// Capturado sem mudança de algoritmo do upstream 2720f58 para a issue #16.
// Referência histórica somente de teste: não importar auxiliares da busca nova.
import { area, type Piece } from "../../src/domain/model";
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
export interface DesignProposal {
  piece: Piece;
  result: CalculationResult;
  changed: boolean;
  message: string;
  candidates: number;
}
const isBeam = (r: CalculationResult) =>
  r.combinations.some((c) => c.method === "beam");
/** Beam model (1 < a/d ≤ 2): N3 must meet Atransv,nec and smáx, and N2 the stitch area,
 * before a tie candidate is judged. Stirrups never change VRd2, so a beamShear failure persists. */
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
/** Finite enumeration; each candidate recomputes d and all simultaneous combinations.
 * Never invents support reinforcement, weld resistance, joint preparation or an input confirmation. */
export function legacySuggestReinforcement(input: Piece): DesignProposal {
  let best: Piece | undefined;
  let score = Infinity,
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
  ]);
  for (const diameter of [6.3, 8, 10, 12.5, 16, 20, 25]) {
    for (
      let count = 2;
      count <= 24;
      count += input.design.frontAnchor === "loop" ? 2 : 1
    ) {
      for (let layers = 1; layers <= 3; layers++) {
        const p = structuredClone(input);
        p.rebar.tieCount = count;
        p.rebar.tieDiameter = diameter;
        p.design.tieLayers = layers;
        if (
          layers > count ||
          (p.design.frontAnchor === "loop" &&
            tieLayout(p).rows.some((row) => row.count % 2))
        )
          continue;
        candidates++;
        let r = calculate(p);
        if (isBeam(r)) {
          beamSecondary(p, r);
          r = calculate(p);
        }
        if (
          !r.combinations.length ||
          r.checks.some((c) => critical.has(c.id) && c.status === "fail")
        )
          continue;
        const candidateScore =
          area(count, diameter) + layers * 0.001 + count * 0.00001;
        if (candidateScore < score) {
          best = p;
          score = candidateScore;
        }
      }
    }
  }
  if (!best)
    return {
      piece: input,
      result: calculate(input),
      changed: false,
      candidates,
      message:
        "Nenhum arranjo de tirante atende ao modelo e ao espaço disponível nesta busca (φ 6,3–25; até 24 ramos; até 3 camadas). Revise geometria, apoio e ancoragem frontal. Nenhum dado foi alterado.",
    };
  const result = calculate(best),
    v = result.values;
  const beam = isBeam(result);
  // A beam with h > 600 mm has skin reinforcement (review), not stitch: N2 stays as informed.
  if (!beam || v.beam_stitchApplies) {
    best.rebar.stitchCount = Math.max(
      1,
      Math.ceil(v.stitchRequired / area(2, best.rebar.stitchDiameter)),
      Math.ceil((2 * v.d) / 3 / Math.min(100, best.geometry.loadOffset)),
    );
    const actualStitch = upperStitchLayout(best, tieLayout(best));
    best.rebar.stitchCount = Math.max(
      best.rebar.stitchCount,
      1 +
        Math.ceil(
          (actualStitch.end - actualStitch.start) /
            Math.min(100, reactionGeometry(best).a),
        ),
    );
  }
  if (beam) beamSecondary(best, result);
  else
    best.rebar.stirrupCount = Math.max(
      1,
      Math.ceil(v.stirrupRequired / area(2, best.rebar.stirrupDiameter)),
    );
  best.design.lowerStitchCount =
    v.lowerRequired > 0
      ? Math.max(
          Math.ceil(v.lowerRequired / area(2, best.rebar.stitchDiameter)),
          Math.ceil(v.d / 3 / Math.min(100, best.geometry.loadOffset)),
        )
      : 0;
  best.design.splittingCount = Math.ceil(
    v.splittingRequired / area(2, best.design.splittingDiameter),
  );
  best.design.suspensionCount = Math.ceil(
    v.suspensionRequired / area(2, best.design.suspensionDiameter),
  );
  const final = calculate(best);
  if (final.status === "invalid")
    return {
      piece: input,
      result: calculate(input),
      changed: false,
      candidates,
      message:
        "As armaduras secundárias excedem o domínio de edição. Revise a seção e as bitolas.",
    };
  return {
    piece: best,
    result: final,
    changed: JSON.stringify(best) !== JSON.stringify(input),
    candidates,
    message: `Arranjo sugerido entre ${candidates} candidatos. Verifique os resultados: ancoragens, suporte e pendências externas permanecem com os dados informados.`,
  };
}
