import { sheetOrigins } from "./sheetOrigins";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as engine from "../src/domain/engine";
import { decodeProject, exampleProject } from "../src/domain/model";
import { beamTieBends } from "../src/detailing/beam";
import { connectionGeometry, pinCenters } from "../src/detailing/connections";
import { pieceDrawing } from "../src/detailing/drawing";
import { entitySvg } from "../src/detailing/exports";
import {
  at,
  mandrelDiameter,
  pathLength,
  pathLengthAfterX,
} from "../src/detailing/geometry";
import { buildDetail } from "../src/detailing/model";
import { rebarModel } from "../src/detailing/rebarModel";
import {
  elevationShapes,
  elevationTieBars,
  elevationTiePaths,
  sectionBars,
} from "../src/detailing/projection";
import { stirrupLayout } from "../src/domain/theory";
import Drawing from "../src/components/Drawing";
import { shortFixture } from "./fixtures";

function fixture() {
  const p = shortFixture();
  p.geometry.tipHeight = 450;
  p.detailing.pins = 3;
  p.design.frontAnchor = "welded";
  p.design.tieLayers = 2;
  p.rebar.tieCount = 6;
  return p;
}

function render(p = fixture(), section = false, rebar = true) {
  return renderToStaticMarkup(
    createElement(Drawing, {
      piece: p,
      section,
      rebar,
      dimensions: true,
      grid: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      forces: true,
      selectedBar: "N4",
      onDimension: () => {},
      onBar: () => {},
    }),
  );
}

describe("Projeções de ligações integradas a N3/N4 (#39)", () => {
  it("não acrescenta família à peça sem pinos e com alça", () => {
    expect(elevationShapes(shortFixture())).toEqual([]);
  });

  it.each([1, 2, 5, 20])(
    "projeta %s pinos sobrepostos, conservando quantidade e percurso físico",
    (quantity) => {
      const p = fixture();
      p.detailing.pins = quantity;
      p.detailing.pinSpacing = 45;
      p.detailing.pinCenterOffset = 12;
      p.detailing.pinEmbedment = 210;
      p.detailing.pinProjection = 90;
      const connection = connectionGeometry(p).pins!;
      expect(connection.centers).toEqual(pinCenters(p));
      expect(connection.centers).toHaveLength(quantity);
      expect(connection.centers[0]).toBe(212 - ((quantity - 1) * 45) / 2);
      const [shape] = elevationShapes(p).filter((s) => s.family === "pin");
      expect(shape).toMatchObject({
        kind: "line",
        quantity,
        a: { x: 300, y: -90 },
        b: { x: 300, y: 210 },
      });
      const bar = buildDetail(p).bars.find((b) => b.family === "pin")!;
      expect(bar.quantity).toBe(shape.quantity);
      expect(bar.exactLength).toBe(connection.bottom - connection.top);
      expect(bar.locations).toEqual([{ x: connection.x, z: 0 }]);
    },
  );

  it.each([1, 2, 3, 4])(
    "projeta a barra soldada nas %s camadas efetivamente ocupadas",
    (layers) => {
      const p = fixture();
      p.design.tieLayers = layers;
      p.rebar.tieCount = 8;
      p.design.weldedBarDiameter = 25;
      const bars = buildDetail(p).bars.filter((b) => b.family === "welded");
      const shapes = elevationShapes(p).filter((s) => s.kind === "end-on");
      expect(shapes).toHaveLength(layers);
      expect(shapes.map((s) => s.mark)).toEqual(bars.map((b) => b.mark));
      shapes.forEach((shape, i) => {
        expect(shape.center).toEqual({
          x: bars[i].locations[0].x,
          y: bars[i].locations[0].z,
        });
        expect(shape.diameter).toBe(bars[i].diameter);
        expect(shape.quantity).toBe(bars[i].quantity);
      });
    },
  );

  it("não cria barra soldada em camada vazia nem pino sem comprimento", () => {
    const p = fixture();
    p.design.tieLayers = 4;
    p.rebar.tieCount = 2;
    p.detailing.pinEmbedment = p.detailing.pinProjection = 0;
    const shapes = elevationShapes(p);
    expect(shapes.filter((s) => s.family === "pin")).toHaveLength(0);
    expect(shapes.filter((s) => s.family === "welded")).toHaveLength(2);
    expect(buildDetail(p).issues.some((i) => i.code === "shape-pin")).toBe(
      true,
    );
  });

  it("suprime a soldada no modo viga, mantendo pinos e a positiva independente", () => {
    const p = fixture();
    p.detailing.barArrangement = "beam";
    expect(elevationShapes(p).map((s) => s.family)).toEqual(["pin"]);
    expect(buildDetail(p).bars.some((b) => b.family === "positive")).toBe(true);
    const html = render(p);
    expect(html).toContain('data-testid="beam-positive"');
    expect(html).toContain('data-family="pin"');
    expect(html).not.toContain('data-family="welded"');
    p.design.excessConcrete = "remove";
    expect(elevationShapes(p).some((s) => s.family === "welded")).toBe(true);
  });

  it.each([2, 4] as const)(
    "preserva N2/N3/N4, a seção e d’ com %s ramos; não duplica o porta-estribos",
    (branches) => {
      const p = fixture();
      p.rebar.stirrupBranches = branches;
      // Four N1 bars per layer define the physical inner stirrup.
      p.rebar.tieCount = 8;
      const html = render(p);
      expect(html).toContain('data-quantity="3"');
      expect(html).toContain("PINO · 3 × Ø16,0 mm");
      expect(html.match(/data-transverse-position=/g)).toHaveLength(branches);
      expect(html).not.toContain("steel-mounting");
      const section = render(p, true);
      expect(section).toContain("steel-N2");
      expect(section).toContain("steel-N3");
      expect(section).toContain("steel-N4");
      expect(section).toContain("d’ =");
      expect(section).not.toContain("data-family=");
      expect(render(p, false, false)).not.toContain("detail-families");
    },
  );

  it("projeta a elevação a partir da geometria existente sem recalcular ELU", () => {
    const p = fixture(),
      before = JSON.stringify(p);
    rebarModel(p);
    const calculate = vi.spyOn(engine, "calculate");
    try {
      elevationShapes(p);
      expect(calculate).not.toHaveBeenCalled();
      expect(JSON.stringify(p)).toBe(before);
    } finally {
      calculate.mockRestore();
    }
  });

  it("reabre no esquema 5 sem restaurar mounting e conserva as projeções", () => {
    const p = fixture();
    const raw = JSON.stringify({ ...exampleProject(), pieces: [p] });
    const reopened = decodeProject(raw).pieces[0];
    expect(reopened.detailing).not.toHaveProperty("mounting");
    expect(elevationShapes(reopened)).toEqual(elevationShapes(p));
    expect(buildDetail(reopened).bars).toEqual(buildDetail(p).bars);
  });
});

