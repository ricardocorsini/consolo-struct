import { calculate, tieLayout } from "../domain/engine";
import type { Piece } from "../domain/model";
import { basicAnchorage, requiredAnchorage } from "../domain/anchorage";
import { bondCoefficientEta1, steelClassOf } from "../domain/steel";
import {
  mandrelDiameter,
  pathLengthAfterX,
  roundedPath,
  type BarPath,
  type Point,
} from "./geometry";

// "Armado como viga": top (tie/negative) and bottom (positive) bars bent at both ends.
// Elevation coordinates in mm: x from the support face to the tip, y = depth below the top face.

/** The arrangement depends on the full concrete outline; cutting the excess removes the bottom chord. */
export const beamArrangementAvailable = (p: Piece) =>
  p.design.excessConcrete !== "remove";
export const beamArrangementActive = (p: Piece) =>
  p.detailing.barArrangement === "beam" && beamArrangementAvailable(p);

export type BeamEnd = {
  /** Anchorage length required from the origin of the anchorage. */
  required: number;
  /** Straight length from the origin to the start of the bend. */
  straight: number;
  /** Straight leg after the 90° bend, as detailed. */
  leg: number;
  /** Longest leg that fits the concrete outline with the specified cover. */
  legMax: number;
  /** Anchorage developed along the bar: straight + arc + leg. */
  developed: number;
  fits: boolean;
};
export type BeamBar = {
  diameter: number;
  mandrel: number;
  radius: number;
  vertices: Point[];
  path: BarPath;
  back: BeamEnd;
  front: BeamEnd;
  /** Horizontal projection between the axes of the two legs. */
  span: number;
};
export type BeamLayout = {
  top: (BeamBar & { layer: number; count: number; depth: number })[];
  bottom: BeamBar & { count: number; depthSupport: number; depthTip: number };
  /** Inner edge of the bearing pad: origin of the anchorage at the tip. */
  frontOrigin: number;
  lbNecTop: number;
  lbNecBottom: number;
  bottomBond: { lb: number; fbd?: number; alpha: number; eta2: number };
};

