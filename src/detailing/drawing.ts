import type { Project } from "../domain/model";
import { number } from "../domain/model";
import {
  mandrelDiameter,
  samplePath,
  type BarPath,
  type Point,
} from "./geometry";
import { type Bar, type Detail } from "./model";
import { reactionGeometry, stirrupLayout } from "../domain/theory";
import { elevationTieBars, sectionBars } from "./projection";
import { projectElevation, projectPlan, type ViewItem } from "./rebarModel";
import { pathExtent } from "./rebarPlacement";
import { bottomDepth, concreteProfile } from "../domain/profile";
import { coefficientText, materialSafety } from "../domain/materialSafety";
import {
  gammaNDecision,
  gammaNDecisionText,
  gammaNReference,
} from "../domain/gammaN";
import { steelLabel } from "../domain/steel";

export type Layer =
  | "FORMAS"
  | "ARMADURAS"
  | "COTAS"
  | "TEXTOS"
  | "EIXOS"
  | "ALERTAS";
export type Entity =
  | {
      type: "line";
      a: Point;
      b: Point;
      layer: Layer;
      dash?: boolean;
      thickness?: number;
    }
  | {
      type: "arc";
      center: Point;
      radius: number;
      start: number;
      sweep: number;
      layer: Layer;
      dash?: boolean;
      thickness?: number;
    }
  | {
      type: "circle";
      center: Point;
      radius: number;
      layer: Layer;
      projectionCap?: boolean;
    }
  | {
      type: "text";
      at: Point;
      text: string;
      size: number;
      layer: Layer;
      align?: "middle" | "end";
      rotate?: number;
    };
export type Drawing = {
  width: number;
  height: number;
  entities: Entity[];
  name: string;
  detail?: Detail;
};
export const cm = (mm: number, digits = 1) => number(mm / 10, digits);
export const grade = steelLabel;
export const barLabel = (b: Bar) =>
  `${b.quantity} ${b.mark} Ø${number(b.diameter, 1)} C=${cm(b.cutLength)}`;
export const colors: Record<Layer, string> = {
  FORMAS: "#303843",
  ARMADURAS: "#174c9b",
  COTAS: "#596779",
  TEXTOS: "#111820",
  EIXOS: "#718096",
  ALERTAS: "#aa382e",
};

