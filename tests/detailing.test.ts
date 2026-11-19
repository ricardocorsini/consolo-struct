import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import {
  closedStirrup,
  pathLength,
  roundedPath,
  samplePath,
  steelMass,
} from "../src/detailing/geometry";
import { buildDetail } from "../src/detailing/model";
import {
  combineDrawings,
  maxPdfPageSide,
  pieceDrawing,
  type Drawing,
  type Entity,
} from "../src/detailing/drawing";
import { elevationShapes } from "../src/detailing/projection";
import { projectPlan } from "../src/detailing/rebarModel";
import {
  drawingDxf,
  drawingPdf,
  drawingSvg,
  entitySvg,
  steelCsv,
} from "../src/detailing/exports";
import { buildSceneModel } from "../src/visualization/model3d";
import { pathExtent } from "../src/detailing/rebarPlacement";
import {
  decodeProject,
  exampleProject,
  newPiece,
  number,
  withTieDiameter,
} from "../src/domain/model";
import { tieLayout } from "../src/domain/engine";
import { bottomDepth, concreteProfile } from "../src/domain/profile";
import { stirrupLayout } from "../src/domain/theory";
import {
  toCalculationJson,
  toCsv,
  toDxf,
  toPdf,
  toSvg,
} from "../src/lib/exports";
import { cantileverFixture, shortFixture } from "./fixtures";
import { sheetOrigins } from "./sheetOrigins";
import { entityBounds } from "../src/detailing/layout";

describe("Cotas geométricas da prancha", () => {
  it("liga A, L, H1 e as cotas de planta e cortes aos vértices medidos", () => {
    const p = shortFixture();
    const g = p.geometry;
    const drawing = pieceDrawing(exampleProject(), buildDetail(p));
    const labels = drawing.entities.filter((e) => e.type === "text");
    const lines = drawing.entities.filter(
      (e) => e.type === "line" && e.layer === "COTAS",
    );
    const label = (s: string) => labels.find((e) => e.text.startsWith(s))!;
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      expect(
        lines.some(({ a, b }) =>
          [a.x - x1, a.y - y1, b.x - x2, b.y - y2].every(
            (v) => Math.abs(v) < 1e-8,
          ),
        ),
      ).toBe(true);
    };
    const origins = sheetOrigins(drawing, g);
    const { x, y } = origins.elevation;
    const { y: planY } = origins.plan;
    const tip = x + g.length / 10;
    const width = g.width / 10;
    const rootBottom = y + g.height / 10;
    const tipBottom = y + g.tipHeight / 10;
    const loadY = label("A = ").at.y + 1.2;
    const lenY = label("L = ").at.y + 1.2;
    expect(loadY).toBeLessThan(y);
    expect(label("P = ").at.y + 1.2).toBe(loadY);
    line(x, loadY, x + g.loadOffset / 10, loadY);
    expect(lenY).toBeGreaterThan(rootBottom);
    line(x, lenY, tip, lenY);
    expect(
      lines.some(
        ({ a, b, annotation }) =>
          annotation === "extension" &&
          Math.abs(a.x - tip) < 1e-8 &&
          Math.abs(a.y - tipBottom - 1) < 1e-8 &&
          b.y > lenY,
      ),
    ).toBe(true);

    const drop = label("H1 = ");
    expect(drop.text).toBe(`H1 = ${number((g.height - g.tipHeight) / 10)}`);
    const dropX = drop.at.x + 1.2;
    expect(dropX).toBeGreaterThan(tip);
    expect(label("H = ").at.x).toBeGreaterThan(drop.at.x);
    line(dropX, tipBottom, dropX, rootBottom);
    line(x + 1, rootBottom, dropX + 2, rootBottom);
    const planLength = labels.find(
      (e) => e.text.startsWith("L = ") && e.at.y > planY,
    )!;
    line(x, planLength.at.y + 1.2, tip, planLength.at.y + 1.2);
    const planWidth = labels.find(
      (e) => e.text.startsWith("b = ") && e.at.x < origins.sectionA.x,
    )!;
    line(planWidth.at.x + 1.2, planY, planWidth.at.x + 1.2, planY + width);

    const profile = concreteProfile(p);
    for (const [origin, station, symbol] of [
      [origins.sectionA, stirrupLayout(p).positions[0], "H(x1)"],
      [origins.sectionB, g.loadOffset, "H(B-B)"],
    ] as const) {
      const { x: left, y: top } = origin;
      const depth = bottomDepth(profile, station) / 10;
      const bottom = top + depth;
      const height = label(`${symbol} = `);
      expect(height.text).toBe(`${symbol} = ${number(depth)}`);
      const axis = height.at.x + 1.2;
      expect(axis).toBeGreaterThan(left + width);
      line(axis, top, axis, bottom);
      expect(
        lines.some(
          ({ a, b, annotation }) =>
            annotation === "dimension" &&
            Math.abs(a.x - left) < 1e-8 &&
            Math.abs(b.x - left - width) < 1e-8 &&
            a.y === b.y &&
            a.y > bottom,
        ),
      ).toBe(true);
    }
    expect(
      labels.filter((e) => e.text === `b = ${number(width)}`),
    ).toHaveLength(3);
    p.geometry.tipHeight = p.geometry.height;
    expect(
      drawingSvg(pieceDrawing(exampleProject(), buildDetail(p))),
    ).not.toContain("H1 = ");
  });
});

