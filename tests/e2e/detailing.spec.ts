import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  const project = await readFile(
    "examples/detalhamento/consolos-detalhados.lume.json",
    "utf8",
  );
  await page.addInitScript(
    (raw) => localStorage.setItem("lumeconsolo.project.v1", raw),
    project,
  );
  await page.goto("/");
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
});

test("projeto e peça novos usam N1 com gancho e TS de mesma bitola", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Arquivo", exact: true }).click();
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await page
    .getByLabel("Nome do projeto", { exact: true })
    .fill("Ancoragem padrão");
  await page
    .getByRole("button", { name: "Criar projeto", exact: true })
    .click();
  const elevation = page.locator("#piece-drawing");
  const welded = elevation.locator('[data-mark="TS"] circle');
  await expect(welded).toHaveCount(1);
  const scale = Math.min(480 / 550, 340 / 480);
  expect(Number(await welded.getAttribute("cy"))).toBeCloseTo(
    185 + 61.3 * scale,
    8,
  );
  expect(Number(await welded.getAttribute("r"))).toBeCloseTo(10 * scale, 8);
  await page.getByRole("tab", { name: "Início", exact: true }).click();
  await page.getByRole("button", { name: "Novo consolo", exact: true }).click();
  await page
    .locator(".ribbon-panel")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  const canvas = page.locator(".detail-canvas");
  await expect(canvas).toContainText("Gancho de 90° no suporte");
  await expect(canvas).toContainText("Barra transversal soldada");
  const diameter = page.getByLabel("Bitola do tirante");
  await diameter.fill("16");
  await diameter.press("Enter");
  await expect(canvas).toContainText("Ø16,0");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const saved = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  expect(
    saved.pieces.map((p: { design: Record<string, unknown> }) => [
      p.design.frontAnchor,
      p.design.supportAnchor,
      p.design.weldedBarDiameter,
      p.design.weldResistancePerBar,
    ]),
  ).toEqual([
    ["welded", "hook", 20, 0],
    ["welded", "hook", 16, 0],
  ]);
});

test("detalhe individual e de todos: DXF em cm, quadro CSV e PDF vetorial", async ({
  page,
}) => {
  const canvas = page.locator(".detail-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toContainText("RELAÇÃO DO AÇO");
  await expect(canvas).toContainText("C01");
  let event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Detalhes DXF", exact: true }).click();
  let download = await event;
  let dxf = await readFile((await download.path())!, "utf8");
  expect(dxf).toContain("$INSUNITS\n70\n5");
  expect(dxf).toContain("C01");
  expect(dxf).not.toContain("C02");
  expect(dxf).toContain("AcDbArc");
  await page.getByLabel("Escopo dos detalhes").selectOption("all");
  await page.getByLabel("Peça do detalhamento").selectOption("double-tie");
  await expect(canvas).toContainText("C02");
  await expect(canvas).toContainText("TIRANTE DUPLO");
  event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Detalhes DXF", exact: true }).click();
  download = await event;
  dxf = await readFile((await download.path())!, "utf8");
  expect(dxf).toContain("C01");
  expect(dxf).toContain("C02");
  expect(dxf).toContain("Concreto total:");
  expect(dxf).toContain("do projeto:");
  event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Quadro CSV", exact: true }).click();
  download = await event;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain('"C01"');
  expect(csv).toContain('"C02"');
  expect(csv).toContain("C unitário (cm)");
  event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Detalhes PDF", exact: true }).click();
  download = await event;
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(10000);
});

test("tirante duplo, revisão e notas persistem e participam do histórico", async ({
  page,
}) => {
  await page.getByLabel("Disposição do tirante").selectOption("2");
  await expect(page.locator(".detail-canvas")).toContainText("TIRANTE DUPLO");
  await page.getByLabel("Revisão do detalhe").fill("R03");
  await page
    .getByLabel("Notas do detalhamento")
    .fill("Conferir posição com a forma do pilar.");
  await expect(page.locator(".detail-canvas")).toContainText("R03");
  await expect(page.locator(".detail-canvas")).toContainText(
    "Conferir posição com a forma do pilar.",
  );
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const project = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  expect(project.schemaVersion).toBe(6);
  expect(project.pieces[0].design.tieLayers).toBe(2);
  expect(project.pieces[0].detailing.revision).toBe("R03");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.getByLabel("Notas do detalhamento")).toHaveValue("");
});

