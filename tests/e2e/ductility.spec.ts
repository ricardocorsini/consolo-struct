import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exampleProject, newPiece, type Piece } from "../../src/domain/model";

function reference(method: "strut" | "friction", a = 125): Piece {
  const p = newPiece(1);
  p.id = "ductility-browser";
  p.name = "Ductilidade";
  Object.assign(p.geometry, { length: 400, loadOffset: a, columnWidth: 600 });
  Object.assign(p.design, {
    method,
    forceMode: "design",
    horizontalMode: "analysis",
    horizontalJustification: "Ações de cálculo simultâneas, conforme issue #4.",
    literatureRecommendations: false,
    bearingHeight: 0,
    bearingWidth: 300,
    bearingLength: 100,
    inputsConfirmed: true,
  });
  p.loads.vertical = 588000;
  p.loads.horizontal = 94080;
  return p;
}
async function seed(page: Page, p: Piece) {
  const raw = JSON.stringify({
    ...exampleProject(),
    name: "Verificações de ductilidade",
    pieces: [p],
  });
  await page.addInitScript(
    (raw) => localStorage.setItem("lumeconsolo.project.v1", raw),
    raw,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Calcular", exact: true }).click();
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Memória", exact: true })
    .click();
  await expect(page.locator(".report-paper")).toBeVisible();
}
const row = (page: Page, label: string) =>
  page
    .locator(".report-paper tbody tr")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
async function download(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  return readFile((await (await event).path())!);
}

for (const method of ["strut", "friction"] as const)
  test(`verificações, fórmulas e memória por combinação — ${method}`, async ({
    page,
  }, info) => {
    await seed(page, reference(method));
    for (const label of [
      "Ductilidade da seção (x/d)",
      "Armadura longitudinal máxima (4% Ac)",
      "Rotação plástica do nó (x/(λd))",
    ])
      await expect(row(page, label)).toContainText("Atende");
    const xd = row(page, "Ductilidade da seção (x/d)");
    await expect(xd).toContainText("0,296");
    await expect(xd).toContainText("0,450");
    await xd.getByText("Ductilidade da seção (x/d)", { exact: true }).click();
    await expect(xd).toContainText("GN Corbel; conferência pendente");
    if (method === "friction")
      await expect(row(page, "Ductilidade no modelo de atrito")).toContainText(
        "Conferir",
      );
    await page.locator(".report-paper .case-memory > summary").first().click();
    const ratio = page.locator(".memory-values > div").filter({
      has: page.getByText("x/(λd) da rotação plástica", { exact: true }),
    });
    await expect(ratio).toContainText("0,25499");
    await ratio.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`ductility-memory-${method}.png`),
    });
    const audit = JSON.parse(
      (await download(page, /Cálculo auditável/)).toString("utf8"),
    );
    expect(audit.result.values.ductility_x).toBeCloseTo(106.23743273008961, 9);
    expect(audit.result.values.plastic_radicand).toBeCloseTo(
      81526.40640087568,
      8,
    );
  });

for (const dark of [false, true])
  test(`raiz inexistente: sem solução na tela e saídas — ${dark ? "escuro" : "claro"}`, async ({
    page,
  }, info) => {
    const p = reference("strut", 250);
    p.loads.vertical = 5e6;
    await seed(page, p);
    if (dark)
      await page
        .getByRole("button", { name: "Alternar tema", exact: true })
        .click();
    const rotation = row(page, "Rotação plástica do nó (x/(λd))");
    await expect(rotation).toContainText("sem solução");
    await expect(rotation).toContainText("Não atende");
    await expect(rotation).toContainText("0,450");
    await rotation
      .getByText("Rotação plástica do nó (x/(λd))", { exact: true })
      .click();
    await expect(rotation).toContainText("radicando negativo");
    await rotation.scrollIntoViewIfNeeded();
    const bounds = await rotation.evaluate((tr) => ({
      result: tr.lastElementChild!.getBoundingClientRect().right,
      wrap: tr.closest(".calculation-table-wrap")!.getBoundingClientRect()
        .right,
    }));
    expect(bounds.result).toBeLessThanOrEqual(bounds.wrap + 1);
    await page.screenshot({
      path: info.outputPath(
        `ductility-unsolved-${dark ? "dark" : "light"}.png`,
      ),
    });
    const pdf = await download(page, /Memória de cálculo/);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("sem solucao");
    const csv = (await download(page, /Lista de quantidades/)).toString("utf8");
    expect(csv).toContain("plasticRotation referencia");
    expect(csv).toContain("sem solução");
    expect(csv).toContain("GN Corbel");
    const audit = JSON.parse(
      (await download(page, /Cálculo auditável/)).toString("utf8"),
    );
    expect(
      audit.result.checks.find(
        (c: { id: string }) => c.id === "plasticRotation",
      ),
    ).toMatchObject({
      status: "fail",
      demand: null,
      capacity: 0.45,
      utilization: null,
    });
    expect(audit.result.values).not.toHaveProperty("plastic_x");
    expect(audit.result.values).not.toHaveProperty("plastic_ratio");
    expect(audit.result.values.plastic_radicand).toBeLessThan(0);
  });

test("C60: limite 0,35, λ=0,775 e consulta em janela estreita", async ({
  page,
}, info) => {
  const p = reference("friction");
  p.materials.fck = 60;
  await seed(page, p);
  await expect(row(page, "Ductilidade da seção (x/d)")).toContainText("0,350");
  await expect(row(page, "Rotação plástica do nó (x/(λd))")).toContainText(
    "0,350",
  );
  await page.locator(".report-paper .case-memory > summary").first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Fechar propriedades", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fechar navegador do projeto", exact: true })
    .click();
  const lambda = page
    .locator(".memory-values > div")
    .filter({ has: page.getByText("λ do concreto", { exact: true }) });
  await lambda.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const unoccluded = await lambda.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(
      document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
    );
  });
  expect(unoccluded).toBe(true);
  await expect(lambda).toContainText("0,77500");
  await page.screenshot({ path: info.outputPath("ductility-narrow.png") });
});

test("armadura excessiva reprova as duas verificações e mantém o projeto", async ({
  page,
}) => {
  const p = reference("friction");
  p.rebar.tieDiameter = 40;
  p.design.tieLayers = 3;
  await seed(page, p);
  for (const label of [
    "Ductilidade da seção (x/d)",
    "Armadura longitudinal máxima (4% Ac)",
  ])
    await expect(row(page, label)).toContainText("Não atende");
  const audit = JSON.parse(
    (await download(page, /Cálculo auditável/)).toString("utf8"),
  );
  expect(audit.input.rebar.tieDiameter).toBe(40);
  expect(audit.input.design.tieLayers).toBe(3);
  expect(audit.result.values.maxSteel).toBe(4800);
  expect(audit.result.values.tieProvided).toBeGreaterThan(4800);
});