const schematicHeading = "Desenho esquemático da armadura";
type Stroke = Extract<Entity, { type: "line" | "arc" }>;
const schematicStrokes = (drawing: Drawing, mark: string) =>
  drawing.entities.filter(
    (e): e is Stroke =>
      (e.type === "line" || e.type === "arc") &&
      e.layer === "ARMADURAS" &&
      e.schematic === mark,
  );

function schematicCells(drawing: Drawing) {
  const headings = drawing.entities.filter(
    (e) => e.type === "text" && e.text === schematicHeading,
  );
  if (!headings.length) throw new Error("Cabeçalho do esquema ausente");
  return headings.flatMap((heading) => {
    const left = heading.at.x - 1.5;
    const top = heading.at.y - 3.6;
    const frame = drawing.entities.find(
      (e) =>
        e.type === "line" &&
        e.layer === "COTAS" &&
        e.a.x === left &&
        e.b.x > left &&
        Math.abs(e.a.y - top) < 1e-8 &&
        e.a.y === e.b.y,
    );
    if (frame?.type !== "line") throw new Error("Célula do esquema ausente");
    return drawing.entities
      .flatMap((e) =>
        e.type === "line" &&
        e.layer === "COTAS" &&
        e.a.x === left &&
        e.b.x === left &&
        e.a.y > e.b.y
          ? [{ left, right: frame.b.x, top: e.b.y, bottom: e.a.y }]
          : [],
      )
      .slice(1);
  });
}

function schematicsFixture() {
  const loop = shortFixture();
  loop.design.supportAnchor = "hook";
  loop.design.lowerStitchCount = 2;
  loop.geometry.tipHeight = loop.geometry.height;
  loop.detailing.supportHookProjection = 600;
  loop.detailing.pins = 2;
  const welded = newPiece(1);
  welded.rebar.stirrupBranches = 4;
  const beam = shortFixture();
  beam.geometry.tipHeight = 450;
  beam.detailing.barArrangement = "beam";
  return [loop, welded, beam];
}

