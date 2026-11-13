import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const settings = (page: Page) =>
  page.getByRole("tab", { name: "Configurações", exact: true });
const panel = (page: Page) => page.getByRole("tabpanel");
const ribbonTab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });
const documentTab = (page: Page, name: string) =>
  page.locator(".document-tabs").getByRole("button", { name, exact: true });

async function savedProject(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .locator(".quick-access")
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const project = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  await page.getByRole("button", { name: "Dispensar mensagem" }).click();
  return project;
}

test.beforeEach(async ({ page }) => {
  const project = await readFile(
    "examples/detalhamento/consolos-detalhados.lume.json",
    "utf8",
  );
  await page.addInitScript((raw) => {
    localStorage.setItem("lumeconsolo.project.v1", raw);
  }, project);
  await page.goto("/");
});

test("aba única, grupos, relação com o painel e navegação completa por teclado", async ({
  page,
}) => {
  await expect(settings(page)).toHaveCount(1);
  await settings(page).click();
  await expect(settings(page)).toHaveAttribute("aria-selected", "true");
  await expect(panel(page)).toHaveAttribute(
    "id",
    (await settings(page).getAttribute("aria-controls"))!,
  );
  await expect(panel(page)).toHaveAttribute(
    "aria-labelledby",
    (await settings(page).getAttribute("id"))!,
  );
  for (const name of [
    "Geral / Aparência",
    "Desenho",
    "Modelo 3D",
    "Dimensionamento",
    "Detalhamento",
  ])
    await expect(
      panel(page).getByRole("region", { name, exact: true }),
    ).toBeVisible();
  await expect(page.locator(".document-tabs")).not.toContainText(
    "Configurações",
  );
  await settings(page).press("Home");
  await expect(ribbonTab(page, "Arquivo")).toBeFocused();
  for (const name of [
    "Início",
    "Modelo",
    "Exibir",
    "Documentação",
    "Configurações",
    "Arquivo",
  ]) {
    await page.keyboard.press("ArrowRight");
    await expect(ribbonTab(page, name)).toBeFocused();
    await expect(ribbonTab(page, name)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await page.keyboard.press("ArrowLeft");
  await expect(settings(page)).toBeFocused();
  await settings(page).press("Home");
  await page.keyboard.press("End");
  await expect(settings(page)).toBeFocused();
  await expect(settings(page)).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeFocused();
  for (const name of [
    "Tema escuro",
    "Verificar atualizações",
    "Mostrar cotas",
    "Mostrar armaduras",
    "Mostrar cargas",
    "Mostrar grade",
    "Critérios da peça selecionada",
    "Limite da biela da peça selecionada",
    "Coeficientes dos materiais da peça selecionada",
    "Concreto excedente da peça selecionada",
    "Armado como viga",
  ]) {
    await page.keyboard.press("Tab");
    await expect(
      panel(page).getByRole("button", { name, exact: true }),
    ).toBeFocused();
  }
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".ribbon")),
  ).toBe(false);
  await page.keyboard.press("Shift+Tab");
  await expect(
    panel(page).getByRole("button", {
      name: "Armado como viga",
    }),
  ).toBeFocused();
});

