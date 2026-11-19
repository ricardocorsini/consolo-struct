import { test, expect, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { exampleProject, number } from "../../src/domain/model";
import { drawingLayoutFixtures } from "../drawingLayoutFixtures";

async function textConflicts(canvas: Locator) {
  return canvas.evaluate((node: SVGSVGElement) => {
    const model = node.querySelector<SVGGElement>(
      '[data-testid="detail-model"]',
    )!;
    const sheet = model.getScreenCTM()!.inverse();
    const limit = node.viewBox.baseVal;
    const boxes = Array.from(node.querySelectorAll("text"))
      .filter((text) => text.textContent?.trim())
      .map((text) => {
        const { x, y, width, height } = text.getBBox();
        const transform = sheet.multiply(text.getScreenCTM()!);
        const corners = [
          [x, y],
          [x + width, y],
          [x, y + height],
          [x + width, y + height],
        ].map(([xx, yy]) => new DOMPoint(xx, yy).matrixTransform(transform));
        return {
          text: text.textContent,
          left: Math.min(...corners.map((v) => v.x)),
          top: Math.min(...corners.map((v) => v.y)),
          right: Math.max(...corners.map((v) => v.x)),
          bottom: Math.max(...corners.map((v) => v.y)),
        };
      })
      .sort((a, b) => a.left - b.left);
    const hits: string[] = [];
    const tolerance = 1e-4;
    for (const [i, a] of boxes.entries()) {
      if (
        a.left < limit.x - tolerance ||
        a.top < limit.y - tolerance ||
        a.right > limit.x + limit.width + tolerance ||
        a.bottom > limit.y + limit.height + tolerance
      )
        hits.push(`Fora da prancha: ${a.text}`);
      for (
        let j = i + 1;
        j < boxes.length && boxes[j].left < a.right - tolerance;
        j++
      ) {
        const b = boxes[j];
        if (
          b.right > a.left + tolerance &&
          b.top < a.bottom - tolerance &&
          a.top < b.bottom - tolerance
        )
          hits.push(`${a.text} / ${b.text}`);
      }
    }
    return hits;
  });
}

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

test("as peças C01 e C02 do exemplo têm caixas de texto disjuntas", async ({
  page,
}, info) => {
  const canvas = page.locator(".detail-canvas");
  await expect(canvas).toHaveAttribute("aria-label", "Detalhes de C01");
  await expect.poll(() => textConflicts(canvas)).toEqual([]);
  await canvas.screenshot({ path: info.outputPath("c01-prancha.png") });
  await page.getByLabel("Peça do detalhamento").selectOption("double-tie");
  await expect(canvas).toHaveAttribute("aria-label", "Detalhes de C02");
  await expect.poll(() => textConflicts(canvas)).toEqual([]);
  await canvas.screenshot({ path: info.outputPath("c02-prancha.png") });
});

for (const { name, piece } of drawingLayoutFixtures().filter(({ name }) =>
  [
    "Pequeno",
    "Grande",
    "Quatro camadas e vinte pinos",
    "Recortado",
    "Armado como viga",
  ].includes(name),
)) {
  test(`${name} tem caixas de texto disjuntas no navegador`, async ({
    page,
  }) => {
    await page.evaluate(
      (raw) => localStorage.setItem("consolostruct.project.v1", raw),
      JSON.stringify({ ...exampleProject(), pieces: [piece] }),
    );
    await page.reload();
    await page
      .locator(".document-tabs")
      .getByRole("button", { name: "Detalhamento", exact: true })
      .click();
    const canvas = page.getByRole("img", {
      name: `Detalhes de ${name}`,
      exact: true,
    });
    await expect(
      canvas.getByText("DISTRIBUIÇÃO DOS ESTRIBOS", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => textConflicts(canvas)).toEqual([]);
  });
}

test("editar camadas e pinos reorganiza a prancha sem sobrepor textos", async ({
  page,
}) => {
  const canvas = page.locator(".detail-canvas");
  await expect(canvas).toHaveAttribute("aria-label", "Detalhes de C01");
  await page.getByLabel("Disposição do tirante").selectOption("2");
  await expect(canvas.getByText(/ - 2ª camada$/)).toHaveCount(1);
  await expect.poll(() => textConflicts(canvas)).toEqual([]);
  const pins = page.getByLabel(/Quantidade de pinos/);
  await pins.fill("3");
  await pins.press("Enter");
  await expect(canvas.getByText(/^3 PINO(?:-\d+)? \(pinos\)$/)).toBeVisible();
  await expect(canvas.getByText(/^s = 2 × /)).toBeVisible();
  await expect.poll(() => textConflicts(canvas)).toEqual([]);
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
  await expect.poll(() => textConflicts(drawing)).toEqual([]);
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

test("prancha e SVG exportado mostram N1 com a bitola física", async ({
  page,
}, info) => {
  const canvas = page.locator(".detail-canvas");
  const bitola = page.getByLabel("Bitola do tirante");
  for (const diameter of [10, 20]) {
    await bitola.fill(String(diameter));
    await bitola.press("Enter");
    const stroke = canvas
      .locator(`line[data-physical-diameter="${diameter}"]`)
      .first();
    const point = canvas
      .locator(`circle[data-physical-diameter="${diameter}"]`)
      .first();
    await expect(stroke).toHaveAttribute("stroke-width", String(diameter / 10));
    await expect(stroke).toHaveCSS("stroke-linecap", "butt");
    await expect(point).toHaveAttribute("r", String(diameter / 20));
    await expect(point).toHaveCSS("stroke", "none");
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Detalhes SVG", exact: true }).click();
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toMatch(
    /<line[^>]+stroke-width="2"[^>]+data-physical-diameter="20"/,
  );
  expect(svg).toMatch(
    /<circle[^>]+r="1"[^>]+stroke="none"[^>]+data-physical-diameter="20"/,
  );
  await canvas.screenshot({ path: info.outputPath("prancha-escala-real.png") });
});

test("Relação do Aço integra a alça e o gancho e atualiza a ponta reta", async ({
  page,
}, info) => {
  const canvas = page.locator(".detail-canvas");
  const heading = "Desenho esquemático da armadura";
  await expect(canvas).toContainText(heading);
  await expect(canvas).not.toContainText("FORMAS DE DOBRAMENTO E POSIÇÕES");
  await page.getByLabel("Ancoragem do detalhe").selectOption("hook");
  const projection = page.getByLabel("Projeção do gancho no suporte");
  await projection.fill("60");
  await projection.press("Enter");
  await expect(canvas).toContainText("Vista lateral");
  const hooks = canvas.locator('path[data-schematic-bar="N1-1"]');
  await expect(hooks).toHaveCount(3);
  const hook = hooks.last();
  const oldCurve = await hook.getAttribute("d");
  const tail = page.getByLabel("Ponta reta do gancho");
  await tail.fill("19");
  await tail.press("Enter");
  await expect(canvas).toContainText("Ponta reta 19,0 cm");
  await expect(hook).not.toHaveAttribute("d", oldCurve!);
  await canvas.screenshot({
    path: info.outputPath("relacao-desenhos-claro.png"),
  });
  await page.getByRole("button", { name: "Alternar tema" }).click();
  await expect(page.locator(".detail-viewport")).toHaveClass(/dark/);
  await expect(hook).toHaveCSS("stroke", "rgb(119, 173, 255)");
  await canvas.screenshot({
    path: info.outputPath("relacao-desenhos-escuro.png"),
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Detalhes SVG", exact: true }).click();
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain(heading);
  expect(svg).toContain('data-schematic-bar="N1-1"');
  expect(svg).toContain("Ponta reta 19,0 cm");
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
  expect(dxf).toContain("AcDbPolyline");
  expect(dxf).toContain("\n42\n");
  expect(dxf).toContain("Desenho esquem\\U+00E1tico da armadura");
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
  expect(csv).not.toContain("Desenho esquemático");
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
