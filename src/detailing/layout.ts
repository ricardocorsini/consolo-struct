import type { Drawing, Entity } from "./drawing";
import type { Point } from "./geometry";
import { pathExtent } from "./rebarPlacement";

type Label = Extract<Entity, { type: "text" }>;
type Line = Extract<Entity, { type: "line" }>;
type Side = "top" | "bottom" | "right";
type Box = { left: number; top: number; right: number; bottom: number };
type Occupant = { entity: Entity; box: Box };

const eps = 1e-6;
const clearance = 0.25;
const ascent = 1.06;
const descent = 0.32;

// Helvetica advances from the standard PDF font metrics, in thousandths of an em.
const ascii = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
const symbols: Record<string, number> = {
  Ø: 778,
  ø: 611,
  "°": 400,
  º: 365,
  ª: 370,
  "×": 584,
  "·": 278,
  "–": 556,
  "—": 1000,
  "§": 556,
  "³": 333,
  "²": 333,
  "’": 222,
};

export const pdfText = (value: string) =>
  value
    .replace(/[–—−]/g, "-")
    .replace(/≥/g, ">=")
    .replace(/γ/g, "gamma")
    .replace(/φ/g, "phi")
    .replace(/·/g, " - ");

function advance(value: string) {
  let width = 0;
  for (const char of value.normalize("NFD").replace(/\p{M}/gu, ""))
    width += ascii[char.charCodeAt(0) - 32] ?? symbols[char] ?? 1100;
  return width;
}

export function textWidth(value: string, size: number) {
  const pdf = pdfText(value);
  const width = advance(value);
  return (
    (Math.max(width, pdf === value ? width : advance(pdf)) * size * 1.1) / 1000
  );
}

export const textPitch = (size: number) => size * 1.5 + 0.5;

export function wrapText(value: string, width: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const char of word) {
        if (line && textWidth(line + char, size) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export const drawingWidth = (entity: Entity) =>
  (entity.type === "line" || entity.type === "arc"
    ? entity.thickness
    : undefined) ?? (entity.layer === "FORMAS" ? 0.25 : 0.13);

function expand(box: Box, amount: number): Box {
  return {
    left: box.left - amount,
    top: box.top - amount,
    right: box.right + amount,
    bottom: box.bottom + amount,
  };
}

export function entityBounds(entity: Entity): Box {
  if (entity.type === "text") {
    const width = textWidth(entity.text, entity.size);
    const left =
      entity.align === "middle"
        ? -width / 2
        : entity.align === "end"
          ? -width
          : 0;
    const { x, y } = entity.at;
    const top = -entity.size * ascent;
    const bottom = entity.size * descent;
    return expand(
      entity.rotate === -90
        ? {
            left: x + top,
            right: x + bottom,
            top: y - left - width,
            bottom: y - left,
          }
        : {
            left: x + left,
            right: x + left + width,
            top: y + top,
            bottom: y + bottom,
          },
      clearance,
    );
  }
  if (entity.type === "circle") {
    const {
      center: { x, y },
      radius,
    } = entity;
    const half =
      radius + (entity.layer === "ARMADURAS" ? 0 : drawingWidth(entity) / 2);
    return { left: x - half, right: x + half, top: y - half, bottom: y + half };
  }
  if (entity.type === "line")
    return expand(
      {
        left: Math.min(entity.a.x, entity.b.x),
        right: Math.max(entity.a.x, entity.b.x),
        top: Math.min(entity.a.y, entity.b.y),
        bottom: Math.max(entity.a.y, entity.b.y),
      },
      drawingWidth(entity) / 2,
    );

  const path = { segments: [entity], length: 0, valid: true };
  const [left, right] = pathExtent(path, "x");
  const [top, bottom] = pathExtent(path, "y");
  return expand({ left, top, right, bottom }, drawingWidth(entity) / 2);
}

export function drawingBounds(entities: Entity[]): Box {
  const bounds = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  for (const entity of entities) {
    const { left, top, right, bottom } = entityBounds(entity);
    bounds.left = Math.min(bounds.left, left);
    bounds.top = Math.min(bounds.top, top);
    bounds.right = Math.max(bounds.right, right);
    bounds.bottom = Math.max(bounds.bottom, bottom);
  }
  return bounds;
}

export function translateEntity(
  entity: Entity,
  dx: number,
  dy: number,
): Entity {
  const move = ({ x, y }: Point) => ({ x: x + dx, y: y + dy });
  if (entity.type === "line")
    return { ...entity, a: move(entity.a), b: move(entity.b) };
  if (entity.type === "text") return { ...entity, at: move(entity.at) };
  return { ...entity, center: move(entity.center) };
}

function intersects(a: Box, b: Box) {
  return (
    a.left < b.right - eps &&
    b.left < a.right - eps &&
    a.top < b.bottom - eps &&
    b.top < a.bottom - eps
  );
}

/** Parameter interval of a segment inside a box. */
function interval({ a, b }: Line, box: Box): [number, number] | null {
  let start = 0;
  let end = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, box.left, box.right],
    [a.y, b.y - a.y, box.top, box.bottom],
  ]) {
    if (Math.abs(delta) < eps) {
      if (origin < min || origin > max) return null;
      continue;
    }
    const enter = (min - origin) / delta;
    const leave = (max - origin) / delta;
    start = Math.max(start, Math.min(enter, leave));
    end = Math.min(end, Math.max(enter, leave));
    if (end < start) return null;
  }
  return [start, end];
}

