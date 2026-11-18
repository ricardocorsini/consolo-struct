import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.beforeEach(async ({ page }) => {
  const data = JSON.parse(
    await readFile(
      "examples/detalhamento/consolos-detalhados.lume.json",
      "utf8",
    ),
  );
  data.pieces[0].design.combinations = Array.from({ length: 10 }, (_, i) => ({
    name: `Caso ${i + 1}`,
    vertical: 120000 + i * 1000,
    horizontal: 10000,
    gamma: 1.4,
  }));
  await page.addInitScript((raw) => {
    localStorage.setItem("lumeconsolo.project.v1", raw);
    (window as any).__commits = 0;
    (window as any).__detailWorkerReplies = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data?.bundle) (window as any).__detailWorkerReplies++;
        });
      }
    };
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberRoot: () => {
        (window as any).__commits++;
      },
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
    };
  }, JSON.stringify(data));
  await page.goto("/");
});
test("detalhamento permanece disponível quando o worker não pode ser criado", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).Worker = class {
      constructor() {
        throw new DOMException("Worker bloqueado", "SecurityError");
      }
    };
  });
  await page.reload();
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  await expect(page.locator(".detail-canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Detalhes DXF", exact: true }),
  ).toBeEnabled();
});
test("Novo projeto exige identidade antes de substituir o atual e cancelar preserva os dados", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Arquivo", exact: true }).click();
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dados do projeto", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText(
    "Consolos - exemplo",
  );
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await page
    .getByLabel("Nome do projeto", { exact: true })
    .fill("Estrutura Oficina");
  await page.getByLabel("Cliente", { exact: true }).fill("Cliente A");
  await page
    .getByLabel("Autor / responsável", { exact: true })
    .fill("Engenheiro B");
  await page
    .getByRole("button", { name: "Criar projeto", exact: true })
    .click();
  await expect(page.locator(".document-title")).toContainText(
    "Estrutura Oficina",
  );
  await expect(page.locator(".document-tab")).toHaveCount(1);
  const event = page.waitForEvent("download");
  await page
    .locator(".quick-access")
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const p = JSON.parse(await readFile((await (await event).path())!, "utf8"));
  expect(p.client).toBe("Cliente A");
  expect(p.author).toBe("Engenheiro B");
  expect(p.pieces).toHaveLength(1);
});
test("árvore abre vários consolos, controla quantidade e multiplica o quadro de aço", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Expandir C02", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recolher C01", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Recolher C02", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("button", { name: "Alterar quantidade de C01", exact: true })
    .click();
  const q = page.getByRole("spinbutton", {
    name: "Quantidade de C01",
    exact: true,
  });
  await q.fill("3");
  await q.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Alterar quantidade de C01",
      exact: true,
    }),
  ).toHaveText("×3");
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Quadro CSV", exact: true }),
  ).toBeEnabled();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Quadro CSV", exact: true }).click();
  const csv = await readFile((await (await event).path())!, "utf8");
  const rows = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .slice(1);
  expect(rows.every((row) => row.startsWith('"C01";"R00";"3";'))).toBe(true);
  await page.getByRole("button", { name: "Recolher C02", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recolher C01", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".detail-canvas")).toBeVisible();
});
test("fecha todas as abas e reabre pelo navegador sem perder o projeto", async ({
  page,
}) => {
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fechar aba Memória", exact: true })
    .click();
  await expect(
    page
      .locator(".document-tabs")
      .getByRole("button", { name: "Memória", exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".browser-documents")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  await expect(
    page
      .locator(".document-tabs")
      .getByRole("button", { name: "Memória", exact: true }),
  ).toBeVisible();
  while (await page.locator(".document-tab-close").count())
    await page.locator(".document-tab-close").first().click();
  await expect(
    page.getByText("Nenhuma vista aberta.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Abrir elevação", exact: true })
    .click();
  await expect(page.locator(".canvas")).toBeVisible();
  await expect(page.locator(".document-title")).toContainText(
    "Consolos - exemplo",
  );
});
test("pan do detalhe mantém a cena e evita commits React por evento; aba preserva câmera", async ({
  page,
}) => {
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  const canvas = page.locator(".detail-canvas"),
    model = page.getByTestId("detail-model");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__detailWorkerReplies))
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Ajustar detalhes à tela", exact: true })
    .click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const before = await model.getAttribute("transform"),
    commits = await page.evaluate(() => (window as any).__commits);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + 150, box.y + 100, { steps: 30 });
  await page.mouse.up({ button: "middle" });
  await expect(model).not.toHaveAttribute("transform", before!);
  expect(
    (await page.evaluate(() => (window as any).__commits)) - commits,
  ).toBeLessThan(5);
  const camera = await model.getAttribute("transform");
  await model.evaluate((el) => ((window as any).__detailNode = el));
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  await expect(model).toHaveAttribute("transform", camera!);
  expect(
    await model.evaluate((el) => el === (window as any).__detailNode),
  ).toBe(true);
});
test("memória só monta as verificações da combinação ao expandir", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Calcular", exact: true }).click();
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  await expect(page.locator(".report-paper .case-memory")).toHaveCount(11);
  await expect(
    page.locator(".report-paper .case-memory .calculation-table"),
  ).toHaveCount(0);
  await page.locator(".report-paper .case-memory > summary").first().click();
  await expect(
    page.locator(".report-paper .case-memory .calculation-table"),
  ).toHaveCount(3);
  await expect(
    page.locator(".report-paper .case-memory").getByTestId("family-anchorage"),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".brand-signature")
      .filter({ hasText: "ConsoloStruct" })
      .first(),
  ).toContainText("OPENSTRUCT");
});
