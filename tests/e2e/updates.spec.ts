import { test, expect, type Page } from "@playwright/test";

// Simula a ponte nativa do Tauri. Estes testes cobrem a interface; a consulta, a
// verificação de assinaturas e a instalação reais são cobertas por `cargo test` e pela
// validação nativa descrita em docs/ATUALIZACOES.md.
type Mock = {
  check?: unknown;
  checkError?: unknown;
  downloadError?: unknown;
  version?: string;
  pending?: unknown;
};

const install = {
  mode: "nsis",
  canInstall: true,
  message: "Instalação independente do Windows.",
  path: "C:\\Users\\x\\AppData\\Local\\ConsoloStruct",
  launcherAvailable: false,
};
const available = {
  current: "0.7.1",
  status: "available",
  offer: {
    version: "0.8.0",
    notes: "Versão 0.8.0 de ConsoloStruct.\n\n- Checagem de atualizações",
    publishedAt: "2026-11-20T10:00:00Z",
    size: 5_000_000,
    fileName: "consolostruct-0.8.0-windows-x86_64.exe",
    platform: "windows",
    arch: "x86_64",
    kind: "nsis",
  },
  latest: "0.8.0",
  target: "windows/x86_64/nsis",
  install,
  checkedAt: 0,
};

async function desktop(page: Page, mock: Mock) {
  await page.addInitScript((mock: Mock) => {
    const calls: string[] = [];
    const callbacks: Record<number, (value: unknown) => void> = {};
    let next = 0;
    let progressHandler = 0;
    const w = window as unknown as Record<string, unknown>;
    w.__updateCalls = calls;
    w.isTauri = true;
    if (mock.pending)
      localStorage.setItem(
        "consolostruct.update.pending",
        JSON.stringify(mock.pending),
      );
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback(callback: (value: unknown) => void) {
        callbacks[++next] = callback;
        return next;
      },
      unregisterCallback(id: number) {
        delete callbacks[id];
      },
      async invoke(cmd: string, args: Record<string, unknown>) {
        calls.push(cmd);
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        switch (cmd) {
          case "plugin:app|version":
            return mock.version ?? "0.7.1";
          case "plugin:event|listen":
            if (args.event === "update://progress")
              progressHandler = args.handler as number;
            return 1;
          case "plugin:event|unlisten":
            return null;
          case "update_check":
            await wait(50);
            if (mock.checkError) throw mock.checkError;
            return mock.check;
          case "update_download":
            for (const received of [1_000_000, 2_500_000, 5_000_000]) {
              await wait(80);
              callbacks[progressHandler]?.({
                event: "update://progress",
                id: 1,
                payload: { received, total: 5_000_000 },
              });
            }
            if (mock.downloadError) throw mock.downloadError;
            return { version: "0.8.0", mode: "nsis" };
          case "update_apply":
          case "update_cancel":
          case "update_discard":
          case "update_open_launcher":
            return null;
          default:
            throw { kind: "state", message: `comando inesperado ${cmd}` };
        }
      },
    };
  }, mock);
}

const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __updateCalls: string[] }).__updateCalls,
  );
const panel = (page: Page) => page.locator(".update-panel[role=dialog]");
const status = (page: Page) => page.locator(".status-update");

test("oferta automática mostra versões e novidades; Agora não não baixa nem instala", async ({
  page,
}) => {
  await desktop(page, { check: available });
  await page.goto("/");
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });
  await expect(panel(page)).toContainText("Atualização disponível");
  await expect(panel(page)).toContainText("Em execução0.7.1");
  await expect(panel(page)).toContainText("Oferecida0.8.0");
  await expect(panel(page)).toContainText("Checagem de atualizações");
  await panel(page).getByRole("button", { name: "Agora não" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(status(page)).toHaveText("Atualização 0.8.0 disponível");
  expect(await calls(page)).toEqual(["update_check"]);
  // Adiado: a mesma versão não volta a interromper ao reabrir.
  await page.reload();
  await expect(status(page)).toHaveText("Atualização 0.8.0 disponível", {
    timeout: 10_000,
  });
  await expect(panel(page)).toHaveCount(0);
  expect(await calls(page)).not.toContain("update_download");
});

