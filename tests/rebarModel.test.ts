import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as engine from "../src/domain/engine";
import {
  exampleProject,
  newPiece,
  number,
  type Piece,
} from "../src/domain/model";
import { concreteProfile, pieceVolume } from "../src/domain/profile";
import { stirrupLayout } from "../src/domain/theory";
import { buildDetail, buildRebarGeometry } from "../src/detailing/model";
import {
  intersectSectionX,
  projectElevation,
  projectPlan,
  quantityMismatches,
  rebarModel,
  scenePaths,
} from "../src/detailing/rebarModel";
import { partPoints3 } from "../src/detailing/rebarPlacement";
import { sectionBars } from "../src/detailing/projection";
import { beamBarPositions } from "../src/detailing/beam";
import { samplePath, steelMass } from "../src/detailing/geometry";
import { pieceDrawing, steelSummaryDrawing } from "../src/detailing/drawing";
import {
  drawingDxf,
  drawingPdf,
  drawingSvg,
  steelCsv,
} from "../src/detailing/exports";
import { toCsv, toPdf } from "../src/lib/exports";
import { buildSceneModel } from "../src/visualization/model3d";
import Drawing from "../src/components/Drawing";
import { shortFixture } from "./fixtures";
import { inflateSync } from "node:zlib";

/** Short corbel with every connection family: welded bars, pins and hooks. */
function curto() {
  const p = shortFixture();
  p.quantity = 3;
  p.design.frontAnchor = "welded";
  p.design.supportAnchor = "hook";
  p.design.lowerStitchCount = 2;
  p.detailing.pins = 2;
  return p;
}
function muitoCurto() {
  const p = shortFixture();
  p.geometry.loadOffset = 200;
  p.design.lowerStitchCount = 2;
  return p;
}
function recortado() {
  const p = shortFixture();
  p.design.excessConcrete = "remove";
  p.design.lowerStitchCount = 2;
  return p;
}
function viga() {
  const p = shortFixture();
  p.detailing.barArrangement = "beam";
  p.detailing.beamBottomDiameter = 12.5;
  return p;
}
const cases: [string, () => Piece][] = [
  ["consolo curto", curto],
  ["consolo muito curto", muitoCurto],
  ["consolo recortado", recortado],
  ["armado como viga", viga],
];

function render(p: Piece, section = false) {
  return renderToStaticMarkup(
    createElement(Drawing, {
      piece: p,
      section,
      rebar: true,
      dimensions: false,
      grid: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      forces: false,
      selectedBar: "N1",
      onDimension: () => {},
      onBar: () => {},
    }),
  );
}
const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