describe("Formas proporcionais na Relação do Aço (#70)", () => {
  it("enquadra a geometria e as cotas de todas as posições na própria linha", () => {
    const project = exampleProject();
    const families = new Set<string>();
    for (const piece of schematicsFixture()) {
      const detail = buildDetail(piece);
      const drawing = pieceDrawing(project, detail);
      const cells = schematicCells(drawing);
      expect(cells).toHaveLength(detail.bars.length);
      expect(drawingSvg(drawing)).not.toContain(
        "FORMAS DE DOBRAMENTO E POSIÇÕES",
      );
      for (const [i, bar] of detail.bars.entries()) {
        families.add(bar.family);
        const cell = cells[i];
        const strokes = schematicStrokes(drawing, bar.mark);
        const hook = bar.instances[0]?.parts.find(
          (part) => part.role === "hook",
        )?.path;
        const source = [...bar.path.segments, ...(hook?.segments ?? [])];
        expect(strokes.map((e) => e.type)).toEqual(
          source.map((seg) => seg.type),
        );
        const scale = pathLength(strokes) / pathLength(source);
        const path = {
          segments: strokes,
          length: pathLength(strokes),
          valid: true,
        };
        const [left, right] = pathExtent(path, "x");
        const [top, bottom] = pathExtent(path, "y");
        const halfStroke =
          Math.max(...strokes.map((e) => e.thickness ?? 0)) / 2;
        expect(left - halfStroke).toBeGreaterThan(cell.left + 3);
        expect(right + halfStroke).toBeLessThan(cell.right - 3);
        expect(top - halfStroke).toBeGreaterThan(cell.top + 3);
        expect(bottom + halfStroke).toBeLessThan(cell.bottom - 3);
        for (const [j, seg] of source.entries()) {
          const actual = strokes[j];
          if (seg.type === "line" && actual.type === "line") {
            expect(actual.b.x - actual.a.x).toBeCloseTo(
              (seg.b.x - seg.a.x) * scale,
              8,
            );
            expect(actual.b.y - actual.a.y).toBeCloseTo(
              (seg.b.y - seg.a.y) * scale,
              8,
            );
          } else if (seg.type === "arc" && actual.type === "arc") {
            expect(actual.radius).toBeCloseTo(seg.radius * scale, 8);
            expect(actual.start).toBe(seg.start);
            expect(actual.sweep).toBe(seg.sweep);
          }
        }
        const labels = drawing.entities.filter(
          (e): e is Extract<Entity, { type: "text" }> =>
            e.type === "text" &&
            e.at.x > cell.left &&
            e.at.x < cell.right &&
            e.at.y > cell.top &&
            e.at.y < cell.bottom,
        );
        expect(labels[0].text).toContain(bar.description);
        for (const label of labels) {
          const box = entityBounds(label);
          expect(box.left).toBeGreaterThan(right + halfStroke);
          expect(box.right).toBeLessThanOrEqual(cell.right - 3);
          expect(box.top).toBeGreaterThanOrEqual(cell.top + 3);
          expect(box.bottom).toBeLessThan(cell.bottom - 3);
        }
        if (hook) {
          expect(labels.map((label) => label.text).join(" ")).toContain(
            "Vista lateral",
          );
          expect(labels.map((label) => label.text).join(" ")).toContain(
            "Gancho de 90° no suporte",
          );
        }
      }
    }
    expect(families).toEqual(
      new Set([
        "tie",
        "stitch",
        "lower",
        "stirrup",
        "stirrupInner",
        "constructive",
        "positive",
        "welded",
        "pin",
      ]),
    );
  });

  it("recalcula as formas quando mudam geometria, mandril e ponta do gancho", () => {
    const project = exampleProject();
    const [piece] = schematicsFixture();
    const before = pieceDrawing(project, buildDetail(piece));
    piece.geometry.length += 150;
    piece.design.loopInternalDiameter += 20;
    piece.detailing.supportHookTail = 190;
    const after = pieceDrawing(project, buildDetail(piece));
    const mark = after.detail!.bars.find((bar) => bar.family === "tie")!.mark;
    const changed = schematicStrokes(after, mark);
    expect(changed).not.toEqual(schematicStrokes(before, mark));
    expect(changed.filter((e) => e.type === "arc")).toHaveLength(3);
    expect(drawingSvg(after)).toContain("Ponta reta 19,0 cm");
    expect(schematicCells(after)).toHaveLength(after.detail!.bars.length);
  });

  it("mantém a coluna e as formas vetoriais no SVG, no DXF e no PDF em peça larga", async () => {
    const project = exampleProject();
    const piece = newPiece(1);
    Object.assign(piece.geometry, {
      width: 6000,
      length: 6000,
      columnWidth: 6000,
      height: 2400,
      tipHeight: 2000,
      loadOffset: 1200,
    });
    piece.detailing.supportHookProjection = 1000;
    const drawing = pieceDrawing(project, buildDetail(piece));
    expect(drawing.width).toBeLessThan(maxPdfPageSide);
    const cell = schematicCells(drawing)[0];
    const tie = schematicStrokes(drawing, "N1");
    const [left, right] = pathExtent(
      { segments: tie, length: 0, valid: true },
      "x",
    );
    expect(left).toBeGreaterThan(cell.left + 3);
    expect(right).toBeLessThan(cell.right - 3);
    const svg = drawingSvg(drawing);
    const dxf = drawingDxf(drawing);
    expect(svg).toContain(schematicHeading);
    expect(svg).toContain('data-schematic-bar="N1"');
    expect(dxf).toContain("Desenho esquem\\U+00E1tico da armadura");
    expect(dxf).toContain("LWPOLYLINE");
    expect(svg + dxf).not.toMatch(/NaN|Infinity/);
    const pdf = Buffer.from(await drawingPdf([drawing])).toString("latin1");
    const streams = Array.from(
      pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g),
      ([, data]) => {
        try {
          return inflateSync(Buffer.from(data, "latin1")).toString("latin1");
        } catch {
          return "";
        }
      },
    ).join("\n");
    expect(streams).toContain(schematicHeading);
    expect(streams).toMatch(/ c\n/);
    expect(streams).not.toMatch(/NaN|Infinity/);
  });

  it("distribui 204 posições em blocos completos que cabem na mesma página PDF", async () => {
    const piece = newPiece(1);
    Object.assign(piece.geometry, {
      width: 500,
      length: 6000,
      columnWidth: 5800,
      height: 850,
      tipHeight: 250,
      loadOffset: 4200,
    });
    Object.assign(piece.rebar, {
      stirrupCount: 100,
      stirrupBranches: 4,
      stirrupDiameter: 6.3,
      stitchCount: 1,
      stitchDiameter: 6.3,
    });
    piece.design.lowerStitchCount = 0;
    const detail = buildDetail(piece);
    const drawing = pieceDrawing(exampleProject(), detail);
    const cells = schematicCells(drawing);
    expect(detail.bars).toHaveLength(204);
    expect(cells).toHaveLength(detail.bars.length);
    expect(new Set(cells.map((cell) => cell.left)).size).toBe(2);
    expect(Math.max(drawing.width, drawing.height)).toBeLessThan(
      maxPdfPageSide,
    );
    for (const [i, bar] of detail.bars.entries()) {
      const path = {
        segments: schematicStrokes(drawing, bar.mark),
        length: 0,
        valid: true,
      };
      expect(path.segments.length).toBeGreaterThan(0);
      const [left, right] = pathExtent(path, "x");
      const [top, bottom] = pathExtent(path, "y");
      const cell = cells[i];
      expect(left).toBeGreaterThan(cell.left + 3);
      expect(right).toBeLessThan(cell.right - 3);
      expect(top).toBeGreaterThan(cell.top + 3);
      expect(bottom).toBeLessThan(cell.bottom - 3);
    }
    const pdf = await drawingPdf([drawing]);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("Armaduras em escala geométrica (#69)", () => {
  it.each([10, 20])(
    "a prancha usa Ø%s em elevação, planta e nos dois cortes",
    (diameter) => {
      const p = shortFixture();
      p.design.frontAnchor = "welded";
      p.design.weldedBarDiameter = p.rebar.tieDiameter = diameter;
      const detail = buildDetail(p);
      const sheet = pieceDrawing(exampleProject(), detail);
      const origins = sheetOrigins(sheet, p.geometry);
      const { x, y: elevationY } = origins.elevation;
      const { y: planY } = origins.plan;
      const front = x + (p.geometry.length - p.geometry.cover) / 10;
      const depth = tieLayout(p).rows[0].y / 10;
      const inset =
        (p.geometry.cover + p.rebar.stirrupDiameter + diameter / 2) / 10;
      const steel = sheet.entities.filter(
        (entity) => entity.layer === "ARMADURAS",
      );
      for (const y of [elevationY + depth, planY + inset]) {
        const line = steel.find(
          (entity) =>
            entity.type === "line" &&
            Math.abs(entity.a.y - y) < 1e-8 &&
            Math.abs(entity.b.y - y) < 1e-8 &&
            Math.abs(Math.max(entity.a.x, entity.b.x) - front) < 1e-8,
        );
        expect(line).toMatchObject({ thickness: diameter / 10 });
        expect(entitySvg(line!)).toContain('stroke-linecap="butt"');
        expect(entitySvg(line!)).toContain(`stroke-width="${diameter / 10}"`);
        expect(front - p.geometry.length / 10 - x).toBeCloseTo(
          -p.geometry.cover / 10,
          8,
        );
      }
      for (const cut of [origins.sectionA, origins.sectionB]) {
        const section = steel.find(
          (entity) =>
            entity.type === "circle" &&
            Math.abs(entity.center.x - cut.x - inset) < 1e-8 &&
            Math.abs(entity.center.y - cut.y - depth) < 1e-8,
        );
        expect(section).toMatchObject({ radius: diameter / 20 });
        expect(entitySvg(section!)).toContain('stroke="none"');
      }
      const n3Cap = steel.find(
        (e) =>
          e.type === "circle" &&
          e.projectionCap &&
          Math.abs(e.center.x - x - stirrupLayout(p).positions[0] / 10) <
            1e-8 &&
          Math.abs(e.center.y - elevationY - stirrupLayout(p).offset / 10) <
            1e-8,
      );
      if (n3Cap?.type !== "circle")
        throw new Error("Top of N3 projection missing");
      expect(n3Cap.center.y - n3Cap.radius - elevationY).toBeCloseTo(
        p.geometry.cover / 10,
        8,
      );
    },
  );

  it("o arco largo do DXF conserva o eixo, a bitola e o raio em cm", () => {
    const project = exampleProject();
    const drawing = pieceDrawing(project, buildDetail(project.pieces[0]));
    const arc = drawing.entities.find(
      (e) => e.type === "arc" && e.thickness === 2,
    );
    if (arc?.type !== "arc") throw new Error("Dobra de N1 Ø20 ausente");
    const dxf = drawingDxf({ ...drawing, entities: [arc] });
    expect(dxf).toContain("$INSUNITS\n70\n5\n");
    const tokens = dxf
      .split("0\nLWPOLYLINE\n")[1]
      .split("0\nENDSEC")[0]
      .split("\n");
    const values = (code: number) =>
      tokens.flatMap((field, i) =>
        i % 2 === 0 && field === String(code) ? [Number(tokens[i + 1])] : [],
      );
    const [ax, bx] = values(10);
    const [ay, by] = values(20);
    const [bulge] = values(42);
    const sweep = 4 * Math.atan(bulge);
    expect(values(43)).toEqual([2]);
    expect(sweep).toBeCloseTo(-arc.sweep, 7);
    expect(
      Math.hypot(bx - ax, by - ay) / (2 * Math.sin(Math.abs(sweep) / 2)),
    ).toBeCloseTo(arc.radius, 4);
    expect(ax).toBeCloseTo(arc.center.x + arc.radius * Math.cos(arc.start), 4);
    expect(-ay).toBeCloseTo(arc.center.y + arc.radius * Math.sin(arc.start), 4);
    expect(bx).toBeCloseTo(
      arc.center.x + arc.radius * Math.cos(arc.start + arc.sweep),
      4,
    );
    expect(-by).toBeCloseTo(
      arc.center.y + arc.radius * Math.sin(arc.start + arc.sweep),
      4,
    );
  });
});

describe("N1 reto com gancho e barra transversal soldada (#67)", () => {
  it("reproduz os 701,37 mm de desenvolvimento com um único BarPath", () => {
    const p = newPiece(1);
    const detail = buildDetail(p);
    const bar = detail.bars.find((b) => b.family === "tie")!;
    const [vertical, bend, horizontal] = bar.path.segments;
    expect(bar.path.valid).toBe(true);
    expect(bar.path.segments.map((s) => s.type)).toEqual([
      "line",
      "arc",
      "line",
    ]);
    if (
      vertical.type !== "line" ||
      bend.type !== "arc" ||
      horizontal.type !== "line"
    )
      throw new Error("Formato de N1 inesperado");
    expect(vertical.a.x).toBe(-265);
    expect(vertical.a.y - vertical.b.y).toBeCloseTo(160, 9);
    expect(bend.radius).toBe(90);
    expect(bend.sweep).toBeCloseTo(Math.PI / 2, 10);
    expect(bend.radius * bend.sweep).toBeCloseTo(141.37, 2);
    expect(horizontal.b.x - horizontal.a.x).toBeCloseTo(400, 10);
    expect(horizontal.b.x).toBe(225);
    expect(bar.mandrel).toBe(160);
    expect(bar.hookExtra).toBe(0);
    expect(bar.exactLength).toBe(bar.path.length);
    expect(bar.exactLength).toBeCloseTo(701.37, 2);
    expect(bar.cutLength).toBe(702);
    expect(
      bar.instances.every(
        (i) => i.parts.length === 1 && i.parts[0].plane === "xz",
      ),
    ).toBe(true);
    const weld = detail.result.checks.find((c) => c.id === "weldForce");
    expect(weld?.demand).toBeCloseTo(157079.63, 2);
    expect(weld?.capacity).toBe(0);
    expect(weld?.status).toBe("fail");
    const sheet = drawingSvg(pieceDrawing(exampleProject(), detail));
    expect(sheet).toContain("Gancho de 90° no suporte");
    expect(sheet).not.toContain("fora do plano da alça");
  });

  it("projeta TS tangente abaixo de N1 na elevação, na planta, no 3D e no quadro", () => {
    const p = newPiece(1);
    const detail = buildDetail(p);
    const bar = detail.bars.find((b) => b.family === "welded")!;
    const { x, z } = bar.locations[0];
    const { geometry: g, rebar: r } = p;
    expect(x).toBe(215);
    expect(z).toBeCloseTo(61.3, 9);
    expect(g.length - x - bar.diameter / 2).toBe(g.cover);
    expect(z - tieLayout(p).rows[0].y).toBeCloseTo(
      (r.tieDiameter + bar.diameter) / 2,
      9,
    );
    expect(z + bar.diameter / 2).toBeLessThanOrEqual(g.height / 5);
    expect(elevationShapes(p).find((s) => s.family === "welded")).toMatchObject(
      {
        center: { x, y: z },
        diameter: 20,
      },
    );
    expect(
      projectPlan(detail).find(({ bar }) => bar.family === "welded")?.shape,
    ).toMatchObject({
      kind: "path",
      path: { segments: [{ type: "line", a: { x, y: 25 }, b: { x, y: 275 } }] },
    });
    expect(buildSceneModel(p).steel.find((b) => b.id === "TS")?.points).toEqual(
      [
        [x, -125, -z],
        [x, 125, -z],
      ],
    );
    expect(drawingSvg(pieceDrawing(exampleProject(), detail))).toContain(
      "Barra transversal soldada",
    );
    expect(steelCsv([detail])).toContain(
      '"TS";"Barra transversal soldada";"CA-50";"20"',
    );
    expect(
      detail.issues
        .filter((i) => i.code.startsWith("weld-"))
        .map((i) => i.code),
    ).toEqual(["weld-review"]);
    const crowded = buildDetail(withTieDiameter(p, 25));
    expect(crowded.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "weld-depth", severity: "error" }),
        expect.objectContaining({
          code: "weld-stitch-clash",
          severity: "error",
        }),
      ]),
    );
  });
});

