import type { Piece } from "./model";
import { geometricPinFactor } from "./steel";

/** Physical nesting of the horizontal tie loops of one layer, in mm (issue #64).
 *
 * Shared by the engine (`loopWidth`), the automatic search and the detailing,
 * so a layer is approved, suggested and drawn with the same widths. A layer
 * with `count` legs holds `floor(count / 2)` concentric loops. The outer loop
 * runs inside the stirrup legs; the inner ones are nested with the minimum
 * free gap; the innermost keeps at most min(d, 15φ) between its legs. Each
 * loop needs a centre-line width of at least D + φ (D = adopted internal
 * diameter, never below the bending pin) to hold its frontal curve. */
export function loopNesting(
  p: Piece,
  count: number,
  specifiedDiameter: number,
  layout: { d: number; spacingHorizontalMin: number },
) {
  const g = p.geometry,
    r = p.rebar,
    phi = r.tieDiameter;
  const loops = Math.floor(count / 2);
  const mainD = geometricPinFactor(p.materials.fyk, phi) * phi;
  const diameter = Math.max(specifiedDiameter, mainD);
  const radius = (diameter + phi) / 2;
  const outerWidth = g.width - 2 * (g.cover + r.stirrupDiameter) - phi;
  const gap = layout.spacingHorizontalMin + phi;
  const maxPitch = Math.min(layout.d, 15 * phi);
  const innerTarget = Math.min(maxPitch, outerWidth - 2 * gap * (loops - 1));
  const nestingPitch =
    loops > 1 ? (outerWidth - innerTarget) / (2 * (loops - 1)) : 0;
  /** Nominal centre-line width of each loop, outer first. */
  const widths = Array.from(
    { length: loops },
    (_, i) => outerWidth - 2 * i * nestingPitch,
  );
  const required = 2 * radius;
  return {
    loops,
    mainD,
    specifiedDiameter,
    diameter,
    radius,
    outerWidth,
    gap,
    maxPitch,
    nestingPitch,
    widths,
    /** Minimum centre-line width that holds the frontal curve: D + φ. */
    required,
    /** Width of the innermost loop (Infinity when the layer has no loop). */
    innermost: widths.length ? widths[widths.length - 1] : Infinity,
    fits: widths.every((w) => w >= required - 1e-9),
  };
}

/** Loop diameter adopted in one layer by the detailing (second-layer override). */
export const detailingLoopDiameter = (p: Piece, layer: number) =>
  layer > 0 && p.detailing.secondLoopDiameter > 0
    ? p.detailing.secondLoopDiameter
    : p.design.loopInternalDiameter;
