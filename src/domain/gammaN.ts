import type { DesignSettings } from "./design";
import { coefficientText } from "./materialSafety";

export const gammaNPolicyLabels = {
  floor12: "Piso conservador de 1,2 (padrão)",
  table9062: "Tabela NBR 9062, sem piso de 1,2",
} as const;
export const gammaNReference = "NBR 9062:2017 §7.3.1.1; NBR 6118:2026 §22.2";
export type GammaNDecision = {
  requestedPolicy: DesignSettings["gammaNPolicy"];
  policy: DesignSettings["gammaNPolicy"];
  gammaN9062: number;
  gammaN: number;
  floor: number;
  justification: string;
};
/** Values copied unchanged from the existing engine; no normative reinterpretation. */
export function gammaNDecision(
  design: Pick<
    DesignSettings,
    "production" | "permanentPredominant" | "gammaN"
  > &
    Partial<Pick<DesignSettings, "gammaNPolicy" | "gammaNJustification">>,
): GammaNDecision {
  const requestedPolicy = design.gammaNPolicy ?? "floor12";
  const policy =
    requestedPolicy === "table9062" && design.production !== "cast"
      ? "table9062"
      : "floor12";
  const gammaN9062 =
    design.production === "factory"
      ? design.permanentPredominant
        ? 1
        : 1.1
      : design.production === "precast"
        ? design.permanentPredominant
          ? 1.1
          : 1.2
        : 1.2;
  return {
    requestedPolicy,
    policy,
    gammaN9062,
    gammaN:
      policy === "table9062"
        ? gammaN9062
        : Math.max(1.2, gammaN9062, design.gammaN),
    floor: 1.2,
    justification: design.gammaNJustification ?? "",
  };
}
export function gammaNDecisionText(decision: GammaNDecision) {
  const adopted = coefficientText(decision.gammaN),
    floor = coefficientText(decision.floor);
  return decision.policy === "table9062"
    ? `Política γn: ${gammaNPolicyLabels.table9062}. γn adotado ${adopted}; γn do piso ${floor}. Justificativa: ${decision.justification || "não informada"}. Decisão explícita do responsável técnico; não declara equivalência entre os textos da NBR 6118 e da NBR 9062.`
    : `Política γn: ${gammaNPolicyLabels.floor12}. γn adotado ${adopted}; γn da tabela ${coefficientText(decision.gammaN9062)}; piso ${floor}, respeitando também o mínimo informado.${decision.requestedPolicy === "table9062" ? " A tabela sem piso não se aplica a moldado no local; foi aplicada a política conservadora." : ""}`;
}
