import { geometricPinFactor } from "../domain/steel";
// Bar centre lines are stored in millimetres. Drawings convert to centimetres.
export type Point = { x: number; y: number };
export type Segment =
  | { type: "line"; a: Point; b: Point }
  | {
      type: "arc";
      center: Point;
      radius: number;
      start: number;
      sweep: number;
    };
export type BarPath = { segments: Segment[]; length: number; valid: boolean };
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const at = (c: Point, radius: number, angle: number): Point => ({
  x: c.x + radius * Math.cos(angle),
  y: c.y + radius * Math.sin(angle),
});
export function pathLength(segments: Segment[]) {
  return segments.reduce(
    (s, p) =>
      s +
      (p.type === "line" ? distance(p.a, p.b) : p.radius * Math.abs(p.sweep)),
    0,
  );
}

/** Developed length on the tip side of a transverse plane. */
export function pathLengthAfterX(path: BarPath, x: number): number {
  return path.segments.reduce((length, s) => {
    if (s.type === "line") {
      const first = Math.min(s.a.x, s.b.x);
      const last = Math.max(s.a.x, s.b.x);
      if (x <= first) return length + distance(s.a, s.b);
      if (x >= last) return length;
      return length + (distance(s.a, s.b) * (last - x)) / (last - first);
    }
    const cosine = (x - s.center.x) / s.radius;
    const sweep = Math.abs(s.sweep);
    if (cosine <= -1) return length + s.radius * sweep;
    if (cosine >= 1) return length;
    const angle = Math.acos(cosine);
    const turn = 2 * Math.PI;
    const crossings = [angle, -angle]
      .map((a) => (((Math.sign(s.sweep) * (a - s.start)) % turn) + turn) % turn)
      .filter((a) => a > 0 && a < sweep)
      .sort((a, b) => a - b);
    const ends = [...crossings, sweep];
    let start = 0;
    for (const end of ends) {
      const middle = s.start + Math.sign(s.sweep) * ((start + end) / 2);
      if (Math.cos(middle) >= cosine) length += s.radius * (end - start);
      start = end;
    }
    return length;
  }, 0);
}

export function stirrupClosure(diameter: number, mandrel: number) {
  const radius = (mandrel + diameter) / 2;
  const tail = Math.max(5 * diameter, 50);
  return { radius, tail, minimum: 2 * radius + tail / Math.sqrt(2) };
}
export function roundedPath(vertices: Point[], radius: number): BarPath {
  const corners = vertices.map((b, i) => {
    if (i === 0 || i === vertices.length - 1) return null;
    const a = vertices[i - 1],
      c = vertices[i + 1];
    const la = distance(a, b),
      lc = distance(c, b);
    const u = { x: (a.x - b.x) / la, y: (a.y - b.y) / la };
    const v = { x: (c.x - b.x) / lc, y: (c.y - b.y) / lc };
    const angle = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)));
    const t = radius / Math.tan(angle / 2);
    const norm = Math.hypot(u.x + v.x, u.y + v.y);
    if (norm < 1e-8) return null;
    const center = {
      x: b.x + (((u.x + v.x) / norm) * radius) / Math.sin(angle / 2),
      y: b.y + (((u.y + v.y) / norm) * radius) / Math.sin(angle / 2),
    };
    const start = { x: b.x + u.x * t, y: b.y + u.y * t };
    const end = { x: b.x + v.x * t, y: b.y + v.y * t };
    const turn = Math.sign(-u.x * v.y + u.y * v.x);
    return { start, end, center, t, sweep: turn * (Math.PI - angle) };
  });
  let valid = true;
  const segments: Segment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    if (
      (corners[i]?.t ?? 0) + (corners[i + 1]?.t ?? 0) >
      distance(vertices[i], vertices[i + 1]) + 1e-6
    )
      valid = false;
    const a = corners[i]?.end ?? vertices[i],
      b = corners[i + 1]?.start ?? vertices[i + 1];
    segments.push({ type: "line", a, b });
    const k = corners[i + 1];
    if (k)
      segments.push({
        type: "arc",
        center: k.center,
        radius,
        start: Math.atan2(k.start.y - k.center.y, k.start.x - k.center.x),
        sweep: k.sweep,
      });
  }
  return {
    segments,
    length: pathLength(segments),
    valid:
      valid && segments.length > 0 && Number.isFinite(pathLength(segments)),
  };
}
// Nominal centre-line rectangle, three 90° corners, two 135° hooks and straight tails.
// The two closing ends are lapped out of the drawing plane; this is a fabrication projection.
export function closedStirrup(
  width: number,
  height: number,
  diameter: number,
  mandrel: number,
): BarPath {
  const { radius: r, tail, minimum } = stirrupClosure(diameter, mandrel);
  const c = { x: width - r, y: r };
  const s = at(c, r, Math.PI / 4);
  const e = at(c, r, (-3 * Math.PI) / 4);
  const t = { x: -tail / Math.sqrt(2), y: tail / Math.sqrt(2) };
  const outline = roundedPath(
    [
      { x: width - r, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: height },
      { x: width, y: height },
      { x: width, y: r },
    ],
    r,
  );
  const segments: Segment[] = [
    { type: "line", a: { x: s.x + t.x, y: s.y + t.y }, b: s },
    {
      type: "arc",
      center: c,
      radius: r,
      start: Math.PI / 4,
      sweep: (-3 * Math.PI) / 4,
    },
    ...outline.segments,
    { type: "arc", center: c, radius: r, start: 0, sweep: (-3 * Math.PI) / 4 },
    { type: "line", a: e, b: { x: e.x + t.x, y: e.y + t.y } },
  ];
  return {
    segments,
    length: pathLength(segments),
    valid: outline.valid && width >= minimum && height >= minimum,
  };
}
/** Perimeter used by the conventional transverse section of N2/N2I. The
 * full fabrication projection includes both overlapping closure ends. */
