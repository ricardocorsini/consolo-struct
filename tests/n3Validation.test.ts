import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Drawing from "../src/components/Drawing";
import {
  exampleProject,
  newPiece,
  number,
  type Piece,
} from "../src/domain/model";
import { calculate } from "../src/domain/engine";
import { bottomDepth, concreteProfile } from "../src/domain/profile";
import { stirrupLayout } from "../src/domain/theory";
import { buildDetail } from "../src/detailing/model";
import { pieceDrawing } from "../src/detailing/drawing";
import { steelCsv } from "../src/detailing/exports";
import {
  constructiveGeometry,
  firstLayerTiePositions,
  projectedConstructiveSection,
  transverseGeometry,
} from "../src/detailing/transverse";
import { buildSceneModel } from "../src/visualization/model3d";
import { shortFixture } from "./fixtures";

function renderSection(piece: Piece) {
  return renderToStaticMarkup(
    createElement(Drawing, {
      piece,
      section: true,
      rebar: true,
      dimensions: false,
      grid: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      forces: false,
      selectedBar: "",
      onDimension: () => {},
      onBar: () => {},
    }),
  );
}

describe("N3G — bloqueios de fabricação e seção A–A", () => {
  it("detecta a penetração de 0,828 mm entre N1 Ø20 e a dobra de N3G Ø8", () => {
    const p = newPiece(1);
    p.design.frontAnchor = "welded";
    p.rebar.stirrupBranches = 4;
    p.rebar.stirrupDiameter = 8;
    const before = structuredClone(p),
      result = calculate(p);
    // Centro de N1 a (2, 2) mm do centro da dobra de raio 16 mm.
    // Distância entre eixos = 16 - hypot(2, 2), menor que a soma dos raios (14).
    expect(14 - (16 - Math.hypot(2, 2))).toBeCloseTo(0.828427, 6);
    expect(buildDetail(p).issues).toContainEqual(
      expect.objectContaining({
        code: "transverse-tie-clash",
        severity: "error",
      }),
    );
    expect(renderSection(p)).toContain(
      "Arranjo N3/N3G inválido para fabricação",
    );
    expect(p).toEqual(before);
    expect(calculate(p)).toEqual(result);
  });

  it("preserva a tangência válida de N1 Ø20 com N3G Ø6,3", () => {
    const p = newPiece(1);
    p.design.frontAnchor = "welded";
    p.rebar.stirrupBranches = 4;
    expect(
      buildDetail(p).issues.filter((i) => i.code.startsWith("transverse-")),
    ).toEqual([]);
    expect(renderSection(p)).not.toContain(
      "Arranjo N3/N3G inválido para fabricação",
    );
  });

  it("mostra na seção a colisão com N1 já identificada no detalhamento", () => {
    const p = shortFixture();
    p.rebar.stirrupBranches = 4;
    expect(
      buildDetail(p).issues.some((i) => i.code === "transverse-tie-clash"),
    ).toBe(true);
    expect(renderSection(p)).toContain(
      "Arranjo N3/N3G inválido para fabricação",
    );
  });

  it("mostra a dobra inválida no último estribo mesmo com o primeiro válido", () => {
    const p = shortFixture();
    p.geometry.tipHeight = 100;
    const t = transverseGeometry(p);
    expect(t.sections[0].path.valid).toBe(true);
    expect(t.sections.at(-1)!.path.valid).toBe(false);
    expect(buildDetail(p).issues.some((i) => i.code === "shape-stirrup")).toBe(
      true,
    );
    expect(renderSection(p)).toContain(
      "Arranjo N3/N3G inválido para fabricação",
    );
  });

  it.each([2, 4] as const)(
    "usa o único estribo real no contorno, legenda e projeção de %s ramos",
    (branches) => {
      const p = newPiece(1);
      p.design.frontAnchor = "welded";
      p.rebar.stirrupBranches = branches;
      p.rebar.stirrupCount = 1;
      const layout = stirrupLayout(p),
        x = p.geometry.length / 2;
      expect(layout.positions).toEqual([x]);
      expect(x).not.toBe(layout.first);
      const section = renderSection(p),
        t = transverseGeometry(p, x);
      expect(section).toContain(
        `SEÇÃO A–A · 1º ESTRIBO · x = ${number(x / 10, 2)} cm`,
      );
      const scale = Math.min(
        480 / (p.geometry.columnWidth + p.geometry.length),
        340 / (p.geometry.height + 80),
        480 / p.geometry.width,
      );
      expect(section).toContain(
        `height="${bottomDepth(concreteProfile(p), x) * scale}" fill="url(`,
      );
      const projected = projectedConstructiveSection(
        constructiveGeometry(p),
        t.sections,
      );
      const innerX = x - p.rebar.stirrupDiameter;
      expect(projected.map((point) => point.x)).toEqual(
        branches === 4 ? [x, innerX, innerX, x] : [x, x],
      );
      const drawing = pieceDrawing(
        { ...exampleProject(), pieces: [p] },
        buildDetail(p),
      );
      const texts = drawing.entities
        .filter((e) => e.type === "text")
        .map((e) => e.text);
      expect(texts).toContain(`CORTE A-A / x=${number(x / 10, 1)} cm`);
      if (branches === 4)
        expect(texts).toContain(
          `N3G projetado de x=${number(innerX / 10, 1)} cm; N4 no plano de cada ramo`,
        );
    },
  );

  it.each(["laços descartados", "camada com três barras"])(
    "não inventa N3G quando faltam N1 centrais: %s",
    (scenario) => {
      const p = newPiece(1);
      p.rebar.stirrupBranches = 4;
      p.design.frontAnchor = "loop";
      p.design.supportAnchor = "straight";
      if (scenario === "camada com três barras") {
        p.design.frontAnchor = "welded";
        p.rebar.tieCount = 3;
      }
      const before = structuredClone(p),
        result = calculate(p);
      expect(firstLayerTiePositions(p).length).toBeLessThan(4);
      const t = transverseGeometry(p),
        detail = buildDetail(p),
        scene = buildSceneModel(p);
      expect(detail.issues).toContainEqual(
        expect.objectContaining({
          code: "transverse-inner-tie",
          severity: "error",
        }),
      );
      expect(t.sections.filter((s) => s.internal)).toEqual([]);
      expect(t.sections.map((s) => s.x)).toEqual(stirrupLayout(p).positions);
      expect(detail.bars.filter((b) => b.family === "stirrupInner")).toEqual(
        [],
      );
      expect(
        detail.bars.find((b) => b.family === "constructive")!.quantity,
      ).toBe(2);
      expect(scene.steel.filter((b) => b.id === "N3")).toHaveLength(
        p.rebar.stirrupCount,
      );
      expect(scene.steel.filter((b) => b.id === "N4")).toHaveLength(2);
      expect(steelCsv([detail])).not.toContain('"N3G-');
      const section = renderSection(p);
      expect(section).not.toContain('data-n3-part="grampo"');
      expect(section).not.toContain("projeção do par");
      expect(section).toContain("Arranjo N3/N3G inválido para fabricação");
      expect(p).toEqual(before);
      expect(calculate(p)).toEqual(result);
    },
  );
});