describe("Sincronização de armaduras entre detalhamento, elevação e seção A–A (#36)", () => {
  it("N1 em alça na seção A–A usa os insets reais do detalhamento, inclusive da alça que não cabe (#64)", () => {
    const p = shortFixture();
    p.geometry.width = 240;
    p.design.frontAnchor = "loop";
    p.design.loopInternalDiameter = 100;
    p.rebar.tieCount = 4;
    const d = buildDetail(p),
      x1 = stirrupLayout(p).positions[0];
    const sec = sectionBars(p, d, x1);
    // Every declared leg is drawn (the inner loop overlaps at its minimum width).
    expect(sec.ties).toHaveLength(p.rebar.tieCount);
    const insets = d.bars
      .filter((b) => b.family === "tie")
      .flatMap((b) => {
        const inset = (p.geometry.width - b.width) / 2;
        return [inset, p.geometry.width - inset];
      })
      .sort((a, b) => a - b);
    expect(sec.ties.map((t) => t.v).sort((a, b) => a - b)).toEqual(insets);
    expect(d.issues.some((i) => i.code === "nested-loops")).toBe(true);
  });

  it("costuras na seção A–A incluem apenas barras que cruzam o plano x1", () => {
    const p = shortFixture();
    p.design.lowerStitchCount = 3;
    const d = buildDetail(p),
      x1 = stirrupLayout(p).positions[0];
    const crossing = d.bars
      .filter((b) => b.family === "stitch" || b.family === "lower")
      .flatMap((b) => b.locations)
      .filter((loc) => loc.x >= x1 - 1e-6);
    const sec = sectionBars(p, d, x1);
    expect(sec.stitches.map((s) => s.depth)).toEqual(
      crossing.map((loc) => loc.z),
    );
  });

  it("modo armado como viga projeta P1 na seção A–A com a profundidade na estação x1", () => {
    const p = fixture();
    p.detailing.barArrangement = "beam";
    const d = buildDetail(p),
      x1 = stirrupLayout(p).positions[0];
    const sec = sectionBars(p, d, x1);
    expect(sec.positives.length).toBeGreaterThan(0);
    const slope =
      (p.geometry.height - p.geometry.tipHeight) / p.geometry.length;
    const expectedDepth =
      p.geometry.height -
      slope * x1 -
      (p.geometry.cover +
        p.rebar.stirrupDiameter +
        sec.positives[0].diameter / 2) *
        Math.sqrt(1 + slope ** 2);
    expect(sec.positives[0].depth).toBeCloseTo(expectedDepth, 10);
    const html = render(p, true);
    expect(html).toContain('data-testid="beam-positive-section"');
  });
});

