import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { shortFixture, cantileverFixture } from "../fixtures";

const text =
  "GN-9062-INTERFACE: enquadramento da produção conferido pelo responsável.";
const panel = (page: Page) => page.locator(".design-panel");
const policy = (page: Page) =>
  panel(page).getByRole("combobox", {
    name: "Política do coeficiente γn",
    exact: true,
  });
const justification = (page: Page) =>
  panel(page).getByRole("textbox", {
    name: /^Justificativa da política de γn/,
  });
const minimum = (page: Page) =>
  panel(page).getByRole("textbox", {
    name: /^Coeficiente adicional mínimo γn/,
  });
const production = (page: Page) =>
  panel(page).getByRole("combobox", {
    name: "Processo de produção",
    exact: true,
  });
async function seed(page: Page, first = shortFixture()) {
  first.name = "C01";
  Object.assign(first.loads, {
    vertical: 350000,
    horizontal: 40000,
    gamma: 1.4,
  });
  first.design.forceMode = "characteristic";
  if (first.design.horizontalMode === "analysis")
    first.design.horizontalJustification =
      "Esforços característicos provenientes da análise do modelo de referência.";
  const second = shortFixture();
  second.name = "C02";
  second.id = "gamma-n-second";
  const data = JSON.parse(
    JSON.stringify({
      format: "lumeconsolo",
      schemaVersion: 5,
      name: "Política de gamma n",
      client: "",
      author: "",
      pieces: [first, second],
    }),
  );
  for (const p of data.pieces) {
    delete p.design.gammaNPolicy;
    delete p.design.gammaNJustification;
  }
  await page.addInitScript(
    (raw) => localStorage.setItem("lumeconsolo.project.v1", raw),
    JSON.stringify(data),
  );
  await page.goto("/");
}
async function form(page: Page) {
  await page.getByRole("tab", { name: "Configurações", exact: true }).click();
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: "Critérios da peça selecionada", exact: true })
    .click();
  await expect(policy(page)).toBeVisible();
}
async function edit(field: Locator, value: string) {
  await field.fill(value);
  await field.press("Enter");
}
async function calculate(page: Page) {
  await page.getByRole("tab", { name: "Início", exact: true }).click();
  await page.getByRole("tabpanel").locator('[data-action="calculate"]').click();
}
async function saved(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .locator(".quick-access")
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const path = (await (await event).path())!;
  return { path, data: JSON.parse(await readFile(path, "utf8")) };
}

