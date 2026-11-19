// Reference pairs supplied by issue #2; production never changes adopted factors.
export const materialSafetyReferences = {
  precast: { label: "Pré-moldado", gammaC: 1.4, gammaS: 1.15 },
  factory: {
    label: "Pré-fabricado (controle de fábrica)",
    gammaC: 1.3,
    gammaS: 1.1,
  },
  cast: { label: "Moldado no local", gammaC: 1.4, gammaS: 1.15 },
} as const;
export type Production = keyof typeof materialSafetyReferences;
export const coefficientText = (value: number) =>
  value.toLocaleString("pt-BR", {
    useGrouping: false,
    maximumFractionDigits: 8,
  });
export function materialSafety(design: {
  production: Production;
  gammaC?: number;
  gammaS?: number;
}) {
  const gammaC = design.gammaC ?? 1.4;
  const gammaS = design.gammaS ?? 1.15;
  const reference = materialSafetyReferences[design.production];
  const below = [
    ...(gammaC < reference.gammaC
      ? [{ symbol: "γc", adopted: gammaC, reference: reference.gammaC }]
      : []),
    ...(gammaS < reference.gammaS
      ? [{ symbol: "γs", adopted: gammaS, reference: reference.gammaS }]
      : []),
  ];
  return { gammaC, gammaS, reference, below };
}
export const materialSafetyReference =
  "NBR 9062:2017 §8.1; NBR 6118:2026 (referências informadas no repositório)";

export function materialProperties(
  fck: number,
  fyk: number,
  fykTransverse = 500,
  gammaC = 1.4,
  gammaS = 1.15,
) {
  const fcd = fck / gammaC,
    fyd = Math.min(fyk / gammaS, 435);
  const fctm =
    fck <= 50 ? 0.3 * fck ** (2 / 3) : 2.12 * Math.log(1 + 0.1 * (fck + 8));
  const alphaV2 = 1 - fck / 250;
  return {
    fcd,
    fyd,
    fydLimited: Math.min(fyd, 435),
    fywd: Math.min(fykTransverse / gammaS, 435),
    fctm,
    fctd: (0.7 * fctm) / gammaC,
    fctkSup: 1.3 * fctm,
    alphaV2,
    etaC: fck <= 40 ? 1 : (40 / fck) ** (1 / 3),
    lambda: fck <= 50 ? 0.8 : 0.8 - (fck - 50) / 400,
    alphaC: fck <= 50 ? 0.85 : 0.85 * (1 - (fck - 50) / 200),
    fcd1: 0.85 * alphaV2 * fcd,
    fcd2: 0.6 * alphaV2 * fcd,
    fcd3: 0.72 * alphaV2 * fcd,
  };
}
