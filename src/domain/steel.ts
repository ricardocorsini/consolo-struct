export const steelClasses = ["CA-25", "CA-50", "CA-60"] as const;
export const tieSteelClasses = ["CA-25", "CA-50"] as const;
export const secondarySteelClasses = steelClasses;
export type SteelClass = (typeof steelClasses)[number];

const properties = {
  "CA-25": { fyk: 250, eta1: 1, smallPin: 4, largePin: 5 },
  "CA-50": { fyk: 500, eta1: 2.25, smallPin: 5, largePin: 8 },
  // Pendente de confirmação pelo responsável técnico quanto à superfície do
  // fio/barra. A issue #3 exige preservar o valor conservador existente, 1,0.
  "CA-60": { fyk: 600, eta1: 1, smallPin: 6, largePin: 6 },
} as const;

const classesByFyk = new Map<number, SteelClass>(
  steelClasses.map((steel) => [properties[steel].fyk, steel]),
);
export const steelClassOf = (fyk: number): SteelClass | undefined =>
  classesByFyk.get(fyk);
/** CA-60 metadata remains available for secondary steel and legacy previews. */
export function tieSteelClassOf(fyk: number) {
  const steel = steelClassOf(fyk);
  return steel === "CA-25" || steel === "CA-50" ? steel : undefined;
}
export const fykOf = (steel: SteelClass) => properties[steel].fyk;
export const bondCoefficientEta1 = (steel: SteelClass) =>
  properties[steel].eta1;
export const bondCoefficientPending = (steel: SteelClass) => steel === "CA-60";
export const requiresSupportHook = (steel: SteelClass | undefined) =>
  steel === "CA-25";
export const loopPinDefined = (
  steel: SteelClass | undefined,
  diameter: number,
) => steel !== "CA-60" || diameter < 20;
export const stirrupMandrelDefined = (
  steel: SteelClass | undefined,
  diameter: number,
) => steel !== "CA-60" || diameter <= 10;
export const loopPinFactor = (steel: SteelClass, diameter: number) =>
  diameter < 20 ? properties[steel].smallPin : properties[steel].largePin;

/** Numeric storage stays unchanged; an unknown value is never a steel class. */
export function steelLabel(fyk: number) {
  return (
    steelClassOf(fyk) ??
    `Personalizado (${fyk.toLocaleString("pt-BR", { useGrouping: false, maximumFractionDigits: 8 })} MPa), não suportado`
  );
}
export const steelOptionLabel = (steel: SteelClass) =>
  `${steel} · ${fykOf(steel)} MPa`;

export function steelBondDescription(fyk: number) {
  const steel = steelClassOf(fyk);
  if (!steel) return steelLabel(fyk);
  const eta1 = bondCoefficientEta1(steel).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
  return `Aderência do tirante ${steel}: η1 = ${eta1}${bondCoefficientPending(steel) ? " · pendente de confirmação pelo responsável técnico quanto à superfície do fio/barra" : ""}.`;
}

/** Preserve the old geometric preview for numeric legacy values as well.
 * This fallback does not assign a class or make an unsupported steel calculable.
 * Known classes share the engine's pin factors; no bending formula changes. */
export function geometricPinFactor(fyk: number, diameter: number) {
  const steel = steelClassOf(fyk);
  if (steel) return loopPinFactor(steel, diameter);
  return fyk <= 250
    ? diameter < 20
      ? 4
      : 5
    : fyk <= 500
      ? diameter < 20
        ? 5
        : 8
      : 6;
}
