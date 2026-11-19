import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { number } from "../../src/domain/model";

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

test("as seis dimensões editadas aparecem nas vistas e nos três formatos vetoriais", async ({
  page,
}) => {
  const tabs = page.locator(".document-tabs");
  await tabs
    .getByRole("button", { name: "C01 · Elevação", exact: true })
    .click();
  const entries = [
    ["width", "Largura", "b", 41.2],
    ["height", "Altura no pilar", "H", 54.3],
    ["tipHeight", "Altura na ponta", "H2", 27.1],
    ["length", "Comprimento", "L", 48.5],
    ["loadOffset", "Posição da carga", "A", 31.2],
    ["columnWidth", "Dimensão do pilar", "P", 93.4],
  ] as const;
  for (const [, name, symbol, value] of entries) {
    const field = page.getByRole("textbox", {
      name: new RegExp(`^${name} ${symbol} cm$`),
    });
    await field.fill(String(value).replace(".", ","));
    await field.press("Enter");
  }
  const dimensions = entries.map(([id, , symbol, value]) => ({
    id,
    label: `${symbol} = ${number(value)}`,
  }));
  const h1 = "H1 = 27,2";
  const elevation = page.getByRole("group", {
    name: "Elevação do consolo C01",
  });
  for (const { id, label } of dimensions)
    if (id !== "width")
      await expect(
        elevation.getByRole("button", { name: `Editar ${label}`, exact: true }),
      ).toBeVisible();
  await expect(elevation.getByRole("img", { name: /^H1 =/ })).toContainText(h1);
  await tabs.getByRole("button", { name: "Seção A–A", exact: true }).click();
  const section = page.getByRole("group", {
    name: "Seção transversal do consolo C01",
  });
  await expect(
    section.getByRole("button", { name: "Editar b = 41,2", exact: true }),
  ).toBeVisible();
  const cutHeight = (await section
    .getByRole("img", { name: /^H\(x1\) =/ })
    .locator("text")
    .textContent())!;

  await tabs.getByRole("button", { name: "Vista 3D", exact: true }).click();
  const view = page.getByTestId("viewport-3d");
  await expect(view).toHaveAttribute("data-renderer", /webgl|svg/);
  for (const { id, label } of dimensions)
    await expect(
      view.getByLabel(`Editar cota 3D ${id}`, { exact: true }),
    ).toHaveText(`${label} cm`);
  await expect(
    view.getByRole("img", { name: `${h1} cm`, exact: true }),
  ).toBeVisible();
  const annotations = await view
    .locator(".three-dimension-label")
    .evaluateAll((nodes) =>
      nodes
        .filter((el) => getComputedStyle(el).visibility === "visible")
        .map((el) => {
          const { left, right, top, bottom } = el.getBoundingClientRect();
          return { left, right, top, bottom };
        }),
    );
  for (const [i, a] of annotations.entries())
    for (const b of annotations.slice(i + 1))
      expect(
        a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top,
      ).toBe(true);

  await tabs.getByRole("button", { name: "Detalhamento", exact: true }).click();
  const drawing = page.locator(".detail-canvas");
  const labels = [...dimensions.map(({ label }) => label), h1, cutHeight];
  for (const label of labels) await expect(drawing).toContainText(label);
  await expect(drawing).toContainText("H(B-B) = ");
  for (const format of ["SVG", "DXF", "PDF"]) {
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: `Detalhes ${format}`, exact: true })
      .click();
    const raw = await readFile((await (await downloaded).path())!);
    let content = raw.toString("utf8");
    if (format === "PDF") {
      expect(raw.subarray(0, 5).toString()).toBe("%PDF-");
      content = Array.from(
        raw.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g),
        ([, stream]) => {
          try {
            return inflateSync(Buffer.from(stream, "latin1")).toString(
              "latin1",
            );
          } catch {
            return stream;
          }
        },
      )
        .join("\n")
        .replace(/\\([()])/g, "$1");
    }
    for (const label of labels) expect(content).toContain(label);
    expect(content).toContain("H(B-B) = ");
  }
  const saved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const project = JSON.parse(
    await readFile((await (await saved).path())!, "utf8"),
  );
  expect(project.schemaVersion).toBe(6);
  expect(Object.keys(project.pieces[0].geometry).sort()).toEqual(
    [...entries.map(([id]) => id), "cover"].sort(),
  );
  for (const [id, , , value] of entries) {
    expect(project.pieces[0].geometry[id]).toBeCloseTo(value * 10, 8);
  }
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
