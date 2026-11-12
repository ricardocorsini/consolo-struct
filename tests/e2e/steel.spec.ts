import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { shortFixture } from "../fixtures";

const selector = (page: Page) =>
  page.getByRole("combobox", { name: "Aço do tirante", exact: true });
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });
const command = (page: Page, action: string) =>
  page.locator(`.ribbon-panel [data-action="${action}"]`);
async function materials(page: Page) {
  await tab(page, "Modelo").click();
  await command(page, "materials").click();
  await expect(selector(page)).toBeVisible();
}
async function save(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .locator(".quick-access")
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const path = (await (await event).path())!;
  return { path, data: JSON.parse(await readFile(path, "utf8")) };
}
async function calculate(page: Page) {
  await tab(page, "Início").click();
  await command(page, "calculate").click();
}

test.beforeEach(async ({ page }) => {
  const first = shortFixture();
  first.name = "C01";
  first.materials.fyk = 420;
  const second = structuredClone(first);
  second.name = "C02";
  second.id = "second-steel";
  second.materials.fyk = 500;
  await page.addInitScript(
    (raw) => localStorage.setItem("lumeconsolo.project.v1", raw),
    JSON.stringify({
      format: "lumeconsolo",
      schemaVersion: 4,
      name: "Classes de aço",
      client: "",
      author: "",
      pieces: [first, second],
    }),
  );
  await page.goto("/");
});

test("legado 420 MPa abre personalizado sem mutação, permanece unsupported e pode ser salvo/reaberto", async ({
  page,
}) => {
  const before = (await save(page)).data;
  await materials(page);
  await expect(selector(page)).toHaveValue("420");
  await expect(selector(page).locator("option:checked")).toHaveText(
    "Personalizado (420 MPa), não suportado",
  );
  await expect(selector(page).locator("option:checked")).toHaveJSProperty(
    "disabled",
    true,
  );
  await expect(
    page.getByRole("textbox", { name: /Resistência ao escoamento/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
  await calculate(page);
  await expect(page.locator(".result-summary").first()).toContainText(
    "Fora do domínio do motor",
  );
  await expect(
    page.getByText(
      "O motor admite aço do tirante somente CA-25 ou CA-50; informe fyk 250 ou 500 MPa. O valor legado foi preservado, sem conversão automática.",
      { exact: true },
    ),
  ).toBeVisible();
  const saved = await save(page);
  expect(saved.data).toEqual(before);
  await page.getByLabel("Abrir arquivo de projeto").setInputFiles(saved.path);
  await materials(page);
  await expect(selector(page)).toHaveValue("420");
});

test("as duas escolhas gravam números e preservam outras peças, histórico e salvamento", async ({
  page,
}) => {
  await materials(page);
  await expect(selector(page).locator("option")).toHaveText([
    "Personalizado (420 MPa), não suportado",
    "CA-25 · 250 MPa",
    "CA-50 · 500 MPa",
  ]);
  const original = (await save(page)).data;
  for (const fyk of [250, 500]) {
    await selector(page).selectOption(String(fyk));
    const selected = (await save(page)).data;
    expect(selected.pieces[0].materials).toEqual({
      ...original.pieces[0].materials,
      fyk,
    });
    expect(selected.pieces[0]).toEqual({
      ...original.pieces[0],
      materials: { ...original.pieces[0].materials, fyk },
    });
    expect(selected.pieces[1]).toEqual(original.pieces[1]);
    await expect(selector(page).locator("option")).toHaveCount(2);
  }
  await expect(page.locator(".inspector")).toContainText("η1 = 2,25");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(selector(page)).toHaveValue("250");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(selector(page)).toHaveValue("420");
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(selector(page)).toHaveValue("250");
  const saved = await save(page);
  await selector(page).selectOption("500");
  await page.getByLabel("Abrir arquivo de projeto").setInputFiles(saved.path);
  await materials(page);
  await expect(selector(page)).toHaveValue("250");
});

test("memória, PDF e auditoria mostram a classe e η1, mantendo os estados do motor", async ({
  page,
}) => {
  for (const [fyk, steel, eta] of [
    [250, "CA-25", "1,0"],
    [500, "CA-50", "2,25"],
  ] as const) {
    await materials(page);
    await selector(page).selectOption(String(fyk));
    await expect(page.locator(".inspector")).toContainText(
      `Aderência do tirante ${steel}: η1 = ${eta}`,
    );
    await calculate(page);
    await page
      .locator(".document-tabs")
      .getByRole("button", { name: "Memória", exact: true })
      .click();
    const paper = page.locator(".report-paper");
    await expect(paper).toContainText(`Tirante ${steel}`);
    await expect(paper).toContainText(
      `Aderência do tirante ${steel}: η1 = ${eta}`,
    );
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: "Baixar PDF", exact: true }).click();
    const pdf = (await readFile((await (await event).path())!)).toString(
      "latin1",
    );
    expect(pdf).toContain(`Tirante: ${steel}`);
    expect(pdf).toContain(`Aderencia do tirante ${steel}: eta1`);
    await command(page, "export").click();
    const auditEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: /Cálculo auditável/ }).click();
    const audit = JSON.parse(
      await readFile((await (await auditEvent).path())!, "utf8"),
    );
    expect(audit.input.materials.fyk).toBe(fyk);
    expect(audit.input.materials).not.toHaveProperty("steelClass");
    expect(audit.result.combinations).toHaveLength(1);
  }
});