test("desenho usa os mesmos estados e efeitos de Exibir, sem nova persistência", async ({
  page,
}) => {
  const controls = [
    { name: "Mostrar cotas", selector: ".dimension", initial: true },
    { name: "Mostrar armaduras", selector: ".steel", initial: true },
    { name: "Mostrar cargas", selector: ".force-label", initial: true },
    {
      name: "Mostrar grade",
      selector: "#piece-drawing > rect",
      initial: false,
    },
  ];
  for (const { name, selector, initial } of controls) {
    await settings(page).click();
    const toggle = panel(page).getByRole("button", { name, exact: true });
    const before = await page.locator(selector).count();
    await expect(toggle).toHaveAttribute("aria-pressed", String(initial));
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", String(!initial));
    await expect(page.locator(selector)).toHaveCount(initial ? 0 : 1);
    await ribbonTab(page, "Exibir").click();
    const original = panel(page).getByRole("button", { name, exact: true });
    await expect(original).toHaveAttribute("aria-pressed", String(!initial));
    await original.click();
    await expect(page.locator(selector)).toHaveCount(before);
    await settings(page).click();
    await expect(toggle).toHaveAttribute("aria-pressed", String(initial));
    await toggle.click();
  }
  await page.reload();
  await settings(page).click();
  for (const { name, initial } of controls)
    await expect(
      panel(page).getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", String(initial));
});

test("tema migra de Exibir e sincroniza com barra superior e mantém a persistência existente", async ({
  page,
}) => {
  await settings(page).click();
  const dark = panel(page).getByRole("button", {
    name: "Tema escuro",
    exact: true,
  });
  await expect(dark).toHaveAttribute("aria-pressed", "false");
  await dark.press("Space");
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => localStorage.getItem("consolostruct.theme")),
  ).toBe("dark");
  await ribbonTab(page, "Exibir").click();
  await expect(panel(page).locator('[data-action="theme"]')).toHaveCount(0);
  await page
    .getByRole("button", { name: "Alternar tema", exact: true })
    .click();
  await settings(page).click();
  await expect(dark).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("button", { name: "Alternar tema", exact: true })
    .click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings(page).click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await dark.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("itens futuros são anunciados como indisponíveis e não executam ações", async ({
  page,
}) => {
  const before = await savedProject(page);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await settings(page).click();
  const future = panel(page).getByRole("button", { name: /Em breve/ });
  await expect(future).toHaveCount(11);
  await expect(panel(page).getByRole("textbox")).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: /^(Salvar|Aplicar)$/ }),
  ).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: "Vista 3D", exact: true }),
  ).toHaveCount(0);
  for (const item of await future.all()) {
    await expect(item).toBeDisabled();
    await expect(item).toContainText("Em breve");
    expect(await item.ariaSnapshot()).toContain("[disabled]");
    await item.click({ force: true });
    await panel(page).focus();
    await item.evaluate((el: HTMLButtonElement) => el.focus());
    await expect(panel(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Refazer", exact: true }),
  ).toBeDisabled();
  expect(downloads).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  await expect(page.locator(".document-tab.active")).toContainText("Elevação");
  expect(await savedProject(page)).toEqual(before);
});

test("entrar e sair preserva seleção, resultados, arquivo e os dois lados do histórico", async ({
  page,
}) => {
  await page.locator(".tree-piece").filter({ hasText: "C02" }).click();
  const length = page
    .locator(".inspector")
    .getByLabel("Comprimento", { exact: false });
  const original = await length.inputValue();
  await length.fill("32,5");
  await length.press("Enter");
  await length.fill("35");
  await length.press("Enter");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(length).toHaveValue("32,5");
  await page.getByRole("button", { name: "Calcular", exact: true }).click();
  const result = await page.locator(".result-summary").first().textContent();
  const before = await savedProject(page);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("consolostruct.project.v1")),
    )
    .not.toBeNull();
  const storage = await page.evaluate(() =>
    localStorage.getItem("consolostruct.project.v1"),
  );
  for (const name of ["Elevação", "Memória", "Detalhamento"]) {
    const doc =
      name === "Elevação"
        ? page.locator(".document-tab-open").filter({ hasText: "Elevação" })
        : documentTab(page, name);
    await doc.click();
    if (name === "Memória")
      await expect(page.locator(".report-paper")).toBeVisible();
    if (name === "Detalhamento")
      await expect(page.locator(".detail-canvas")).toBeVisible();
    const label = await doc.innerText();
    for (let i = 0; i < 2; i++) {
      await settings(page).click();
      await expect(
        page.locator(".document-tab.active .document-tab-open"),
      ).toHaveText(label);
      await expect(page.locator(".tree-piece.selected")).toContainText("C02");
      await expect(
        page.getByRole("button", { name: "Desfazer", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Refazer", exact: true }),
      ).toBeEnabled();
      await ribbonTab(page, "Início").click();
    }
  }
  expect(await savedProject(page)).toEqual(before);
  expect(
    await page.evaluate(() => localStorage.getItem("consolostruct.project.v1")),
  ).toBe(storage);
  await page
    .locator(".document-tab-open")
    .filter({ hasText: "Elevação" })
    .click();
  await expect(page.locator(".result-summary").first()).toHaveText(result);
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(length).toHaveValue("35");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(length).toHaveValue("32,5");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(length).toHaveValue(original);
});

