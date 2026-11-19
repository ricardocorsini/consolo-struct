import type { Piece } from "../domain/model";
import { samplePath, type BarPath, type Point } from "./geometry";
import type { Bar, BarFamily, Detail } from "./model";
import {
  intersectSectionX,
  projectElevation,
  rebarModel,
  type RebarSource,
} from "./rebarModel";

/** View adapters over the canonical reinforcement model (`rebarModel.ts`).
 * They only regroup projections of the placed bars; no coordinate is rebuilt. */
export type ElevationShape =
  | {
      kind: "line";
      family: "pin";
      mark: string;
      description: string;
      quantity: number;
      diameter: number;
      a: Point;
      b: Point;
    }
  | {
      kind: "end-on";
      family: "welded";
      mark: string;
      description: string;
      quantity: number;
      diameter: number;
      center: Point;
    };

/** Elevation of the connections (pins and welded transverse bars). */
export function elevationShapes(p: Piece): ElevationShape[] {
  const items = projectElevation(rebarModel(p));
  const shapes: ElevationShape[] = [];
  // All transverse pin centres overlap in this orthographic view. Preserve
  // their physical count in the label rather than shifting them in pixels.
  const pin = items.find(({ bar }) => bar.family === "pin");
  if (pin && pin.shape.kind === "path") {
    const segment = pin.shape.path.segments[0];
    if (segment.type === "line")
      shapes.push({
        kind: "line",
        family: "pin",
        mark: pin.bar.mark,
        description: "Pinos de ligação",
        quantity: pin.bar.quantity,
        diameter: pin.bar.diameter,
        a: segment.a,
        b: segment.b,
      });
  }
  for (const { bar, shape } of items)
    if (bar.family === "welded" && shape.kind === "point")
      shapes.push({
        kind: "end-on",
        family: "welded",
        mark: bar.mark,
        description: "Barra transversal soldada",
        quantity: bar.quantity,
        diameter: bar.diameter,
        center: shape.center,
      });
  return shapes;
}

const join = (paths: BarPath[]): BarPath => ({
  segments: paths.flatMap((path) => path.segments),
  length: paths.reduce((sum, path) => sum + path.length, 0),
  valid: paths.every((path) => path.valid),
});

/** One elevation path per tie shape and depth: the projected run followed by
 * its support hook. Overlapping legs keep the bar's quantity. */
export function elevationTieBars(_p: Piece, detail: RebarSource) {
  const items = projectElevation(detail).filter(
    ({ bar }) => bar.family === "tie",
  );
  const result: { bar: Bar; path: BarPath; endCaps?: Point[] }[] = [];
  for (const bar of detail.bars.filter((b) => b.family === "tie")) {
    const own = items.filter((item) => item.bar === bar);
    if (detail.arrangement === "beam") {
      const body = own.find((item) => item.part.role === "body");
      if (body?.shape.kind === "path")
        result.push({ bar, path: body.shape.path });
      continue;
    }
    const depths: number[] = [];
    for (const instance of bar.instances) {
      const parts = own.filter((item) => item.instance === instance);
      const body = parts.find((item) => item.part.role === "body");
      if (body?.shape.kind !== "path") continue;
      const depth =
        body.shape.path.segments[0].type === "line"
          ? body.shape.path.segments[0].a.y
          : 0;
      if (depths.some((d) => Math.abs(d - depth) < 1e-6)) continue;
      depths.push(depth);
      // Both hooks of a loop overlap in elevation; draw one.
      const hook = parts.find((item) => item.part.role === "hook");
      result.push({
        bar,
        path: join([
          reversed(body.shape.path),
          ...(hook?.shape.kind === "path" ? [hook.shape.path] : []),
        ]),
        endCaps: body.shape.endCaps,
      });
    }
  }
  return result;
}

export function elevationTiePaths(p: Piece, detail: Detail): Point[][] {
  return elevationTieBars(p, detail).map(({ path }) => samplePath(path, 24));
}

/** Bars cut by the transverse plane `sectionX`, grouped for the renderers.
 * With `pairWindow`, the N3/N3G pair and its N4 are projected as fabricated. */
export function sectionBars(
  _p: Piece,
  detail: RebarSource,
  sectionX: number,
  options: { pairWindow?: number } = {},
) {
  const items = intersectSectionX(detail, sectionX, {
    ...options,
    stitchPerimeter: true,
  });
  const ties: { v: number; depth: number; diameter: number; mark: string }[] =
    [];
  const addTie = (bar: Bar, v: number, depth: number) => {
    if (
      !ties.some(
        (t) =>
          t.mark === bar.mark &&
          Math.abs(t.v - v) < 1e-6 &&
          Math.abs(t.depth - depth) < 1e-6,
      )
    )
      ties.push({ v, depth, diameter: bar.diameter, mark: bar.mark });
  };
  const stitches: {
    depth: number;
    x: number;
    positions: number[];
    diameter: number;
    mark: string;
  }[] = [];
  const positives: {
    v: number;
    depth: number;
    diameter: number;
    mark: string;
  }[] = [];
  const lines: {
    family: BarFamily;
    mark: string;
    diameter: number;
    a: Point;
    b: Point;
  }[] = [];
  const stirrups: {
    family: "stirrup" | "stirrupInner";
    mark: string;
    diameter: number;
    x: number;
    path: BarPath;
  }[] = [];
  const constructive: {
    v: number;
    depth: number;
    x: number;
    diameter: number;
    mark: string;
  }[] = [];
  for (const { bar, instance, part, cut } of items) {
    for (const [a, b] of cut.lines)
      lines.push({
        family: bar.family,
        mark: bar.mark,
        diameter: bar.diameter,
        a,
        b,
      });
    switch (bar.family) {
      case "tie":
        for (const pt of cut.points) addTie(bar, pt.x, pt.y);
        break;
      case "stitch":
      case "lower":
        if (cut.points.length)
          stitches.push({
            depth: part.at,
            x: bar.locations[bar.instances.indexOf(instance)].x,
            positions: cut.points.map((pt) => pt.x).sort((a, b) => a - b),
            diameter: bar.diameter,
            mark: bar.mark,
          });
        break;
      case "positive":
        for (const pt of cut.points)
          positives.push({
            v: pt.x,
            depth: pt.y,
            diameter: bar.diameter,
            mark: bar.mark,
          });
        break;
      case "pin":
      case "welded":
        break;
      case "stirrup":
      case "stirrupInner":
        if (cut.inPlane)
          stirrups.push({
            family: bar.family,
            mark: bar.mark,
            diameter: bar.diameter,
            x: cut.x,
            path: cut.inPlane,
          });
        break;
      case "constructive":
        for (const pt of cut.points)
          constructive.push({
            v: pt.x,
            depth: pt.y,
            x: cut.x,
            diameter: bar.diameter,
            mark: bar.mark,
          });
        break;
    }
  }
  return { ties, stitches, positives, lines, stirrups, constructive };
}

/** Runs the projected tie from the tip back to the support, where its hook starts. */
function reversed(path: BarPath): BarPath {
  return {
    ...path,
    segments: [...path.segments]
      .reverse()
      .map((s) =>
        s.type === "line"
          ? { ...s, a: s.b, b: s.a }
          : { ...s, start: s.start + s.sweep, sweep: -s.sweep },
      ),
  };
}
