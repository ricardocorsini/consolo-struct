import { describe, expect, it } from "vitest";
import { exampleProject, newPiece } from "../src/domain/model";
import { buildDetail } from "../src/detailing/model";
import { pieceDrawing } from "../src/detailing/drawing";
import { elevationTiePaths, sectionBars } from "../src/detailing/projection";
import { shortFixture } from "./fixtures";

function shortBeam() {
  const p = newPiece(1);
  p.geometry.length = 120;
  p.geometry.loadOffset = 60;
  p.geometry.tipHeight = 350;
  p.rebar.stirrupCount = 1;
  p.detailing.barArrangement = "beam";
  return p;
}

describe("Projeções dos percursos físicos — revisão #58", () => {
  it("não desenha N1 na elevação quando todas as alças foram descartadas", () => {
    const p = shortFixture();
    p.geometry.width = 100;
    const d = buildDetail(p);
    expect(d.bars.filter((b) => b.family === "tie")).toHaveLength(0);
    expect(elevationTiePaths(p, d)).toEqual([]);
  });

  it.each(["loop", "welded"] as const)(
    "não inventa N1 além da ponta física (%s)",
    (frontAnchor) => {
      const p = shortFixture();
      p.design.frontAnchor = frontAnchor;
      const d = buildDetail(p);
      expect(d.bars.some((b) => b.family === "tie")).toBe(true);
      expect(sectionBars(p, d, p.geometry.length).ties).toEqual([]);
    },
  );

  it("corta a curva frontal da alça na posição transversal real", () => {
    const p = shortFixture();
    p.geometry.width = 240;
    const d = buildDetail(p);
    const x = 388,
      radius = 58,
      centerX = 359;
    const inset = 39.3 + radius - Math.sqrt(radius ** 2 - (x - centerX) ** 2);
    const bars = sectionBars(p, d, x).ties;
    expect(bars).toHaveLength(2);
    expect(bars[0].v).toBeCloseTo(inset, 8);
    expect(bars[1].v).toBeCloseTo(p.geometry.width - inset, 8);
  });

  it("corta N1 e P1 pelos arcos reais na estação única", () => {
    const p = shortBeam(),
      d = buildDetail(p),
      section = sectionBars(p, d, 60);
    // N1: centro (-5; 131,3), R=90; P1: centro (40; 311,508333), R=30.
    const tieDepth = 131.3 - Math.sqrt(90 ** 2 - 65 ** 2);
    const positiveDepth = 311.5083333333333 + Math.sqrt(30 ** 2 - 20 ** 2);
    expect(section.ties).toHaveLength(4);
    for (const bar of section.ties) expect(bar.depth).toBeCloseTo(tieDepth, 8);
    expect(section.positives).toHaveLength(2);
    for (const bar of section.positives)
      expect(bar.depth).toBeCloseTo(positiveDepth, 8);
    expect(sectionBars(p, d, 80).positives).toEqual([]);
    expect(sectionBars(p, d, p.geometry.length).ties).toEqual([]);
  });

  it("costuras não aparecem antes do início da penetração no suporte", () => {
    const p = shortFixture(),
      d = buildDetail(p);
    const embedment = d.result.values.anchorN2_adopted;
    expect(embedment).toBeGreaterThan(0);
    expect(sectionBars(p, d, -embedment - 1).stitches).toEqual([]);
    expect(sectionBars(p, d, -embedment + 20).stitches.length).toBeGreaterThan(
      0,
    );
  });

  it("não interpreta os ganchos de fechamento de N2/N2I como ramos adicionais", () => {
    const p = newPiece(1),
      d = buildDetail(p);
    const stitches = sectionBars(p, d, 28.15).stitches;
    expect(stitches.some((b) => b.mark.startsWith("N2I"))).toBe(true);
    for (const bar of stitches) expect(bar.positions).toHaveLength(2);
  });

  it("preserva a curva do contorno N2 ao excluir pontas de fechamento fora do plano", () => {
    const p = shortFixture(),
      d = buildDetail(p);
    const bar = d.bars.find((b) => b.family === "stitch")!;
    const radius = (bar.mandrel + bar.diameter) / 2;
    const front = bar.locations[0].x;
    const inset = (p.geometry.width - bar.height) / 2;
    const x = front - radius / 2;
    const section = sectionBars(p, d, x).stitches.find(
      (b) => b.mark === bar.mark,
    )!;
    const offset = radius - Math.sqrt(radius ** 2 - (radius / 2) ** 2);
    expect(section.positions).toHaveLength(2);
    expect(section.positions[0]).toBeCloseTo(inset + offset, 8);
    expect(section.positions[1]).toBeCloseTo(
      p.geometry.width - inset - offset,
      8,
    );
    expect(
      sectionBars(p, d, front + 1).stitches.some((b) => b.mark === bar.mark),
    ).toBe(false);
  });

  it("o corte exportado conserva as profundidades curvas de N1 e P1", () => {
    const p = shortBeam(),
      d = buildDetail(p);
    const drawing = pieceDrawing({ ...exampleProject(), pieces: [p] }, d);
    const title = drawing.entities.find(
      (e) => e.type === "text" && e.text.startsWith("CORTE A-A /"),
    );
    expect(title?.type).toBe("text");
    if (title?.type !== "text") throw new Error("Corte ausente");
    const origin = { x: title.at.x, y: title.at.y + 8 };
    for (const [family, depth, quantity] of [
      ["tie", 131.3 - Math.sqrt(90 ** 2 - 65 ** 2), 4],
      ["positive", 311.5083333333333 + Math.sqrt(30 ** 2 - 20 ** 2), 2],
    ] as const) {
      const diameter = d.bars.find((b) => b.family === family)!.diameter;
      const circles = drawing.entities.filter(
        (e) =>
          e.type === "circle" &&
          e.layer === "ARMADURAS" &&
          e.radius === diameter / 20 &&
          e.center.x > origin.x &&
          e.center.x < origin.x + p.geometry.width / 10 &&
          Math.abs(e.center.y - (origin.y + depth / 10)) < 1e-8,
      );
      expect(circles).toHaveLength(quantity);
    }
  });

  it("pinos e soldadas só aparecem quando o corte contém seu plano", () => {
    const p = shortFixture();
    p.design.frontAnchor = "welded";
    p.design.tieLayers = 2;
    p.detailing.pins = 3;
    p.detailing.pinSpacing = 50;
    p.detailing.pinCenterOffset = 10;
    const d = buildDetail(p);
    const pins = sectionBars(p, d, p.geometry.loadOffset).lines;
    expect(pins).toHaveLength(3);
    expect(pins.map((b) => b.a.x)).toEqual([160, 210, 260]);
    for (const pin of pins) {
      expect(pin.family).toBe("pin");
      expect(pin.a.y).toBe(-p.detailing.pinProjection);
      expect(pin.b.y).toBe(p.detailing.pinEmbedment);
    }
    expect(sectionBars(p, d, p.geometry.loadOffset + 1).lines).toEqual([]);
    const welded = d.bars.filter((b) => b.family === "welded");
    const atWeld = sectionBars(p, d, welded[0].locations[0].x).lines;
    expect(atWeld).toHaveLength(2);
    for (const bar of atWeld) {
      expect(bar.family).toBe("welded");
      expect(bar.a.x).toBe(25);
      expect(bar.b.x).toBe(375);
      expect(bar.a.y).toBe(bar.b.y);
    }
    expect(sectionBars(p, d, welded[0].locations[0].x + 1).lines).toEqual([]);
  });

  it("projetar não modifica entradas, formas, comprimentos, massas ou cálculo", () => {
    const p = shortBeam(),
      d = buildDetail(p);
    const before = structuredClone({ p, d });
    elevationTiePaths(p, d);
    sectionBars(p, d, 60);
    expect({ p, d }).toEqual(before);
  });
});
