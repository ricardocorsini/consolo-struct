import { z } from "zod";
import { defaultDesign, designSchema } from "./design";
import { defaultDetailing, detailingSchema } from "../detailing/settings";

// Canonical model: millimetres, newtons, MPa (N/mm²). Conversion only at the UI boundary.
const mm = z.number().finite().min(5).max(6000);
export const geometrySchema = z.object({
  width: mm,
  height: mm,
  tipHeight: mm,
  length: mm,
  loadOffset: mm,
  cover: z.number().min(10).max(100),
  columnWidth: mm,
});
export const rebarSchema = z.object({
  tieCount: z.number().int().min(2).max(40),
  tieDiameter: z.number().min(6.3).max(40),
  stitchCount: z.number().int().min(1).max(100),
  stitchDiameter: z.number().min(5).max(25),
  stirrupCount: z.number().int().min(1).max(100),
  stirrupDiameter: z.number().min(5).max(25),
  stirrupBranches: z.union([z.literal(2), z.literal(4)]).default(2),
  constructiveDiameter: z.number().finite().min(5).max(25).default(8),
});
export const pieceSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  description: z.string().max(160),
  quantity: z.number().int().min(1).max(10000),
  geometry: geometrySchema,
  loads: z.object({
    vertical: z.number().min(0).max(1e8),
    horizontal: z.number().min(-1e8).max(1e8),
    gamma: z.number().min(1).max(2),
  }),
  materials: z.object({
    fck: z.number().min(20).max(90),
    // Preserve numeric legacy tie values; the engine checks class eligibility.
    fyk: z.number().min(250).max(600),
    fykTransverse: z.union([z.literal(250), z.literal(500), z.literal(600)]),
  }),
  rebar: rebarSchema,
  design: designSchema,
  detailing: detailingSchema,
});
export const projectSchema = z.object({
  format: z.literal("lumeconsolo"),
  schemaVersion: z.literal(6),
  name: z.string().min(1).max(120),
  client: z.string().max(120),
  author: z.string().max(120),
  pieces: z
    .array(pieceSchema)
    .min(1)
    .max(200)
    .refine(
      (ps) => new Set(ps.map((p) => p.id)).size === ps.length,
      "Identificadores de peças repetidos",
    ),
});
export type Geometry = z.infer<typeof geometrySchema>;
export type Piece = z.infer<typeof pieceSchema>;
export type Project = z.infer<typeof projectSchema>;
export type InspectorTab =
  | "geometry"
  | "loads"
  | "materials"
  | "rebar"
  | "design";
export type GeometryKey = keyof Geometry;
const formatters = new Map<number, Intl.NumberFormat>();
export const number = (value: number, digits = 1) => {
  let formatter = formatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(digits, formatter);
  }
  return formatter.format(value);
};
export const area = (count: number, diameter: number) =>
  (count * Math.PI * diameter ** 2) / 4;
export const volume = (g: Geometry) =>
  (g.width * g.length * (g.height + g.tipHeight)) / 2 / 1e9;

export function geometryErrors(p: Piece): string[] {
  const g = p.geometry;
  const errors: string[] = [];
  if (g.tipHeight > g.height)
    errors.push(
      "A altura na ponta deve ser menor ou igual à altura junto ao pilar.",
    );
  if (g.loadOffset > g.length)
    errors.push(
      "A distância da carga deve estar dentro do comprimento do consolo.",
    );
  if (
    2 * g.cover + 2 * p.rebar.stirrupDiameter + p.rebar.tieDiameter >=
    Math.min(g.width, g.tipHeight)
  )
    errors.push(
      "Não há espaço geométrico para o cobrimento e os diâmetros informados.",
    );
  const freeWidth = g.width - 2 * (g.cover + p.rebar.stirrupDiameter);
  if (
    Math.ceil(p.rebar.tieCount / p.design.tieLayers) * p.rebar.tieDiameter >
    freeWidth
  )
    errors.push("As barras do tirante não cabem nas camadas informadas.");
  return errors;
}
export const fingerprint = (p: Piece) =>
  JSON.stringify([
    p.geometry,
    p.loads,
    p.materials,
    p.rebar,
    p.design,
    p.detailing?.supportHookProjection,
    p.detailing?.supportHookTail,
    p.detailing?.stitchEmbedment,
    p.detailing?.barArrangement,
    p.detailing?.beamBottomDiameter,
    p.detailing?.pins,
    p.detailing?.secondLoopDiameter,
  ]);