function meetsLabel(label: Box, { entity, box }: Occupant) {
  if (!intersects(label, box)) return false;
  if (entity.type === "line")
    return interval(entity, expand(label, drawingWidth(entity) / 2)) !== null;
  if (entity.type === "circle") {
    const dx = Math.max(
      label.left - entity.center.x,
      0,
      entity.center.x - label.right,
    );
    const dy = Math.max(
      label.top - entity.center.y,
      0,
      entity.center.y - label.bottom,
    );
    return Math.hypot(dx, dy) < (box.right - box.left) / 2;
  }
  return true;
}

function parallelDimensions(a: Occupant, b: Occupant) {
  if (
    a.entity.type !== "line" ||
    b.entity.type !== "line" ||
    a.entity.annotation !== "dimension" ||
    b.entity.annotation !== "dimension"
  )
    return false;
  const horizontal = Math.abs(a.entity.a.y - a.entity.b.y) < eps;
  if (horizontal !== Math.abs(b.entity.a.y - b.entity.b.y) < eps) return false;
  // The common endpoint between consecutive dimensions is intentional.
  const axis = horizontal ? "x" : "y";
  const aa = [a.entity.a[axis], a.entity.b[axis]];
  const bb = [b.entity.a[axis], b.entity.b[axis]];
  return (
    Math.max(Math.min(...aa), Math.min(...bb)) <
      Math.min(Math.max(...aa), Math.max(...bb)) - eps &&
    intersects(a.box, b.box)
  );
}

function leaderTouchesDimension(leader: Occupant, dimension: Occupant) {
  return (
    leader.entity.type === "line" &&
    leader.entity.annotation === "leader" &&
    dimension.entity.type === "line" &&
    dimension.entity.annotation === "dimension" &&
    intersects(leader.box, dimension.box) &&
    interval(
      leader.entity,
      expand(dimension.box, drawingWidth(leader.entity) / 2),
    ) !== null
  );
}

function collides(a: Occupant, b: Occupant) {
  if (a.entity.type === "text") return meetsLabel(a.box, b);
  if (b.entity.type === "text") return meetsLabel(b.box, a);
  return (
    parallelDimensions(a, b) ||
    leaderTouchesDimension(a, b) ||
    leaderTouchesDimension(b, a)
  );
}

const occupied = (entity: Entity): Occupant => ({
  entity,
  box: entityBounds(entity),
});

export function detectDrawingCollisions(drawing: Drawing) {
  const sorted = drawing.entities
    .filter((e) => e.type !== "text" || e.text.trim())
    .map(occupied)
    .sort((a, b) => a.box.left - b.box.left);
  const hits: { first: Entity; second: Entity }[] = [];
  for (const [i, a] of sorted.entries())
    for (
      let j = i + 1;
      j < sorted.length && sorted[j].box.left < a.box.right;
      j++
    ) {
      const b = sorted[j];
      if (collides(a, b)) hits.push({ first: a.entity, second: b.entity });
    }
  return hits;
}

const stroke = (a: Point, b: Point, annotation?: Line["annotation"]): Line => ({
  type: "line",
  a,
  b,
  layer: "COTAS",
  ...(annotation ? { annotation } : {}),
});

function splitExtension(line: Line, labels: Box[]) {
  const blocked = labels
    .map((box) =>
      interval(line, expand(box, clearance + drawingWidth(line) / 2)),
    )
    .filter((range) => range !== null)
    .sort((a, b) => a[0] - b[0]);
  if (!blocked.length) return [line];
  const at = (t: number) => ({
    x: line.a.x + (line.b.x - line.a.x) * t,
    y: line.a.y + (line.b.y - line.a.y) * t,
  });
  const segments: Line[] = [];
  let from = 0;
  for (const [start, end] of blocked) {
    if (start - from > eps)
      segments.push({ ...line, a: at(from), b: at(start) });
    from = Math.max(from, end);
  }
  if (1 - from > eps) segments.push({ ...line, a: at(from) });
  return segments;
}

/** Annotate one view in its own coordinates before placing the view on the sheet. */
export class AnnotationLayout {
  private readonly obstacles: Occupant[];
  private readonly frame: Box;
  private readonly extensions: Line[] = [];

  constructor(private readonly view: Entity[]) {
    this.obstacles = view.map(occupied);
    this.frame = drawingBounds(view);
  }

  private fits(entities: Entity[]) {
    const candidates = entities.map(occupied);
    return candidates.every(
      (candidate, i) =>
        this.obstacles.every((blocker) => !collides(candidate, blocker)) &&
        candidates
          .slice(0, i)
          .every((blocker) => !collides(candidate, blocker)),
    );
  }