describe("Fonte única das armaduras (#63)", () => {
  it("o caso recortado aplica de fato o recorte do concreto", () => {
    expect(concreteProfile(recortado()).status).toBe("removed");
  });

  it.each(cases)(
    "%s: cada posição declara todos os campos e uma barra física por unidade",
    (_name, make) => {
      const p = make();
      const model = rebarModel(p);
      expect(quantityMismatches(model)).toEqual([]);
      for (const bar of model.bars) {
        expect(bar.mark).toMatch(/^(N1|N2I?|N3G?|N4|P1|TS|PINO)(-\d+)?$/);
        expect(bar.role.length).toBeGreaterThan(0);
        expect(bar.diameter).toBeGreaterThan(0);
        expect(bar.grade).toBeGreaterThan(0);
        expect(bar.quantity).toBeGreaterThan(0);
        expect(bar.totalQuantity).toBe(bar.instances.length * p.quantity);
        expect(bar.totalLength).toBe(bar.cutLength * bar.totalQuantity);
        expect(bar.mass).toBeCloseTo(
          steelMass(bar.cutLength, bar.diameter) * bar.instances.length,
          9,
        );
        expect(bar.totalMass).toBeCloseTo(bar.mass * p.quantity, 9);
        expect(bar.path.valid).toBe(true);
        expect(bar.exactLength).toBeCloseTo(bar.path.length + bar.hookExtra, 9);
        expect(bar.cutLength).toBe(Math.ceil(bar.exactLength - 1e-7));
        expect(Array.isArray(bar.anchorage)).toBe(true);
        for (const end of bar.anchorage)
          expect(end.length === null || end.length > 0).toBe(true);
        // Every physical bar has the fabrication length of its position.
        for (const instance of bar.instances) {
          const placedLength = instance.parts.reduce(
            (sum, part) => sum + part.path.length,
            0,
          );
          expect(placedLength).toBeCloseTo(bar.exactLength, 6);
        }
      }
    },
  );

  it.each(cases)(
    "%s: a seção contém exatamente e somente as barras que atravessam o plano",
    (_name, make) => {
      const p = make();
      const model = rebarModel(p);
      const g = p.geometry;
      const { values } = engine.calculate(p);
      const stations = [
        stirrupLayout(p).positions[0],
        g.loadOffset,
        g.length / 2,
        -values.anchorN2_adopted / 2,
      ];
      for (const x of stations) {
        const cut = intersectSectionX(model, x);
        for (const bar of model.bars)
          for (const instance of bar.instances)
            for (const part of instance.parts) {
              // Independent reference: the sampled 3D centre line spans x.
              const xs = partPoints3(part, 96).map((pt) => pt.x);
              const spans =
                part.plane === "yz"
                  ? close(part.at, x)
                  : Math.min(...xs) <= x + 1e-9 && Math.max(...xs) >= x - 1e-9;
              const found = cut.some(
                (item) => item.instance === instance && item.part === part,
              );
              expect(found, `${bar.mark} @ x=${x}`).toBe(spans);
            }
      }
    },
  );

  it.each(cases)(
    "%s: elevação, planta e 3D são projeções das mesmas barras físicas",
    (_name, make) => {
      const p = make();
      const model = rebarModel(p);
      const elevation = projectElevation(model);
      const plan = projectPlan(model);
      const scene = buildSceneModel(p);
      const paths = scenePaths(model);
      expect(scene.steel).toHaveLength(paths.length);
      paths.forEach((item, i) => {
        const steel = scene.steel[i];
        expect(steel.mark).toBe(item.bar.mark);
        expect(steel.diameter).toBe(item.bar.diameter);
        expect(steel.points).toEqual(
          item.points.map((pt) => [pt.x, pt.y - g(p).width / 2, -pt.z]),
        );
        const onView = (
          shape: (typeof elevation)[number]["shape"],
          u: number,
          v: number,
        ) => {
          if (shape.kind === "point")
            return close(shape.center.x, u) && close(shape.center.y, v);
          const pts = samplePath(shape.path, 96);
          return pts.some((pt) => close(pt.x, u, 0.5) && close(pt.y, v, 0.5));
        };
        const e = elevation.find((x) => x.part === item.part)!;
        const pl = plan.find((x) => x.part === item.part)!;
        for (const pt of item.points) {
          // Collapsed runs keep the exact extent: compare with the extremes.
          if (e.shape.kind === "path" && item.part.plane !== "xz") {
            const xs = samplePath(e.shape.path).map((q) => q.x);
            const zs = samplePath(e.shape.path).map((q) => q.y);
            expect(pt.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
            expect(pt.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
            expect(pt.z).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-6);
            expect(pt.z).toBeLessThanOrEqual(Math.max(...zs) + 1e-6);
          } else expect(onView(e.shape, pt.x, pt.z)).toBe(true);
          if (pl.shape.kind === "path" && item.part.plane !== "xy") {
            const xs = samplePath(pl.shape.path).map((q) => q.x);
            const ys = samplePath(pl.shape.path).map((q) => q.y);
            expect(pt.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
            expect(pt.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
            expect(pt.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-6);
            expect(pt.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-6);
          } else expect(onView(pl.shape, pt.x, pt.y)).toBe(true);
        }
      });
    },
  );

  it.each(cases)(
    "%s: N2/N2I usam a penetração e o alcance do detalhamento na elevação e no 3D",
    (_name, make) => {
      const p = make();
      const model = rebarModel(p);
      const { values } = engine.calculate(p);
      const stitches = model.bars.filter(
        (b) => b.family === "stitch" || b.family === "lower",
      );
      expect(stitches.length).toBeGreaterThan(0);
      const scene = buildSceneModel(p).steel.filter((s) => s.id === "N2");
      const elevation = projectElevation(model).filter(
        ({ bar }) => bar.family === "stitch" || bar.family === "lower",
      );
      const locations = stitches.flatMap((b) =>
        b.locations.map((loc) => ({
          ...loc,
          embedment:
            values[
              b.family === "stitch" ? "anchorN2_adopted" : "anchorN2I_adopted"
            ],
        })),
      );
      expect(scene).toHaveLength(locations.length);
      expect(elevation).toHaveLength(locations.length);
      locations.forEach((loc, i) => {
        const xs = scene[i].points.map((pt) => pt[0]);
        expect(Math.min(...xs)).toBeCloseTo(-loc.embedment, 6);
        expect(Math.max(...xs)).toBeCloseTo(loc.x, 6);
        expect(scene[i].points.every((pt) => close(-pt[2], loc.z))).toBe(true);
        const shape = elevation[i].shape;
        expect(shape.kind).toBe("path");
        if (shape.kind === "path") {
          const pts = samplePath(shape.path);
          expect(Math.min(...pts.map((q) => q.x))).toBeCloseTo(
            -loc.embedment,
            6,
          );
          expect(Math.max(...pts.map((q) => q.x))).toBeCloseTo(loc.x, 6);
        }
      });
      // The modelling elevation draws one N2 path per physical stitch.
      const html = render(p);
      const n2 = html.match(/steel-N2[^]*?<\/g>/)![0];
      expect(n2.match(/<path/g)).toHaveLength(locations.length);
    },
  );

  it("o 3D inclui TS, PINO e as curvas reais de N1 (gancho no suporte)", () => {
    const p = curto();
    const scene = buildSceneModel(p);
    const model = rebarModel(p);
    const { values } = engine.calculate(p);
    const ids = new Set(scene.steel.map((s) => s.id));
    for (const id of ["N1", "N2", "N3", "N4", "TS", "PINO"])
      expect(ids.has(id as never)).toBe(true);
    expect(scene.steel.filter((s) => s.id === "PINO")).toHaveLength(
      p.detailing.pins,
    );
    expect(scene.steel.filter((s) => s.id === "TS")).toHaveLength(
      model.bars.filter((b) => b.family === "welded").length,
    );
    // Each N1 has one continuous trajectory including the support hook.
    const ties = model.bars.filter((b) => b.family === "tie");
    const legs = ties.reduce((n, b) => n + b.quantity, 0);
    const n1 = scene.steel.filter((s) => s.id === "N1");
    expect(n1).toHaveLength(legs);
    for (const bar of n1)
      expect(
        Math.max(...bar.points.map((pt) => -pt[2])) -
          Math.min(...bar.points.map((pt) => -pt[2])),
      ).toBeGreaterThan(values.anchorN1_tail);
  });

  it("o Corte B–B do modo viga corta N1 nas posições reais e mostra P1", () => {
    const p = viga();
    p.design.frontAnchor = "loop";
    const d = buildDetail(p);
    const bb = sectionBars(p, d, p.geometry.loadOffset);
    const tie = d.bars.find((b) => b.family === "tie")!;
    const positive = d.bars.find((b) => b.family === "positive")!;
    expect(bb.ties.map((t) => t.v)).toEqual(
      beamBarPositions(p, tie.quantity, tie.diameter),
    );
    expect(bb.positives).toHaveLength(positive.quantity);
    // The sheet draws every cut P1 of A–A and B–B (unique diameter here).
    const aa = sectionBars(p, d, stirrupLayout(p).positions[0], {
      pairWindow: p.rebar.stirrupDiameter,
    });
    const drawing = pieceDrawing({ ...exampleProject(), pieces: [p] }, d);
    const p1Circles = drawing.entities.filter(
      (e) =>
        e.type === "circle" &&
        e.layer === "ARMADURAS" &&
        !e.projectionCap &&
        close(e.radius, positive.diameter / 20),
    );
    expect(p1Circles).toHaveLength(aa.positives.length + bb.positives.length);
    expect(drawingSvg(drawing)).not.toMatch(/NaN|Infinity/);
    expect(drawingDxf(drawing)).not.toMatch(/NaN/);
  });

  it("o Corte B–B omite costuras que terminam antes do eixo da carga", () => {
    const p = recortado();
    const model = rebarModel(p);
    const x = p.geometry.loadOffset;
    const reaching = model.bars
      .filter((b) => b.family === "stitch" || b.family === "lower")
      .flatMap((b) => b.locations)
      .filter((loc) => loc.x >= x - 1e-6);
    expect(sectionBars(p, model, x).stitches.map((s) => s.depth)).toEqual(
      reaching.map((loc) => loc.z),
    );
  });

  it("representa por uma linha o trecho de N2 que pertence ao plano B–B", () => {
    const p = shortFixture();
    p.geometry.loadOffset =
      p.geometry.length - p.geometry.cover - p.rebar.stitchDiameter / 2;
    p.geometry.tipHeight = p.geometry.height;
    p.design.bearingLength = 40;
    const detail = buildDetail(p);
    const section = sectionBars(p, detail, p.geometry.loadOffset);
    const spans = section.lines.filter((line) => line.family === "stitch");
    expect(spans).toHaveLength(p.rebar.stitchCount);
    expect(section.stitches).toEqual([]);
    const drawing = pieceDrawing({ ...exampleProject(), pieces: [p] }, detail);
    const cut = drawing.entities.find(
      (e) => e.type === "text" && e.text.startsWith("CORTE B-B"),
    );
    if (cut?.type !== "text") throw new Error("Corte B–B ausente");
    for (const { a, b } of spans)
      expect(
        drawing.entities.some(
          (e) =>
            e.type === "line" &&
            e.layer === "ARMADURAS" &&
            close(e.a.x, cut.at.x + a.x / 10) &&
            close(e.b.x, cut.at.x + b.x / 10) &&
            close(e.a.y, cut.at.y + 10 + a.y / 10) &&
            close(e.b.y, cut.at.y + 10 + b.y / 10),
        ),
      ).toBe(true);
  });

  it("projeta no A–A apenas o N3G pareado mesmo com estações congestionadas", () => {
    const p = curto();
    p.rebar.stirrupBranches = 4;
    p.rebar.stirrupCount = 100;
    const model = rebarModel(p);
    expect(
      model.issues.some(({ code }) => code === "transverse-clearance"),
    ).toBe(true);
    const x = stirrupLayout(p).positions[0];
    const bars = sectionBars(p, model, x, {
      pairWindow: p.rebar.stirrupDiameter,
    });
    expect(bars.stirrups.map(({ family, x }) => ({ family, x }))).toEqual([
      { family: "stirrup", x },
      { family: "stirrupInner", x: x + p.rebar.stirrupDiameter },
    ]);
    expect(bars.constructive.map(({ x }) => x)).toEqual([
      x,
      x + p.rebar.stirrupDiameter,
      x + p.rebar.stirrupDiameter,
      x,
    ]);
  });

  it("detalha na peça padrão todos os ramos configurados, com erro explícito (#64)", async () => {
    const p = newPiece(1);
    p.design.frontAnchor = "loop";
    p.design.supportAnchor = "straight";
    p.quantity = 3;
    const project = { ...exampleProject(), pieces: [p] };
    const detail = buildDetail(p);
    expect(detail.issues.some(({ code }) => code === "nested-loops")).toBe(
      true,
    );
    const svg = drawingSvg(pieceDrawing(project, detail));
    // No loop is discarded: the sheet shows the 4 configured legs.
    expect(svg).toContain("Tirante: 4 ramos detalhados em 1 camada(s) ·");
    expect(svg).not.toContain("informados");
    expect(svg).toContain("PENDÊNCIAS IMPEDITIVAS");
    const csv = csvCells(toCsv(project));
    const header = csv[1];
    expect(csv[2][header.indexOf("Tirante (barras)")]).toBe("4");
    expect(csv[2][header.indexOf("N1 ramos detalhados por peca")]).toBe("4");
    const schedule = csvCells(steelCsv([detail]));
    // Two physical loops per piece, each with two longitudinal legs.
    for (const mark of ["N1-1", "N1-2"])
      expect(schedule.find((r) => r[3] === mark)!.slice(7, 9)).toEqual([
        "1",
        "3",
      ]);
    const memory = Buffer.from(await toPdf(project, p)).toString("latin1");
    expect(memory).not.toContain("N1 no detalhamento");
    expect(memory).toContain("Consumo com pendencias impeditivas");
  });

  it("não posiciona N3G sobre um par de ramos N1 descartado por forma inválida", () => {
    const p = shortFixture();
    Object.assign(p.geometry, { length: 60, loadOffset: 30 });
    Object.assign(p.design, { supportAnchorLength: 0, bearingLength: 40 });
    p.rebar.stirrupBranches = 4;
    const model = buildRebarGeometry(p);
    expect(model.issues.some(({ code }) => code === "shape-tie")).toBe(true);
    expect(
      model.issues.some(({ code }) => code === "transverse-inner-tie"),
    ).toBe(true);
    expect(model.bars.some(({ family }) => family === "stirrupInner")).toBe(
      false,
    );
  });

  it("as curvas tracejadas da costura em planta chegam ao SVG, DXF e PDF", async () => {
    const p = curto();
    const project = { ...exampleProject(), pieces: [p] };
    const drawing = pieceDrawing(project, buildDetail(p));
    const dashedArc = drawing.entities.find((e) => e.type === "arc" && e.dash);
    if (dashedArc?.type !== "arc" || dashedArc.thickness === undefined)
      throw new Error("Arco tracejado sem bitola");
    expect(drawingSvg(drawing)).toMatch(/<path[^>]+stroke-dasharray="2 1"/);
    expect(drawingDxf(drawing)).toMatch(
      /0\nLWPOLYLINE\n100\nAcDbEntity\n8\nARMADURAS\n6\nTRACEJADO[^]*?\n42\n/,
    );
    const pdf = Buffer.from(
      await drawingPdf([{ ...drawing, entities: [dashedArc] }]),
    ).toString("latin1");
    const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map((r) => {
        try {
          return inflateSync(Buffer.from(r[1], "latin1")).toString("latin1");
        } catch {
          return r[1];
        }
      })
      .join("\n");
    expect(streams).toMatch(/\[5\.669\d* 2\.834\d*\] 0\.? d/);
    const widths = [...streams.matchAll(/^([\d.]+) w$/gm)];
    expect(Number(widths.at(-1)?.[1])).toBeCloseTo(
      (dashedArc.thickness * 72) / 25.4,
      8,
    );
    expect(streams.match(/ m\n/g)).toHaveLength(1);
    expect(streams.match(/ c\n/g)!.length).toBeGreaterThan(1);
  });

  it.each(cases)(
    "%s: a seção A–A da modelagem desenha exatamente as barras do corte",
    (_name, make) => {
      const p = make();
      const model = rebarModel(p);
      const x1 = stirrupLayout(p).positions[0];
      const cut = sectionBars(p, model, x1, {
        pairWindow: p.rebar.stirrupDiameter,
      });
      const html = render(p, true);
      const group = (id: string) =>
        html.match(new RegExp(`steel-${id}[^]*?</g>`))?.[0] ?? "";
      expect(group("N1").match(/<circle/g) ?? []).toHaveLength(cut.ties.length);
      expect(group("N4").match(/<circle/g) ?? []).toHaveLength(
        cut.constructive.length,
      );
      expect(group("N3").match(/<path/g) ?? []).toHaveLength(
        cut.stirrups.length,
      );
      expect(
        (
          html.match(/data-testid="beam-positive-section"[^]*?<\/g>/)?.[0] ?? ""
        ).match(/<circle/g) ?? [],
      ).toHaveLength(cut.positives.length);
    },
  );

  it.each(cases)(
    "%s: concreto e taxa de aço consistentes com pieceVolume e o quadro",
    (_name, make) => {
      const p = make();
      p.quantity = 4;
      const d = buildDetail(p);
      expect(d.concreteVolume).toBe(pieceVolume(p));
      expect(d.totalConcreteVolume).toBeCloseTo(pieceVolume(p) * 4, 12);
      expect(d.steelRate).toBeCloseTo(d.mass / pieceVolume(p), 9);
      expect(rebarModel(p).concreteVolume).toBe(d.concreteVolume);
      expect(rebarModel(p).mass).toBe(d.mass);
      const svg = drawingSvg(
        pieceDrawing({ ...exampleProject(), pieces: [p] }, d),
      );
      expect(svg).toContain(
        `Concreto por peça: ${number(pieceVolume(p), 3)} m³ · 4 peças: ${number(pieceVolume(p) * 4, 3)} m³ · Taxa de aço: ${number(d.mass / pieceVolume(p), 1)} kg/m³`,
      );
      // Same value as the project CSV (toCsv) and the application status bar.
      const [, header, values] = csvCells(
        toCsv({ ...exampleProject(), pieces: [p] }),
      );
      expect(values[header.indexOf("Volume consolo total (m3)")]).toBe(
        number(pieceVolume(p) * 4, 3),
      );
      expect(values[header.indexOf("Volume consolo por peca (m3)")]).toBe(
        number(d.concreteVolume, 3),
      );
      expect(values[header.indexOf("Aco detalhado por peca (kg)")]).toBe(
        number(d.mass, 2),
      );
      expect(values[header.indexOf("Aco detalhado total (kg)")]).toBe(
        number(d.totalMass, 2),
      );
      expect(values[header.indexOf("Taxa de aco detalhado (kg/m3)")]).toBe(
        number(d.steelRate, 1),
      );
      const [scheduleHeader, ...rows] = csvCells(steelCsv([d]));
      for (const [i, bar] of d.bars.entries()) {
        const value = (column: string) =>
          rows[i][scheduleHeader.indexOf(column)];
        expect(value("Barras totais")).toBe(String(bar.totalQuantity));
        expect(value("C total (cm)")).toBe(
          (bar.totalLength / 10).toFixed(1).replace(".", ","),
        );
        expect(value("kg total")).toBe(
          bar.totalMass.toFixed(3).replace(".", ","),
        );
      }
    },
  );

  it("calcula a taxa geral pela massa e pelo volume de todos os exemplares", () => {
    const p = curto(),
      q = recortado();
    q.quantity = 17;
    const details = [buildDetail(p), buildDetail(q)];
    const volume =
      details[0].totalConcreteVolume + details[1].totalConcreteVolume;
    const mass = details[0].totalMass + details[1].totalMass;
    const summary = steelSummaryDrawing(exampleProject(), details);
    expect(drawingSvg(summary)).toContain(
      `Concreto total: ${number(volume, 3)} m³ · Taxa de aço do projeto: ${number(mass / volume, 1)} kg/m³`,
    );
  });

  it("informa passo uniforme somente quando as posições físicas de N3G o têm", () => {
    const p = shortFixture();
    p.rebar.stirrupBranches = 4;
    p.rebar.stirrupCount = 3;
    const bars = rebarModel(p).bars.filter(
      (bar) => bar.family === "stirrupInner",
    );
    expect(bars.flatMap((bar) => bar.instances)).toHaveLength(3);
    expect(bars.every((bar) => bar.spacing === null)).toBe(true);

    p.rebar.stirrupCount = 2;
    const pair = rebarModel(p).bars.filter(
      (bar) => bar.family === "stirrupInner",
    );
    const xs = pair.flatMap((bar) => bar.locations.map((loc) => loc.x));
    expect(xs).toHaveLength(2);
    expect(pair.every((bar) => bar.spacing === xs[1] - xs[0])).toBe(true);
  });

  it.each(cases)(
    "%s: não altera o cálculo estrutural nem as entradas",
    (_name, make) => {
      const p = make();
      const before = JSON.stringify(p);
      const d = buildDetail(p);
      expect(d.result).toEqual(engine.calculate(p));
      expect(JSON.stringify(p)).toBe(before);
    },
  );

  it("as vistas de modelagem reusam o cálculo de ancoragem da peça", () => {
    const p = curto();
    p.name = "ancoragem-memorizada";
    const { values } = engine.calculate(p);
    const spy = vi.spyOn(engine, "calculate");
    try {
      buildRebarGeometry(p, values);
      rebarModel(p, values);
      render(p);
      render(p, true);
      buildSceneModel(p);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("edições invalidam o modelo memorizado (sem reaproveitar resultado antigo)", () => {
    const p = curto();
    const first = rebarModel(p);
    expect(rebarModel(p)).toBe(first);
    const edited = structuredClone(p);
    edited.detailing.stitchEmbedment = 350;
    const second = rebarModel(edited);
    expect(second).not.toBe(first);
    const n2 = second.bars.find((b) => b.family === "stitch")!;
    const xs = partPoints3(n2.instances[0].parts[0]).map((pt) => pt.x);
    expect(Math.min(...xs)).toBeCloseTo(-edited.detailing.stitchEmbedment, 6);
    // Mutating the same object in place is also detected.
    p.rebar.stitchDiameter = 8;
    expect(rebarModel(p)).not.toBe(first);
    expect(first.piece.rebar.stitchDiameter).toBe(6.3);
    p.rebar.stitchDiameter = 6.3;
    expect(rebarModel(p)).toBe(first);
  });
});

const g = (p: Piece) => p.geometry;
const csvCells = (csv: string) =>
  csv
    .split("\r\n")
    .map((row) =>
      [...row.matchAll(/"((?:[^"]|"")*)"/g)].map((cell) =>
        cell[1].replaceAll('""', '"'),
      ),
    );