test("legado mantém piso; tabela oculta o mínimo e só calcula com justificativa válida", async ({
  page,
}) => {
  await seed(page);
  await form(page);
  await expect(policy(page)).toHaveValue("floor12");
  await expect(minimum(page)).toHaveValue("1,2");
  await expect(justification(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
  await edit(minimum(page), "1,5");
  await policy(page).selectOption("table9062");
  await expect(minimum(page)).toHaveCount(0);
  await expect(justification(page)).toHaveValue("");
  await calculate(page);
  await expect(page.locator(".result-summary").first()).toContainText(
    "Fora do domínio do motor",
  );
  await expect(
    page.getByText(/Informe justificativa de ao menos 10 caracteres/),
  ).toBeVisible();
  await form(page);
  await justification(page).fill("123456789");
  await calculate(page);
  await expect(page.locator(".result-summary").first()).toContainText(
    "Fora do domínio do motor",
  );
  await form(page);
  await justification(page).fill(text);
  await calculate(page);
  await expect(page.locator(".result-summary").first()).not.toContainText(
    "Fora do domínio",
  );
  await expect(
    page
      .locator("tr.result-review")
      .filter({ hasText: "Adoção da tabela de γn" })
      .first(),
  ).toBeVisible();
  await form(page);
  await policy(page).selectOption("floor12");
  await expect(minimum(page)).toHaveValue("1,5");
  await expect(justification(page)).toHaveCount(0);
});

test("produção e preponderância mostram a tabela; moldado no local desabilita a opção e aplica a regra conservadora", async ({
  page,
}) => {
  await seed(page);
  await form(page);
  await edit(minimum(page), "1,5");
  await policy(page).selectOption("table9062");
  await justification(page).fill(text);
  for (const [process, permanent, value] of [
    ["factory", true, "1"],
    ["factory", false, "1,1"],
    ["precast", true, "1,1"],
    ["precast", false, "1,2"],
  ] as const) {
    await production(page).selectOption(process);
    await panel(page)
      .getByRole("checkbox", {
        name: "Ação permanente predominante",
        exact: true,
      })
      .setChecked(permanent);
    await expect(panel(page).locator(".gamma-n-control")).toContainText(
      `γn adotado: ${value}`,
    );
  }
  await production(page).selectOption("cast");
  await expect(
    policy(page).locator('option[value="table9062"]'),
  ).toHaveJSProperty("disabled", true);
  await expect(panel(page).locator(".gamma-n-control")).toContainText(
    "A tabela sem piso não se aplica a moldado no local",
  );
  await expect(panel(page).locator(".gamma-n-control")).toContainText(
    "γn adotado: 1,5",
  );
  await expect(minimum(page)).toHaveValue("1,5");
  await expect(justification(page)).toHaveCount(0);
  await calculate(page);
  await expect(
    page
      .locator("tr.result-review")
      .filter({ hasText: "Adoção da tabela de γn" }),
  ).toHaveCount(0);
  await expect(page.locator(".gamma-n-policy")).toContainText(
    "foi aplicada a política conservadora",
  );
});

test("escolhas são por peça, entram no histórico e são preservadas no arquivo", async ({
  page,
}) => {
  const first = shortFixture();
  first.rebar.stirrupBranches = 4;
  first.rebar.constructiveDiameter = 10;
  await seed(page, first);
  const before = (await saved(page)).data;
  await form(page);
  await edit(minimum(page), "1,5");
  await policy(page).selectOption("table9062");
  await justification(page).fill(text);
  const save = await saved(page);
  expect(save.data.schemaVersion).toBe(5);
  expect(save.data.pieces[0].rebar).toEqual(before.pieces[0].rebar);
  expect(save.data.pieces[0].design).toMatchObject({
    gammaN: 1.5,
    gammaNPolicy: "table9062",
    gammaNJustification: text,
  });
  expect(save.data.pieces[1]).toEqual(before.pieces[1]);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(justification(page)).toHaveValue("");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(policy(page)).toHaveValue("floor12");
  await expect(minimum(page)).toHaveValue("1,5");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(minimum(page)).toHaveValue("1,2");
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(minimum(page)).toHaveValue("1,5");
  await page.getByLabel("Abrir arquivo de projeto").setInputFiles(save.path);
  await form(page);
  await expect(policy(page)).toHaveValue("table9062");
  await expect(justification(page)).toHaveValue(text);
  expect((await saved(page)).data.pieces[0].rebar).toEqual(
    before.pieces[0].rebar,
  );
});

for (const model of ["short", "beam"]) {
  test(`memória, PDF e auditoria rastreiam a decisão e 539 kN — ${model}`, async ({
    page,
  }, testInfo) => {
    await seed(
      page,
      model === "beam" ? cantileverFixture({ length: 700 }) : shortFixture(),
    );
    await form(page);
    await policy(page).selectOption("table9062");
    await justification(page).fill(text);
    await calculate(page);
    await page
      .locator(".document-tabs")
      .getByRole("button", { name: "Memória", exact: true })
      .click();
    const paper = page.locator(".report-paper");
    await expect(paper.locator(".gamma-n-policy")).toContainText(text);
    await expect(paper.locator(".gamma-n-policy")).toContainText(
      "γn adotado 1,1; γn do piso 1,2",
    );
    await paper.locator(".case-memory > summary").first().click();
    await expect(
      paper.getByText("γn da tabela NBR 9062", { exact: true }),
    ).toBeVisible();
    await testInfo.attach(`gamma-n-memoria-${model}`, {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
    const pdfEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Baixar PDF", exact: true }).click();
    const pdf = (await readFile((await (await pdfEvent).path())!)).toString(
      "latin1",
    );
    expect(pdf).toContain("GN-9062-INTERFACE");
    expect(pdf).toContain("Tabela NBR 9062, sem piso de 1,2");
    await page.getByRole("tabpanel").locator('[data-action="export"]').click();
    const auditEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: /Cálculo auditável/ }).click();
    const audit = JSON.parse(
      await readFile((await (await auditEvent).path())!, "utf8"),
    );
    expect(audit.result.values).toMatchObject({
      gammaN: 1.1,
      gammaN9062: 1.1,
      vertical: 539000,
    });
    expect(audit.result.gammaNDecision).toMatchObject({
      policy: "table9062",
      justification: text,
    });
    expect(
      audit.result.checks.find((c: { id: string }) => c.id === "gammaNPolicy")
        .status,
    ).toBe("review");
  });
}

test("controle acessível nos dois temas e em janela estreita", async ({
  page,
}, testInfo) => {
  await seed(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page
          .getByRole("button", { name: "Alternar tema", exact: true })
          .click();
      await form(page);
      await policy(page).selectOption("floor12");
      await policy(page).focus();
      await expect(policy(page)).toBeFocused();
      await policy(page).press("End");
      await policy(page).press("Enter");
      await expect(policy(page)).toHaveValue("table9062");
      await justification(page).fill(text);
      await expect(justification(page)).toHaveAttribute("maxlength", "1000");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await panel(page)
          .locator(".gamma-n-control")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await policy(page).scrollIntoViewIfNeeded();
      await testInfo.attach(`gamma-n-${width}-${theme}`, {
        body: await page.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
    }
  }
});