test("atalho de critérios abre dados da peça e conserva os acessos anteriores", async ({
  page,
}) => {
  await page.locator(".tree-piece").filter({ hasText: "C02" }).click();
  await documentTab(page, "Memória").click();
  const before = await savedProject(page);
  await settings(page).click();
  await panel(page)
    .getByRole("button", { name: "Critérios da peça selecionada", exact: true })
    .click();
  await expect(page.locator(".design-panel")).toBeVisible();
  await expect(page.locator(".property-selection")).toContainText("C02");
  for (const name of ["Modelo"]) {
    await ribbonTab(page, name).click();
    await panel(page)
      .getByRole("button", {
        name: "Critérios da peça selecionada",
        exact: true,
      })
      .click();
    await expect(page.locator(".design-panel")).toBeVisible();
  }
  await ribbonTab(page, "Documentação").click();
  await expect(
    panel(page).getByRole("button", { name: "Detalhamento", exact: true }),
  ).toBeEnabled();
  expect(await savedProject(page)).toEqual(before);
});

test("controles reutilizados afetam a vista 3D sem mudar câmera ou documento", async ({
  page,
}) => {
  await documentTab(page, "Vista 3D").click();
  const view = page.getByTestId("viewport-3d");
  await expect(view.locator(".three-dimension-label")).toHaveCount(6);
  const camera = await view.getAttribute("data-camera");
  await settings(page).click();
  for (const [name, selector] of [
    ["Mostrar cotas", ".three-dimension-label"],
    ["Mostrar cargas", ".three-force-label"],
  ]) {
    await panel(page).getByRole("button", { name, exact: true }).click();
    await expect(view.locator(selector)).toHaveCount(0);
    await ribbonTab(page, "Exibir").click();
    await expect(
      panel(page).getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await panel(page).getByRole("button", { name, exact: true }).click();
    await settings(page).click();
  }
  expect(await view.getAttribute("data-camera")).toBe(camera);
  await expect(page.locator(".document-tab.active")).toContainText("Vista 3D");
});

test("temas e janela estreita mantêm grupos, rolagem, foco e painéis acessíveis", async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await settings(page).click();
    for (const dark of [false, true]) {
      if (dark)
        await panel(page)
          .getByRole("button", { name: "Tema escuro", exact: true })
          .click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        dark ? "dark" : "light",
      );
      await expect(
        panel(page).getByRole("region", { name: "Detalhamento", exact: true }),
      ).toBeVisible();
      await panel(page).focus();
      await panel(page).evaluate((el) => {
        el.scrollLeft = 0;
      });
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => panel(page).evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(0);
      const last = panel(page).getByRole("button", {
        name: "Identificação de barras Em breve",
        exact: true,
      });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await expect(last).toHaveCSS("opacity", "1");
      const bounds = (await last.boundingBox())!;
      const container = (await panel(page).boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        container.y + container.height,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
    }
    await panel(page)
      .getByRole("button", { name: "Tema escuro", exact: true })
      .click();
    if (width === 390) {
      await settings(page).focus();
      await page.keyboard.press("Home");
      await expect(ribbonTab(page, "Arquivo")).toBeInViewport();
      await page.keyboard.press("End");
      await expect(settings(page)).toBeInViewport();
      await panel(page)
        .getByRole("button", {
          name: "Critérios da peça selecionada",
          exact: true,
        })
        .click();
      const dock = (await page.locator(".property-dock").boundingBox())!;
      const ribbon = (await page.locator(".ribbon").boundingBox())!;
      expect(dock.y).toBeGreaterThanOrEqual(ribbon.y + ribbon.height);
      await expect(page.locator(".design-panel")).toBeVisible();
      await page
        .getByRole("button", { name: "Fechar propriedades", exact: true })
        .click();
    }
  }
});