test("Atualizar inicia um único download e só reinicia após proteger o trabalho", async ({
  page,
}) => {
  await desktop(page, { check: available });
  await page.goto("/");
  const update = panel(page).getByRole("button", {
    name: "Atualizar",
    exact: true,
  });
  await expect(update).toBeVisible({ timeout: 10_000 });
  await update.dblclick();
  await expect(panel(page).getByRole("progressbar")).toBeVisible();
  await expect(panel(page)).toContainText("Atualização pronta");
  expect(
    (await calls(page)).filter((c) => c === "update_download"),
  ).toHaveLength(1);
  await panel(page)
    .getByRole("button", { name: "Reiniciar e instalar" })
    .click();
  await expect(panel(page)).toContainText("Antes de reiniciar");
  await panel(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(panel(page)).toContainText("Atualização pronta");
  expect(await calls(page)).not.toContain("update_apply");
  await panel(page)
    .getByRole("button", { name: "Reiniciar e instalar" })
    .click();
  await panel(page).getByRole("button", { name: "Reiniciar agora" }).click();
  await expect
    .poll(async () => (await calls(page)).filter((c) => c === "update_apply"))
    .toHaveLength(1);
  const pending = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("consolostruct.update.pending")!),
  );
  expect(pending).toMatchObject({ from: "0.7.1", to: "0.8.0", mode: "nsis" });
});

test("falha de download é explicada e mantém a versão atual", async ({
  page,
}) => {
  await desktop(page, {
    check: available,
    downloadError: {
      kind: "integrity",
      message:
        "O arquivo baixado não confere com o catálogo (SHA-256 divergente)",
    },
  });
  await page.goto("/");
  await panel(page)
    .getByRole("button", { name: "Atualizar", exact: true })
    .click({ timeout: 10_000 });
  await expect(panel(page)).toContainText("O arquivo baixado não confere");
  await expect(panel(page)).toContainText("Nenhum arquivo foi instalado");
  expect(await calls(page)).not.toContain("update_apply");
});

test("offline na consulta automática não interrompe nem diz atualizado", async ({
  page,
}) => {
  await desktop(page, {
    checkError: {
      kind: "offline",
      message: "Sem conexão com o servidor de atualizações (dns)",
    },
  });
  await page.goto("/");
  await expect(status(page)).toHaveText("Atualizações não verificadas", {
    timeout: 10_000,
  });
  await expect(panel(page)).toHaveCount(0);
  await status(page).click();
  await expect(panel(page)).toContainText(
    "Sem conexão com o servidor de atualizações",
  );
  await expect(panel(page)).not.toContainText(/atualizado/i);
});

test("instalação do Launcher encaminha ao Struct Launcher sem instalador próprio", async ({
  page,
}) => {
  await desktop(page, {
    check: {
      ...available,
      install: {
        ...install,
        mode: "launcher",
        canInstall: false,
        launcherAvailable: true,
        message: "Esta instalação é gerenciada pelo Struct Launcher.",
      },
    },
  });
  await page.goto("/");
  await expect(panel(page)).toContainText("gerenciada pelo Struct Launcher", {
    timeout: 10_000,
  });
  await expect(
    panel(page).getByRole("button", { name: "Atualizar", exact: true }),
  ).toHaveCount(0);
  await panel(page)
    .getByRole("button", { name: "Abrir o Struct Launcher" })
    .click();
  await expect.poll(() => calls(page)).toContain("update_open_launcher");
  expect(await calls(page)).not.toContain("update_download");
});

test("versão atual: consulta manual pelo ribbon informa atualizado", async ({
  page,
}) => {
  await desktop(page, {
    check: {
      ...available,
      status: "upToDate",
      offer: undefined,
      latest: "0.7.1",
    },
  });
  await page.goto("/");
  await expect(status(page)).toHaveText("Versão 0.7.1 atualizada", {
    timeout: 10_000,
  });
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Configurações", exact: true }).click();
  await page.getByRole("button", { name: "Verificar atualizações" }).click();
  await expect(panel(page)).toContainText("é a mais recente estável");
});

test("após reiniciar, avisa quando a versão aberta ainda é a anterior", async ({
  page,
}) => {
  await desktop(page, {
    check: available,
    version: "0.7.1",
    pending: { from: "0.7.1", to: "0.8.0", mode: "nsis", at: Date.now() },
  });
  await page.goto("/");
  await expect(page.locator(".toast")).toContainText(
    "A atualização para 0.8.0 não está em execução",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("consolostruct.update.pending"),
    ),
  ).toBeNull();
});

test("interface web explica que a verificação é do aplicativo desktop", async ({
  page,
}) => {
  await page.goto("/");
  await expect(status(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Configurações", exact: true }).click();
  await page.getByRole("button", { name: "Verificar atualizações" }).click();
  await expect(panel(page)).toContainText("aplicativo desktop");
});
