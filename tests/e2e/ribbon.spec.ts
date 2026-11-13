import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";

const tabs = [
  "Arquivo",
  "Início",
  "Modelo",
  "Exibir",
  "Documentação",
  "Configurações",
];
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });
const command = (page: Page, action: string) =>
  page.locator(`.ribbon-panel [data-action="${action}"]`);
const doc = (page: Page, text: string) =>
  page.locator(".document-tab-open").filter({ hasText: text });
const length = (page: Page) =>
  page.locator(".inspector").getByLabel("Comprimento", { exact: false });
const undo = (page: Page) =>
  page.getByRole("button", { name: "Desfazer", exact: true });
const redo = (page: Page) =>
  page.getByRole("button", { name: "Refazer", exact: true });

async function downloaded(page: Page, trigger: Locator | string) {
  const event = page.waitForEvent("download");
  if (typeof trigger === "string") await page.keyboard.press(trigger);
  else await trigger.click();
  const download = await event;
  return {
    name: download.suggestedFilename(),
    data: await readFile((await download.path())!),
  };
}
async function saved(page: Page) {
  const file = await downloaded(
    page,
    page
      .locator(".quick-access")
      .getByRole("button", { name: "Salvar projeto", exact: true }),
  );
  expect(file.name).toMatch(/\.consolo\.json$/);
  return JSON.parse(file.data.toString());
}

test.beforeEach(async ({ page }) => {
  const raw = await readFile(
    "examples/detalhamento/consolos-detalhados.lume.json",
    "utf8",
  );
  await page.addInitScript(
    (raw) => localStorage.setItem("lumeconsolo.project.v1", raw),
    raw,
  );
  await page.goto("/");
});

test("composição, painel associado, foco e navegação por mouse e teclado", async ({
  page,
}) => {
  const counts = [5, 8, 11, 15, 7, 22];
  for (const [i, name] of tabs.entries()) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      (await tab(page, name).getAttribute("id"))!,
    );
    await expect(page.getByRole("tabpanel")).toHaveAttribute(
      "id",
      (await tab(page, name).getAttribute("aria-controls"))!,
    );
    await expect(page.locator(".ribbon-panel button")).toHaveCount(counts[i]);
  }
  await tab(page, "Documentação").focus();
  await page.keyboard.press("Home");
  await expect(tab(page, "Arquivo")).toBeFocused();
  for (const name of [...tabs.slice(1), tabs[0]]) {
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, name)).toBeFocused();
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
  }
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Configurações")).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await expect(tab(page, "Configurações")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Documentação")).toBeFocused();
  await expect(tab(page, "Documentação")).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(command(page, "report")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(tab(page, "Documentação")).toBeFocused();
});

test("fluxo principal permanece em Início e cálculo contextual permanece na memória", async ({
  page,
}) => {
  await command(page, "add").click();
  const pieceId = await page
    .locator(".tree-item.selected")
    .getAttribute("data-piece-id");
  await command(page, "geometry").click();
  await length(page).fill("35");
  await length(page).press("Enter");
  await command(page, "loads").click();
  await page.getByLabel("Força vertical", { exact: false }).fill("150");
  await page.getByLabel("Força vertical", { exact: false }).press("Enter");
  await command(page, "calculate").click();
  await expect(page.locator(".result-summary").first()).toBeVisible();
  await command(page, "report").click();
  await expect(page.locator(".report-paper")).toBeVisible();
  await page
    .getByRole("button", { name: "Calcular revisão atual", exact: true })
    .click();
  await expect(page.locator(".document-tab.active")).toContainText("Memória");
  const pdf = await downloaded(
    page,
    page.getByRole("button", { name: "Baixar PDF", exact: true }),
  );
  expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
  await command(page, "calculate").click();
  await expect(page.locator(".document-tab.active")).toContainText("Elevação");
  await command(page, "details").click();
  await expect(page.locator(".detail-canvas")).toBeVisible();
  await expect(page.getByLabel("Peça do detalhamento")).toHaveValue(pieceId!);
  await expect(tab(page, "Início")).toHaveAttribute("aria-selected", "true");
});

