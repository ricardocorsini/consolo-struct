import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exampleProject } from "../../src/domain/model";
import { shortFixture } from "../fixtures";

async function seed(page: Page, beam: boolean, branches: 2 | 4) {
  const p = shortFixture();
  p.geometry.tipHeight = 450;
  p.rebar.stirrupBranches = branches;
  // Four physical N1 bars in the first layer are required to define N3G.
  p.rebar.tieCount = 8;
  p.design.frontAnchor = "welded";
  p.design.tieLayers = 2;
  p.detailing.pins = 3;
  p.detailing.barArrangement = beam ? "beam" : "consolo";
  await page.addInitScript(
    (raw) => localStorage.setItem("consolostruct.project.v1", raw),
    JSON.stringify({ ...exampleProject(), pieces: [p] }),
  );
  await page.goto("/");
  return p;
}

async function elevation(page: Page) {
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Curto-ELU · Elevação", exact: true })
    .click();
}

for (const beam of [false, true])
  for (const branches of [2, 4] as const)
    test(`ligações, N2/N3/N4 e d’ — ${beam ? "viga" : "consolo"}, ${branches} ramos`, async ({
      page,
    }, info) => {
      const p = await seed(page, beam, branches);
      if (branches === 4)
        await page.getByRole("button", { name: "Alternar tema" }).click();
      const pins = page.locator('[data-family="pin"]');
      await expect(pins).toHaveCount(1);
      await expect(pins).toHaveAttribute("data-quantity", "3");
      await expect(pins).toHaveAttribute("aria-label", /PINO · 3 × Ø16,0 mm/);
      const scale = Math.min(480 / 1350, 340 / 580);
      const coords = (await pins.locator("path").getAttribute("d"))!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      expect(coords[0]).toBeCloseTo(480 + 300 * scale);
      expect(coords[1]).toBeCloseTo(185 - 150 * scale);
      expect(coords[2]).toBeCloseTo(coords[0]);
      expect(coords[3]).toBeCloseTo(185 + 200 * scale);
      await expect(page.locator('[data-family="welded"]')).toHaveCount(
        beam ? 0 : 2,
      );
      await expect(page.locator(".steel-N4 path")).toHaveCount(branches);
      await expect(page.getByTestId("beam-positive")).toHaveCount(beam ? 1 : 0);
      await expect(page.locator(".steel-mounting")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("ligacoes-elevacao.png") });
      await page
        .locator(".document-tabs")
        .getByRole("button", { name: "Seção A–A", exact: true })
        .click();
      await expect(page.locator(".steel-N4 circle")).toHaveCount(branches);
      await expect(page.locator(".steel-N2 circle")).toHaveCount(16);
      await expect(page.locator('[data-n3-part="grampo"]')).toHaveCount(
        branches === 4 ? 1 : 0,
      );
      await expect(page.locator("#piece-drawing")).toContainText("d’ =");
      await expect(page.getByTestId("detail-families")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("ligacoes-secao.png") });
      await elevation(page);
      await page.getByRole("tab", { name: "Exibir", exact: true }).click();
      await page
        .getByRole("button", { name: "Mostrar armaduras", exact: true })
        .click();
      await expect(page.getByTestId("detail-families")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Mostrar armaduras", exact: true })
        .click();
      await expect(pins).toHaveCount(1);
      const event = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Salvar projeto", exact: true })
        .click();
      const saved = JSON.parse(
        await readFile((await (await event).path())!, "utf8"),
      );
      expect(saved.pieces[0]).toEqual(p);
      expect(saved.schemaVersion).toBe(6);
    });

test("edição dos pinos chega à elevação, ao histórico e ao arquivo reaberto", async ({
  page,
}) => {
  await seed(page, false, 4);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  const count = page.getByRole("textbox", { name: /Quantidade de pinos/ });
  await count.fill("5");
  await count.press("Enter");
  await elevation(page);
  const pins = page.locator('[data-family="pin"]');
  await expect(pins).toHaveAttribute("data-quantity", "5");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(pins).toHaveAttribute("data-quantity", "3");
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(pins).toHaveAttribute("data-quantity", "5");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const path = (await (await event).path())!;
  await page.getByLabel("Abrir arquivo de projeto").setInputFiles(path);
  await elevation(page);
  await expect(pins).toHaveAttribute("data-quantity", "5");
  await expect(page.locator(".steel-N4 path")).toHaveCount(4);
});