export function closedStirrupPerimeter(path: BarPath): BarPath {
  const closing = path.segments.at(-2)!;
  const segments = [
    ...path.segments.slice(2, -2),
    closing.type === "arc" ? { ...closing, sweep: -Math.PI / 2 } : closing,
  ];
  return { ...path, segments, length: pathLength(segments) };
}

/** Internal U for N3: two vertical effective legs and two inward 135° hooks.
 * Explicit arcs keep the full straight tails instead of consuming them in fillets. */
export function openStirrup(
  width: number,
  height: number,
  diameter: number,
  mandrel: number,
): BarPath {
  const radius = (mandrel + diameter) / 2,
    tail = Math.max(5 * diameter, 50);
  const left = { x: radius, y: radius },
    right = { x: width - radius, y: radius };
  const start = at(left, radius, -Math.PI / 4),
    end = at(right, radius, (-3 * Math.PI) / 4);
  const outline = roundedPath(
    [
      { x: 0, y: radius },
      { x: 0, y: height },
      { x: width, y: height },
      { x: width, y: radius },
    ],
    radius,
  );
  const segments: Segment[] = [
    {
      type: "line",
      a: { x: start.x + tail / Math.SQRT2, y: start.y + tail / Math.SQRT2 },
      b: start,
    },
    {
      type: "arc",
      center: left,
      radius,
      start: -Math.PI / 4,
      sweep: (-3 * Math.PI) / 4,
    },
    ...outline.segments,
    { type: "arc", center: right, radius, start: 0, sweep: (-3 * Math.PI) / 4 },
    {
      type: "line",
      a: end,
      b: { x: end.x - tail / Math.SQRT2, y: end.y + tail / Math.SQRT2 },
    },
  ];
  return {
    segments,
    length: pathLength(segments),
    valid:
      outline.valid &&
      height >= 2 * radius &&
      width >= 2 * (radius + radius / Math.SQRT2 + tail / Math.SQRT2),
  };
}
export function samplePath(path: BarPath, divisions = 12): Point[] {
  return path.segments.flatMap((s, index) => {
    const pts =
      s.type === "line"
        ? [s.a, s.b]
        : Array.from({ length: divisions + 1 }, (_, i) =>
            at(s.center, s.radius, s.start + (s.sweep * i) / divisions),
          );
    return index ? pts.slice(1) : pts;
  });
}
/** Maximum sagitta between an arc and the chords returned by samplePath. */
export function pathSamplingError(path: BarPath, divisions: number): number {
  return Math.max(
    0,
    ...path.segments.map((segment) =>
      segment.type === "arc"
        ? segment.radius * (1 - Math.cos(segment.sweep / (2 * divisions)))
        : 0,
    ),
  );
}
export function mandrelDiameter(
  diameter: number,
  fyk: number,
  stirrup = false,
) {
  if (stirrup && diameter <= 10) return 3 * diameter;
  return geometricPinFactor(fyk, diameter) * diameter;
}
export const steelMass = (length: number, diameter: number) =>
  ((length * Math.PI * diameter ** 2) / 4) * 7.85e-6;