test("edição e critérios reabrem propriedades da peça selecionada; visibilidade não edita", async ({
  page,
}) => {
  await page.locator(".tree-piece").filter({ hasText: "C02" }).click();
  await tab(page, "Modelo").click();
  for (const action of ["geometry", "loads", "design", "rebar"]) {
    await page
      .getByRole("button", { name: "Fechar propriedades", exact: true })
      .click();
    await command(page, action).click();
    await expect(page.locator(".property-selection")).toContainText("C02");
    const name = await command(page, action).getAttribute("aria-label");
    await expect(
      page
        .locator(".inspector-tabs")
        .getByRole("button", { name: name!, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(command(page, action)).not.toHaveAttribute("aria-pressed");
  }
  const before = await saved(page);
  await tab(page, "Exibir").click();
  await command(page, "steel").click();
  await command(page, "forces").click();
  await expect(page.locator(".steel")).toHaveCount(0);
  await expect(page.locator(".force-label")).toHaveCount(0);
  await expect(command(page, "steel")).toHaveAttribute("aria-pressed", "false");
  await expect(command(page, "forces")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await saved(page)).toEqual(before);
});

test("trocar só abas superiores preserva documentos, câmeras, seleção, resultados e histórico", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.locator(".tree-piece").filter({ hasText: "C02" }).click();
  await length(page).fill("32,5");
  await length(page).press("Enter");
  await length(page).fill("35");
  await length(page).press("Enter");
  await undo(page).click();
  await command(page, "calculate").click();
  const result = await page.locator(".checks-body").textContent();
  const before = await saved(page);
  for (const document of [
    "Elevação",
    "Seção A–A",
    "Vista 3D",
    "Memória",
    "Detalhamento",
  ]) {
    await doc(page, document).click();
    if (document === "Memória")
      await expect(page.locator(".report-paper")).toBeVisible();
    if (document === "Detalhamento") {
      await expect(page.locator(".detail-canvas")).toBeVisible();
      const initial = await page
        .getByTestId("detail-model")
        .getAttribute("transform");
      await page
        .getByRole("button", { name: "Aumentar detalhes", exact: true })
        .click();
      await expect(page.getByTestId("detail-model")).not.toHaveAttribute(
        "transform",
        initial!,
      );
    } else if (document === "Vista 3D") {
      await expect(page.getByTestId("viewport-3d")).toHaveAttribute(
        "data-renderer",
        /webgl|svg/,
      );
    }
    const content =
      document === "Memória"
        ? page.locator(".report-paper")
        : document === "Detalhamento"
          ? page.getByTestId("detail-model")
          : document === "Vista 3D"
            ? page.getByTestId("viewport-3d")
            : page.getByTestId("drawing-model");
    const attribute = document === "Vista 3D" ? "data-camera" : "transform";
    const camera = await content.getAttribute(attribute);
    await content.evaluate((el) => {
      (window as any).__ribbonRetainedNode = el;
    });
    for (const name of [...tabs, ...tabs]) {
      await tab(page, name).click();
      await expect(page.locator(".document-tab.active")).toContainText(
        document,
      );
      await expect(page.locator(".tree-piece.selected")).toContainText("C02");
      await expect(undo(page)).toBeEnabled();
      await expect(redo(page)).toBeEnabled();
    }
    expect(
      await content.evaluate(
        (el) => el === (window as any).__ribbonRetainedNode,
      ),
    ).toBe(true);
    expect(await content.getAttribute(attribute)).toBe(camera);
  }
  expect(await saved(page)).toEqual(before);
  await doc(page, "Elevação").click();
  await expect(page.locator(".checks-body")).toHaveText(result!);
  await redo(page).click();
  await expect(length(page)).toHaveValue("35");
  await undo(page).click();
  await expect(length(page)).toHaveValue("32,5");
});

test("troca de aba confirma campo válido no blur e conserva rascunho inválido", async ({
  page,
}) => {
  await length(page).fill("32,5");
  await tab(page, "Modelo").click();
  await expect(length(page)).toHaveValue("32,5");
  await expect(undo(page)).toBeEnabled();
  await command(page, "calculate").click();
  await length(page).fill("35");
  await tab(page, "Exibir").click();
  await expect(
    page.getByText("Cálculo desatualizado", { exact: true }),
  ).toBeVisible();
  await length(page).fill("0");
  await tab(page, "Início").click();
  await expect(length(page)).toHaveValue("0");
  await expect(length(page)).toHaveAttribute("aria-invalid", "true");
  await command(page, "calculate").click();
  await expect(page.locator(".toast")).toContainText(
    "campo com valor inválido",
  );
  expect((await saved(page)).pieces[0].geometry.length).toBe(350);
  await length(page).press("Escape");
  await expect(length(page)).toHaveValue("35");
  await command(page, "calculate").click();
  await expect(page.locator(".result-summary").first()).toBeVisible();
});

test("modos locais e gerais sincronizam, e navegação do ribbon continua sendo do modelo", async ({
  page,
}) => {
  await tab(page, "Exibir").click();
  await command(page, "pan").press("Space");
  await expect(
    page.getByRole("button", { name: "Pan no desenho", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Selecionar no desenho", exact: true })
    .click();
  await expect(command(page, "select")).toHaveAttribute("aria-pressed", "true");
  await command(page, "zoomIn").click();
  await expect(page.getByTestId("drawing-model")).not.toHaveAttribute(
    "transform",
    "translate(400 300) scale(1) translate(-400 -300)",
  );
  await command(page, "fit").click();
  await expect(page.getByTestId("drawing-model")).toHaveAttribute(
    "transform",
    "translate(400 300) scale(1) translate(-400 -300)",
  );
  await doc(page, "Detalhamento").click();
  const detail = page.getByTestId("detail-model");
  await expect(detail).toBeVisible();
  const initial = await detail.getAttribute("transform");
  await page
    .getByRole("button", { name: "Aumentar detalhes", exact: true })
    .click();
  await expect(detail).not.toHaveAttribute("transform", initial!);
  const camera = await detail.getAttribute("transform");
  await command(page, "fit").click();
  await expect(page.locator(".document-tab.active")).toContainText("Elevação");
  await doc(page, "Detalhamento").click();
  await expect(detail).toHaveAttribute("transform", camera!);
  await command(page, "three").click();
  await expect(page.getByTestId("viewport-3d")).toHaveAttribute(
    "data-renderer",
    /webgl|svg/,
  );
  await command(page, "pan").click();
  await expect(
    page.getByRole("button", { name: "Pan no modelo 3D", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Orbitar modelo 3D", exact: true })
    .click();
  await expect(command(page, "select")).toHaveAttribute("aria-pressed", "true");
});

test("organização da peça, confirmação, cancelar, desfazer/refazer e proteção da última", async ({
  page,
}) => {
  await tab(page, "Modelo").click();
  await command(page, "duplicate").click();
  await expect(page.locator(".tree-piece.selected")).toContainText("C03");
  await command(page, "rename").click();
  await page.getByLabel("Identificação", { exact: true }).fill("Teste-ribbon");
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect(page.locator(".tree-piece.selected")).toContainText(
    "Teste-ribbon",
  );
  await command(page, "delete").click();
  await expect(page.getByRole("dialog")).toContainText(
    "Teste-ribbon será removido",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.locator(".tree-piece")).toHaveCount(3);
  await command(page, "delete").click();
  await page.getByRole("button", { name: "Excluir peça", exact: true }).click();
  await expect(page.locator(".tree-piece")).toHaveCount(2);
  await undo(page).click();
  await expect(page.locator(".tree-piece")).toHaveCount(3);
  await redo(page).click();
  await expect(page.locator(".tree-piece")).toHaveCount(2);
  await command(page, "delete").click();
  await page.getByRole("button", { name: "Excluir peça", exact: true }).click();
  await expect(page.locator(".tree-piece")).toHaveCount(1);
  await expect(command(page, "delete")).toBeDisabled();
  await expect(tab(page, "Modelo")).toBeFocused();
});

test("diálogos movidos fecham com Escape, reabrem e devolvem foco sem alterar dados", async ({
  page,
}) => {
  const before = await saved(page);
  for (const [name, action] of [
    ["Arquivo", "project"],
    ["Arquivo", "new"],
    ["Arquivo", "export"],
    ["Modelo", "rename"],
    ["Modelo", "delete"],
  ]) {
    await tab(page, name).click();
    const button = command(page, action);
    await button.focus();
    await button.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(button).toBeFocused();
    await button.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("button", { name: "Fechar janela", exact: true })
      .click();
  }
  expect(await saved(page)).toEqual(before);
});

test("exportações diretas e cálculo auditável mantêm identidade, nomes e unidades", async ({
  page,
}) => {
  await tab(page, "Documentação").click();
  const pdf = await downloaded(page, command(page, "pdf"));
  expect(pdf.name).toBe("C01-consolostruct.pdf");
  expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
  const dxf = await downloaded(page, command(page, "dxf"));
  expect(dxf.name).toBe("C01-consolostruct.dxf");
  expect(dxf.data.toString()).toContain("$INSUNITS\n70\n4");
  expect(dxf.data.toString()).toContain("GEOMETRIA");
  const svg = await downloaded(page, command(page, "svg"));
  expect(svg.name).toBe("C01-consolostruct.svg");
  expect(svg.data.toString()).toContain("Unidades: mm.");
  const csv = await downloaded(page, command(page, "csv"));
  expect(csv.name).toMatch(/-quantidades\.csv$/);
  expect(csv.data.toString()).toContain('"b (cm)"');
  expect(csv.data.toString()).toContain('"C01"');
  expect(csv.data.toString()).toContain('"C02"');
  await tab(page, "Arquivo").click();
  await command(page, "export").click();
  await expect(page.getByRole("dialog")).toContainText(".consolo.json");
  await expect(page.getByRole("dialog")).toContainText(
    "não reabre como projeto",
  );
  const audit = await downloaded(
    page,
    page.getByRole("button", { name: /Cálculo auditável/ }),
  );
  expect(audit.name).toBe("C01-consolostruct.calc.json");
  const data = JSON.parse(audit.data.toString());
  expect(data.input.geometry.width).toBe(400);
  expect(data.result.engineVersion).toBe("0.4.0");
  expect(data).not.toHaveProperty("pieces");
  await command(page, "export").click();
  await page
    .getByRole("button", {
      name: "Abrir detalhamento e quadro de aço",
      exact: true,
    })
    .click();
  await expect(page.locator(".detail-canvas")).toBeVisible();
  for (const scope of ["one", "all"]) {
    await page.getByLabel("Escopo dos detalhes").selectOption(scope);
    await expect(
      page.getByRole("button", { name: "Detalhes SVG", exact: true }),
    ).toBeEnabled();
    const detail = await downloaded(
      page,
      page.getByRole("button", { name: "Detalhes SVG", exact: true }),
    );
    expect(detail.name).toContain(
      scope === "one" ? "-detalhes-peca.svg" : "-detalhes-todos.svg",
    );
    expect(detail.data.toString()).toContain("RELAÇÃO DO AÇO");
    expect(detail.data.toString()).toContain("cm");
    expect(detail.data.toString().includes("C02")).toBe(scope === "all");
  }
});

test("saídas diretas continuam bloqueadas por geometria ou rascunho inválido", async ({
  page,
}) => {
  const files: string[] = [];
  page.on("download", (file) => files.push(file.suggestedFilename()));
  await page.getByLabel("Posição da carga", { exact: false }).fill("99");
  await page.getByLabel("Posição da carga", { exact: false }).press("Enter");
  await tab(page, "Documentação").click();
  for (const action of ["dxf", "svg"]) {
    await command(page, action).click();
    await expect(page.locator(".toast")).toContainText(
      "inconsistências geométricas",
    );
  }
  await undo(page).click();
  await length(page).fill("0");
  await tab(page, "Início").click();
  await expect(length(page)).toHaveAttribute("aria-invalid", "true");
  await tab(page, "Documentação").click();
  for (const action of ["pdf", "csv"]) {
    await command(page, action).click();
    await expect(page.locator(".toast")).toContainText(
      "campo com valor inválido",
    );
  }
  expect(files).toEqual([]);
});

test("toque alcança abas e comandos roláveis em janela estreita", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:1420/");
  for (const name of tabs) {
    await tab(page, name).tap();
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
  }
  await tab(page, "Início").tap();
  await command(page, "export").tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Fechar janela", exact: true }).tap();
  await expect(command(page, "export")).toBeFocused();
  await tab(page, "Exibir").tap();
  await command(page, "grid").tap();
  await expect(command(page, "grid")).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test("salvar por teclado, reabrir e recuperar documentos fechados mantém o projeto", async ({
  page,
}) => {
  await length(page).fill("32,5");
  const file = await downloaded(page, "Control+s");
  const before = JSON.parse(file.data.toString());
  expect(before.pieces[0].geometry.length).toBe(325);
  await page.keyboard.press("Control+z");
  await expect(length(page)).toHaveValue("45");
  await page.keyboard.press("Control+Shift+z");
  await expect(length(page)).toHaveValue("32,5");
  await page.getByLabel("Abrir arquivo de projeto").setInputFiles({
    name: file.name,
    mimeType: "application/json",
    buffer: file.data,
  });
  expect(await saved(page)).toEqual(before);
  while (await page.locator(".document-tab-close").count())
    await page.locator(".document-tab-close").first().click();
  await expect(
    page.getByText("Nenhuma vista aberta.", { exact: true }),
  ).toBeVisible();
  await tab(page, "Documentação").click();
  for (const action of ["report", "details", "pieces"]) {
    await command(page, action).click();
    await command(page, action).click();
    await expect(page.locator(".document-tab")).toHaveCount(
      ["report", "details", "pieces"].indexOf(action) + 1,
    );
  }
  await tab(page, "Exibir").click();
  await command(page, "elevation").click();
  await expect(length(page)).toHaveValue("32,5");
  await page
    .getByRole("button", { name: "Fechar aba Memória", exact: true })
    .click();
  await page
    .locator(".browser-documents")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  await expect(page.locator(".report-paper")).toBeVisible();
  expect(await saved(page)).toEqual(before);
});

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 960, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`todos os comandos alcançáveis nos dois temas em ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    await page.reload();
    for (const dark of [false, true]) {
      if (dark)
        await page
          .getByRole("button", { name: "Alternar tema", exact: true })
          .click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        dark ? "dark" : "light",
      );
      for (const name of tabs) {
        await tab(page, name).focus();
        await page.keyboard.press("Enter");
        await expect(tab(page, name)).toBeInViewport();
        const buttons = page.locator(".ribbon-panel button");
        for (const button of await buttons.all()) {
          if (await button.isDisabled()) continue;
          await button.focus();
          await expect(button).toBeInViewport();
          expect(
            await button.evaluate((el) => el.scrollWidth <= el.clientWidth),
          ).toBe(true);
        }
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth === innerWidth &&
              document.documentElement.scrollHeight === innerHeight,
          ),
        ).toBe(true);
        expect(
          (await page.locator(".canvas").boundingBox())!.height,
        ).toBeGreaterThan(250);
      }
    }
  });
}