test("pan e zoom, tema escuro e campo inválido bloqueando exportação", async ({
  page,
}) => {
  const canvas = page.locator(".detail-canvas"),
    model = page.getByTestId("detail-model");
  await page.getByRole("button", { name: "Ajustar detalhes à tela" }).click();
  const before = await model.getAttribute("transform");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + 150, box.y + 140, { steps: 3 });
  await page.mouse.up({ button: "middle" });
  expect(await model.getAttribute("transform")).not.toBe(before);
  await page
    .getByRole("button", { name: "Aumentar detalhes", exact: true })
    .click();
  await expect(page.locator(".detail-view-tools")).toContainText("125%");
  await page.getByRole("button", { name: "Alternar tema" }).click();
  await expect(page.locator(".detail-viewport")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  const length = page.getByRole("textbox", {
    name: "Penetração da costura cm",
    exact: true,
  });
  await length.fill("-5");
  await length.press("Enter");
  await page.getByRole("button", { name: "Detalhes DXF", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("campo inválido");
});

test("alternância de escopo, troca de peça, pan com soltura e exportações SVG/PDF permanecem equivalentes (#54)", async ({
  page,
}) => {
  const canvas = page.locator(".detail-canvas"),
    model = page.getByTestId("detail-model");
  await expect(canvas).toBeVisible();

  let event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Detalhes SVG", exact: true }).click();
  let download = await event;
  const svgOne = await readFile((await download.path())!, "utf8");
  expect(svgOne).toContain("<svg");
  expect(svgOne).toContain("C01");

  await page.getByLabel("Escopo dos detalhes").selectOption("all");
  await page.getByLabel("Peça do detalhamento").selectOption("double-tie");
  await expect(canvas).toContainText("C02");
  await page.getByLabel("Escopo dos detalhes").selectOption("one");
  await page.getByLabel("Peça do detalhamento").selectOption({ index: 0 });
  await expect(canvas).toContainText("C01");

  const box = (await canvas.boundingBox())!;
  const before = await model.getAttribute("transform");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 + 30,
    {
      steps: 4,
    },
  );
  await page.mouse.up({ button: "left" });
  expect(await model.getAttribute("transform")).not.toBe(before);

  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "C01 · Elevação", exact: true })
    .click();
  await page.getByRole("button", { name: "Calcular", exact: true }).click();
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  await expect(page.locator(".report-paper")).toContainText("C01");
  event = page.waitForEvent("download");
  await page
    .locator(".report-selection")
    .getByRole("button", { name: "Baixar PDF", exact: true })
    .click();
  download = await event;
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
});

test("volume de concreto e taxa de aço do detalhamento coincidem com a modelagem (#63)", async ({
  page,
}, testInfo) => {
  const canvas = page.locator(".detail-canvas");
  await expect(canvas).toContainText("Taxa de aço");
  const concrete = page.getByTestId("detail-concrete");
  await expect(concrete).toContainText("m³/pç");
  const detailVolume = (await concrete.textContent())!.match(
    /Concreto: ([\d,]+)/,
  )![1];
  const steelRate = page.getByTestId("detail-steel-rate");
  await expect(steelRate).toContainText("kg/m³");
  const rate = (await steelRate.textContent())!.match(
    /Taxa de aço: ([\d,]+)/,
  )![1];
  await expect(canvas).toContainText(`Concreto por peça: ${detailVolume} m³`);
  await expect(canvas).toContainText(`Taxa de aço: ${rate} kg/m³`);
  const screenshot = testInfo.outputPath("fonte-unica-armaduras.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("fonte-unica-armaduras", {
    path: screenshot,
    contentType: "image/png",
  });
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  await expect(page.getByTestId("memory-consumption")).toContainText(
    `concreto ${detailVolume} m³`,
  );
  await expect(page.getByTestId("memory-consumption")).toContainText(
    `taxa de aço ${rate} kg/m³`,
  );
  await page
    .locator(".document-tab-open")
    .filter({ hasText: "Elevação" })
    .click();
  await expect(page.locator(".geometry-summary")).toContainText(
    `Vol. ${detailVolume} m³`,
  );
});
