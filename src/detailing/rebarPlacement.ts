import {
  at,
  samplePath,
  type BarPath,
  type Point,
  type Segment,
} from "./geometry";

/** Physical placement of reinforcement in the piece, in mm.
 *
 * World axes: x from the support face toward the tip, y across the width
 * from one lateral face (0 … b) and z as the depth below the top face.
 * Each bar part is an exact planar `BarPath` (lines and arcs) lying in one of
 * the three orthogonal planes. Views are derived from these parts only:
 * the plane parallel to the view keeps the exact arcs; perpendicular planes
 * collapse to their exact extents; cuts intersect lines and arcs analytically. */
export type Plane = "xy" | "xz" | "yz";
export type Point3 = { x: number; y: number; z: number };
export type PlacedPath = {
  /** xy: (u, v) = (x, y) at z = at; xz: (x, z) at y = at; yz: (y, z) at x = at. */
  plane: Plane;
  at: number;
  path: BarPath;
  /** body: main run; hook: support hook out of the body plane. */
  role: "body" | "hook";
};
export type BarInstance = {
  /** Global construction order, shared by every family of the piece. */
  order: number;
  parts: PlacedPath[];
  /** Transverse family that physically carries this bar (N4 in a N3/N3G corner). */
  host?: "stirrup" | "stirrupInner";
  /** Outer N3 station of an N3G drawn in its own longitudinal plane. */
  pairedWith?: number;
};
export type ViewShape =
  | { kind: "path"; path: BarPath; endCaps?: Point[] }
  | { kind: "point"; center: Point };
/** Section coordinates: x = y (across the width), y = z (depth). */
export type SectionCut = {
  points: Point[];
  lines: [Point, Point][];
  /** The whole part lies in the section plane (or within the projection window). */
  inPlane: BarPath | null;
  /** Longitudinal station actually cut or projected. */
  x: number;
};

const EPS = 1e-6;

export function placed(
  plane: Plane,
  at: number,
  path: BarPath,
  role: PlacedPath["role"] = "body",
): PlacedPath {
  return { plane, at, path, role };
}

/** Translate a planar path in its own (u, v) coordinates. */
export function translatePath(path: BarPath, x: number, y: number): BarPath {
  const move = (p: Point) => ({ x: p.x + x, y: p.y + y });
  return {
    ...path,
    segments: path.segments.map(
      (s): Segment =>
        s.type === "line"
          ? { ...s, a: move(s.a), b: move(s.b) }
          : { ...s, center: move(s.center) },
    ),
  };
}

const line = (a: Point, b: Point): BarPath => ({
  segments: [{ type: "line", a, b }],
  length: Math.hypot(b.x - a.x, b.y - a.y),
  valid: true,
});

/** Whether the polar angle lies on the arc, as swept from `start`. */
function onArc(start: number, sweep: number, angle: number) {
  const turn =
    (((Math.sign(sweep) * (angle - start)) % (2 * Math.PI)) + 2 * Math.PI) %
    (2 * Math.PI);
  return turn <= Math.abs(sweep) + 1e-8;
}

/** Exact extent of a path along its local u (`"x"`) or v (`"y"`) axis. */
export function pathExtent(path: BarPath, axis: "x" | "y"): [number, number] {
  let min = Infinity,
    max = -Infinity;
  const take = (v: number) => {
    min = Math.min(min, v);
    max = Math.max(max, v);
  };
  for (const s of path.segments) {
    if (s.type === "line") {
      take(s.a[axis]);
      take(s.b[axis]);
      continue;
    }
    const value = (angle: number) =>
      axis === "x"
        ? s.center.x + s.radius * Math.cos(angle)
        : s.center.y + s.radius * Math.sin(angle);
    take(value(s.start));
    take(value(s.start + s.sweep));
    for (const angle of axis === "x"
      ? [0, Math.PI]
      : [Math.PI / 2, -Math.PI / 2])
      if (onArc(s.start, s.sweep, angle)) take(value(angle));
  }
  return [min, max];
}

