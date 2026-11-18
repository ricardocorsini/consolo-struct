import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { cantileverFixture, shortFixture } from "../fixtures";
import { beamHorizontalFixture } from "../reference/autodesign-cases";

async function open(page: Page, piece = shortFixture()) {
  await page.addInitScript(
    (raw) => localStorage.setItem("lumeconsolo.project.v1", raw),
    JSON.stringify({
      format: "lumeconsolo",
      schemaVersion: 4,
      name: "Busca de armadura",
      client: "",
      author: "",
      pieces: [piece],
    }),
  );
  await page.goto("/");
}
async function saved(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .locator(".quick-access")
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  return JSON.parse(await readFile((await (await event).path())!, "utf8"));
}
const suggest = (page: Page) =>
  page.getByRole("button", { name: "Sugerir armaduras", exact: true }).click();

test("sugestão reduz candidatos, passa nas verificações e mantém histórico e dados externos", async ({
  page,
}) => {
  await open(page);
  const before = await saved(page);
  await suggest(page);
  await expect(page.getByRole("status")).toContainText(
    "Arranjo sugerido entre 28 candidatos",
  );
  await expect(page.locator(".result-summary").first()).toContainText(
    "Atende às verificações implementadas",
  );
  const after = await saved(page),
    p = after.pieces[0];
  expect(p.rebar).toMatchObject({
    tieCount: 6,
    tieDiameter: 10,
    stitchCount: 4,
    stirrupCount: 5,
  });
  for (const key of [
    "supportRebarArea",
    "anchorConfinementArea",
    "inputsConfirmed",
    "weldResistancePerBar",
    "roughnessConfirmed",
  ])
    expect(p.design[key]).toBe(before.pieces[0].design[key]);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  expect(await saved(page)).toEqual(after);
});

test("antigo vencedor com costura sem espaço é recusado com rótulo e sem editar a peça", async ({
  page,
}) => {
  await open(page, beamHorizontalFixture());
  const before = await saved(page);
  await suggest(page);
  await expect(page.getByRole("status")).toContainText(
    "Espaço livre vertical da costura",
  );
  await expect(page.getByRole("status")).toContainText(
    "Nenhum dado foi alterado.",
  );
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
  expect(await saved(page)).toEqual(before);
});

test("a sugestão sincroniza TS com N1 e mantém os dados da solda", async ({
  page,
}) => {
  const p = shortFixture();
  Object.assign(p.design, {
    frontAnchor: "welded",
    supportAnchor: "hook",
    weldResistancePerBar: 12345,
    weldSpecification: "Qualificação registrada para a solda.",
  });
  await open(page, p);
  await suggest(page);
  await expect(page.getByRole("status")).toContainText("Arranjo sugerido");
  const result = (await saved(page)).pieces[0];
  expect(result.rebar.tieDiameter).not.toBe(p.rebar.tieDiameter);
  expect(result.design).toMatchObject({
    weldResistancePerBar: p.design.weldResistancePerBar,
    weldSpecification: p.design.weldSpecification,
    weldedBarDiameter: result.rebar.tieDiameter,
  });
});

test("falha do concreto é explicada nos dois temas em janela estreita, sem solução artificial", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, cantileverFixture({ vertical: 350000, length: 700 }));
  for (const dark of [false, true]) {
    if (dark)
      await page
        .getByRole("button", { name: "Alternar tema", exact: true })
        .click();
    await suggest(page);
    await expect(page.getByRole("status")).toContainText(
      "Compressão diagonal do concreto (viga em balanço)",
    );
    await expect(page.getByRole("status")).toContainText(
      "Nenhum dado foi alterado.",
    );
    await expect(page.locator(".result-summary").first()).toContainText(
      "Há verificações não atendidas",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