export function pieceDrawing(project: Project, d: Detail): Drawing {
  const p = d.piece,
    g = p.geometry,
    concrete = concreteProfile(p),
    cut = concrete.status === "removed",
    r = p.rebar,
    q = p.design,
    s = p.detailing;
  const entities: Entity[] = [];
  const text = (
    x: number,
    y: number,
    value: string,
    size = 2.4,
    layer: Layer = "TEXTOS",
    align?: "middle" | "end",
    rotate?: number,
  ) =>
    entities.push({
      type: "text",
      at: { x, y },
      text: value,
      size,
      layer,
      align,
      rotate,
    });
  const line = (
    x: number,
    y: number,
    x2: number,
    y2: number,
    layer: Layer = "FORMAS",
    dash = false,
    thickness?: number,
  ) =>
    entities.push({
      type: "line",
      a: { x, y },
      b: { x: x2, y: y2 },
      layer,
      dash,
      ...(thickness !== undefined ? { thickness } : {}),
    });
  const poly = (
    points: Point[],
    layer: Layer = "FORMAS",
    closed = false,
    dash = false,
  ) => {
    for (let i = 1; i < points.length; i++)
      line(
        points[i - 1].x,
        points[i - 1].y,
        points[i].x,
        points[i].y,
        layer,
        dash,
      );
    if (closed)
      line(
        points.at(-1)!.x,
        points.at(-1)!.y,
        points[0].x,
        points[0].y,
        layer,
        dash,
      );
  };
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    layer: Layer = "FORMAS",
    dash = false,
  ) =>
    poly(
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      layer,
      true,
      dash,
    );
  const barCircle = (
    x: number,
    y: number,
    diameter: number,
    projectionCap = false,
  ) =>
    entities.push({
      type: "circle",
      center: { x, y },
      radius: diameter / 20,
      layer: "ARMADURAS",
      ...(projectionCap ? { projectionCap } : {}),
    });
  const barPath = (
    path: BarPath,
    diameter: number,
    x: number,
    y: number,
    dash = false,
    endCaps: Point[] = [],
  ) => {
    const thickness = diameter / 10;
    for (const seg of path.segments) {
      if (seg.type === "line")
        line(
          x + seg.a.x / 10,
          y + seg.a.y / 10,
          x + seg.b.x / 10,
          y + seg.b.y / 10,
          "ARMADURAS",
          dash,
          thickness,
        );
      else
        entities.push({
          ...seg,
          center: { x: x + seg.center.x / 10, y: y + seg.center.y / 10 },
          radius: seg.radius / 10,
          layer: "ARMADURAS",
          thickness,
          ...(dash ? { dash } : {}),
        });
    }
    for (const cap of endCaps)
      barCircle(x + cap.x / 10, y + cap.y / 10, diameter, true);
  };
  const dim = (
    x: number,
    y: number,
    x2: number,
    y2: number,
    offset: number,
    label: string,
  ) => {
    const vertical = Math.abs(x2 - x) < 1e-6;
    if (!vertical) {
      line(
        x,
        y + Math.sign(offset),
        x,
        y + offset + Math.sign(offset) * 2,
        "COTAS",
      );
      line(
        x2,
        y2 + Math.sign(offset),
        x2,
        y + offset + Math.sign(offset) * 2,
        "COTAS",
      );
      line(x, y + offset, x2, y + offset, "COTAS");
      for (const xx of [x, x2])
        line(xx - 1.2, y + offset + 1.2, xx + 1.2, y + offset - 1.2, "COTAS");
      text((x + x2) / 2, y + offset - 1.5, label, 2.2, "COTAS", "middle");
    } else {
      line(
        x + Math.sign(offset),
        y,
        x + offset + Math.sign(offset) * 2,
        y,
        "COTAS",
      );
      line(
        x2 + Math.sign(offset),
        y2,
        x + offset + Math.sign(offset) * 2,
        y2,
        "COTAS",
      );
      line(x + offset, y, x + offset, y2, "COTAS");
      for (const yy of [y, y2])
        line(x + offset - 1.2, yy + 1.2, x + offset + 1.2, yy - 1.2, "COTAS");
      text(x + offset - 1.5, (y + y2) / 2, label, 2.2, "COTAS", "middle", -90);
    }
  };
  const leader = (
    x: number,
    y: number,
    tx: number,
    ty: number,
    label: string,
  ) => {
    line(x, y, tx - 3, ty - 1, "COTAS");
    line(tx - 3, ty - 1, tx + 2, ty - 1, "COTAS");
    text(tx + 3, ty, label, 2.1);
  };
  const wrap = (value: string, width = 100) => {
    const result: string[] = [];
    for (const paragraph of value.split(/\r?\n/)) {
      let chunk = "";
      for (const word of paragraph.split(/\s+/)) {
        if (chunk.length + word.length + 1 > width) {
          result.push(chunk);
          chunk = "";
        }
        chunk += `${chunk ? " " : ""}${word}`;
      }
      if (chunk) result.push(chunk);
    }
    return result;
  };
  const P = g.columnWidth / 10,
    L = g.length / 10,
    H = g.height / 10,
    B = g.width / 10;
  const x = P + 15,
    y =
      52 +
      (d.bars.some((bar) => bar.family === "pin") ? s.pinProjection / 10 : 0),
    sectionX = x + L + 46;
  const viewRight = sectionX + B + 50;
  const tableX = viewRight + 10,
    tableW = 205;
  const width = Math.max(540, tableX + tableW + 12);
  const countBars = (family: Bar["family"]) =>
    d.bars
      .filter((bar) => bar.family === family)
      .reduce((sum, bar) => sum + bar.quantity, 0);
  const detailedTieCount = d.tieRows.reduce(
    (sum, row) => sum + row.detailedCount,
    0,
  );
  const detailedTieLayers = d.tieRows.filter(
    (row) => row.detailedCount > 0,
  ).length;
  const missingTieLegs = detailedTieCount !== r.tieCount;
  const outerCount = countBars("stirrup");
  const innerCount = countBars("stirrupInner");
  const constructiveCount = countBars("constructive");
  text(10, 8, `${p.name}  |  DETALHAMENTO DO CONSOLO`, 3.5);
  text(
    width - 10,
    8,
    `${s.revision || "R00"}  ·  ${p.quantity} PEÇA(S)`,
    2.8,
    "TEXTOS",
    "end",
  );
  text(10, 14, `${project.name} · ${p.description}`.slice(0, 160), 2.5);
  text(width - 10, 14, "ConsoloStruct · OPENSTRUCT", 2.3, "TEXTOS", "end");
  text(
    10,
    20,
    `fck ${number(p.materials.fck, 0)} MPa · Tirante ${grade(p.materials.fyk)} · Transversal ${grade(p.materials.fykTransverse)} · Cobrimento ${cm(g.cover)} cm · Cotas em cm / bitolas em mm`,
    2.3,
  );
  text(
    10,
    26,
    `Tirante: ${detailedTieCount} ramos detalhados em ${detailedTieLayers} camada(s)${detailedTieLayers === 2 ? " · TIRANTE DUPLO" : ""}${missingTieLegs ? ` (${r.tieCount} informados)` : ""} · V${q.forceMode === "design" ? "d" : "k"}=${number(p.loads.vertical / 1000, 1)} kN · H${q.forceMode === "design" ? "d" : "k"}=${number(p.loads.horizontal / 1000, 1)} kN · a_calc=${cm(reactionGeometry(p).a)} cm`,
    2.3,
  );
  text(
    10,
    32,
    d.issues.some((i) => i.severity === "error")
      ? "PENDÊNCIAS IMPEDITIVAS - CORRIGIR ANTES DA EXECUÇÃO"
      : "PARA CONFERÊNCIA DO RESPONSÁVEL TÉCNICO",
    2.5,
    "ALERTAS",
  );
  line(10, 36, width - 10, 36, "COTAS");
  // Elevation. The column is deliberately shown as a local fragment, with break marks.
  poly([
    { x: x - P, y: y - 4 },
    { x, y: y - 4 },
    { x, y },
    { x: x + L, y },
    ...[...concrete.bottom]
      .reverse()
      .map((v) => ({ x: x + v.x / 10, y: y + v.depth / 10 })),
    { x, y: y + H + 5 },
    { x: x - P, y: y + H + 5 },
  ]);
  line(x - P, y - 4, x - P, y + H + 5);
  for (const yy of [y - 4, y + H + 5])
    poly([
      { x: x - P, y: yy },
      { x: x - P + P * 0.4, y: yy },
      { x: x - P + P * 0.45, y: yy - 1 },
      { x: x - P + P * 0.5, y: yy + 1 },
      { x: x - P + P * 0.55, y: yy },
      { x, y: yy },
    ]);
  rect(
    x + (g.loadOffset - q.bearingLength / 2) / 10,
    y - Math.max(q.bearingHeight / 10, 1),
    q.bearingLength / 10,
    Math.max(q.bearingHeight / 10, 1),
  );
  const slope = (g.height - g.tipHeight) / g.length;
  // Inclination of each inclined stretch of the bottom face, in degrees.
  const bottomAngles = concrete.bottom
    .slice(1)
    .map((v, i) => {
      const a = concrete.bottom[i];
      return (Math.atan((a.depth - v.depth) / (v.x - a.x)) * 180) / Math.PI;
    })
    .filter((angle) => angle > 1e-6);
  const anglesText = (cut ? bottomAngles : [(Math.atan(slope) * 180) / Math.PI])
    .map((angle) => `${number(angle, 1)}°`)
    .join(" / ");
  const beam = d.arrangement === "beam";
  // Every view below is a projection or a cut of the same placed bars.
  const drawShapes = (
    items: ViewItem[],
    ox: number,
    oy: number,
    dashed: (bar: Bar) => boolean = () => false,
  ) => {
    const drawn = new Set<string>();
    for (const { bar, shape } of items) {
      // Coincident projections of bars of one position are drawn once.
      const key = `${bar.mark}|${JSON.stringify(shape)}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      if (shape.kind === "point")
        barCircle(
          ox + shape.center.x / 10,
          oy + shape.center.y / 10,
          bar.diameter,
        );
      else
        barPath(shape.path, bar.diameter, ox, oy, dashed(bar), shape.endCaps);
    }
  };
  const projectedTies = elevationTieBars(p, d);
  for (const { path, bar, endCaps } of projectedTies)
    barPath(path, bar.diameter, x, y, false, endCaps);
  const elevation = projectElevation(d);
  drawShapes(
    elevation.filter(({ bar }) => bar.family !== "tie"),
    x,
    y,
  );
  const pin = elevation.find(({ bar }) => bar.family === "pin");
  const pinTop =
    pin?.shape.kind === "path" ? pin.shape.path.segments[0] : undefined;
  if (pin && pinTop?.type === "line")
    leader(
      x + pinTop.a.x / 10,
      y + pinTop.a.y / 10,
      x + L + 4,
      y - 10,
      `${pin.bar.quantity} ${pin.bar.mark} (pinos)`,
    );
  dim(x - P, y, x, y, -10, `P=${cm(g.columnWidth)}`);
  dim(x, y, x + L, y, -10, `L=${cm(g.length)}`);
  dim(x, y, x + g.loadOffset / 10, y, -19, `a=${cm(g.loadOffset)}`);
  dim(x + L, y, x + L, y + H, 20, `h=${cm(g.height)}`);
  dim(x + L, y, x + L, y + g.tipHeight / 10, 10, `h2=${cm(g.tipHeight)}`);
  const tieBars = d.bars.filter((b) => b.family === "tie");
  const stitchBars = d.bars.filter(
    (b) => b.family === "stitch" || b.family === "lower",
  );
  const verticalBars = d.bars.filter(
    (b) => b.family === "stirrup" || b.family === "stirrupInner",
  );
  const constructiveBars = d.bars.filter((b) => b.family === "constructive");
  const positiveBars = d.bars.filter((b) => b.family === "positive");
  const marks = (bs: Bar[]) =>
    bs.length
      ? bs.length === 1
        ? bs[0].mark
        : `${bs[0].mark} a ${bs.at(-1)!.mark}`
      : "--";
  leader(
    x + L * 0.55,
    y + d.tieRows[0].y / 10,
    x + L + 5,
    y + H + 15,
    `Tirante ${marks(tieBars)}`,
  );
  text(x - P, y + H + 24, "ELEVAÇÃO LATERAL - ARMADURAS", 2.8);
  text(
    x - P,
    y + H + 29,
    `Costura ${marks(stitchBars)} · Estribos ${marks(verticalBars)} · Construtiva ${marks(constructiveBars)}${positiveBars.length ? ` · Positiva ${marks(positiveBars)}` : ""}`,
    2.2,
  );
  if (beam)
    text(
      x - P,
      y + H + 34,
      "ARMADO COMO VIGA: tirante e positiva com dobras nas duas extremidades.",
      2.2,
    );
  // The first scheduled outer stirrup defines the cut, even if its shape is invalid.
  const cutDepth = stirrupLayout(p).positions[0];
  const sectionH = cut
    ? bottomDepth(concrete, cutDepth) / 10
    : H - (slope * cutDepth) / 10;
  // Both transverse cuts draw exactly the bars that meet their plane.
  const drawSection = (
    section: ReturnType<typeof sectionBars>,
    ox: number,
    oy: number,
  ) => {
    for (const bar of section.stirrups) barPath(bar.path, bar.diameter, ox, oy);
    for (const bar of [
      ...section.constructive,
      ...section.ties,
      ...section.positives,
    ])
      barCircle(ox + bar.v / 10, oy + bar.depth / 10, bar.diameter);
    for (const bar of section.stitches)
      for (const v of bar.positions)
        barCircle(ox + v / 10, oy + bar.depth / 10, bar.diameter);
    for (const bar of section.lines)
      line(
        ox + bar.a.x / 10,
        oy + bar.a.y / 10,
        ox + bar.b.x / 10,
        oy + bar.b.y / 10,
        "ARMADURAS",
        false,
        bar.diameter / 10,
      );
  };
  // A–A at the first stirrup: the juxtaposed N3/N3G pair is projected and
  // each N4 is cut in the plane of the stirrup that carries it.
  const sectionRebar = sectionBars(p, d, cutDepth, {
    pairWindow: r.stirrupDiameter,
  });
  const cutHeadroom = Math.max(
    0,
    ...sectionRebar.lines.map((bar) => -bar.a.y / 10),
  );
  text(sectionX, y - cutHeadroom - 8, `CORTE A-A / x=${cm(cutDepth)} cm`, 2.8);
  rect(sectionX, y, B, sectionH);
  const innerSection = sectionRebar.stirrups.find(
    (bar) => bar.family === "stirrupInner",
  );
  if (innerSection)
    text(
      sectionX,
      y - cutHeadroom - 4,
      `N3G projetado de x=${cm(innerSection.x)} cm; N4 no plano de cada ramo`,
      1.8,
    );
  drawSection(sectionRebar, sectionX, y);
  dim(sectionX, y + H, sectionX + B, y + H, 8, `b=${cm(g.width)}`);
  text(
    sectionX,
    y + H + 18,
    `Tirante detalhado: ${detailedTieCount} ramos Ø${number(r.tieDiameter, 1)} / ${detailedTieLayers} camada(s)`,
    2.1,
  );
  d.tieRows
    .filter((row) => row.count)
    .forEach((row, i) =>
      text(
        sectionX,
        y + H + 23 + i * 4,
        `${i + 1}ª: ${row.detailedCount} ramos detalhados${row.detailedCount !== row.count ? ` de ${row.count} informados` : ""}; eixo a ${cm(row.y)} do topo (${tieBars
          .filter((b) => b.locations.some((loc) => loc.layer === i))
          .map((b) => b.mark)
          .join("/")})`,
        2.1,
      ),
    );
  // Plan with actual frontal loops and placement lines for the vertical stirrups.
  const planY = y + H + Math.max(55, q.tieLayers * 5 + 40);
  text(x - P, planY - 10, "PLANTA DAS ARMADURAS / TIRANTES", 2.8);
  rect(x - P, planY, P, B);
  rect(x, planY, L, B);
  rect(
    x + (g.loadOffset - q.bearingLength / 2) / 10,
    planY + (B - q.bearingWidth / 10) / 2,
    q.bearingLength / 10,
    q.bearingWidth / 10,
    "EIXOS",
    true,
  );
  const plan = projectPlan(d);
  const belowTies = (bar: Bar) =>
    bar.family === "stitch" ||
    bar.family === "lower" ||
    bar.family === "positive" ||
    bar.family === "constructive" ||
    bar.family === "stirrup" ||
    bar.family === "stirrupInner";
  // Put the dashed secondary steel behind the solid ties and connections.
  drawShapes(
    plan.filter(({ bar }) => belowTies(bar)),
    x,
    planY,
    belowTies,
  );
  drawShapes(
    plan.filter(({ bar }) => !belowTies(bar)),
    x,
    planY,
  );
  for (const b of tieBars)
    for (const loc of b.locations)
      if ((loc.layer ?? 0) > 0)
        leader(
          x + L * 0.7,
          planY + B / 2,
          x + L + 3,
          planY + B + 12 + (loc.layer ?? 0) * 5,
          `${b.mark} - ${loc.layer! + 1}ª camada`,
        );
  const cutX = x + cutDepth / 10;
  line(cutX, planY - 5, cutX, planY + B + 5, "EIXOS", true);
  text(cutX - 2, planY - 6, "A", 2.7);
  text(cutX - 2, planY + B + 10, "A", 2.7);
  dim(x, planY + B, x + L, planY + B, 8, cm(g.length));
  dim(x + L, planY, x + L, planY + B, 10, cm(g.width));
  text(
    x - P,
    planY + B + 23,
    `Apoio: ${cm(q.bearingLength)} × ${cm(q.bearingWidth)} × ${cm(q.bearingHeight)} cm`,
    2.2,
  );
  const stitchPenetration = (family: "stitch" | "lower") => {
    const bar = stitchBars.find((bar) => bar.family === family);
    const length = bar?.anchorage.find(
      (anchor) => anchor.end === "embutimento",
    )?.length;
    return length == null
      ? ""
      : `${family === "stitch" ? "N2" : "N2I"} ${cm(length)} cm`;
  };
  const stitchLengths = [
    stitchPenetration("stitch"),
    stitchPenetration("lower"),
  ].filter(Boolean);
  text(
    x - P,
    planY + B + 28,
    stitchLengths.length
      ? `Penetração no suporte pelo eixo · ${stitchLengths.join(" · ")} · cobrimento nominal ${cm(g.cover)} cm.`
      : `Cobrimento nominal ${cm(g.cover)} cm.`,
    2.2,
  );
  text(x - P, planY + B + 33, "Armaduras secundárias em tracejado.", 2.2);
  const outerStations = verticalBars
    .filter((bar) => bar.family === "stirrup")
    .flatMap((bar) => bar.locations.map((loc) => loc.x))
    .sort((a, b) => a - b);
  const bearingH = cut
    ? bottomDepth(concrete, g.loadOffset) / 10
    : H - (slope * g.loadOffset) / 10;
  text(
    sectionX,
    planY - (s.pins ? Math.max(10, s.pinProjection / 10 + 5) : 10),
    `CORTE B-B / x=${cm(g.loadOffset)} cm`,
    2.8,
  );
  rect(sectionX, planY, B, bearingH);
  rect(
    sectionX + (B - q.bearingWidth / 10) / 2,
    planY - Math.max(q.bearingHeight / 10, 1),
    q.bearingWidth / 10,
    Math.max(q.bearingHeight / 10, 1),
  );
  // B–B at the load axis: same cut as A–A (loops, beam bars and P1 included,
  // stitches only where they still reach x, pins in their own plane).
  drawSection(sectionBars(p, d, g.loadOffset), sectionX, planY);
  // Pin dimensions refer to the placed pins (planes y = centre of each pin).
  const centers = d.bars
    .filter((bar) => bar.family === "pin")
    .flatMap((bar) => bar.instances.map((pin) => pin.parts[0].at / 10));
  if (centers.length) {
    if (centers.length > 1)
      dim(
        sectionX + centers[0],
        planY + bearingH,
        sectionX + centers.at(-1)!,
        planY + bearingH,
        8,
        `${centers.length - 1}×${cm((centers[1] - centers[0]) * 10)}`,
      );
    dim(
      sectionX,
      planY + bearingH,
      sectionX + centers[0],
      planY + bearingH,
      16,
      `e=${cm(centers[0] * 10)}`,
    );
  }
  dim(
    sectionX + B,
    planY,
    sectionX + B,
    planY + bearingH,
    10,
    cm(bearingH * 10),
  );
  const bx = x + g.loadOffset / 10;
  line(bx, planY - 5, bx, planY + B + 5, "EIXOS", true);
  text(bx - 2, planY - 6, "B", 2.7);
  text(bx - 2, planY + B + 10, "B", 2.7);
  const infoY = planY + Math.max(B, bearingH) + 22;
  text(sectionX, infoY, "DISTRIBUIÇÃO DOS ESTRIBOS", 2.7);
  text(
    sectionX,
    infoY + 6,
    `N3: ${outerCount} externos detalhados · N3G: ${innerCount} internos detalhados.`,
    2.1,
  );
  text(
    sectionX,
    infoY + 11,
    outerStations.length
      ? `N3: primeiro eixo x=${cm(outerStations[0])} cm; último x=${cm(outerStations.at(-1)!)} cm.`
      : "Nenhum eixo N3 detalhado.",
    2.1,
  );
  text(
    sectionX,
    infoY + 18,
    `Costura superior: ${countBars("stitch")} barras nos 2d/3 superiores.`,
    2.1,
  );
  text(
    sectionX,
    infoY + 23,
    `Costura inferior: ${countBars("lower")} barras no trecho restante.`,
    2.1,
  );
  text(
    sectionX,
    infoY + 30,
    cut
      ? `Face inferior recortada (concreto excedente removido): ${anglesText}.`
      : `Face inferior com inclinação ${anglesText}.`,
    2.1,
  );
  // Steel schedule. Every position references the very same bar centre-line model as the sketches.
  const table = (
    tx: number,
    ty: number,
    widths: number[],
    rows: string[][],
    header = true,
  ) => {
    const rowH = 5.3;
    let yy = ty;
    for (const [index, row] of rows.entries()) {
      let xx = tx;
      row.forEach((cell, j) => {
        rect(xx, yy, widths[j], rowH, "COTAS");
        text(xx + 1.5, yy + 3.6, cell, index === 0 && header ? 2.05 : 2.1);
        xx += widths[j];
      });
      yy += rowH;
    }
    return yy;
  };
  text(tableX, 45, "RELAÇÃO DO AÇO - BARRAS FÍSICAS", 2.9);
  const rows = [
    [
      "Pos.",
      "Aço",
      "Ø mm",
      "Q/pç",
      "Q total",
      "C unit cm",
      "C total cm",
      "kg total",
    ],
    ...d.bars.map((b) => [
      b.mark,
      String(b.grade / 10),
      number(b.diameter, 1),
      String(b.quantity),
      String(b.totalQuantity),
      cm(b.cutLength),
      cm(b.totalLength),
      number(b.totalMass, 2),
    ]),
  ];
  let tableBottom = table(tableX, 49, [15, 16, 19, 20, 22, 35, 47, 31], rows);
  tableBottom += 8;
  text(tableX, tableBottom, "RESUMO DO AÇO - QUANTIDADE TOTAL DO TIPO", 2.6);
  tableBottom = table(
    tableX,
    tableBottom + 4,
    [31, 32, 55, 87],
    [
      ["Aço", "Ø mm", "C total (cm)", "Peso total (kg)"],
      ...d.steelSummary.map((v) => [
        grade(v.grade),
        number(v.diameter, 1),
        cm(v.totalLength),
        number(v.totalMass, 2),
      ]),
    ],
  );
  text(
    tableX,
    tableBottom + 6,
    `Aço por peça: ${number(d.mass, 2)} kg · ${p.quantity} peças: ${number(d.totalMass, 2)} kg`,
    2.4,
  );
  // Concrete consumption of the same piece outline used by the bars and by
  // the quantities of the application and of the CSV (pieceVolume).
  text(
    tableX,
    tableBottom + 11,
    `Concreto por peça: ${number(d.concreteVolume, 3)} m³ · ${p.quantity} peças: ${number(d.totalConcreteVolume, 3)} m³ · Taxa de aço: ${number(d.steelRate, 1)} kg/m³`,
    2.4,
  );
  text(
    tableX,
    tableBottom + 16,
    "Massa teórica; sem perdas de corte, emendas ou acréscimo de compra.",
    2.05,
  );
  // Bar drawings laid out freely. All coordinates remain 1:1 in cm; no A-series sheet.
  let bottom = Math.max(infoY + 43, tableBottom + 30);
  text(10, bottom, "FORMAS DE DOBRAMENTO E POSIÇÕES", 3);
  text(
    10,
    bottom + 6,
    "Cotas no eixo da barra (cm); D = diâmetro interno do mandril (cm). C = comprimento de corte desenvolvido, arredondado para cima a 0,1 cm.",
    2.2,
  );
  text(
    10,
    bottom + 11,
    "Ganchos de estribos: 135° voltados para dentro; pontas retas ≥5Ø e ≥5 cm. Nas alças, Q/pç conta alças, cada uma com 2 ramos resistentes.",
    2.2,
  );
  bottom += 20;
  const cards = d.bars.map((b) => {
    const pts = samplePath(b.path),
      xs = pts.map((v) => v.x / 10),
      ys = pts.map((v) => v.y / 10);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const hook = b.instances[0]?.parts.find(
      (part) => part.role === "hook",
    )?.path;
    const [hookLeft, hookRight] = hook ? pathExtent(hook, "x") : [0, 0];
    const [hookTop, hookBottom] = hook ? pathExtent(hook, "y") : [0, 0];
    return {
      b,
      minX,
      minY,
      maxY,
      hook,
      hookLeft,
      hookRight,
      hookTop,
      w: Math.max(maxX - minX + 32, 140),
      h: Math.max(
        maxY -
          minY +
          43 +
          (b.hookTail ? Math.max(24, (hookBottom - hookTop) / 10 + 9) : 0),
        72,
      ),
    };
  });
  let cardX = 10,
    cardY = bottom,
    rowH = 0;
  for (const card of cards) {
    if (cardX + card.w > width - 10 && cardX > 10) {
      cardY += rowH + 8;
      cardX = 10;
      rowH = 0;
    }
    const { b } = card,
      bx = cardX + 12 - card.minX,
      by = cardY + 21 - card.minY;
    text(cardX, cardY, barLabel(b), 2.5);
    text(
      cardX,
      cardY + 5,
      `${b.description} · ${grade(b.grade)}${b.mandrel ? ` · D=${cm(b.mandrel)}` : ""}`,
      2.15,
    );
    barPath(b.path, b.diameter, bx, by);
    const pts = samplePath(b.path),
      maxX = Math.max(...pts.map((v) => v.x)),
      maxY = Math.max(...pts.map((v) => v.y));
    if (b.width > 0)
      dim(
        bx + card.minX,
        by + card.minY,
        bx + maxX / 10,
        by + card.minY,
        -5,
        cm(maxX - card.minX * 10),
      );
    if (maxY / 10 - card.minY > 2)
      dim(
        bx + maxX / 10,
        by + card.minY,
        bx + maxX / 10,
        by + maxY / 10,
        6,
        cm(maxY - card.minY * 10),
      );
    if (beam && (b.family === "tie" || b.family === "positive"))
      text(
        cardX,
        cardY + card.h - 5,
        `Trechos retos: ${b.path.segments
          .filter((v) => v.type === "line")
          .map((v) => cm(Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y)))
          .join(" / ")} cm; dobras nas duas extremidades.`,
        2.05,
      );
    else if (b.family === "tie" && b.width > 0) {
      const hookY = cardY + 33 + card.maxY - card.minY;
      text(
        cardX,
        card.hook ? hookY - 3 : cardY + card.h - 16,
        `Projeção total=${cm(b.height)}; largura entre eixos=${cm(b.width)} cm`,
        2.05,
      );
      if (card.hook) {
        const hx = cardX + 8;
        barPath(
          card.hook,
          b.diameter,
          hx - card.hookLeft / 10,
          hookY - card.hookTop / 10,
        );
        const labelX = hx + (card.hookRight - card.hookLeft) / 10 + 7;
        text(
          labelX,
          hookY + 4,
          `Gancho 90° em cada extremidade do suporte: ponta=${cm(b.hookTail)} cm`,
          2.05,
        );
        text(
          labelX,
          hookY + 9,
          `Projeção no suporte ${cm(b.anchorage.find((anchor) => anchor.end === "suporte")?.projection ?? 0)} cm · D=${cm(mandrelDiameter(b.diameter, p.materials.fyk))} cm.`,
          2.05,
        );
        text(
          labelX,
          hookY + 14,
          "Vista lateral do gancho fora do plano da alça.",
          2.05,
        );
      }
    } else if (b.family === "tie") {
      text(
        cardX,
        cardY + card.h - 16,
        `Projeção longitudinal = ${cm(b.height)} cm`,
        2.05,
      );
      if (b.hookTail)
        text(
          cardX,
          cardY + card.h - 5,
          `Gancho de 90° no suporte · ponta reta = ${cm(b.hookTail)} cm`,
          2.05,
        );
    }
    text(cardX, cardY + card.h - 10, b.note.slice(0, 115), 2.05);
    if (b.family === "stirrup" || b.family === "stirrupInner")
      text(
        cardX,
        cardY + card.h - 5,
        `Eixo x=${b.locations.map((v) => cm(v.x)).join(" / ")} cm a partir da face do suporte.`,
        2.05,
      );
    if (b.family === "constructive")
      text(
        cardX,
        cardY + card.h - 5,
        `Trechos retos: ${b.path.segments
          .filter((v) => v.type === "line")
          .map((v) => cm(Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y)))
          .join(" / ")} cm; ${cut ? "dobras" : "dobra"} ${anglesText}.`,
        2.05,
      );
    if (b.family === "stitch" || b.family === "lower")
      text(
        cardX,
        cardY + card.h - 5,
        `Eixo z=${b.locations.map((v) => cm(v.z)).join(" / ")} cm abaixo do topo.`,
        2.05,
      );
    cardX += card.w + 12;
    rowH = Math.max(rowH, card.h);
  }
  bottom = cardY + rowH + 15;
  text(10, bottom, "NOTAS DE DETALHAMENTO E CONFERÊNCIA", 2.8);
  const safety = materialSafety(q);
  const notes = [
    `N3: ${outerCount} estribo(s) externo(s); N3G: ${innerCount} estribo(s) interno(s). N4: ${constructiveCount} barras construtivas Ø${number(r.constructiveDiameter ?? 8, 1)} mm, sem contribuição resistente. N5 fendilhamento e N6 suspensão exigem detalhamento próprio.`,
    `Responsável técnico: ${project.author || "não informado"}. Cliente: ${project.client || "não informado"}. Revisão ${s.revision || "R00"}.`,
    "Desenhos soltos: geometria e formas em centímetros; diâmetros das barras em milímetros. CAD em escala real 1:1; PDF em escala nominal 1:10 ao imprimir a 100%.",
    "Mandris e ganchos: NBR 6118:2026, 9.4.2.3, tabelas 9.1 e 9.2 e 9.4.6.1. Estribos representados pela projeção nominal com fechamento de ganchos fora do plano.",
    "Comprimentos C somam trechos retos e arcos no eixo; não se obtêm por soma de cotas externas. O excedente de arredondamento fica na ponta reta. Densidade do aço: 7 850 kg/m³.",
    "Não cortar ou dobrar barras a partir da escala da tela. Conferir as cotas, o ajuste das armaduras no suporte e as tolerâncias do fabricante.",
    ...(q.gammaNPolicy === "table9062"
      ? [
          `CONFERIR: ${gammaNDecisionText(d.result.gammaNDecision ?? gammaNDecision(q))} ${gammaNReference}.`,
        ]
      : []),
    ...(beam
      ? [
          "Armado como viga: dobras do tirante dimensionadas com lb e razão As,req/As,ef do cálculo, sem desconto por barra soldada, contadas da face do suporte e da borda interna da placa de apoio; dobras da positiva para lb,nec da própria bitola. Dobras dentro do contorno com o cobrimento informado.",
        ]
      : []),
    ...(safety.gammaC !== 1.4 || safety.gammaS !== 1.15
      ? [
          `Materiais: γc = ${coefficientText(safety.gammaC)}; γs = ${coefficientText(safety.gammaS)}. Referência para ${safety.reference.label}: γc = ${coefficientText(safety.reference.gammaC)}; γs = ${coefficientText(safety.reference.gammaS)}. Decisão do responsável técnico; o programa não certifica o enquadramento do elemento. NBR 9062:2017 §8.1; NBR 6118:2026.`,
        ]
      : []),
    ...safety.below.map(
      (value) =>
        `CONFERIR: ${value.symbol} adotado ${coefficientText(value.adopted)}, abaixo da referência ${coefficientText(value.reference)}.`,
    ),
    ...d.issues.map(
      (v) =>
        `${v.severity === "error" ? "CORRIGIR" : "CONFERIR"}: ${v.message}`,
    ),
    ...(s.notes ? [s.notes] : []),
  ];
  for (const value of notes)
    for (const row of wrap(value, Math.floor((width - 20) / 1.25))) {
      bottom += 4.5;
      text(
        10,
        bottom,
        row,
        2.1,
        value.startsWith("CORRIGIR") ? "ALERTAS" : "TEXTOS",
      );
    }
  return { width, height: bottom + 12, entities, name: p.name, detail: d };
}

export function combineDrawings(drawings: Drawing[]): Drawing {
  let y = 0;
  const entities: Entity[] = [];
  for (const drawing of drawings) {
    for (const e of drawing.entities) {
      if (e.type === "line")
        entities.push({
          ...e,
          a: { ...e.a, y: e.a.y + y },
          b: { ...e.b, y: e.b.y + y },
        });
      else if (e.type === "text")
        entities.push({ ...e, at: { ...e.at, y: e.at.y + y } });
      else entities.push({ ...e, center: { ...e.center, y: e.center.y + y } });
    }
    y += drawing.height + 30;
  }
  return {
    width: Math.max(...drawings.map((v) => v.width), 1),
    height: Math.max(1, y - 30),
    entities,
    name: "Todos os consolos",
  };
}
export function steelSummaryDrawing(
  project: Project,
  details: Detail[],
): Drawing {
  const entities: Entity[] = [];
  const text = (x: number, y: number, value: string, size = 2.7) =>
    entities.push({
      type: "text",
      at: { x, y },
      text: value,
      size,
      layer: "TEXTOS",
    });
  const summary = new Map<
    string,
    { grade: number; diameter: number; length: number; mass: number }
  >();
  for (const d of details)
    for (const v of d.steelSummary) {
      const key = `${v.grade}/${v.diameter}`,
        old = summary.get(key) ?? {
          grade: v.grade,
          diameter: v.diameter,
          length: 0,
          mass: 0,
        };
      old.length += v.totalLength;
      old.mass += v.totalMass;
      summary.set(key, old);
    }
  text(10, 10, "RESUMO GERAL DO AÇO - TODOS OS CONSOLOS", 3.5);
  text(10, 17, project.name, 2.8);
  text(175, 24, "ConsoloStruct · OPENSTRUCT", 2.3);
  text(
    10,
    24,
    `${details.length} tipos · ${details.reduce((n, d) => n + d.piece.quantity, 0)} peças · C em cm / Ø em mm`,
  );
  const rows = [
    ["AÇO", "Ø mm", "COMPRIMENTO (cm)", "MASSA TEÓRICA (kg)"],
    ...[...summary.values()]
      .sort((a, b) => a.grade - b.grade || a.diameter - b.diameter)
      .map((v) => [
        grade(v.grade),
        number(v.diameter, 1),
        cm(v.length),
        number(v.mass, 2),
      ]),
  ];
  const totalMass = details.reduce((n, d) => n + d.totalMass, 0);
  const totalVolume = details.reduce((n, d) => n + d.totalConcreteVolume, 0);
  const steelRate = totalVolume > 0 ? totalMass / totalVolume : 0;
  rows.push(["TOTAL", "", "", number(totalMass, 2)]);
  let y = 32;
  for (const row of rows) {
    const xs = [10, 50, 85, 165, 250];
    entities.push({
      type: "line",
      a: { x: 10, y },
      b: { x: 250, y },
      layer: "COTAS",
    });
    row.forEach((v, i) => {
      text(xs[i] + 2, y + 5.5, v, 2.4);
      entities.push({
        type: "line",
        a: { x: xs[i], y },
        b: { x: xs[i], y: y + 8 },
        layer: "COTAS",
      });
    });
    entities.push({
      type: "line",
      a: { x: 250, y },
      b: { x: 250, y: y + 8 },
      layer: "COTAS",
    });
    y += 8;
  }
  entities.push({
    type: "line",
    a: { x: 10, y },
    b: { x: 250, y },
    layer: "COTAS",
  });
  text(
    10,
    y + 8,
    `Concreto total: ${number(totalVolume, 3)} m³ · Taxa de aço do projeto: ${number(steelRate, 1)} kg/m³`,
    2.3,
  );
  text(
    10,
    y + 14,
    "Quantidades do projeto já multiplicadas. Sem perdas, emendas ou reserva de compra.",
    2.3,
  );
  text(
    10,
    y + 20,
    "Identificar cada barra pela peça e pela posição (ex.: C01/N1). Conferir as pendências de cada tipo.",
    2.3,
  );
  return { width: 270, height: y + 31, entities, name: "Resumo geral do aço" };
}