const finite = (v: number | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

function end(
  required: number,
  straight: number,
  radius: number,
  legMax: number,
  diameter: number,
  turn = Math.PI / 2,
): BeamEnd {
  const arc = turn * radius;
  const minimum = 8 * diameter;
  const needed = Math.max(minimum, required - Math.max(straight, 0) - arc);
  const leg = Math.max(0, Math.min(needed, legMax));
  return {
    required,
    straight,
    leg,
    legMax,
    developed: Math.max(straight, 0) + arc + leg,
    fits: legMax + 1e-6 >= needed,
  };
}

/** Transverse axis positions (mm from one lateral face) of n bars between the stirrup legs. */
export function beamBarPositions(p: Piece, count: number, diameter: number) {
  const g = p.geometry,
    edge = g.cover + p.rebar.stirrupDiameter + diameter / 2;
  return Array.from(
    { length: count },
    (_, i) => edge + (count > 1 ? (i * (g.width - 2 * edge)) / (count - 1) : 0),
  );
}

export function beamLayout(
  p: Piece,
  values: Record<string, number> = calculate(p).values,
): BeamLayout {
  const g = p.geometry,
    r = p.rebar,
    q = p.design,
    s = p.detailing;
  const layout = tieLayout(p);
  const slope = (g.height - g.tipHeight) / g.length;
  const bottomAt = (x: number, offset: number) =>
    g.height - slope * x - offset * Math.sqrt(1 + slope ** 2);
  const frontOrigin = Math.max(0, g.loadOffset - q.bearingLength / 2);
  // Keep the engine's force ratio and basic length, but use the actual bent
  // arrangement. No transverse welded bar is detailed in beam mode. The normal
  // cover is the lateral cover of these bars, not the legacy support declaration.
  const phi = r.tieDiameter;
  const lbTie = finite(values.lb) ? values.lb : 25 * phi;
  const alphaTop = g.cover + r.stirrupDiameter >= 3 * phi ? 0.7 : 1;
  const ratio = values.anchorRatio ?? 1;
  const lbNecTop = requiredAnchorage(phi, lbTie, alphaTop * lbTie * ratio);
  const actualEnd = (end: BeamEnd, developed: number, diameter: number) => ({
    ...end,
    developed,
    fits: developed + 1e-8 >= end.required && end.leg + 1e-8 >= 8 * diameter,
  });
  // Positive bars are constructive: full anchorage of their own diameter, hooked ends.
  const phiB = s.beamBottomDiameter;
  const eta2 = q.bond === "good" ? 1 : 0.7;
  const steel = steelClassOf(p.materials.fyk);
  const bond =
    steel && finite(values.fyd) && finite(values.fctd)
      ? basicAnchorage({
          diameter: phiB,
          fyd: values.fyd,
          fctd: values.fctd,
          eta1: bondCoefficientEta1(steel),
          eta2,
        })
      : { lb: (lbTie / phi) * phiB };
  const lbBottom = bond.lb;
  const alphaBottom = g.cover + r.stirrupDiameter >= 3 * phiB ? 0.7 : 1;
  const lbNecBottom = requiredAnchorage(phiB, lbBottom, alphaBottom * lbBottom);

  const mandrel = mandrelDiameter(phi, p.materials.fyk);
  const radius = (mandrel + phi) / 2;
  const layerPitch = phi + Math.max(20, phi, 0.5 * q.aggregate);
  const rows = layout.rows
    .map((row, layer) => ({ row, layer }))
    .filter(({ row }) => row.count > 0);
  const top = rows.map(({ row, layer }) => {
    const z = row.y;
    // Nest the bends: coincident leg axes would overlap across tie layers.
    const xFront = g.length - g.cover - phi / 2 - layer * layerPitch;
    const xBack = -(g.columnWidth - g.cover - phi / 2) + layer * layerPitch;
    const back = end(
      lbNecTop,
      -xBack - radius,
      radius,
      g.height - g.cover - phi / 2 - z - radius,
      phi,
    );
    const front = end(
      lbNecTop,
      xFront - radius - frontOrigin,
      radius,
      bottomAt(xFront, g.cover + phi / 2) - z - radius,
      phi,
    );
    const vertices = [
      { x: xBack, y: z + radius + back.leg },
      { x: xBack, y: z },
      { x: xFront, y: z },
      { x: xFront, y: z + radius + front.leg },
    ];
    const path = roundedPath(vertices, radius);
    return {
      layer,
      count: row.count,
      depth: z,
      diameter: phi,
      mandrel,
      radius,
      vertices,
      path,
      back: actualEnd(
        back,
        path.valid ? path.length - pathLengthAfterX(path, 0) : 0,
        phi,
      ),
      front: actualEnd(
        front,
        path.valid ? pathLengthAfterX(path, frontOrigin) : 0,
        phi,
      ),
      span: xFront - xBack,
    };
  });

  // Bottom bars sit inside the tie legs so the bends do not clash at the corners.
  const mandrelB = mandrelDiameter(phiB, p.materials.fyk);
  const radiusB = (mandrelB + phiB) / 2;
  const offset = g.cover + r.stirrupDiameter + phiB / 2;
  const inner = top.at(-1)!;
  const xFrontB = inner.vertices.at(-1)!.x - phi / 2 - phiB / 2;
  const xBackB = inner.vertices[0].x + phi / 2 + phiB / 2;
  const zSupport = bottomAt(0, offset);
  const zTip = bottomAt(xFrontB, offset);
  const ceiling = inner.depth + phi / 2 + phiB / 2;
  const backB = end(
    lbNecBottom,
    -xBackB - radiusB,
    radiusB,
    zSupport - radiusB - ceiling,
    phiB,
  );
  // The sloping chord meets the vertical tip leg at 90° minus its slope.
  // Use that bend's actual tangent and arc, not a nominal quarter circle.
  const frontTurn = Math.PI / 2 - Math.atan(slope);
  const frontTangent = radiusB * Math.tan(frontTurn / 2);
  const frontB = end(
    lbNecBottom,
    Math.max(0, xFrontB - frontOrigin) * Math.hypot(1, slope) - frontTangent,
    radiusB,
    zTip - frontTangent - ceiling,
    phiB,
    frontTurn,
  );
  const verticesB = [
    { x: xBackB, y: zSupport - radiusB - backB.leg },
    { x: xBackB, y: zSupport },
    ...(slope > 0 ? [{ x: 0, y: zSupport }] : []),
    { x: xFrontB, y: zTip },
    { x: xFrontB, y: zTip - frontTangent - frontB.leg },
  ];
  const path = roundedPath(verticesB, radiusB);
  return {
    top,
    bottom: {
      count: s.beamBottomCount,
      diameter: phiB,
      mandrel: mandrelB,
      radius: radiusB,
      vertices: verticesB,
      path,
      back: actualEnd(
        backB,
        path.valid ? path.length - pathLengthAfterX(path, 0) : 0,
        phiB,
      ),
      front: actualEnd(
        frontB,
        path.valid ? pathLengthAfterX(path, frontOrigin) : 0,
        phiB,
      ),
      span: xFrontB - xBackB,
      depthSupport: zSupport,
      depthTip: zTip,
    },
    frontOrigin,
    lbNecTop,
    lbNecBottom,
    bottomBond: { ...bond, alpha: alphaBottom, eta2 },
  };
}
