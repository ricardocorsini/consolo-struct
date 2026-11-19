import type { Project } from "../domain/model";
import { number } from "../domain/model";
import { dimensionLabel, elevationDimensions } from "../domain/dimensions";
import { at, type BarPath, type Point, type Segment } from "./geometry";
import type { ViewShape } from "./rebarPlacement";
import {
  AnnotationLayout,
  drawingBounds,
  textPitch,
  textWidth,
  translateEntity,
  wrapText,
} from "./layout";
import { type Bar, type Detail } from "./model";
import { reactionGeometry, stirrupLayout } from "../domain/theory";
import { elevationTieBars, sectionBars } from "./projection";
import { projectElevation, projectPlan, type ViewItem } from "./rebarModel";
import { countText, declaredCounts, placedCounts } from "./consistency";
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
  | (Segment & {
      layer: Layer;
      dash?: boolean;
      thickness?: number;
      schematic?: string;
      annotation?: "dimension" | "extension" | "leader";
    })
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
export const maxPdfPageSide = 4500;
export const cm = (mm: number, digits = 1) => number(mm / 10, digits);
export const grade = steelLabel;
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
  let entities: Entity[] = [];
  // Every count printed on the sheet is the detailed one (#64).
  const declared = declaredCounts(d),
    placed = placedCounts(d);
  const qty = (family: keyof typeof placed) =>
    countText(placed[family], declared[family]);
  const n3Branches = placed.stirrupInner ? 4 : 2;
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
    {
      dash = false,
      endCaps = [],
      scale = 1,
      schematic,
    }: {
      dash?: boolean;
      endCaps?: Point[];
      scale?: number;
      schematic?: string;
    } = {},
  ) => {
    const move = (point: Point) => ({
      x: x + (point.x * scale) / 10,
      y: y + (point.y * scale) / 10,
    });
    const width = (diameter * scale) / 10;
    const style = {
      layer: "ARMADURAS" as const,
      thickness: schematic ? Math.min(0.55, Math.max(0.22, width)) : width,
      ...(schematic ? { schematic } : {}),
      ...(dash ? { dash } : {}),
    };
    for (const seg of path.segments)
      entities.push(
        seg.type === "line"
          ? { ...seg, a: move(seg.a), b: move(seg.b), ...style }
          : {
              ...seg,
              center: move(seg.center),
              radius: (seg.radius * scale) / 10,
              ...style,
            },
      );
    for (const cap of endCaps) {
      const center = move(cap);
      barCircle(center.x, center.y, diameter * scale, true);
    }
  };
  type Row = [value: string, size?: number, layer?: Layer];
  const textRows = (x: number, top: number, rows: Row[]) => {
    for (const [value, size = 2.1, layer = "TEXTOS"] of rows) {
      text(x, top + size * 1.12 + 0.25, value, size, layer);
      top += textPitch(size) + 0.7;
    }
    return top;
  };
  const viewBlock = (
    layout: AnnotationLayout,
    captionX: number,
    above: Row[],
    below: Row[] = [],
  ) => {
    layout.finish();
    const geometry = drawingBounds(entities);
    const captionHeight = above.reduce(
      (h, [, size = 2.1]) => h + textPitch(size) + 0.7,
      0,
    );
    textRows(captionX, geometry.top - captionHeight - 3, above);
    textRows(captionX, geometry.bottom + 3, below);
    const block = { entities, bounds: drawingBounds(entities) };
    entities = [];
    return block;
  };
  const shapeAnchor = (shape: ViewShape): Point | undefined => {
    if (shape.kind === "point") return shape.center;
    const segment =
      shape.path.segments.find((part) => part.type === "line") ??
      shape.path.segments[0];
    if (!segment) return;
    if (segment.type === "arc")
      return at(
        segment.center,
        segment.radius,
        segment.start + segment.sweep / 2,
      );
    return {
      x: (segment.a.x + segment.b.x) / 2,
      y: (segment.a.y + segment.b.y) / 2,
    };
  };
  const P = g.columnWidth / 10,
    L = g.length / 10,
    H = g.height / 10,
    B = g.width / 10;
  const bearingHeight = Math.max(q.bearingHeight / 10, 1);
  // Each view starts in local sheet coordinates. Placement only translates it.
  const x = P,
    y = 0,
    sectionX = 0,
    planY = 0;
  const schematicWidth = 150;
  const steelHeader = [
    "Pos.",
    "Aço",
    "Ø mm",
    "Q/pç",
    "Q total",
    "C unit cm",
    "C total cm",
    "kg total",
    "Desenho esquemático da armadura",
  ];
  const schedules: TableCell[][][] = [[steelHeader]];
  // Reserve space below each schedule for totals and detailing notes.
  const scheduleLimit = maxPdfPageSide - 300;
  const headerHeight = tableRowHeight(steelHeader);
  let scheduleHeight = headerHeight;
  for (const bar of d.bars) {
    const row = [
      bar.mark,
      String(bar.grade / 10),
      number(bar.diameter, 1),
      String(bar.quantity),
      String(bar.totalQuantity),
      cm(bar.cutLength),
      cm(bar.totalLength),
      number(bar.totalMass, 2),
      schematicCell(bar),
    ];
    const height = tableRowHeight(row);
    if (scheduleHeight + height > scheduleLimit) {
      schedules.push([steelHeader]);
      scheduleHeight = headerHeight;
    }
    schedules.at(-1)!.push(row);
    scheduleHeight += height;
  }
  const detailedTieLayers = d.tieRows.filter(
    (row) => row.detailedCount > 0,
  ).length;
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
    y - bearingHeight,
    q.bearingLength / 10,
    bearingHeight,
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
        barPath(shape.path, bar.diameter, ox, oy, {
          dash: dashed(bar),
          endCaps: shape.endCaps,
        });
    }
  };
  const projectedTies = elevationTieBars(p, d);
  for (const { path, bar, endCaps } of projectedTies)
    barPath(path, bar.diameter, x, y, { endCaps });
  const elevation = projectElevation(d);
  drawShapes(
    elevation.filter(({ bar }) => bar.family !== "tie"),
    x,
    y,
  );
  const elevationLayout = new AnnotationLayout(entities);
  for (const { from, to, placement, id, value } of elevationDimensions(g))
    elevationLayout.dimension(
      { x: x + from.x / 10, y: y + from.depth / 10 },
      { x: x + to.x / 10, y: y + to.depth / 10 },
      dimensionLabel(id, value),
      placement === "inner" || placement === "outer" ? "right" : placement,
    );
  const pin = elevation.find(({ bar }) => bar.family === "pin");
  const pinTop =
    pin?.shape.kind === "path" ? pin.shape.path.segments[0] : undefined;
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
  if (pin && pinTop?.type === "line") {
    const top = pinTop.a.y < pinTop.b.y ? pinTop.a : pinTop.b;
    elevationLayout.leader(
      { x: x + top.x / 10, y: y + top.y / 10 },
      `${pin.bar.quantity} ${pin.bar.mark} (pinos)`,
    );
  }
  const projected = projectedTies[0];
  const tieAnchor =
    projected && shapeAnchor({ kind: "path", path: projected.path });
  if (tieAnchor)
    elevationLayout.leader(
      { x: x + tieAnchor.x / 10, y: y + tieAnchor.y / 10 },
      `Tirante ${marks(tieBars)}`,
    );
  const elevationRows: Row[] = [
    ["ELEVAÇÃO LATERAL - ARMADURAS", 2.8],
    [
      `Costura ${marks(stitchBars)} · N3: ${countText(n3Branches, r.stirrupBranches ?? 2)} ramos/posição (${marks(verticalBars)}) · Construtiva ${marks(constructiveBars)}${positiveBars.length ? ` · Positiva ${marks(positiveBars)}` : ""}`,
      2.2,
    ],
  ];
  if (beam)
    elevationRows.push([
      "ARMADO COMO VIGA: tirante e positiva com dobras nas duas extremidades.",
      2.2,
    ]);
  const elevationBlock = viewBlock(elevationLayout, x - P, [], elevationRows);
  // The first scheduled outer stirrup defines the cut, even if its shape is invalid.
  const cutDepth = stirrupLayout(p).positions[0];
  const sectionDepth = bottomDepth(concrete, cutDepth);
  const sectionH = sectionDepth / 10;
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
  rect(sectionX, y, B, sectionH);
  const innerSection = sectionRebar.stirrups.find(
    (bar) => bar.family === "stirrupInner",
  );
  drawSection(sectionRebar, sectionX, y);
  const sectionLayout = new AnnotationLayout(entities);
  sectionLayout.dimension(
    { x: sectionX, y: y + sectionH },
    { x: sectionX + B, y: y + sectionH },
    dimensionLabel("width", g.width),
    "bottom",
  );
  sectionLayout.dimension(
    { x: sectionX + B, y },
    { x: sectionX + B, y: y + sectionH },
    dimensionLabel("sectionHeight", sectionDepth),
    "right",
  );
  const sectionTitles: Row[] = [[`CORTE A-A / x=${cm(cutDepth)} cm`, 2.8]];
  if (innerSection)
    sectionTitles.push([
      `N3G projetado de x=${cm(innerSection.x)} cm; N4 no plano de cada ramo`,
      1.8,
    ]);
  const sectionBlock = viewBlock(sectionLayout, sectionX, sectionTitles, [
    [
      `Tirante detalhado: ${qty("tie")} ramos Ø${number(r.tieDiameter, 1)} / ${detailedTieLayers} camada(s)`,
    ],
    ...d.tieRows.flatMap((row, i): Row[] =>
      row.count
        ? [
            [
              `${i + 1}ª: ${countText(row.detailedCount, row.count)} ramos detalhados; eixo a ${cm(row.y)} do topo (${tieBars
                .filter((bar) => bar.locations.some((loc) => loc.layer === i))
                .map((bar) => bar.mark)
                .join("/")})`,
            ],
          ]
        : [],
    ),
  ]);
  // Plan with actual frontal loops and placement lines for the vertical stirrups.
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
  const planForm = drawingBounds(entities);
  const axisTop = planForm.top - 3;
  const axisBottom = planForm.bottom + 3;
  const axes = [
    [x + cutDepth / 10, "A"],
    [x + g.loadOffset / 10, "B"],
  ] as const;
  for (const [axis] of axes)
    line(axis, axisTop, axis, axisBottom, "EIXOS", true);
  const planLayout = new AnnotationLayout(entities);
  for (const [axis, label] of axes) {
    planLayout.axisLabel(axis, axisTop, label, "top");
    planLayout.axisLabel(axis, axisBottom, label, "bottom");
  }
  planLayout.dimension(
    { x, y: planY + B },
    { x: x + L, y: planY + B },
    dimensionLabel("length", g.length),
    "bottom",
  );
  planLayout.dimension(
    { x: x + L, y: planY },
    { x: x + L, y: planY + B },
    dimensionLabel("width", g.width),
    "right",
  );
  for (let layer = 1; layer < d.tieRows.length; layer++) {
    const bars = tieBars.filter((bar) =>
      bar.locations.some((loc) => loc.layer === layer),
    );
    const item = plan.find(
      ({ bar, instance, part }) =>
        part.role === "body" &&
        bars.includes(bar) &&
        bar.locations[bar.instances.indexOf(instance)]?.layer === layer,
    );
    const anchor = item && shapeAnchor(item.shape);
    if (!anchor) continue;
    planLayout.leader(
      { x: x + anchor.x / 10, y: planY + anchor.y / 10 },
      `${bars.map((bar) => bar.mark).join(" / ")} - ${layer + 1}ª camada`,
    );
  }
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
  const planBlock = viewBlock(
    planLayout,
    x - P,
    [["PLANTA DAS ARMADURAS / TIRANTES", 2.8]],
    [
      [
        `Apoio: ${cm(q.bearingLength)} × ${cm(q.bearingWidth)} × ${cm(q.bearingHeight)} cm`,
        2.2,
      ],
      [
        stitchLengths.length
          ? `Penetração no suporte pelo eixo · ${stitchLengths.join(" · ")} · cobrimento nominal ${cm(g.cover)} cm.`
          : `Cobrimento nominal ${cm(g.cover)} cm.`,
        2.2,
      ],
      ["Armaduras secundárias em tracejado.", 2.2],
    ],
  );
  const outerStations = verticalBars
    .filter((bar) => bar.family === "stirrup")
    .flatMap((bar) => bar.locations.map((loc) => loc.x))
    .sort((a, b) => a - b);
  const bearingDepth = bottomDepth(concrete, g.loadOffset);
  const bearingH = bearingDepth / 10;
  rect(sectionX, planY, B, bearingH);
  rect(
    sectionX + (B - q.bearingWidth / 10) / 2,
    planY - bearingHeight,
    q.bearingWidth / 10,
    bearingHeight,
  );
  // B–B at the load axis: same cut as A–A (loops, beam bars and P1 included,
  // stitches only where they still reach x, pins in their own plane).
  drawSection(sectionBars(p, d, g.loadOffset), sectionX, planY);
  // Pin dimensions refer to the placed pins (planes y = centre of each pin).
  const centers = d.bars
    .filter((bar) => bar.family === "pin")
    .flatMap((bar) => bar.instances.map((pin) => pin.parts[0].at / 10));
  const bearingLayout = new AnnotationLayout(entities);
  const bearingBase = (u: number) => ({ x: sectionX + u, y: planY + bearingH });
  if (centers.length > 1)
    bearingLayout.dimension(
      bearingBase(centers[0]),
      bearingBase(centers.at(-1)!),
      `s = ${centers.length - 1} × ${cm((centers[1] - centers[0]) * 10)}`,
      "bottom",
    );
  if (centers.length)
    bearingLayout.dimension(
      bearingBase(0),
      bearingBase(centers[0]),
      `e = ${cm(centers[0] * 10)}`,
      "bottom",
    );
  bearingLayout.dimension(
    bearingBase(0),
    bearingBase(B),
    dimensionLabel("width", g.width),
    "bottom",
  );
  bearingLayout.dimension(
    { x: sectionX + B, y: planY },
    bearingBase(B),
    dimensionLabel("bearingSectionHeight", bearingDepth),
    "right",
  );
  const bearingBlock = viewBlock(bearingLayout, sectionX, [
    [`CORTE B-B / x=${cm(g.loadOffset)} cm`, 2.8],
  ]);

  const margin = 10;
  const gap = 9;
  const bodyTop = 44;
  const left =
    margin - Math.min(elevationBlock.bounds.left, planBlock.bounds.left);
  const right =
    left +
    Math.max(elevationBlock.bounds.right, planBlock.bounds.right) +
    gap -
    Math.min(sectionBlock.bounds.left, bearingBlock.bounds.left);
  const topRow =
    bodyTop - Math.min(elevationBlock.bounds.top, sectionBlock.bounds.top);
  const bottomRow =
    topRow +
    Math.max(elevationBlock.bounds.bottom, sectionBlock.bounds.bottom) +
    gap -
    Math.min(planBlock.bounds.top, bearingBlock.bounds.top);
  const place = (block: typeof elevationBlock, dx: number, dy: number) => {
    for (const entity of block.entities)
      entities.push(translateEntity(entity, dx, dy));
  };
  place(elevationBlock, left, topRow);
  place(sectionBlock, right, topRow);
  place(planBlock, left, bottomRow);
  place(bearingBlock, right, bottomRow);
  const infoY =
    bottomRow +
    Math.max(planBlock.bounds.bottom, bearingBlock.bounds.bottom) +
    gap;
  textRows(right + sectionX, infoY, [
    ["DISTRIBUIÇÃO DOS ESTRIBOS", 2.7],
    [
      `N3: ${qty("stirrup")} externos detalhados · N3G: ${qty("stirrupInner")} internos detalhados.`,
    ],
    [
      outerStations.length
        ? `N3: primeiro eixo x=${cm(outerStations[0])} cm; último x=${cm(outerStations.at(-1)!)} cm.`
        : "Nenhum eixo N3 detalhado.",
    ],
    [`Costura superior: ${qty("stitch")} barras nos 2d/3 superiores.`],
    [`Costura inferior: ${qty("lower")} barras no trecho restante.`],
    [
      cut
        ? `Face inferior recortada (concreto excedente removido): ${anglesText}.`
        : `Face inferior com inclinação ${anglesText}.`,
    ],
  ]);
  const tableX = drawingBounds(entities).right + gap;
  type GraphicCell = {
    height: number;
    draw: (x: number, y: number, height: number) => void;
  };
  type TableCell = string | GraphicCell;
  function schematicCell(bar: Bar): GraphicCell {
    const pad = 3;
    const gap = 4;
    const plotWidth = 66;
    const labelSize = 2.05;
    const linePitch = textPitch(labelSize);
    const labelWidth = schematicWidth - plotWidth - gap - 2 * pad - 0.5;
    const hook = bar.instances[0]?.parts.find(
      (part) => part.role === "hook",
    )?.path;
    const shapes = [bar.path, ...(hook ? [hook] : [])].map((path) => {
      const [left, right] = pathExtent(path, "x");
      const [top, bottom] = pathExtent(path, "y");
      return { path, left, top, width: right - left, height: bottom - top };
    });
    const between = (shapes.length - 1) * gap;
    const pathsWidth = shapes.reduce((sum, shape) => sum + shape.width, 0) / 10;
    const pathsHeight = Math.max(...shapes.map((shape) => shape.height)) / 10;
    // Leave room for the stroke on both sides of the fitted centre lines.
    const scale = Math.min(
      1,
      (plotWidth - between - 1) / Math.max(pathsWidth, 1),
      15 / Math.max(pathsHeight, 1),
    );
    const body = shapes[0];
    const dimensions = [body.width, body.height]
      .filter((value) => value > 1e-6)
      .map((value) => cm(value));
    const straights = bar.path.segments
      .flatMap((seg) =>
        seg.type === "line"
          ? [Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y)]
          : [],
      )
      .filter((length) => length > 1e-6);
    const turns = [
      ...new Set(
        bar.path.segments.flatMap((seg) =>
          seg.type === "arc"
            ? [`${number((Math.abs(seg.sweep) * 180) / Math.PI, 1)}°`]
            : [],
        ),
      ),
    ];
    const labels = [
      `${bar.description}${bar.mandrel ? ` · D = ${cm(bar.mandrel)} cm` : ""}`,
    ];
    if (dimensions.length > 1)
      labels.push(`Entre eixos ${dimensions.join(" × ")} cm`);
    if (straights.length)
      labels.push(
        `Retas (cm) ${straights.map((length) => cm(length)).join(" / ")}`,
      );
    if (turns.length) labels.push(`Dobras ${turns.join(" / ")}`);
    if (bar.family === "tie" && bar.hookTail) {
      labels.push(
        "Gancho de 90° no suporte",
        `Ponta reta ${cm(bar.hookTail)} cm`,
      );
      const rearArc = hook?.segments.find((seg) => seg.type === "arc");
      const support = bar.anchorage.find((anchor) => anchor.end === "suporte");
      if (rearArc && support?.projection !== undefined)
        labels.push(
          `Vista lateral · D = ${cm(2 * rearArc.radius - bar.diameter)} cm`,
          `Projeção no suporte ${cm(support.projection)} cm · total ${cm(bar.height)} cm`,
        );
    }
    labels.push(bar.note);
    if (bar.family === "stirrup" || bar.family === "stirrupInner")
      labels.push(
        `Eixos x da face (cm) ${bar.locations.map((v) => cm(v.x)).join(" / ")}`,
      );
    if (bar.family === "stitch" || bar.family === "lower")
      labels.push(
        `Eixos z do topo (cm) ${bar.locations.map((v) => cm(v.z)).join(" / ")}`,
      );
    const lines = labels.flatMap((label) =>
      wrapText(label, labelWidth, labelSize),
    );
    const labelHeight = lines.length * linePitch;
    return {
      height: Math.max(
        14,
        2 * pad + Math.max(pathsHeight * scale + 1, labelHeight),
      ),
      draw: (xx, yy, height) => {
        let axisX = xx + pad + (plotWidth - pathsWidth * scale - between) / 2;
        for (const shape of shapes) {
          barPath(
            shape.path,
            bar.diameter,
            axisX - (shape.left * scale) / 10,
            yy +
              (height - (shape.height * scale) / 10) / 2 -
              (shape.top * scale) / 10,
            { scale, schematic: bar.mark },
          );
          axisX += (shape.width * scale) / 10 + gap;
        }
        const labelY = yy + (height - labelHeight) / 2;
        for (const [i, label] of lines.entries())
          text(
            xx + pad + plotWidth + gap,
            labelY + i * linePitch + labelSize * 1.12 + 0.25,
            label,
            labelSize,
          );
      },
    };
  }

  function tableRowHeight(row: TableCell[]) {
    return Math.max(
      5.3,
      ...row.map((cell) => (typeof cell === "string" ? 0 : cell.height)),
    );
  }
  const table = (
    tx: number,
    ty: number,
    widths: number[],
    rows: TableCell[][],
  ) => {
    let yy = ty;
    for (const [index, row] of rows.entries()) {
      const rowH = tableRowHeight(row);
      let xx = tx;
      row.forEach((cell, j) => {
        rect(xx, yy, widths[j], rowH, "COTAS");
        if (typeof cell === "string")
          text(
            xx + 1.5,
            yy + (rowH - 5.3) / 2 + 3.6,
            cell,
            index === 0 ? 2.05 : 2.1,
          );
        else cell.draw(xx, yy, rowH);
        xx += widths[j];
      });
      yy += rowH;
    }
    return yy;
  };
  const tableGap = 12;
  const steelColumns = [15, 16, 19, 20, 22, 35, 47, 31, schematicWidth];
  for (const rows of schedules)
    for (const row of rows)
      for (const [i, value] of row.entries())
        if (typeof value === "string")
          steelColumns[i] = Math.max(
            steelColumns[i],
            textWidth(value, 2.1) + 3,
          );
  const tableW = steelColumns.reduce((sum, column) => sum + column, 0);
  const tableTop = bodyTop + 5;
  let tableBottom = tableTop;
  for (const [index, rows] of schedules.entries()) {
    const xx = tableX + index * (tableW + tableGap);
    text(xx, bodyTop + 1, "RELAÇÃO DO AÇO - BARRAS FÍSICAS", 2.9);
    tableBottom = Math.max(
      tableBottom,
      table(xx, tableTop, steelColumns, rows),
    );
  }
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

  const bodyBounds = drawingBounds(entities);
  const heading = `${p.name}  |  DETALHAMENTO DO CONSOLO`;
  const subtitle = `${project.name} · ${p.description}`;
  const revision = `${s.revision || "R00"}  ·  ${p.quantity} PEÇA(S)`;
  const materialLine = `fck ${number(p.materials.fck, 0)} MPa · Tirante ${grade(p.materials.fyk)} · Transversal ${grade(p.materials.fykTransverse)} · Cobrimento ${cm(g.cover)} cm · Cotas em cm / bitolas em mm`;
  const tieLine = `Tirante: ${placed.tie} ramos detalhados em ${detailedTieLayers} camada(s)${detailedTieLayers === 2 ? " · TIRANTE DUPLO" : ""}${placed.tie !== declared.tie ? ` (${countText(placed.tie, declared.tie)})` : ""} · V${q.forceMode === "design" ? "d" : "k"}=${number(p.loads.vertical / 1000, 1)} kN · H${q.forceMode === "design" ? "d" : "k"}=${number(p.loads.horizontal / 1000, 1)} kN · a_calc=${cm(reactionGeometry(p).a)} cm`;

  const leftHeader = Math.max(
    textWidth(heading, 3.5),
    textWidth(subtitle, 2.5),
    textWidth(materialLine, 2.3),
    textWidth(tieLine, 2.3),
  );
  const rightHeader = Math.max(
    textWidth(revision, 2.8),
    textWidth("ConsoloStruct · OPENSTRUCT", 2.3),
  );
  const width = Math.max(
    540,
    bodyBounds.right + margin,
    leftHeader + rightHeader + 3 * margin,
  );
  const body = entities;
  entities = [];
  text(margin, 8, heading, 3.5);
  text(width - margin, 8, revision, 2.8, "TEXTOS", "end");
  text(margin, 14, subtitle, 2.5);
  text(width - margin, 14, "ConsoloStruct · OPENSTRUCT", 2.3, "TEXTOS", "end");
  text(margin, 20, materialLine, 2.3);
  text(margin, 26, tieLine, 2.3);
  text(
    10,
    32,
    d.issues.some((i) => i.severity === "error")
      ? "PENDÊNCIAS IMPEDITIVAS - CORRIGIR ANTES DA EXECUÇÃO"
      : "PARA CONFERÊNCIA DO RESPONSÁVEL TÉCNICO",
    2.5,
    "ALERTAS",
  );
  line(margin, 36, width - margin, 36, "COTAS");
  for (const entity of body) entities.push(entity);
  let bottom = textRows(margin, bodyBounds.bottom + gap, [
    ["NOTAS DE DETALHAMENTO E CONFERÊNCIA", 2.8],
  ]);
  const safety = materialSafety(q);
  const notes = [
    `N3: ${qty("stirrup")} estribo(s) externo(s); N3G: ${qty("stirrupInner")} estribo(s) interno(s). N4: ${qty("constructive")} barras construtivas Ø${number(r.constructiveDiameter ?? 8, 1)} mm, sem contribuição resistente. N5 fendilhamento e N6 suspensão exigem detalhamento próprio.`,
    `Responsável técnico: ${project.author || "não informado"}. Cliente: ${project.client || "não informado"}. Revisão ${s.revision || "R00"}.`,
    "Vistas em centímetros e bitolas em milímetros. Escala das vistas 1:1 no CAD e 1:10 no PDF impresso a 100%.",
    "Na Relação do Aço, as formas são proporcionais. Cotas no eixo e diâmetro interno D em cm. C é o comprimento de corte arredondado para cima a 0,1 cm.",
    "Ganchos dos estribos a 135° para dentro, com pontas retas ≥5Ø e ≥5 cm. Q/pç conta alças quando indicadas. Cada alça fornece dois ramos resistentes.",
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
  for (const value of notes) {
    const layer = value.startsWith("CORRIGIR") ? "ALERTAS" : "TEXTOS";
    const rows = wrapText(value, width - 2 * margin, 2.1).map(
      (row): Row => [row, 2.1, layer],
    );
    bottom = textRows(margin, bottom, rows);
  }
  return { width, height: bottom + 12, entities, name: p.name, detail: d };
}

export function combineDrawings(drawings: Drawing[]): Drawing {
  let y = 0;
  const entities: Entity[] = [];
  for (const drawing of drawings) {
    for (const entity of drawing.entities)
      entities.push(translateEntity(entity, 0, y));
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
  return {
    width: Math.max(270, drawingBounds(entities).right + 10),
    height: y + 31,
    entities,
    name: "Resumo geral do aço",
  };
}