test("aço secundário admite as três classes em Materiais e deixa de aparecer em Cálculo", async ({
  page,
}) => {
  await materials(page);
  const transverse = page.getByRole("combobox", {
    name: "Aço da costura e estribos",
    exact: true,
  });
  await expect(transverse.locator("option")).toHaveText([
    "CA-25 · 250 MPa",
    "CA-50 · 500 MPa",
    "CA-60 · 600 MPa",
  ]);
  const original = (await save(page)).data;
  for (const fykTransverse of [250, 500, 600]) {
    await transverse.selectOption(String(fykTransverse));
    const project = (await save(page)).data;
    expect(project.schemaVersion).toBe(5);
    expect(project.pieces[0].materials).toEqual({
      ...original.pieces[0].materials,
      fykTransverse,
    });
    expect(project.pieces[0].design).not.toHaveProperty("fykTransverse");
    expect(project.pieces[1]).toEqual(original.pieces[1]);
  }
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(transverse).toHaveValue("500");
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(transverse).toHaveValue("600");
  const saved = await save(page);
  await transverse.selectOption("250");
  await page.getByLabel("Abrir arquivo de projeto").setInputFiles(saved.path);
  await materials(page);
  await expect(transverse).toHaveValue("600");
  await command(page, "design").click();
  await page
    .locator(".design-panel")
    .getByText("Durabilidade e disposição", { exact: true })
    .click();
  await expect(
    page.getByRole("combobox", {
      name: "Aço da costura e estribos",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("seletor é acessível por teclado e cabe nos dois temas em janela estreita", async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page
          .getByRole("button", { name: "Alternar tema", exact: true })
          .click();
      await materials(page);
      await selector(page).focus();
      await expect(selector(page)).toBeFocused();
      await selector(page).press("Home");
      await selector(page).press("ArrowDown");
      await selector(page).press("Enter");
      await expect(selector(page)).toHaveValue("500");
      const secondary = page.getByRole("combobox", {
        name: "Aço da costura e estribos",
        exact: true,
      });
      await secondary.focus();
      await expect(secondary).toBeFocused();
      await secondary.press("Home");
      await secondary.press("Enter");
      await expect(secondary).toHaveValue("250");
      await secondary.press("End");
      await secondary.press("Enter");
      await expect(secondary).toHaveValue("600");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await selector(page).evaluate(
          (el) => el.getBoundingClientRect().width <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("abertura com migração preserva CA-60 legado e secundárias, participa do histórico e invalida cálculo", async ({
  page,
}) => {
  const original = (await save(page)).data;
  const legacy = structuredClone(original);
  legacy.schemaVersion = 4;
  legacy.pieces[0].materials.fyk = 600;
  delete legacy.pieces[0].materials.fykTransverse;
  legacy.pieces[0].design.fykTransverse = 600;
  await page.getByLabel("Abrir arquivo de projeto").setInputFiles({
    name: "legado.lume.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await materials(page);
  await expect(selector(page)).toHaveValue("600");
  await expect(selector(page).locator("option:checked")).toHaveText(
    "CA-60 · legado, não suportado no tirante",
  );
  await expect(selector(page).locator("option:checked")).toHaveJSProperty(
    "disabled",
    true,
  );
  const transverse = page.getByRole("combobox", {
    name: "Aço da costura e estribos",
    exact: true,
  });
  await expect(transverse).toHaveValue("600");
  const migrated = (await save(page)).data;
  expect(migrated.schemaVersion).toBe(5);
  expect(migrated.pieces[0].materials).toMatchObject({
    fyk: 600,
    fykTransverse: 600,
  });
  expect(migrated.pieces[0].design).not.toHaveProperty("fykTransverse");
  expect(migrated.pieces[1]).toEqual(original.pieces[1]);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(selector(page)).toHaveValue("420");
  await expect(transverse).toHaveValue("500");
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(selector(page)).toHaveValue("600");
  await calculate(page);
  await expect(page.locator(".result-summary").first()).toContainText(
    "Fora do domínio do motor",
  );
  await materials(page);
  await selector(page).selectOption("500");
  await expect(
    page.getByText("Cálculo desatualizado", { exact: true }),
  ).toBeVisible();
  await calculate(page);
  await materials(page);
  await transverse.selectOption("250");
  await expect(
    page.getByText("Cálculo desatualizado", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(transverse).toHaveValue("600");
  await expect(
    page.getByText("Cálculo desatualizado", { exact: true }),
  ).toHaveCount(0);
});

test("memória e auditoria exibem resistência limitada na ancoragem com γs=1,10", async ({
  page,
}) => {
  const project = (await save(page)).data;
  project.pieces[0].materials = { fck: 30, fyk: 500, fykTransverse: 600 };
  project.pieces[0].design.gammaS = 1.1;
  await page.getByLabel("Abrir arquivo de projeto").setInputFiles({
    name: "limite.consolo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await calculate(page);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  const paper = page.locator(".report-paper");
  await paper.locator(".case-memory summary").first().click();
  await expect(paper).toContainText("fyd adotado na ancoragem");
  await expect(paper).toContainText("fywd adotado da costura e estribos");
  await expect(paper).toContainText("435,0");
  await command(page, "export").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Cálculo auditável/ }).click();
  const audit = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(audit.input.materials.fykTransverse).toBe(600);
  expect(audit.result.values.fyd).toBe(435);
  expect(audit.result.values.fywd).toBe(435);
  const v = audit.result.values;
  expect(v.lb).toBe(
    Math.max(
      (project.pieces[0].rebar.tieDiameter * 435) / (4 * v.fbd),
      25 * project.pieces[0].rebar.tieDiameter,
    ),
  );
});