/** Values of v where a path crosses u = x, including arcs (no chord error). */
function crossings(segments: Segment[], x: number) {
  const values: number[] = [];
  const lines: [number, number][] = [];
  const add = (v: number) => {
    if (!values.some((w) => Math.abs(w - v) < EPS)) values.push(v);
  };
  for (const s of segments) {
    if (s.type === "line") {
      if (Math.abs(s.b.x - s.a.x) < 1e-8) {
        // A run along v at u = x lies in the cut plane.
        if (Math.abs(x - s.a.x) < EPS) {
          if (Math.abs(s.b.y - s.a.y) < EPS) add(s.a.y);
          else lines.push([s.a.y, s.b.y]);
        }
      } else {
        const t = (x - s.a.x) / (s.b.x - s.a.x);
        if (t >= -1e-8 && t <= 1 + 1e-8) add(s.a.y + t * (s.b.y - s.a.y));
      }
      continue;
    }
    const cosine = (x - s.center.x) / s.radius;
    if (Math.abs(cosine) > 1 + 1e-8) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
    for (const a of [angle, -angle])
      if (onArc(s.start, s.sweep, a)) add(s.center.y + s.radius * Math.sin(a));
  }
  // Endpoints of in-plane runs are not separate crossings.
  return {
    values: values.filter(
      (v) =>
        !lines.some(
          ([a, b]) => v >= Math.min(a, b) - EPS && v <= Math.max(a, b) + EPS,
        ),
    ),
    lines,
  };
}

/** A run seen edge-on can end at a bend or a perpendicular run. There the
 * physical disk extends beyond the projected axis, unlike a cut bar end. */
function collapsePath(
  path: BarPath,
  axis: "x" | "y",
  point: (coordinate: number) => Point,
): ViewShape {
  const [min, max] = pathExtent(path, axis);
  if (max - min < EPS) return { kind: "point", center: point(min) };
  const extrema = axis === "x" ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
  const endCaps = [min, max]
    .filter((value) =>
      path.segments.some((s) =>
        s.type === "line"
          ? Math.abs(s.a[axis] - value) < EPS &&
            Math.abs(s.b[axis] - value) < EPS &&
            Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > EPS
          : extrema.some(
              (angle) =>
                Math.abs(at(s.center, s.radius, angle)[axis] - value) < EPS &&
                onArc(s.start, s.sweep, angle),
            ),
      ),
    )
    .map(point);
  return {
    kind: "path",
    path: line(point(min), point(max)),
    ...(endCaps.length ? { endCaps } : {}),
  };
}

/** Orthographic projection of one part.
 * elevation: (x, z) · plan: (x, y) · section: (y, z), in-plane parts only. */
export function projectPart(
  part: PlacedPath,
  view: "elevation" | "plan" | "section",
): ViewShape | null {
  const { plane, at, path } = part;
  const own: Record<typeof view, Plane> = {
    elevation: "xz",
    plan: "xy",
    section: "yz",
  };
  if (plane === own[view]) return { kind: "path", path };
  if (view === "section") return null;
  if (plane === "yz")
    return collapsePath(path, view === "elevation" ? "y" : "x", (v) => ({
      x: at,
      y: v,
    }));
  return collapsePath(path, "x", (x) => ({ x, y: at }));
}

/** Intersection with the transverse plane x = `x`, in section coordinates. */
export function cutPart(part: PlacedPath, x: number): SectionCut {
  const { plane, at, path } = part;
  if (plane === "yz")
    return {
      points: [],
      lines: [],
      inPlane: Math.abs(at - x) < EPS ? path : null,
      x,
    };
  const { values, lines } = crossings(path.segments, x);
  // xy: v = y at z = at; xz: v = z at y = at.
  const point = (v: number): Point =>
    plane === "xy" ? { x: v, y: at } : { x: at, y: v };
  return {
    points: values.map(point),
    lines: lines.map(([a, b]) => [point(a), point(b)]),
    inPlane: null,
    x,
  };
}

export function partPoints3(part: PlacedPath, divisions = 24): Point3[] {
  return samplePath(part.path, divisions).map(({ x: u, y: v }) =>
    part.plane === "xy"
      ? { x: u, y: v, z: part.at }
      : part.plane === "xz"
        ? { x: u, y: part.at, z: v }
        : { x: part.at, y: u, z: v },
  );
}
