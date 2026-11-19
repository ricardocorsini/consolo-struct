import { test, expect, type Page } from "@playwright/test";
import { exampleProject, newPiece, type Piece } from "../../src/domain/model";
import { shortFixture } from "../fixtures";
async function seed(page: Page, count = 5, length?: number) {
  const p = shortFixture();
  p.rebar.stirrupBranches = 4;
  p.rebar.stirrupCount = count;
  if (length !== undefined) p.geometry.length = length;
  await seedPiece(page, p);
}
async function seedPiece(page: Page, p: Piece) {
  await page.addInitScript(
    (raw) => localStorage.setItem("consolostruct.project.v1", raw),
    JSON.stringify({ ...exampleProject(), pieces: [p] }),
  );
  await page.goto("/");
}
test("N3G tem plano próprio e seção indica a projeção, com N4 em cada plano", async ({
  page,
}) => {
  await seed(page);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Seção A–A", exact: true })
    .click();
  const outer = page.locator('[data-n3-part="externo"]'),
    inner = page.locator('[data-n3-part="grampo"]');
  const x = Number(await outer.getAttribute("data-longitudinal-position")),
    xi = Number(await inner.getAttribute("data-longitudinal-position"));
  expect(x).toBe(28.15);
  expect(xi - x).toBeCloseTo(6.3, 10);
  await expect(page.locator("#piece-drawing")).toContainText("projeção do par");
  const planes = await page
    .locator(".steel-N4 circle")
    .evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("data-longitudinal-position"))),
    );
  expect(planes).toEqual([x, xi, xi, x]);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  await expect(page.locator(".detail-canvas")).toContainText("N3G projetado");
  await expect(page.locator(".detail-issues")).not.toContainText(
    "Há interferência física entre estribos",
  );
});

test("colisão de 0,828 mm com N1 aparece na seção e no detalhamento", async ({
  page,
}, info) => {
  const p = newPiece(1);
  p.design.frontAnchor = "welded";
  p.rebar.stirrupBranches = 4;
  p.rebar.stirrupDiameter = 8;
  await seedPiece(page, p);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Seção A–A", exact: true })
    .click();
  await expect(page.locator("#piece-drawing")).toContainText(
    "Arranjo N3/N3G inválido para fabricação",
  );
  const warning = await page
    .locator("#piece-drawing")
    .getByText(/Arranjo N3\/N3G inválido para fabricação/)
    .boundingBox();
  const widthDimension = await page
    .getByRole("button", { name: /^Editar b =/ })
    .boundingBox();
  expect(warning).not.toBeNull();
  expect(widthDimension).not.toBeNull();
  expect(warning!.y + warning!.height).toBeLessThan(widthDimension!.y);
  await page.screenshot({ path: info.outputPath("n3g-colisao.png") });
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  await expect(
    page
      .locator(".detail-issues .error")
      .filter({ hasText: "N3/N3G interfere com N1" }),
  ).toBeVisible();
});

test("seção avisa sobre dobra inválida fora da primeira estação", async ({
  page,
}) => {
  const p = shortFixture();
  p.geometry.tipHeight = 100;
  await seedPiece(page, p);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Seção A–A", exact: true })
    .click();
  await expect(page.locator("#piece-drawing")).toContainText(
    "Arranjo N3/N3G inválido para fabricação",
  );
});

for (const branches of [2, 4] as const)
  test(`uma posição: seção e N4 usam os planos físicos de ${branches} ramos`, async ({
    page,
  }, info) => {
    const p = newPiece(1);
    p.design.frontAnchor = "welded";
    p.rebar.stirrupBranches = branches;
    p.rebar.stirrupCount = 1;
    await seedPiece(page, p);
    await page
      .locator(".document-tabs")
      .getByRole("button", { name: "Seção A–A", exact: true })
      .click();
    await expect(page.locator("#piece-drawing")).toContainText(
      "1º ESTRIBO · x = 12,50 cm",
    );
    await expect(page.locator('[data-n3-part="externo"]')).toHaveAttribute(
      "data-longitudinal-position",
      "125",
    );
    const planes = await page
      .locator(".steel-N4 circle")
      .evaluateAll((nodes) =>
        nodes.map((n) => Number(n.getAttribute("data-longitudinal-position"))),
      );
    expect(planes).toEqual(
      branches === 4 ? [125, 118.7, 118.7, 125] : [125, 125],
    );
    await page.screenshot({
      path: info.outputPath(`n3g-posicao-unica-${branches}.png`),
    });
    await page
      .locator(".document-tabs")
      .getByRole("button", { name: "Detalhamento", exact: true })
      .click();
    await expect(page.locator(".detail-canvas")).toContainText(
      "CORTE A-A / x=12,5 cm",
    );
    if (branches === 4)
      await expect(page.locator(".detail-canvas")).toContainText(
        "N3G projetado de x=11,9 cm",
      );
  });

test("sem N1 centrais, não inventa N3G e mostra apenas as duas N4 externas", async ({
  page,
}, info) => {
  const p = newPiece(1);
  p.rebar.stirrupBranches = 4;
  // One loop (two legs) per layer: no central N1 pair. With 4 Ø20 the inner
  // loop is now drawn (#64), so it no longer represents this case.
  p.rebar.tieCount = 2;
  p.design.frontAnchor = "loop";
  p.design.supportAnchor = "straight";
  await seedPiece(page, p);
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "Editar armaduras", exact: true })
    .click();
  await expect(page.getByLabel("Ramos efetivos de N3")).toHaveValue("4");
  await expect(
    page
      .locator(".rebar-editor")
      .filter({ has: page.getByLabel("Diâmetro N4") }),
  ).toContainText("2 barras");
  await expect(page.locator(".steel-N4 path")).toHaveCount(2);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Seção A–A", exact: true })
    .click();
  await expect(page.locator('[data-n3-part="grampo"]')).toHaveCount(0);
  await expect(page.locator(".steel-N4 circle")).toHaveCount(2);
  await expect(page.locator("#piece-drawing")).not.toContainText(
    "projeção do par",
  );
  await expect(page.locator("#piece-drawing")).toContainText(
    "Arranjo N3/N3G inválido para fabricação",
  );
  await page.screenshot({ path: info.outputPath("n3g-sem-n1-centrais.png") });
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  await expect(
    page
      .locator(".detail-issues .error")
      .filter({ hasText: "não possui as duas barras centrais" }),
  ).toBeVisible();
  await expect(page.locator(".detail-canvas")).not.toContainText(
    "N3G projetado",
  );
});
test("arranjo congestionado exibe erro físico específico de N3/N3G", async ({
  page,
}) => {
  await seed(page, 4, 80);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Seção A–A", exact: true })
    .click();
  await expect(page.locator("#piece-drawing")).toContainText(
    "Arranjo N3/N3G inválido para fabricação",
  );
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  await expect(
    page.locator(".detail-issues .error").filter({
      hasText:
        "Há interferência física entre estribos N3 e/ou estribos internos fechados N3G",
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".detail-issues .error")
      .filter({ hasText: "Falta espaço longitudinal" }),
  ).toBeVisible();
});
