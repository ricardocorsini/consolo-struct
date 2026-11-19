import type { Piece } from "../domain/model";
import { closedStirrupPerimeter } from "./geometry";
import {
  buildRebarGeometry,
  familyMark,
  type Bar,
  type RebarGeometry,
} from "./model";
import {
  cutPart,
  partPoints3,
  projectPart,
  type BarInstance,
  type PlacedPath,
  type Point3,
  type SectionCut,
  type ViewShape,
} from "./rebarPlacement";

/** Canonical reinforcement model of the ConsoloStruct (issue #63).
 *
 * `buildRebarGeometry` instantiates every detailed position once — mark,
 * function, diameter, steel, quantity, spacing, fabrication shape, anchorage
 * provisions, developed/cut lengths and the physical bars placed in 3D.
 * Elevation, sections A–A/B–B, plan, the 3D scene, the steel schedule and the
 * steel/concrete quantities are all derived from it by the pure functions
 * below; no renderer rebuilds bar coordinates on its own. */
export type RebarModel = RebarGeometry;
/** Anything carrying the placed bars: the geometry model or a full Detail. */
export type RebarSource = Pick<RebarGeometry, "piece" | "bars" | "arrangement">;

const cache = new Map<string, RebarModel>();
const CACHE_SIZE = 24;

/** Geometry of one piece, memoized by complete content. Views share the
 * effective anchorages and can reuse values from an existing calculation. */
export function rebarModel(
  p: Piece,
  currentValues?: Record<string, number>,
): RebarModel {
  const key = JSON.stringify(p);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  // A cached entry is a snapshot for this key even if a caller edits p in place.
  const model = buildRebarGeometry(structuredClone(p), currentValues);
  cache.set(key, model);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return model;
}

/** Family label used by the modelling views (selection, colours, 3D ids). */
export const viewFamily = (bar: Bar) =>
  bar.family === "stitch" || bar.family === "lower"
    ? "N2"
    : bar.family === "stirrup" || bar.family === "stirrupInner"
      ? "N3"
      : familyMark[bar.family];

type Placed = { bar: Bar; instance: BarInstance; part: PlacedPath };
function placedParts(src: RebarSource): Placed[] {
  return src.bars.flatMap((bar) =>
    bar.instances.flatMap((instance) =>
      instance.parts.map((part) => ({ bar, instance, part })),
    ),
  );
}

export type ViewItem = Placed & { shape: ViewShape };
/** Orthographic elevation (x, z): exact arcs for parts in vertical
 * longitudinal planes; horizontal runs and stirrups collapse to their extents. */
export function projectElevation(src: RebarSource): ViewItem[] {
  return placedParts(src).flatMap((item) => {
    const shape = projectPart(item.part, "elevation");
    return shape ? [{ ...item, shape }] : [];
  });
}
/** Orthographic plan (x, y), seen from the top face. */
export function projectPlan(src: RebarSource): ViewItem[] {
  return placedParts(src).flatMap((item) => {
    const shape = projectPart(item.part, "plan");
    return shape ? [{ ...item, shape }] : [];
  });
}

export type SectionItem = Placed & { cut: SectionCut };
/** Bars of the transverse plane x, in section coordinates (y, z).
 *
 * By default the section uses the nominal paths shown in 3D. With `pairWindow`,
 * the N3G paired to this N3 is projected and its N4 is cut in the N3G plane.
 * The drafting convention for N2/N2I can request their perimeter so the
 * nominal lap of the closing hooks is not counted as extra cut legs. */
export function intersectSectionX(
  src: RebarSource,
  x: number,
  {
    pairWindow = 0,
    stitchPerimeter = false,
  }: { pairWindow?: number; stitchPerimeter?: boolean } = {},
): SectionItem[] {
  const items = placedParts(src);
  const paired =
    pairWindow > 0
      ? items.find(
          ({ bar, instance, part }) =>
            bar.family === "stirrupInner" &&
            instance.pairedWith !== undefined &&
            Math.abs(instance.pairedWith - x) < 1e-6 &&
            Math.abs(part.at - x) <= pairWindow + 1e-6,
        )
      : undefined;
  return items.flatMap((item) => {
    const { bar, part, instance } = item;
    if (part.plane === "yz") {
      if (Math.abs(part.at - x) >= 1e-6 && item !== paired) return [];
      return [
        {
          ...item,
          cut: { points: [], lines: [], inPlane: part.path, x: part.at },
        },
      ];
    }
    const station =
      paired && instance.host === "stirrupInner" ? paired.part.at : x;
    const sectionPart =
      stitchPerimeter && (bar.family === "stitch" || bar.family === "lower")
        ? { ...part, path: closedStirrupPerimeter(part.path) }
        : part;
    const cut = cutPart(sectionPart, station);
    return cut.points.length || cut.lines.length ? [{ ...item, cut }] : [];
  });
}

export type ScenePath = Placed & { points: Point3[] };
/** 3D centre lines of every placed part, in construction order. */
export function scenePaths(src: RebarSource, divisions = 24): ScenePath[] {
  return placedParts(src)
    .sort((a, b) => a.instance.order - b.instance.order)
    .map((item) => ({ ...item, points: partPoints3(item.part, divisions) }));
}

/** Physical bars of every position against its declared quantity. */
export function quantityMismatches(src: RebarSource) {
  return src.bars
    .filter((bar) => bar.instances.length !== bar.quantity)
    .map((bar) => ({
      mark: bar.mark,
      declared: bar.quantity,
      placed: bar.instances.length,
    }));
}
