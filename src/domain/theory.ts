import type { Piece } from "./model";

/** Clear spacing of the tie layers and their nested vertical legs. */
export const tieLayerSpacing = (p: Piece) =>
  Math.max(20, p.rebar.tieDiameter, 0.5 * p.design.aggregate);

/** Shared physical distribution: calculation and fabrication use the same bar axes. */
export function upperStitchLayout(
  p: Piece,
  layout: { d: number; dPrime: number; maxDepth: number },
) {
  const diameter = p.rebar.stitchDiameter;
  const start =
    layout.maxDepth +
    diameter / 2 +
    Math.max(20, diameter, 0.5 * p.design.aggregate);
  const end = layout.dPrime + (2 * layout.d) / 3;
  const count = p.rebar.stitchCount;
  const pitch = count > 1 ? (end - start) / (count - 1) : (2 * layout.d) / 3;
  const levels = Array.from({ length: count }, (_, i) =>
    count === 1 ? (start + end) / 2 : start + i * pitch,
  );
  return { start, end, pitch, levels };
}

/** Shared N3 distribution: the engine checks the same pitch that detailing draws.
 * Closed vertical stirrups between the cover lines along the corbel length. */
export function stirrupLayout(p: Piece) {
  const g = p.geometry,
    count = p.rebar.stirrupCount;
  const offset = g.cover + p.rebar.stirrupDiameter / 2;
  const first = offset,
    last = g.length - offset;
  const pitch = count > 1 ? (last - first) / (count - 1) : 0;
  const positions = Array.from({ length: count }, (_, i) =>
    count === 1 ? (first + last) / 2 : first + pitch * i,
  );
  return { offset, first, last, pitch, positions };
}

/** The pad stays at loadOffset. Only the reaction moves; no drawing geometry is relocated. */
export function reactionGeometry(p: Piece) {
  const center = p.geometry.loadOffset;
  const length = p.design.bearingLength;
  const mode = p.design.reactionPosition ?? "specified";
  const a =
    mode === "outerThird"
      ? center + length / 6
      : mode === "threeQuarter"
        ? Math.max(center, 0.75 * p.geometry.length)
        : center;
  const shift = a - center;
  return {
    center,
    a,
    shift,
    // A centred uniform sub-area with the same resultant, contained in the physical pad.
    effectiveLength: length - 2 * Math.abs(shift),
  };
}

/** El Debs, supplied excerpt §3.5.1, Fig.3.41 and eqs.3.18–3.25.
 * N, mm, MPa. Keep the H*d_h term; 5.55 is rounded in the book, not here. */
export function elDebsSimplified({
  vertical,
  horizontal,
  a,
  d,
  loadHeight,
  width,
  fcd,
  indirect = false,
}: {
  vertical: number;
  horizontal: number;
  a: number;
  d: number;
  loadHeight: number;
  width: number;
  fcd: number;
  indirect?: boolean;
}) {
  const z = 0.9 * d;
  const hypotenuse = Math.hypot(z, a);
  const lever = (z * a) / hypotenuse;
  const strutWidth = 0.2 * d;
  const tieVertical = (vertical * a) / z;
  const tieForce = tieVertical + horizontal * (1 + loadHeight / z);
  const strutForce = (vertical * a + horizontal * loadHeight) / lever;
  const beta = indirect ? 0.85 : 1;
  return {
    z,
    lever,
    strutWidth,
    tieVertical,
    tieForce,
    tieForceApprox: tieVertical + 1.2 * horizontal,
    strutForce,
    strutStress: strutForce / (width * strutWidth),
    beta,
    strutLimit: beta * fcd,
    tauLimit: (0.18 * beta * fcd) / Math.sqrt(0.9 ** 2 + (a / d) ** 2),
    horizontalMomentRatio: (horizontal * loadHeight) / (vertical * a),
    momentResidual: tieForce * z - vertical * a - horizontal * (z + loadHeight),
  };
}