export function newPiece(index: number): Piece {
  const design = defaultDesign();
  return {
    id: crypto.randomUUID(),
    name: `C${String(index).padStart(2, "0")}`,
    description: "Consolo simples",
    quantity: 1,
    geometry: {
      width: 300,
      height: 400,
      tipHeight: 200,
      length: 250,
      loadOffset: 125,
      cover: 25,
      columnWidth: 300,
    },
    loads: { vertical: 350000, horizontal: 40000, gamma: 1.4 },
    materials: { fck: 30, fyk: 500, fykTransverse: 500 },
    design,
    detailing: defaultDetailing(),
    rebar: {
      tieCount: 4,
      tieDiameter: design.weldedBarDiameter,
      stitchCount: 6,
      stitchDiameter: 6.3,
      stirrupCount: 5,
      stirrupDiameter: 6.3,
      stirrupBranches: 2,
      constructiveDiameter: 8,
    },
  };
}
export function exampleProject(): Project {
  const first = newPiece(1);
  first.description = "Apoio principal";
  first.quantity = 8;
  const second = newPiece(2);
  second.description = "Apoio lateral";
  second.quantity = 4;
  second.geometry = {
    ...second.geometry,
    width: 250,
    height: 350,
    tipHeight: 180,
    length: 220,
    loadOffset: 110,
  };
  second.loads.vertical = 250000;
  second.rebar.tieDiameter = 16;
  second.design = defaultDesign(250, 220, 300, 25, second.rebar.tieDiameter);
  return {
    format: "lumeconsolo",
    schemaVersion: 6,
    name: "Pavilhão Horizonte",
    client: "Projeto de demonstração",
    author: "",
    pieces: [first, second],
  };
}

