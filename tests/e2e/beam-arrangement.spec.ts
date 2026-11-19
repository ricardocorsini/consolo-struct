import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { shortFixture } from "../fixtures";

const command = (page: Page, action: string) =>
  page.locator(`.ribbon-panel [data-action="${action}"]`);
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });
const option = (dialog: Locator, name: string) =>
  dialog.getByRole("radio", { name: new RegExp(name) });
async function open(page: Page, action: string) {
  await tab(page, "Configurações").click();
  await command(page, action).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}
const done = (dialog: Locator) =>
  dialog.getByRole("button", { name: "Concluir", exact: true }).click();
async function saved(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .locator(".quick-access")
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  return JSON.parse(await readFile((await (await event).path())!, "utf8"));
}

test.beforeEach(async ({ page }) => {
  const piece = shortFixture();
  piece.geometry = { ...piece.geometry, tipHeight: 450 };
  // Projects saved before the option have none of its fields.
  const detailing = piece.detailing as Partial<typeof piece.detailing>;
  delete detailing.barArrangement;
  delete detailing.beamBottomCount;
  delete detailing.beamBottomDiameter;
  const data = {
    format: "lumeconsolo",
    schemaVersion: 4,
    name: "Armado como viga",
    author: "",
    client: "",
    pieces: [piece, { ...structuredClone(piece), id: "second", name: "C02" }],
  };
  await page.addInitScript(
    (raw) => localStorage.setItem("lumeconsolo.project.v1", raw),
    JSON.stringify(data),
  );
  await page.goto("/");
});

test("Configurações > Detalhamento liga o modo viga, desenha as barras e salva por peça", async ({
  page,
}) => {
  await expect(page.getByTestId("beam-positive")).toHaveCount(0);
  const dialog = await open(page, "barArrangement");
  await expect(dialog).toContainText("Peça Curto-ELU");
  await expect(option(dialog, "Consolo")).toBeChecked();
  await option(dialog, "Armado como viga").check();
  await expect(option(dialog, "Armado como viga")).toBeChecked();
  await expect(dialog).toContainText("Dobras do tirante");
  await expect(dialog).toContainText("Dobras da positiva");
  await done(dialog);
  await expect(command(page, "barArrangement")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("beam-positive")).toBeAttached();
  for (const bar of [
    page.locator(".steel-N1 path").first(),
    page.getByTestId("beam-positive").locator("path").first(),
  ]) {
    await expect(bar).toHaveAttribute("d", /A[^A]+A/);
    await expect(bar).toHaveCSS("stroke-linecap", "butt");
  }

  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Seção A–A", exact: true })
    .click();
  await expect(
    page.getByTestId("beam-positive-section").locator("circle"),
  ).toHaveCount(2);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Curto-ELU · Elevação", exact: true })
    .click();

  const project = await saved(page);
  expect(project.pieces[0].detailing.barArrangement).toBe("beam");
  expect(project.pieces[1].detailing.barArrangement).toBe("consolo");

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("beam-positive")).toHaveCount(0);
});

test("o modo viga fica indisponível quando o concreto excedente é recortado", async ({
  page,
}) => {
  const concrete = await open(page, "excessConcrete");
  await option(concrete, "Remover concreto excedente").check();
  await done(concrete);
  const dialog = await open(page, "barArrangement");
  await expect(option(dialog, "Armado como viga")).toBeDisabled();
  await expect(dialog).toContainText(
    "Disponível somente quando o concreto excedente",
  );
});
