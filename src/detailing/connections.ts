import type { Piece } from "../domain/model";
import { tieLayout } from "../domain/engine";
import { bottomOffsetDepth, type ConcreteProfile } from "../domain/profile";
import { beamArrangementActive } from "./beam";
import { stitchFront } from "./stitches";

export function pinCenters(p: Piece): number[] {
  const s = p.detailing;
  const pitch =
    s.pinSpacing > 0 ? s.pinSpacing : p.design.bearingWidth / (s.pins + 1);
  return Array.from(
    { length: s.pins },
    (_, i) =>
      p.geometry.width / 2 + s.pinCenterOffset + (i - (s.pins - 1) / 2) * pitch,
  );
}

/** Physical connection geometry in mm, shared by detailing and elevation.
 * It does not run the design engine or add these bars to the resistance. */
export function connectionGeometry(p: Piece, layout = tieLayout(p)) {
  const { geometry: g, detailing: s, design: q } = p;
  const pinLength = s.pinEmbedment + s.pinProjection;
  const pins =
    s.pins > 0 && pinLength > 0
      ? {
          x: g.loadOffset,
          top: -s.pinProjection,
          bottom: s.pinEmbedment,
          length: pinLength,
          diameter: s.pinDiameter,
          quantity: s.pins,
          centers: pinCenters(p),
        }
      : null;
  const weldedLength = g.width - 2 * g.cover;
  const welded =
    !beamArrangementActive(p) && q.frontAnchor === "welded"
      ? layout.rows
          .filter((row) => row.count > 0)
          .map((row, layer) => ({
            x: g.length - g.cover - q.weldedBarDiameter / 2,
            depth: row.y + (p.rebar.tieDiameter + q.weldedBarDiameter) / 2,
            layer,
            length: weldedLength,
            diameter: q.weldedBarDiameter,
          }))
      : [];
  return { pins, welded };
}

/** TS spans the N2 legs in plan. The nearest axis is at the same x, or at
 * the front of N2 when the stitch ends before TS. */
export function weldedFrontIssues(
  p: Piece,
  welded: ReturnType<typeof connectionGeometry>["welded"],
  upperLevels: number[],
  concrete: ConcreteProfile,
) {
  const { geometry: g, rebar: r } = p;
  const issues: { code: string; message: string }[] = [];
  if (welded.some((bar) => bar.depth + bar.diameter / 2 > g.height / 5 + 1e-8))
    issues.push({
      code: "weld-depth",
      message:
        "A barra transversal soldada TS ultrapassa o quinto superior do consolo.",
    });
  if (
    welded.some(
      (bar) =>
        bar.x <= 0 ||
        bar.length <= 0 ||
        bar.depth >
          bottomOffsetDepth(concrete, bar.x, g.cover + bar.diameter / 2) + 1e-8,
    )
  )
    issues.push({
      code: "weld-cover",
      message:
        "A barra transversal soldada TS não cabe no contorno com o cobrimento informado.",
    });
  if (
    welded.some((bar) =>
      upperLevels.some((depth) => {
        const gapX = Math.max(0, bar.x - stitchFront(p, concrete, depth));
        const radiusSum = (bar.diameter + r.stitchDiameter) / 2;
        return Math.hypot(gapX, bar.depth - depth) < radiusSum - 1e-8;
      }),
    )
  )
    issues.push({
      code: "weld-stitch-clash",
      message:
        "A barra transversal soldada TS interfere com a costura superior N2.",
    });
  return issues;
}