describe("Centro de gravidade das barras e comprimentos de oficina", () => {
  it("alça U inclui duas curvas de 90° sem somar os cantos virtuais", () => {
    const r = 58;
    const path = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 300 },
        { x: 0, y: 300 },
      ],
      r,
    );
    expect(path.valid).toBe(true);
    expect(path.length).toBeCloseTo(2300 + (Math.PI - 4) * r, 8);
    expect(path.segments.filter((s) => s.type === "arc")).toHaveLength(2);
    const points = samplePath(path);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 0, y: 300 });
  });
  it("estribo fechado soma três cantos de 90° e dois ganchos de 135°", () => {
    const path = closedStirrup(300, 400, 6.3, 18.9),
      radius = 12.6;
    expect(path.valid).toBe(true);
    expect(path.length).toBeCloseTo(1400 + (3 * Math.PI - 8) * radius + 100, 8);
    const arcs = path.segments.filter((s) => s.type === "arc");
    expect(arcs).toHaveLength(5);
    expect(arcs.reduce((s, a) => s + Math.abs(a.sweep), 0)).toBeCloseTo(
      3 * Math.PI,
      10,
    );
  });
  it("não reduz mandris para fazer uma forma impossível caber", () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
        ],
        40,
      ).valid,
    ).toBe(false);
    expect(closedStirrup(30, 40, 16, 80).valid).toBe(false);
  });
  it("massa usa comprimento desenvolvido e densidade de 7850 kg/m³", () => {
    expect(steelMass(1000, 10)).toBeCloseTo(0.616537558, 8);
  });
});
describe("Posições, tirante duplo e quadro de aço", () => {
  it("quatro ramos são duas alças e não quatro alças", () => {
    const detail = buildDetail(shortFixture());
    // The rounded N3 corner penetrates N1 by 0.601 mm; counting two loops
    // must not certify their physical clearance or suppress that diagnostic.
    expect(
      detail.issues.filter((i) => i.severity === "error").map((i) => i.code),
    ).toEqual(["transverse-tie-clash"]);
    const loops = detail.bars.filter((b) => b.family === "tie");
    expect(loops.reduce((n, b) => n + b.quantity, 0)).toBe(2);
    expect(loops).toHaveLength(2); // nested loops have different cut lengths
  });
  it("a segunda camada tem posição, mandril, comprimento e altura útil próprios", () => {
    const p = shortFixture();
    p.design.tieLayers = 2;
    p.detailing.secondLoopDiameter = 160;
    const detail = buildDetail(p),
      ties = detail.bars.filter((b) => b.family === "tie");
    expect(ties).toHaveLength(2);
    expect(ties[0].mandrel).toBe(100);
    expect(ties[1].mandrel).toBe(160);
    expect(ties[0].locations[0].z).toBeLessThan(ties[1].locations[0].z);
    expect(ties[0].cutLength).not.toBe(ties[1].cutLength);
    expect(detail.result.fingerprint).toContain('"tieLayers":2');
  });
  it("separa comprimentos variáveis dos estribos em cada x", () => {
    const p = shortFixture(),
      detail = buildDetail(p);
    const stirrups = detail.bars.filter((b) => b.family === "stirrup");
    expect(stirrups).toHaveLength(5);
    expect(new Set(stirrups.map((b) => b.cutLength)).size).toBe(5);
    expect(stirrups[0].cutLength).toBeGreaterThan(stirrups[4].cutLength);
    expect(stirrups.flatMap((b) => b.locations).at(-1)!.x).toBeCloseTo(
      p.geometry.length - p.geometry.cover - p.rebar.stirrupDiameter / 2,
      8,
    );
  });
  it("quantidades do tipo multiplicam barras e massa uma única vez", () => {
    const p = shortFixture();
    p.quantity = 7;
    const d = buildDetail(p);
    expect(d.totalMass).toBeCloseTo(d.mass * 7, 10);
    expect(d.steelSummary.reduce((s, v) => s + v.mass, 0)).toBeCloseTo(
      d.mass,
      10,
    );
    for (const b of d.bars) {
      expect(b.cutLength).toBeGreaterThanOrEqual(b.exactLength - 1e-6);
      expect(b.cutLength - b.exactLength).toBeLessThan(1.00001);
    }
  });
  it("denuncia alças que não cabem e ramos ímpares por camada", () => {
    const p = shortFixture();
    p.geometry.width = 220;
    expect(buildDetail(p).issues.some((i) => i.code === "nested-loops")).toBe(
      true,
    );
    p.geometry.width = 400;
    p.rebar.tieCount = 6;
    p.design.tieLayers = 2;
    expect(buildDetail(p).issues.some((i) => i.code === "tie-even")).toBe(true);
  });
  it("verifica o percurso real do gancho em vez de reutilizar o valor declarado", () => {
    const p = shortFixture();
    p.design.supportAnchor = "hook";
    p.detailing.supportHookProjection = 250;
    p.detailing.supportHookTail = 200;
    expect(buildDetail(p).issues.some((i) => i.code === "hook-available")).toBe(
      true,
    );
  });
  it("incorpora ancoragens adotadas no comprimento de corte de N1, N2/N2I e N4", () => {
    const p = shortFixture();
    p.design.supportAnchor = "hook";
    const d = buildDetail(p);
    p.detailing.supportHookTail = 158;
    p.detailing.stitchEmbedment = 250;
    const manual = buildDetail(p);
    const first = (detail: typeof d, mark: string) =>
      detail.bars.find((b) => b.mark.startsWith(mark))!;
    const { values } = d.result;
    expect(
      first(manual, "N1").exactLength - first(d, "N1").exactLength,
    ).toBeCloseTo(2 * (158 - values.anchorN1_tail), 8);
    for (const [mark, family, automatic] of [
      ["N2-", "stitch", values.anchorN2_adopted],
      ["N2I-", "lower", values.anchorN2I_adopted],
    ] as const) {
      const a = d.bars.find((b) => b.family === family)!;
      const b = manual.bars.find((b) => b.mark === a.mark)!;
      expect(a.mark.startsWith(mark.slice(0, -1))).toBe(true);
      expect(b.exactLength - a.exactLength).toBeCloseTo(
        2 * (250 - automatic),
        8,
      );
      expect(b.cutLength).toBe(Math.ceil(b.exactLength - 1e-7));
    }
    p.geometry.columnWidth = 140;
    const limited = buildDetail(p);
    expect(first(limited, "N4").exactLength).toBeCloseTo(
      first(d, "N4").exactLength -
        (values.anchorN4_adopted - limited.result.values.anchorN4_adopted),
      8,
    );
    expect(first(limited, "N4").cutLength).toBeLessThan(
      first(d, "N4").cutLength,
    );
  });
  it("pinos não ganham aprovação estrutural por serem desenhados", () => {
    const p = shortFixture();
    p.detailing.pins = 2;
    const d = buildDetail(p);
    expect(d.bars.find((b) => b.family === "pin")?.quantity).toBe(2);
    expect(d.issues.find((i) => i.code === "pins")?.severity).toBe("review");
  });
  it("detecta pino atravessando o tirante e permite ajustar a distribuição transversal", () => {
    const p = shortFixture();
    p.detailing.pins = 2;
    p.detailing.pinSpacing = 321.4;
    expect(buildDetail(p).issues.some((i) => i.code === "pin-tie-clash")).toBe(
      true,
    );
    p.detailing.pinSpacing = 0;
    expect(buildDetail(p).issues.some((i) => i.code === "pin-tie-clash")).toBe(
      false,
    );
  });
});
describe("Interoperabilidade e arquivos", () => {
  it("exporta a ancoragem por família e os limites nominal e no eixo", async () => {
    const p = shortFixture();
    p.geometry.columnWidth = 207;
    const project = { ...exampleProject(), pieces: [p] };
    const d = buildDetail(p);
    const audit = JSON.parse(toCalculationJson(project, p));
    expect(audit.result.values).toEqual(d.result.values);
    expect(audit.result.combinations[0].values).toEqual(
      d.result.combinations[0].values,
    );
    const [, header, row] = toCsv(project)
      .split("\r\n")
      .map((line) => line.split(";"));
    expect(row[header.indexOf('"N2 Limite nominal P − c (mm)"')]).toBe(
      '"182,000"',
    );
    expect(row[header.indexOf('"N2 Limite no eixo P − c − φ/2 (mm)"')]).toBe(
      '"178,850"',
    );
    const pdf = Buffer.from(await toPdf(project, p)).toString("latin1");
    expect(pdf).toContain("Ancoragem por familia de armadura");
    expect(pdf).toContain("Limite nominal P - c");
    expect(pdf).toContain("Limite no eixo P - c - phi/2");
  });
  it("migra esquemas 1 e 2 sem inventar aprovação do detalhamento", () => {
    const project = exampleProject();
    const legacy = {
      ...project,
      schemaVersion: 2,
      pieces: project.pieces.map(({ detailing: _d, ...p }) => p),
    };
    const converted = decodeProject(JSON.stringify(legacy));
    expect(converted.schemaVersion).toBe(6);
    expect(converted.pieces[0].detailing.revision).toBe("R00");
    converted.pieces[0].detailing.notes = "Dobra conferida";
    expect(decodeProject(JSON.stringify(converted))).toEqual(converted);
  });
  it("DXF trabalha em cm e mantém arcos e textos editáveis", () => {
    const p = shortFixture(),
      project = { ...exampleProject(), pieces: [p] };
    const drawing = pieceDrawing(project, buildDetail(p));
    const dxf = drawingDxf(drawing);
    expect(dxf).toContain("$INSUNITS\n70\n5\n");
    expect(dxf).toContain("\nLWPOLYLINE\n");
    expect(dxf).toContain("\n42\n");
    expect(dxf).toContain("AcDbText");
    expect(dxf).toContain("C unit cm");
    expect(dxf).toContain("FORMAS");
    expect(dxf).not.toContain("NaN");
  });
  it("exporta todos os tipos, com marcas locais e identidade preservada", () => {
    const project = exampleProject();
    project.pieces = [
      shortFixture(),
      { ...shortFixture(), id: "second", name: "Outro" },
    ];
    const drawings = project.pieces.map((p) =>
      pieceDrawing(project, buildDetail(p)),
    );
    const combined = combineDrawings(drawings);
    expect(drawingSvg(combined)).toContain("Outro");
    expect(combined.height).toBeGreaterThan(
      drawings[0].height + drawings[1].height,
    );
  });
  it("escapa SVG e fórmulas CSV nos campos editáveis", () => {
    const p = shortFixture();
    p.name = '=HYPERLINK("x")';
    p.detailing.notes = '<script>alert("x")</script>';
    const project = { ...exampleProject(), pieces: [p] };
    const svg = drawingSvg(pieceDrawing(project, buildDetail(p)));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(steelCsv([buildDetail(p)])).toContain("\"'=HYPERLINK");
  });
});
describe("Viga em balanço (1 < a/d ≤ 2)", () => {
  it("detalha, desenha e exporta sem depender de valores de bielas", () => {
    for (const p of [
      cantileverFixture(),
      cantileverFixture({ vertical: 350000, loadOffset: 700, length: 800 }),
      cantileverFixture({ height: 700, loadOffset: 1000, length: 1100 }),
    ]) {
      const detail = buildDetail(p);
      expect(detail.result.combinations[0].method).toBe("beam");
      expect(detail.bars.length).toBeGreaterThan(0);
      const project = { ...exampleProject(), pieces: [p] };
      const drawing = pieceDrawing(project, detail);
      for (const text of [
        drawingDxf(drawing),
        drawingSvg(drawing),
        steelCsv([detail]),
        toCsv(project),
        toDxf(p),
        toSvg(p),
      ])
        expect(text).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
  it("o passo de N3 verificado pelo motor é o mesmo do detalhamento", () => {
    const p = cantileverFixture();
    p.rebar.stirrupCount = 7;
    const drawn = buildDetail(p)
      .bars.filter((b) => b.family === "stirrup")
      .map((b) => b.locations[0].x);
    const layout = stirrupLayout(p);
    expect(drawn).toEqual(layout.positions);
    expect(drawn[1] - drawn[0]).toBeCloseTo(layout.pitch, 10);
    const spacing = buildDetail(p).result.checks.find(
      (c) => c.id === "beamStirrupSpacing",
    )!;
    expect(spacing.demand).toBeCloseTo(layout.pitch, 10);
  });
});
