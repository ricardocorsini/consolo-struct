import { number, type Geometry, type GeometryKey } from "./model";

export const dimensionMetadata = {
  width: { symbol: "b", label: "Largura" },
  height: { symbol: "H", label: "Altura no pilar" },
  tipHeight: { symbol: "H2", label: "Altura na ponta" },
  length: { symbol: "L", label: "Comprimento" },
  loadOffset: { symbol: "A", label: "Posição da carga" },
  columnWidth: { symbol: "P", label: "Dimensão do pilar" },
  cover: { symbol: "c", label: "Cobrimento" },
  heightDifference: { symbol: "H1", label: "Desnível vertical entre H e H2" },
  sectionHeight: { symbol: "H(x1)", label: "Altura do concreto na seção A–A" },
  bearingSectionHeight: {
    symbol: "H(B-B)",
    label: "Altura do concreto no corte B–B",
  },
  tieCentroid: { symbol: "d’", label: "topo ao centroide do tirante" },
};

type DimensionId = keyof typeof dimensionMetadata;
const heightDifferenceFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 8,
});
export function dimensionLabel(id: DimensionId, mm: number, withUnit = false) {
  const value =
    id === "heightDifference"
      ? heightDifferenceFormat.format(mm / 10)
      : number(mm / 10, 1);
  return `${dimensionMetadata[id].symbol} = ${value}${withUnit ? " cm" : ""}`;
}

export function dimensionFieldLabel(key: GeometryKey) {
  const { label, symbol } = dimensionMetadata[key];
  return `${label} ${symbol}`;
}

type ElevationPoint = { x: number; depth: number };
export type ElevationDimension = {
  id: Exclude<GeometryKey, "width" | "cover"> | "heightDifference";
  value: number;
  placement: "top" | "bottom" | "inner" | "outer";
  from: ElevationPoint;
  to: ElevationPoint;
};

/** Witness origins on the longitudinal profile, in mm. Each view adds its drawing offsets. */
export function elevationDimensions(g: Geometry): ElevationDimension[] {
  const root = { x: 0, depth: 0 };
  const tip = { x: g.length, depth: 0 };
  const rootBottom = { x: 0, depth: g.height };
  const tipBottom = { x: g.length, depth: g.tipHeight };
  const dimensions: ElevationDimension[] = [
    {
      id: "columnWidth",
      value: g.columnWidth,
      placement: "top",
      from: { x: -g.columnWidth, depth: 0 },
      to: root,
    },
    {
      id: "loadOffset",
      value: g.loadOffset,
      placement: "top",
      from: root,
      to: { x: g.loadOffset, depth: 0 },
    },
    {
      id: "length",
      value: g.length,
      placement: "bottom",
      from: rootBottom,
      to: tipBottom,
    },
    {
      id: "tipHeight",
      value: g.tipHeight,
      placement: "inner",
      from: tip,
      to: tipBottom,
    },
    {
      id: "heightDifference",
      value: g.height - g.tipHeight,
      placement: "inner",
      from: tipBottom,
      to: rootBottom,
    },
    {
      id: "height",
      value: g.height,
      placement: "outer",
      from: tip,
      to: rootBottom,
    },
  ];
  return dimensions.filter(
    ({ id, value }) => id !== "heightDifference" || value > 0,
  );
}
