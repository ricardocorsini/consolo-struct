/** Additional corbel checks from issue #4. mm, N, MPa; no intermediate rounding.
 * References are those cited in GN Corbel, not independently verified ABNT text. */
export const ductilityReferences = {
  ductilityXd:
    "NBR 6118:2023 §17.2.3 (citada no GN Corbel; conferência pendente)",
  maxSteel:
    "NBR 6118:2023 §17.3.5.2.4 (citada no GN Corbel; conferência pendente)",
  plasticRotation:
    "NBR 6118:2023 §22.3; NBR 9062:2017 §5.1.2.9 (citadas no GN Corbel; conferência pendente)",
} as const;
export const ductilityCheckIds = [
  "ductilityXd",
  "maxSteel",
  "plasticRotation",
] as const;
export function corbelDuctility({
  b,
  h,
  d,
  dPrime,
  a,
  vertical,
  horizontal,
  asTie,
  fck,
  fcd,
  fyd,
  lambda,
  alphaV2,
}: {
  b: number;
  h: number;
  d: number;
  dPrime: number;
  a: number;
  vertical: number;
  horizontal: number;
  asTie: number;
  fck: number;
  fcd: number;
  fyd: number;
  lambda: number;
  alphaV2: number;
}): Record<string, number> {
  const x = (asTie * fyd) / (lambda * b * fcd);
  const limit = fck <= 50 ? 0.45 : 0.35;
  const fcdCCC = 0.85 * alphaV2 * fcd;
  const a1 = vertical / (b * fcdCCC);
  const aexc = a1 / 2 + a + (horizontal / vertical) * dPrime;
  const radicand = d ** 2 - 2 * a1 * aexc;
  const plasticX = radicand >= 0 ? d - Math.sqrt(radicand) : undefined;
  return {
    ductility_x: x,
    ductility_xd: x / d,
    ductility_limit: limit,
    maxSteel: 0.04 * b * h,
    plastic_fcdCCC: fcdCCC,
    plastic_a1: a1,
    plastic_aexc: aexc,
    plastic_radicand: radicand,
    ...(plasticX === undefined
      ? {}
      : { plastic_x: plasticX, plastic_ratio: plasticX / (lambda * d) }),
  };
}
export const isUnsolvedPlasticRotation = (c: {
  id: string;
  status: string;
  demand: number | null;
}) => c.id === "plasticRotation" && c.status === "fail" && c.demand === null;

/** Shared rows of the per-combination memory; the two missing root results mean no solution. */
export function ductilityRows(
  v: Record<string, number>,
): { label: string; value: number | undefined; unit: string }[] {
  if (v.ductility_limit === undefined) return [];
  return [
    { label: "λ do concreto", value: v.lambda, unit: "" },
    { label: "fyd da seção (fyk/γs)", value: v.fyd, unit: "MPa" },
    { label: "x da seção", value: v.ductility_x, unit: "mm" },
    { label: "x/d da seção", value: v.ductility_xd, unit: "" },
    { label: "Limite de ductilidade", value: v.ductility_limit, unit: "" },
    { label: "As máxima (4% b h)", value: v.maxSteel, unit: "mm²" },
    {
      label: "fcdCCC da rotação plástica",
      value: v.plastic_fcdCCC,
      unit: "MPa",
    },
    { label: "a1 da rotação plástica", value: v.plastic_a1, unit: "mm" },
    { label: "aexc da rotação plástica", value: v.plastic_aexc, unit: "mm" },
    {
      label: "Radicando da rotação plástica",
      value: v.plastic_radicand,
      unit: "mm²",
    },
    { label: "x da rotação plástica", value: v.plastic_x, unit: "mm" },
    { label: "x/(λd) da rotação plástica", value: v.plastic_ratio, unit: "" },
  ];
}