  private add(entities: Entity[]) {
    this.view.push(...entities);
    this.obstacles.push(...entities.map(occupied));
  }

  axisLabel(x: number, end: number, value: string, side: "top" | "bottom") {
    const size = 2.7;
    const step = side === "top" ? -textPitch(size) : textPitch(size);
    for (let y = end + (side === "top" ? -1.5 : 3.8); ; y += step) {
      const label: Label = {
        type: "text",
        at: { x, y },
        align: "middle",
        size,
        layer: "TEXTOS",
        text: value,
      };
      if (this.fits([label])) {
        this.add([label]);
        return;
      }
    }
  }

  dimension(a: Point, b: Point, value: string, side: Side) {
    const vertical = side === "right";
    const along = vertical ? "y" : "x";
    const across = vertical ? "x" : "y";
    const away = side === "top" ? -1 : 1;
    const start = Math.min(a[along], b[along]);
    const end = Math.max(a[along], b[along]);
    const span = end - start;
    const size = 2.2;
    const width = textWidth(value, size);
    const tick = Math.min(1.2, Math.max(0.35, span / 3));
    const tail = 2.5;
    const edge = vertical
      ? this.frame.right
      : side === "top"
        ? this.frame.top
        : this.frame.bottom;
    const trackStep = textPitch(size) + tick + 0.7;
    const xy = (u: number, v: number) =>
      vertical ? { x: v, y: u } : { x: u, y: v };
    // A narrow dimension keeps its measured endpoints and moves its text outside them.
    const inline = span >= width + 2 * (tick + clearance + 0.6);
    const candidates = inline
      ? [{ center: (start + end) / 2, endpoint: undefined }]
      : [
          { center: end + tick + tail + width / 2, endpoint: end },
          { center: start - tick - tail - width / 2, endpoint: start },
        ];
    for (
      let track = edge + away * (size * 2.2 + 1);
      ;
      track += away * trackStep
    ) {
      for (const { center, endpoint } of candidates) {
        const label: Label = {
          type: "text",
          layer: "COTAS",
          at: xy(center, track - 1.2),
          text: value,
          size,
          align: "middle",
          ...(vertical ? { rotate: -90 } : {}),
        };
        const marks = span > eps ? [start, end] : [start];
        const entities: Entity[] = [
          ...marks.map((u) =>
            stroke(
              xy(u - tick, track + (vertical ? -tick : tick)),
              xy(u + tick, track + (vertical ? tick : -tick)),
            ),
          ),
          label,
        ];
        if (span > eps)
          entities.push(stroke(xy(start, track), xy(end, track), "dimension"));
        if (endpoint !== undefined)
          entities.push(
            stroke(
              xy(endpoint, track),
              xy(center - (Math.sign(center - endpoint) * width) / 2, track),
              "dimension",
            ),
          );
        if (!this.fits(entities)) continue;
        this.add(entities);
        for (const ref of span > eps ? [a, b] : [a]) {
          this.extensions.push(
            stroke(
              xy(ref[along], ref[across] + away),
              xy(ref[along], track + away * (tick + 0.8)),
              "extension",
            ),
          );
        }
        return;
      }
    }
  }

  leader(anchor: Point, text: string) {
    const size = 2.1;
    const labelAt = (x: number, y: number, align?: "end"): Label => ({
      type: "text",
      layer: "TEXTOS",
      at: { x, y },
      text,
      size,
      align,
    });
    const bend = (at: Point, side: number) => ({ x: at.x - side * 4, y: at.y });
    const edge = drawingBounds(this.view);
    for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
      const y = anchor.y + offset * textPitch(size);
      for (const side of [1, -1]) {
        const x = side === 1 ? edge.right + 7 : edge.left - 7;
        const label = labelAt(x, y + size * 0.35, side < 0 ? "end" : undefined);
        const knee = bend({ x, y }, side);
        const lines = [
          stroke(anchor, knee, "leader"),
          stroke(knee, { x: x - side * 1.4, y }, "leader"),
        ];
        if (!this.fits([label, ...lines])) continue;
        this.add([...lines, label]);
        return;
      }
    }
    // The unannotated left side of the view is an exit even when the right
    // and lower edges are crowded. Place the landing below all prior text.
    const exitX = this.frame.left - 1.5;
    const y = edge.bottom + textPitch(size) + 1;
    const label = labelAt(edge.left - 7, y + size * 0.35, "end");
    this.add([
      stroke(anchor, { x: exitX, y: anchor.y }, "leader"),
      stroke({ x: exitX, y: anchor.y }, { x: exitX, y }, "leader"),
      stroke({ x: exitX, y }, { x: label.at.x + 1.4, y }, "leader"),
      label,
    ]);
  }

  finish() {
    const labels = this.obstacles
      .filter(({ entity }) => entity.type === "text")
      .map(({ box }) => box);
    // Extension lines can traverse another track. Leave a drafting break
    // at its label, keeping the measured endpoints and the dimension line.
    this.view.push(
      ...this.extensions.flatMap((line) => splitExtension(line, labels)),
    );
  }
}
