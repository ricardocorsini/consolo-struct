import {
  basicAnchorage,
  requiredAnchorage,
  supportLimits,
} from "../domain/anchorage";
import { materialProperties, materialSafety } from "../domain/materialSafety";
import type { Piece } from "../domain/model";
import {
  bottomOffsetDepth,
  bottomReach,
  concreteProfile,
  type ConcreteProfile,
} from "../domain/profile";
import { bondCoefficientEta1, steelClassOf } from "../domain/steel";
import { upperStitchLayout } from "../domain/theory";
import { mandrelDiameter } from "./geometry";

export function lowerStitchLayout(
  p: Piece,
  layout: { d: number; dPrime: number; maxDepth: number },
  concrete = concreteProfile(p),
) {
  const { geometry: g, design: q, rebar: r } = p;
  const start =
    upperStitchLayout(p, layout).end +
    Math.max(20, r.stitchDiameter, 0.5 * q.aggregate) +
    r.stitchDiameter;
  const end = bottomOffsetDepth(
    concrete,
    g.cover +
      r.stitchDiameter / 2 +
      (mandrelDiameter(r.stitchDiameter, p.materials.fykTransverse, true) +
        r.stitchDiameter) /
        2,
    g.cover + r.stitchDiameter / 2,
  );
  const count = q.lowerStitchCount;
  const step = (end - start) / Math.max(count - 1, 1);
  const levels =
    count > 0 && end >= start
      ? Array.from({ length: count }, (_, i) =>
          count === 1 ? (start + end) / 2 : start + i * step,
        )
      : [];
  return { start, end, step, levels };
}

export function stitchFront(
  p: Piece,
  concrete: ConcreteProfile,
  depth: number,
) {
  const { geometry: g, rebar: r } = p;
  const offset = g.cover + r.stitchDiameter / 2;
  return Math.min(
    g.length - offset,
    bottomReach(concrete, depth, offset, g.length),
  );
}

export const stitchWidth = (p: Piece) =>
  p.geometry.width -
  2 * (p.geometry.cover + p.rebar.stirrupDiameter) -
  p.rebar.stitchDiameter;

export function stitchAnchorage(
  p: Piece,
  family: "N2" | "N2I",
  levels: number[],
  areaNeeded: number,
  areaProvided: number,
  material?: { fctd: number; fywd: number },
) {
  const { geometry: g, design: q, materials: s } = p;
  const diameter = p.rebar.stitchDiameter;
  const shallowest = Math.min(...levels);
  const eta2 =
    q.bond === "poor" || (g.height > 300 && shallowest < g.height - 300)
      ? 0.7
      : 1;
  const { gammaC, gammaS } = materialSafety(q);
  const { fctd, fywd } =
    material ??
    materialProperties(s.fck, s.fyk, s.fykTransverse, gammaC, gammaS);
  const steel = steelClassOf(s.fykTransverse);
  const { fbd, lb } = basicAnchorage({
    diameter,
    eta2,
    fctd,
    fyd: fywd,
    eta1: steel ? bondCoefficientEta1(steel) : 1,
  });
  const alpha = g.cover >= 3 * diameter ? 0.7 : 1;
  const rawRatio = areaProvided > 0 ? areaNeeded / areaProvided : 1;
  const ratio =
    family === "N2" && q.anchorRatioFloor
      ? Math.max(1, rawRatio)
      : family === "N2I" && areaNeeded === 0
        ? 0
        : rawRatio;
  const required = requiredAnchorage(diameter, lb, alpha * lb * ratio);
  const limits = supportLimits(p, diameter);
  return {
    diameter,
    eta2,
    fbd,
    lb,
    alpha,
    ratio,
    required,
    ...limits,
    adopted: Math.min(
      limits.axis,
      Math.max(required, p.detailing.stitchEmbedment),
    ),
  };
}