describe("Gancho de N1 no suporte (#68)", () => {
  it.each(["loop", "welded"] as const)(
    "conserva o início, a dobra e a ponta da ancoragem %s na prancha",
    (frontAnchor) => {
      const p = shortFixture();
      p.design.frontAnchor = frontAnchor;
      p.design.tieLayers = 2;
      p.design.supportAnchor = "hook";
      p.detailing.supportHookProjection = 600.1234567;
      p.detailing.supportHookTail = 128.1234567;
      const detail = buildDetail(p);
      const ties = elevationTieBars(p, detail);
      const sampled = elevationTiePaths(p, detail);
      const drawing = pieceDrawing(exampleProject(), detail);
      const sheet = drawing.entities.filter(
        (e) => e.layer === "ARMADURAS" && e.type !== "circle",
      );
      const radius =
        (mandrelDiameter(p.rebar.tieDiameter, p.materials.fyk) +
          p.rebar.tieDiameter) /
        2;
      const { x: originX, y: originY } = sheetOrigins(
        drawing,
        p.geometry,
      ).elevation;
      const pitch = beamTieBends(p, 1).back - beamTieBends(p, 0).back;
      expect(ties).toHaveLength(2);
      let offset = 0;
      for (const [i, { bar, path }] of ties.entries()) {
        const run = path.segments[0];
        const [bend, tail] = path.segments.slice(-2);
        const [sheetRun, ...rest] = sheet.slice(
          offset,
          offset + path.segments.length,
        );
        offset += path.segments.length;
        const [sheetBend, sheetTail] = rest.slice(-2);
        if (
          run.type !== "line" ||
          bend.type !== "arc" ||
          tail.type !== "line" ||
          sheetRun.type !== "line" ||
          sheetBend.type !== "arc" ||
          sheetTail.type !== "line"
        )
          throw new Error("Percurso de N1 sem reta, arco e ponta reta");
        expect(bend.radius).toBe(radius);
        expect(bend.sweep).toBeCloseTo(-Math.PI / 2, 10);
        expect(tail.a.x).toBeCloseTo(tail.b.x, 10);
        expect(tail.b.x).toBeCloseTo(
          -p.detailing.supportHookProjection + i * pitch,
          8,
        );
        expect(tail.b.y - tail.a.y).toBeCloseTo(
          p.detailing.supportHookTail,
          10,
        );
        expect(sampled[i][0]).toEqual(run.a);
        expect(sampled[i].at(-1)).toEqual(tail.b);
        for (const [mm, cm] of [
          [run.a, sheetRun.a],
          [bend.center, sheetBend.center],
          [tail.a, sheetTail.a],
          [tail.b, sheetTail.b],
        ]) {
          expect((cm.x - originX) * 10).toBeCloseTo(mm.x, 7);
          expect((cm.y - originY) * 10).toBeCloseTo(mm.y, 7);
        }
        const arcSvg = entitySvg(sheetBend).match(/d="([^"]+)"/)![1];
        const [ax, ay, r, , , , , bx, by] = arcSvg
          .match(/-?\d+(?:\.\d+)?/g)!
          .map(Number);
        const arcStart = at(bend.center, bend.radius, bend.start);
        expect((ax - originX) * 10).toBeCloseTo(arcStart.x, 7);
        expect((ay - originY) * 10).toBeCloseTo(arcStart.y, 7);
        expect(r * 10).toBeCloseTo(bend.radius, 7);
        expect((bx - originX) * 10).toBeCloseTo(tail.a.x, 7);
        expect((by - originY) * 10).toBeCloseTo(tail.a.y, 7);
        expect(bar.anchorage[0].projection).toBeCloseTo(-tail.b.x, 9);
        expect(bar.anchorage[0].length).toBeCloseTo(
          path.length - pathLengthAfterX(path, 0),
          9,
        );
        for (const instance of bar.instances) {
          const developed = instance.parts.reduce(
            (length, part) => length + pathLength(part.path.segments),
            0,
          );
          expect(bar.exactLength).toBeCloseTo(developed, 9);
          expect(bar.cutLength).toBe(Math.ceil(developed));
        }
      }
      const n1 = render(p).match(
        /class="steel steel-N1[^>]*>[\s\S]*?<\/g>/,
      )![0];
      expect(n1.match(/A[\d.]+ [\d.]+ 0 0 0 /g)).toHaveLength(2);
      expect(ties[0].bar.exactLength - ties[1].bar.exactLength).toBeCloseTo(
        frontAnchor === "loop" ? 2 * pitch : pitch,
        9,
      );

      p.design.supportAnchor = "straight";
      const straight = elevationTieBars(p, buildDetail(p));
      expect(straight).toHaveLength(2);
      for (const { path } of straight) {
        expect(path.segments).toMatchObject([{ type: "line" }]);
        const [line] = path.segments;
        if (line.type === "line") {
          expect(line.a.y).toBe(line.b.y);
          expect(line.b.x).toBe(-p.design.supportAnchorLength);
        }
      }
    },
  );
});
