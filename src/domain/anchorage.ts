/** Bond strength in MPa and basic anchorage length in mm. */
export function basicAnchorage({
  diameter,
  fyd,
  fctd,
  eta1,
  eta2,
}: {
  diameter: number;
  fyd: number;
  fctd: number;
  eta1: number;
  eta2: number;
}) {
  const eta3 = diameter < 32 ? 1 : (132 - diameter) / 100;
  const fbd = eta1 * eta2 * eta3 * fctd;
  const lb = Math.max((diameter * fyd) / (4 * fbd), 25 * diameter);
  return { eta3, fbd, lb };
}

/** Apply the floors to the length after the end and stress-ratio adjustments. */
export function requiredAnchorage(
  diameter: number,
  lb: number,
  adjustedLength: number,
) {
  return Math.max(adjustedLength, 0.3 * lb, 10 * diameter, 100);
}
import { materialProperties, materialSafety } from "./materialSafety";
import type { Piece } from "./model";
import { bondCoefficientEta1, steelClassOf } from "./steel";
import { tieLayerSpacing } from "./theory";

export const anchorageFamilies = [
  "N1",
  "N2",
  "N2I",
  "N3",
  "N3G",
  "N4",
  "P1",
] as const;
export type AnchorageFamily = (typeof anchorageFamilies)[number];

export const anchorageFields = [
  "diameter",
  "eta2",
  "fbd",
  "lb",
  "alpha",
  "ratio",
  "required",
  "available",
  "nominal",
  "axis",
  "adopted",
  "front",
  "tail",
  "tailMinimum",
  "tailAvailable",
  "width",
  "height",
  "mandrel",
  "developed",
] as const;
type AnchorageField = (typeof anchorageFields)[number];
export type AnchorageValues = Partial<Record<AnchorageField, number>>;
export const anchorageLabels: Record<AnchorageField, [string, string]> = {
  diameter: ["Bitola", "mm"],
  eta2: ["η2 de aderência", ""],
  fbd: ["fbd", "MPa"],
  lb: ["lb básico", "mm"],
  alpha: ["α", ""],
  ratio: ["Razão As,req/As,ef adotada", ""],
  required: ["Mínimo necessário", "mm"],
  available: ["Disponível para a verificação", "mm"],
  nominal: ["Limite nominal P − c", "mm"],
  axis: ["Limite no eixo P − c − φ/2", "mm"],
  adopted: ["Trecho no suporte adotado no eixo", "mm"],
  front: ["Alcance ou percurso frontal", "mm"],
  tail: ["Ponta reta adotada", "mm"],
  tailMinimum: ["Ponta reta mínima", "mm"],
  tailAvailable: ["Espaço para a ponta reta", "mm"],
  width: ["Largura entre eixos", "mm"],
  height: ["Altura entre eixos", "mm"],
  mandrel: ["Diâmetro de mandril", "mm"],
  developed: ["Percurso desenvolvido no suporte", "mm"],
};
export const anchorageKey = (family: AnchorageFamily, field: AnchorageField) =>
  `anchor${family}_${field}`;

export function anchorageRows(values: Record<string, number>) {
  return anchorageFamilies.flatMap((family) => {
    const data: AnchorageValues = {};
    for (const field of anchorageFields) {
      const value = values[anchorageKey(family, field)];
      if (Number.isFinite(value)) data[field] = value;
    }
    return Object.keys(data).length ? [{ family, ...data }] : [];
  });
}

export function supportLimits(p: Piece, diameter: number) {
  const nominal = p.geometry.columnWidth - p.geometry.cover;
  return { nominal, axis: Math.max(0, nominal - diameter / 2) };
}

/** The manual projection sets the axis in the outermost layer. In automatic
 * mode the innermost occupied layer sets the minimum required reach. */
export function supportHookGeometry(
  p: Piece,
  rows: readonly { count: number; y: number }[],
  radius: number,
  required: number,
) {
  const { geometry: g, rebar: r, design: q, detailing: s } = p;
  const diameter = r.tieDiameter;
  const limits = supportLimits(p, diameter);
  const declared = Math.min(q.supportAnchorLength, limits.nominal);
  const pitch = diameter + tieLayerSpacing(p);
  const occupied = rows
    .map((row, layer) => ({ ...row, layer }))
    .filter(({ count }) => count > 0);
  const lastOffset = (occupied.at(-1)?.layer ?? 0) * pitch;
  const wanted = Math.max(radius, required - diameter / 2) + lastOffset;
  const firstProjection =
    s.supportHookProjection ||
    Math.max(0, Math.min(wanted, declared - diameter / 2));
  const tailMinimum = 8 * diameter;
  const tail = s.supportHookTail || tailMinimum;
  const layers = occupied.map(({ layer, y }) => {
    const projection = firstProjection - layer * pitch;
    const outerProjection = projection + diameter / 2;
    // Only the part of the bend beyond the face contributes to support length.
    const developed =
      projection > 0
        ? Math.max(0, projection - radius) +
          radius * Math.acos(Math.max(0, 1 - projection / radius)) +
          tail
        : 0;
    return {
      layer,
      projection,
      outerProjection,
      available: Math.max(0, Math.min(declared, outerProjection)),
      tailAvailable: Math.max(0, g.height - g.cover - y - radius),
      developed,
    };
  });
  return {
    ...limits,
    declared,
    tail,
    tailMinimum,
    layers,
  };
}

/** N4 has only the constructive anchorage minima and retains its own steel. */
export function constructiveAnchorage(p: Piece) {
  const { materials: m, design: q } = p;
  const { gammaC, gammaS } = materialSafety(q);
  const properties = materialProperties(
    m.fck,
    m.fyk,
    m.fykTransverse,
    gammaC,
    gammaS,
  );
  const diameter = p.rebar.constructiveDiameter ?? 8;
  const eta2 = q.bond === "poor" ? 0.7 : 1;
  const steel = steelClassOf(m.fykTransverse);
  const { fbd, lb } = basicAnchorage({
    diameter,
    fyd: properties.fywd,
    fctd: properties.fctd,
    eta1: steel ? bondCoefficientEta1(steel) : 1,
    eta2,
  });
  const required = requiredAnchorage(diameter, lb, 0);
  const limits = supportLimits(p, diameter);
  return {
    diameter,
    eta2,
    fbd,
    lb,
    alpha: 1,
    ratio: 0,
    required,
    ...limits,
    adopted: Math.min(limits.axis, required),
  };
}
