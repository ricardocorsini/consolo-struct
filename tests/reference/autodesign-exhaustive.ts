// Exhaustive oracle for R2/R3: no pruning and no first-count stop.
// Sizing is copied from the historical implementation, never from production helpers.
import { area, type Piece } from "../../src/domain/model";
import { beamArrangementActive } from "../../src/detailing/beam";
import {
  connectionGeometry,
  weldedFrontIssues,
} from "../../src/detailing/connections";
import { concreteProfile } from "../../src/domain/profile";
import {
  calculate,
  tieLayout,
  type CalculationResult,
} from "../../src/domain/engine";
import {
  reactionGeometry,
  stirrupLayout,
  upperStitchLayout,
} from "../../src/domain/theory";
const isBeam = (r: CalculationResult) =>
  r.combinations.some((c) => c.method === "beam");
function beamSecondary(p: Piece, r: CalculationResult) {
  const v = r.values;
  // Each load case has its own shear-dependent limit, independent of tie demand.
  const spacingLimit = Math.min(
    ...r.combinations.map((c) => c.values.beam_stirrupSpacingLimit),
  );
  if (v.stirrupRequired !== undefined && Number.isFinite(spacingLimit)) {
    const span = stirrupLayout(p).last - stirrupLayout(p).first;
    p.rebar.stirrupCount = Math.min(
      100,
      Math.max(
        1,
        Math.ceil(v.stirrupRequired / area(2, p.rebar.stirrupDiameter)),
        p.geometry.length <= spacingLimit
          ? 1
          : 1 + Math.ceil(span / spacingLimit),
      ),
    );
  }
  if (v.beam_stitchApplies && v.stitchRequired !== undefined)
    p.rebar.stitchCount = Math.min(
      100,
      Math.max(
        p.rebar.stitchCount,
        Math.ceil(v.stitchRequired / area(2, p.rebar.stitchDiameter)),
      ),
    );
}
function sizeAll(p: Piece, result: CalculationResult) {
  const v = result.values;
  const beam = isBeam(result);
  // A beam with h > 600 mm has skin reinforcement (review), not stitch: N2 stays as informed.
  if (!beam || v.beam_stitchApplies) {
    p.rebar.stitchCount = Math.max(
      1,
      Math.ceil(v.stitchRequired / area(2, p.rebar.stitchDiameter)),
      Math.ceil((2 * v.d) / 3 / Math.min(100, p.geometry.loadOffset)),
    );
    const actualStitch = upperStitchLayout(p, tieLayout(p));
    p.rebar.stitchCount = Math.max(
      p.rebar.stitchCount,
      1 +
        Math.ceil(
          (actualStitch.end - actualStitch.start) /
            Math.min(100, reactionGeometry(p).a),
        ),
    );
  }
  if (beam) beamSecondary(p, result);
  else
    p.rebar.stirrupCount = Math.max(
      1,
      Math.ceil(v.stirrupRequired / area(2, p.rebar.stirrupDiameter)),
    );
  p.design.lowerStitchCount =
    v.lowerRequired > 0
      ? Math.max(
          Math.ceil(v.lowerRequired / area(2, p.rebar.stitchDiameter)),
          Math.ceil(v.d / 3 / Math.min(100, p.geometry.loadOffset)),
        )
      : 0;
  p.design.splittingCount = Math.ceil(
    v.splittingRequired / area(2, p.design.splittingDiameter),
  );
  p.design.suspensionCount = Math.ceil(
    v.suspensionRequired / area(2, p.design.suspensionDiameter),
  );
}
export function exhaustiveSecondarySearch(input: Piece) {
  let best: Piece | undefined,
    score = Infinity,
    candidates = 0;
  const critical = new Set([
    "tie",
    "mechanical",
    "strut",
    "angleMin",
    "nodeSupport",
    "ductility",
    "bearing",
    "tieDepth",
    "clearSpacing",
    "tieDiameter",
    "tiePitch",
    "frontClearance",
    "loopPin",
    "loopWidth",
    "loopNesting",
    "loopEven",
    "loopSteel",
    "weldDiameter",
    "cover",
    "literatureHorizontal",
    "literatureTip",
    "literatureConcrete",
    "literatureStrut",
    "beamDomain",
    "beamShear",
    "beamStirrups",
    "beamStirrupSpacing",
    "beamStitch",
    "stitch",
    "stitchSpacing",
    "stitchZone",
    "stitchClear",
    "stitchDiameter",
    "lowerStitch",
    "lowerSpacing",
    "transverse",
    "suspension",
    "splitting",
    "anchorN1HookBend",
    "anchorN1HookCover",
    "anchorN1HookHeight",
    "anchorN1HookTail",
    "anchorN1BeamTail",
    "anchorN2",
    "anchorN2Front",
    "anchorN2Closure",
    "anchorN2I",
    "anchorN2IFront",
    "anchorN2IClosure",
    "anchorN3Closure",
    "anchorN3GClosure",
    "anchorN4",
    "anchorN4Front",
    "anchorN4Tail",
    "anchorN4Geometry",
    "anchorP1",
    "anchorP1Tail",
  ]);
  if (input.design.supportAnchor === "hook" || beamArrangementActive(input))
    critical.add("anchorage");

  for (const diameter of [6.3, 8, 10, 12.5, 16, 20, 25]) {
    for (
      let count = 2;
      count <= 24;
      count += input.design.frontAnchor === "loop" ? 2 : 1
    ) {
      for (let layers = 1; layers <= 3; layers++) {
        const p = structuredClone(input);
        Object.assign(p.rebar, { tieDiameter: diameter, tieCount: count });
        if (p.design.frontAnchor === "welded")
          p.design.weldedBarDiameter = diameter;
        p.design.tieLayers = layers;
        if (
          layers > count ||
          (p.design.frontAnchor === "loop" &&
            tieLayout(p).rows.some((row) => row.count % 2))
        )
          continue;
        candidates++;
        let r = calculate(p);
        if (!r.combinations.length) continue;
        if (isBeam(r)) {
          beamSecondary(p, r);
          r = calculate(p);
        }
        sizeAll(p, r);
        r = calculate(p);
        if (
          r.status === "invalid" ||
          !r.combinations.length ||
          r.checks.some((c) => critical.has(c.id) && c.status === "fail")
        )
          continue;
        if (p.design.frontAnchor === "welded" && !beamArrangementActive(p)) {
          const layout = tieLayout(p);
          const { welded } = connectionGeometry(p, layout);
          if (
            weldedFrontIssues(
              p,
              welded,
              upperStitchLayout(p, layout).levels,
              concreteProfile(p),
            ).length
          )
            continue;
        }
        const rank = area(count, diameter) + layers * 0.001 + count * 0.00001;
        if (rank < score) {
          best = p;
          score = rank;
        }
      }
    }
  }
  return {
    piece: best ?? input,
    result: calculate(best ?? input),
    changed: best ? JSON.stringify(best) !== JSON.stringify(input) : false,
    candidates,
    found: !!best,
  };
}
