import { test, expect, type Page } from "@playwright/test";
import { exampleProject, newPiece, type Piece } from "../../src/domain/model";
import { shortFixture } from "../fixtures";
import { calculate } from "../../src/domain/engine";

async function seed(page: Page, p: Piece) {
  await page.addInitScript(
    (raw) => localStorage.setItem("consolostruct.project.v1", raw),
    JSON.stringify({ ...exampleProject(), pieces: [p] }),
  );
  await page.goto("/");
}

async function view(page: Page, name: string) {
  await page
    .locator(".document-tabs")
    .getByRole("button", { name, exact: true })
    .click();
}

test("alças que não cabem continuam em todas as vistas, com a pendência visível (#64)", async ({
  page,
}, info) => {
  const p = shortFixture();
  p.geometry.width = 100;
  await seed(page, p);
  await expect(page.locator(".steel-N1 path")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("alcas-descartadas-elevacao.png"),
  });
  await view(page, "Seção A–A");
  // Every declared leg is drawn, overlapping at the narrowest loop width.
  await expect(page.locator(".steel-N1 circle")).toHaveCount(p.rebar.tieCount);
  await page.screenshot({
    path: info.outputPath("alcas-descartadas-secao.png"),
  });
  await view(page, "Detalhamento");
  await expect(page.locator(".detail-issues")).toContainText(
    "não cabem aninhadas",
  );
});

test("seção corta as curvas de N1 e P1 e mantém d’ como referência do cálculo", async ({
  page,
}, info) => {
  const p = newPiece(1);
  Object.assign(p.geometry, { length: 120, loadOffset: 60, tipHeight: 350 });
  p.rebar.stirrupCount = 1;
  p.detailing.barArrangement = "beam";
  await seed(page, p);
  await expect(page.locator(".steel-N1 path")).toHaveCount(1);
  await expect(page.getByTestId("beam-positive").locator("path")).toHaveCount(
    1,
  );
  await page.screenshot({ path: info.outputPath("curvas-viga-elevacao.png") });
  await view(page, "Seção A–A");
  const scale = Math.min(
    480 / (p.geometry.columnWidth + 120),
    340 / (p.geometry.height + 80),
    480 / p.geometry.width,
  );
  for (const [selector, depth, count] of [
    [".steel-N1 circle", 131.3 - Math.sqrt(90 ** 2 - 65 ** 2), 4],
    [
      '[data-testid="beam-positive-section"] circle',
      311.5083333333333 + Math.sqrt(30 ** 2 - 20 ** 2),
      2,
    ],
  ] as const) {
    const circles = page.locator(selector);
    await expect(circles).toHaveCount(count);
    const ys = await circles.evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("cy"))),
    );
    for (const y of ys) expect(y).toBeCloseTo(140 + depth * scale, 8);
  }
  await expect(page.locator("#piece-drawing")).toContainText("d’ = 4,1 cm");
  await page.screenshot({ path: info.outputPath("curvas-viga-secao.png") });
  await view(page, "Detalhamento");
  await expect(page.locator(".detail-canvas")).toContainText(
    "CORTE A-A / x=6,0 cm",
  );
  await page.screenshot({
    path: info.outputPath("curvas-viga-detalhamento.png"),
  });
});

test("elevação conserva o gancho de suporte e a penetração das costuras", async ({
  page,
}, info) => {
  const p = shortFixture();
  p.design.supportAnchor = "hook";
  const { values } = calculate(p);
  await seed(page, p);
  const tie = page.locator(".steel-N1 path").first();
  await expect(tie).toHaveAttribute("d", /A/);
  const height = await tie.evaluate(
    (path) => (path as SVGPathElement).getBBox().height,
  );
  const scale = Math.min(480 / 1350, 340 / 580);
  expect(height).toBeGreaterThan(values.anchorN1_tail * scale);
  const stitch = page.locator(".steel-N2 path").first();
  const start = Number(
    (await stitch.getAttribute("d"))!.match(/^M(-?[\d.]+)/)![1],
  );
  expect(start).toBeCloseTo(480 - values.anchorN2_adopted * scale, 8);
  await page.screenshot({
    path: info.outputPath("gancho-suporte-costuras.png"),
  });
});

test("pinos no plano A–A aparecem com suas posições transversais", async ({
  page,
}, info) => {
  const p = newPiece(1);
  p.design.frontAnchor = "welded";
  p.geometry.loadOffset = p.geometry.length / 2;
  p.rebar.stirrupCount = 1;
  p.detailing.pins = 3;
  p.detailing.pinSpacing = 50;
  await seed(page, p);
  await view(page, "Seção A–A");
  await expect(
    page.locator('.steel-detail-families [data-family="pin"]'),
  ).toHaveCount(3);
  await expect(
    page.locator('.steel-detail-families [data-family="welded"]'),
  ).toHaveCount(0);
  const dimension = (await page
    .getByRole("button", { name: /^Editar b =/ })
    .boundingBox())!;
  for (const pin of await page
    .locator('.steel-detail-families [data-family="pin"]')
    .all()) {
    const box = (await pin.boundingBox())!;
    expect(box.y + box.height).toBeLessThan(dimension.y);
  }
  await page.screenshot({ path: info.outputPath("pinos-no-corte.png") });
  await view(page, "Detalhamento");
  await expect(page.locator(".detail-canvas")).toContainText("PINO");
  await page.screenshot({
    path: info.outputPath("pinos-no-corte-detalhamento.png"),
  });
});
