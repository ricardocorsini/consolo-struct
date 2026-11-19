import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { viewsFixture } from "../reference/views59";

const open = (page: Page, name: string) =>
  page
    .locator(".document-tabs")
    .getByRole("button", { name, exact: true })
    .click();
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function ready(page: Page) {
  await expect(page.locator(".detail-workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await frames(page);
}
async function matrix(page: Page) {
  return page.getByTestId("detail-model").evaluate((el) => {
    const m = (el as unknown as SVGGElement).transform.baseVal.consolidate()!
      .matrix;
    return { a: m.a, d: m.d, e: m.e, f: m.f };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((raw) => {
    localStorage.setItem("consolostruct.project.v1", raw);
    (window as any).__viewRequests = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: any) {
        if (message.project)
          (window as any).__viewRequests.push({
            pieceId: message.pieceId,
            scope: message.scope,
            pieces: message.project.pieces.length,
            bytes: new TextEncoder().encode(JSON.stringify(message.project))
              .length,
          });
        super.postMessage(message);
      }
    };
  }, JSON.stringify(viewsFixture()));
  await page.goto("/");
  await open(page, "Detalhamento");
  await ready(page);
});

test("peça atual envia só uma peça; abas ocultas preservam estado e recebem a revisão atual ao voltar", async ({
  page,
}, info) => {
  const requests = () => page.evaluate(() => (window as any).__viewRequests);
  expect(await requests()).toMatchObject([
    { pieces: 1, pieceId: "views-0", scope: "one" },
  ]);
  await open(page, "Memória");
  await page
    .getByRole("button", { name: "Calcular revisão atual", exact: true })
    .click();
  await expect(page.locator(".report-paper .result-summary")).toBeVisible();
  await page.locator(".report-paper .case-memory > summary").first().click();
  await open(page, "C01 · Elevação");
  await open(page, "Memória");
  await expect(
    page.locator(".report-paper .case-memory").first(),
  ).toHaveAttribute("open", "");
  await open(page, "C01 · Elevação");
  const before = await page.locator(".report-paper").textContent();
  const posts = (await requests()).length;
  await page
    .getByRole("button", { name: "Alterar quantidade de C01", exact: true })
    .click();
  const quantity = page.getByRole("spinbutton", {
    name: "Quantidade de C01",
    exact: true,
  });
  await quantity.fill("3");
  await quantity.press("Enter");
  await page.getByLabel("Altura no pilar").fill("55");
  await page.getByLabel("Altura no pilar").press("Enter");
  await frames(page);
  expect(await page.locator(".report-paper").textContent()).toBe(before);
  expect((await requests()).length).toBe(posts);
  await open(page, "Memória");
  await expect(page.locator(".report-paper")).toContainText("Quantidade: 3");
  await expect(page.locator(".report-paper .report-warning")).toContainText(
    "Cálculo desatualizado",
  );
  await expect(page.locator(".report-paper .result-summary")).toHaveCount(0);
  await page.getByLabel("Peça do relatório").selectOption("views-1");
  await expect(page.locator(".report-paper h2")).toContainText("C02");
  await expect(page.locator(".report-paper .result-summary")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Calcular revisão atual", exact: true })
    .click();
  await expect(page.locator(".report-paper .result-summary")).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .locator(".report-selection")
    .getByRole("button", { name: "Baixar PDF" })
    .click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toContain("C02");
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
  await open(page, "Detalhamento");
  await ready(page);
  await expect(page.locator(".detail-canvas")).toContainText("C02");
  await page.getByLabel("Peça do detalhamento").selectOption("views-0");
  await ready(page);
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Quadro CSV", exact: true }).click();
  const csv = await readFile((await (await csvEvent).path())!, "utf8");
  expect(csv).toContain('"C01";"R00";"3";');
  await page.getByLabel("Escopo dos detalhes").selectOption("all");
  await ready(page);
  expect((await requests()).at(-1)).toMatchObject({ scope: "all", pieces: 20 });
  // Persist files even with the CI's list reporter (inline bodies live only in
  // reporter events). The uploaded artifact must retain the successful evidence.
  const payloadPath = info.outputPath("worker-payloads.json");
  await writeFile(payloadPath, JSON.stringify(await requests(), null, 2));
  await info.attach("worker-payloads", {
    path: payloadPath,
    contentType: "application/json",
  });
  const screenshotPath = info.outputPath("detalhamento-20-pecas.png");
  await page.screenshot({ path: screenshotPath });
  await info.attach("detalhamento-20-pecas", {
    path: screenshotPath,
    contentType: "image/png",
  });
});

test("soltura usa coordenadas finais mesmo sem movimento intermediário; zoom preserva âncora", async ({
  page,
}) => {
  const canvas = page.locator(".detail-canvas");
  const before = await matrix(page),
    box = (await canvas.boundingBox())!;
  const start = { x: box.x + 120, y: box.y + 120 };
  await canvas.evaluate((el) =>
    el.addEventListener(
      "pointerdown",
      (e) => {
        (window as any).__pointerId = (e as PointerEvent).pointerId;
      },
      { once: true },
    ),
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const scale = await canvas.evaluate(
    (el) => (el as unknown as SVGSVGElement).getScreenCTM()!.a,
  );
  await canvas.evaluate((el, start) => {
    el.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: (window as any).__pointerId,
        clientX: start.x + 15,
        clientY: start.y + 10,
        buttons: 1,
      }),
    );
    el.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: (window as any).__pointerId,
        clientX: start.x + 95,
        clientY: start.y + 65,
        button: 0,
      }),
    );
  }, start);
  await page.mouse.up();
  await frames(page);
  const after = await matrix(page);
  // SVG matrices round their coefficients: assess the interaction in CSS pixels,
  // not millionths of a model unit. Missing the final delta fails by 80/55 px.
  expect(Math.abs((after.e - before.e) * scale - 95)).toBeLessThan(0.01);
  expect(Math.abs((after.f - before.f) * scale - 65)).toBeLessThan(0.01);
  // WheelEvent converts client coordinates to integers. Use the same point for
  // both the event and the expected anchor instead of testing a fractional one.
  const anchor = {
    x: Math.round(box.x + box.width * 0.6),
    y: Math.round(box.y + box.height * 0.4),
  };
  const local = () =>
    page.getByTestId("detail-model").evaluate((el, anchor) => {
      const p = new DOMPoint(anchor.x, anchor.y).matrixTransform(
        (el as unknown as SVGGElement).getScreenCTM()!.inverse(),
      );
      return { x: p.x, y: p.y };
    }, anchor);
  const old = await local();
  await canvas.dispatchEvent("wheel", {
    clientX: anchor.x,
    clientY: anchor.y,
    deltaY: -100,
  });
  await frames(page);
  const current = await page.getByTestId("detail-model").evaluate((el, old) => {
    const p = new DOMPoint(old.x, old.y).matrixTransform(
      (el as unknown as SVGGElement).getScreenCTM()!,
    );
    return { x: p.x, y: p.y };
  }, old);
  expect(Math.abs(current.x - anchor.x)).toBeLessThan(0.01);
  expect(Math.abs(current.y - anchor.y)).toBeLessThan(0.01);
});