/** Follow N1 when TS had the same diameter. Keep a separate manual choice. */
export function withTieDiameter(p: Piece, tieDiameter: number): Piece {
  return {
    ...p,
    rebar: { ...p.rebar, tieDiameter },
    design:
      p.design.weldedBarDiameter === p.rebar.tieDiameter
        ? { ...p.design, weldedBarDiameter: tieDiameter }
        : p.design,
  };
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Capture the old material before schema 1 resets illustrative design data. */
function migrateSecondarySteel(data: unknown): unknown {
  if (
    !isRecord(data) ||
    ![1, 2, 3, 4, 5].includes(data.schemaVersion as number) ||
    !Array.isArray(data.pieces)
  )
    return data;
  return {
    ...data,
    pieces: data.pieces.map((p: unknown) => {
      if (!isRecord(p) || !isRecord(p.materials)) return p;
      const design = isRecord(p.design) ? p.design : undefined;
      const oldValue = design && Object.hasOwn(design, "fykTransverse");
      const newValue = Object.hasOwn(p.materials, "fykTransverse");
      if (
        oldValue &&
        newValue &&
        design.fykTransverse !== p.materials.fykTransverse
      )
        throw new Error(
          "Projeto inválido: os aços secundários em Cálculo e Materiais divergem. Confira os valores no arquivo antes de abrir; nenhuma classe foi escolhida automaticamente.",
        );
      return {
        ...p,
        materials: {
          ...p.materials,
          fykTransverse: oldValue
            ? design.fykTransverse
            : newValue
              ? p.materials.fykTransverse
              : 500,
        },
        ...(design
          ? {
              design: Object.fromEntries(
                Object.entries(design).filter(([k]) => k !== "fykTransverse"),
              ),
            }
          : {}),
      };
    }),
  };
}
export function decodeProject(text: string): Project {
  if (text.length > 2_000_000)
    throw new Error("O projeto excede o limite de 2 MB.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("O arquivo não contém um JSON válido.");
  }
  data = migrateSecondarySteel(data);
  // Version 1 carried illustrative bars only. New engineering data must be reviewed.
  if (
    data &&
    typeof data === "object" &&
    "schemaVersion" in data &&
    data.schemaVersion === 1 &&
    "pieces" in data &&
    Array.isArray(data.pieces)
  ) {
    data = {
      ...data,
      schemaVersion: 2,
      pieces: data.pieces.map((p: unknown) => {
        if (!p || typeof p !== "object" || !("geometry" in p)) return p;
        const g = geometrySchema.safeParse(p.geometry);
        if (!g.success) return p;
        return {
          ...p,
          design: {
            ...defaultDesign(
              g.data.width,
              g.data.length,
              g.data.columnWidth,
              g.data.cover,
            ),
            // Version 1 had no anchorage by default. Keep its historical reconstruction.
            frontAnchor: "loop",
            supportAnchor: "straight",
            // Preserve anchorage and special reinforcement if a v1 producer supplied them.
            ...("design" in p && p.design && typeof p.design === "object"
              ? Object.fromEntries(
                  Object.entries(p.design).filter(([key]) =>
                    [
                      "frontAnchor",
                      "loopInternalDiameter",
                      "weldedBarDiameter",
                      "weldResistancePerBar",
                      "weldSpecification",
                      "supportAnchor",
                      "supportAnchorLength",
                      "hookNormalCover",
                      "splittingCount",
                      "splittingDiameter",
                      "suspensionCount",
                      "suspensionDiameter",
                    ].includes(key),
                  ),
                )
              : {}),
          },
        };
      }),
    };
  }
  if (
    data &&
    typeof data === "object" &&
    "schemaVersion" in data &&
    data.schemaVersion === 2 &&
    "pieces" in data &&
    Array.isArray(data.pieces)
  ) {
    data = {
      ...data,
      schemaVersion: 3,
      pieces: data.pieces.map((p: unknown) =>
        p && typeof p === "object"
          ? { ...p, detailing: defaultDetailing() }
          : p,
      ),
    };
  }
  // Schema 4 prevents older applications from silently discarding the new calculation policy.
  if (
    data &&
    typeof data === "object" &&
    "schemaVersion" in data &&
    data.schemaVersion === 3
  ) {
    data = { ...data, schemaVersion: 4 };
  }
  // N4 is mandatory in schema 5; obsolete mounting choices cannot suppress it.
  if (
    data &&
    typeof data === "object" &&
    "schemaVersion" in data &&
    data.schemaVersion === 4 &&
    "pieces" in data &&
    Array.isArray(data.pieces)
  ) {
    data = {
      ...data,
      schemaVersion: 5,
      pieces: data.pieces.map((p: unknown) =>
        p &&
        typeof p === "object" &&
        "rebar" in p &&
        p.rebar &&
        typeof p.rebar === "object"
          ? {
              ...p,
              rebar: {
                ...p.rebar,
                stirrupBranches: 2,
                constructiveDiameter: 8,
              },
            }
          : p,
      ),
    };
  }
  // Schema 5 already belongs to N4; steel separation has a distinct schema 6.
  if (isRecord(data) && data.schemaVersion === 5)
    data = { ...data, schemaVersion: 6 };
  // Do not let Zod silently strip a misplaced material from a canonical file.
  if (
    isRecord(data) &&
    data.schemaVersion === 6 &&
    Array.isArray(data.pieces) &&
    data.pieces.some(
      (p) =>
        isRecord(p) &&
        isRecord(p.design) &&
        Object.hasOwn(p.design, "fykTransverse"),
    )
  )
    throw new Error(
      "Projeto inválido: no esquema 6 o aço secundário deve estar em materials.fykTransverse, sem duplicação em design.",
    );
  const parsed = projectSchema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "Projeto inválido ou versão não suportada. Use um arquivo .lume.json compatível (esquemas 1, 2, 3, 4, 5 ou 6).",
    );
  return parsed.data;
}
