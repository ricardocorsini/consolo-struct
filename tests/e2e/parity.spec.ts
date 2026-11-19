import { test, expect } from "@playwright/test";
import { buildDetail } from "../../src/detailing/model";
import { sectionBars } from "../../src/detailing/projection";
import { exampleProject } from "../../src/domain/model";
import { stirrupLayout } from "../../src/domain/theory";

// Issue #64: the initial project (C01: b = 30 cm, 4 Ø20, one layer, loops).
test("peça inicial: Seção A–A, prancha e relação do aço mostram os mesmos 4 ramos de N1", async ({
  page,
}) => {
  const piece = exampleProject().pieces[0];
  expect(piece.geometry.width).toBe(300);
  expect(piece.rebar.tieCount).toBe(4);
  const detail = buildDetail(piece);
  const x1 = stirrupLayout(piece).positions[0];
  expect(sectionBars(piece, detail, x1).ties).toHaveLength(4);
  await page.goto("/");
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Seção A–A", exact: true })
    .click();
  await expect(page.locator(".steel-N1 circle")).toHaveCount(4);
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: "Detalhamento", exact: true })
    .click();
  const canvas = page.locator(".detail-canvas");
  await expect(canvas).toContainText("RELAÇÃO DO AÇO");
  await expect(canvas).toContainText(
    "Tirante: 4 ramos detalhados em 1 camada(s) ·",
  );
  await expect(canvas).toContainText(
    "Tirante detalhado: 4 ramos Ø20,0 / 1 camada(s)",
  );
  await expect(canvas).not.toContainText("declarado(s)");
  // Two loops (N1-1, N1-2) of two legs each in the schedule, with the error.
  await expect(canvas).toContainText("N1-1");
  await expect(canvas).toContainText("N1-2");
  await expect(page.locator(".detail-issues")).toContainText(
    "não cabem aninhadas",
  );
});