for (const context of [
  "piece",
  "scope",
  "tab",
  "fit",
  "blur",
  "resize",
  "cancel",
  "capture",
  "escape",
] as const)
  test(`arrasto anterior não sobrevive a ${context}`, async ({ page }) => {
    const canvas = page.locator(".detail-canvas"),
      box = (await canvas.boundingBox())!;
    const start = { x: box.x + 160, y: box.y + 180 };
    await canvas.evaluate((el) =>
      el.addEventListener(
        "pointerdown",
        (e) => {
          (window as any).__pointerId = (e as PointerEvent).pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + 10);
    if (context === "piece")
      await page.getByLabel("Peça do detalhamento").selectOption("views-1");
    if (context === "scope")
      await page.getByLabel("Escopo dos detalhes").selectOption("all");
    if (context === "tab") {
      await page
        .locator(".document-tabs")
        .getByRole("button", { name: "Memória", exact: true })
        .evaluate((el) => (el as HTMLElement).click());
      await page
        .locator(".document-tabs")
        .getByRole("button", { name: "Detalhamento", exact: true })
        .evaluate((el) => (el as HTMLElement).click());
    }
    if (context === "fit")
      await page
        .getByRole("button", { name: "Ajustar detalhes à tela", exact: true })
        .evaluate((el) => (el as HTMLElement).click());
    if (context === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (context === "resize")
      await page.setViewportSize({ width: 1280, height: 900 });
    if (context === "cancel")
      await canvas.evaluate((el) =>
        el.dispatchEvent(
          new PointerEvent("pointercancel", {
            bubbles: true,
            pointerId: (window as any).__pointerId,
          }),
        ),
      );
    if (context === "capture") {
      await canvas.evaluate((el) =>
        el.releasePointerCapture((window as any).__pointerId),
      );
      // The browser delivers lostpointercapture before its next pointer event.
      await page.mouse.move(start.x + 20, start.y + 10);
    }
    if (context === "escape")
      await canvas.dispatchEvent("keydown", { key: "Escape" });
    await ready(page);
    const before = await matrix(page);
    await canvas.evaluate((el, start) => {
      for (const type of ["pointermove", "pointerup"])
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: (window as any).__pointerId,
            clientX: start.x + 160,
            clientY: start.y + 110,
            buttons: 0,
          }),
        );
    }, start);
    await page.mouse.up();
    await frames(page);
    expect(await matrix(page)).toEqual(before);
  });
