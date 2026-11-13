import { z } from "zod";

// mm, N, MPa throughout. Physical data are explicit; reductions are never inferred.
const length = z.number().finite().min(0).max(10000);
const diameter = z.number().finite().min(5).max(25);
export const strutLimitSchema = z.enum([
  "fcd2",
  "fcd3",
  "indirect085",
  "direct100",
]);
export type StrutLimit = z.infer<typeof strutLimitSchema>;
export const excessConcreteSchema = z.enum(["keep", "remove"]);
export type ExcessConcrete = z.infer<typeof excessConcreteSchema>;
const materialFactor = (symbol: string, initial: number) => {
  const error = `${symbol} deve ser um número finito entre 1,0 e 2,0.`;
  return z
    .number({ error })
    .finite({ error })
    .min(1, { error })
    .max(2, { error })
    .default(initial);
};
export const designSchema = z.object({
  method: z.enum(["auto", "strut", "friction"]),
  strutLimit: strutLimitSchema.default("fcd2"),
  // Missing field keeps the original geometry of projects saved before this option.
  excessConcrete: excessConcreteSchema.default("keep"),
  // Missing fields preserve the policy of projects saved before 0.7.
  literatureRecommendations: z.boolean().default(false),
  reactionPosition: z
    .enum(["specified", "outerThird", "threeQuarter"])
    .default("specified"),
  production: z.enum(["factory", "precast", "cast"]),
  gammaC: materialFactor("γc", 1.4),
  gammaS: materialFactor("γs", 1.15),
  permanentPredominant: z.boolean(),
  gammaN: z.number().finite().min(1.2).max(3),
  gammaNPolicy: z.enum(["floor12", "table9062"]).default("floor12"),
  gammaNJustification: z.string().max(1000).default(""),
  forceMode: z.enum(["characteristic", "design"]),
  includeSelfWeight: z.boolean(),
  horizontalMode: z.enum(["estimated", "analysis"]),
  horizontalJustification: z.string().max(1000),
  supportType: z.enum([
    "dry",
    "mortar",
    "elastomer",
    "ptfe",
    "steel",
    "concreteSteel",
    "restrained",
  ]),
  loadType: z.enum(["direct", "indirect"]),
  joint: z.enum(["monolithic", "rough", "smooth"]),
  roughnessConfirmed: z.boolean(),
  bearingLength: length.refine((v) => v >= 10),
  bearingWidth: length.refine((v) => v >= 10),
  bearingHeight: length,
  transverseEccentricity: z.number().finite().min(-6000).max(6000),
  transverseForce: z.number().finite().min(-1e8).max(1e8),
  fatigue: z.boolean(),
  exposure: z.enum(["I", "II", "III", "IV"]),
  qualityCoverReduction: z.boolean(),
  aggregate: z.number().finite().min(4).max(50),
  tieLayers: z.number().int().min(1).max(4),
  extraTopCover: length,
  frontAnchor: z.enum(["loop", "welded"]),
  loopInternalDiameter: length,
  weldedBarDiameter: diameter,
  weldResistancePerBar: z.number().finite().min(0).max(1e7),
  weldSpecification: z.string().max(1000),
  supportAnchor: z.enum(["straight", "hook"]),
  supportAnchorLength: length,
  hookNormalCover: length,
  // Missing fields keep the behaviour of projects saved before these options.
  supportWeldedBar: z.boolean().default(false),
  anchorRatioFloor: z.boolean().default(false),
  bond: z.enum(["good", "poor"]),
  anchorConfinementArea: z.number().finite().min(0).max(100000),
  supportRebarArea: z.number().finite().min(0).max(100000),
  lowerStitchCount: z.number().int().min(0).max(100),
  splittingCount: z.number().int().min(0).max(100),
  splittingDiameter: diameter,
  suspensionCount: z.number().int().min(0).max(100),
  suspensionDiameter: diameter,
  fykTransverse: z.union([z.literal(500), z.literal(600)]),
  inputsConfirmed: z.boolean(),
  combinations: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        vertical: z.number().finite().min(0).max(1e8),
        horizontal: z.number().finite().min(-1e8).max(1e8),
        gamma: z.number().finite().min(1).max(2),
      }),
    )
    .max(20)
    .refine(
      (cs) =>
        new Set(["principal", ...cs.map((c) => c.name.trim().toLowerCase())])
          .size ===
        cs.length + 1,
      "Use nomes únicos nas combinações; Principal é reservado.",
    ),
});
export type DesignSettings = z.infer<typeof designSchema>;
export function defaultDesign(
  width = 300,
  length = 250,
  column = 300,
  cover = 25,
): DesignSettings {
  return {
    method: "auto",
    strutLimit: "fcd2",
    excessConcrete: "keep",
    literatureRecommendations: true,
    reactionPosition: "specified",
    production: "precast",
    gammaC: 1.4,
    gammaS: 1.15,
    permanentPredominant: true,
    gammaN: 1.2,
    gammaNPolicy: "floor12",
    gammaNJustification: "",
    forceMode: "characteristic",
    includeSelfWeight: false,
    horizontalMode: "estimated",
    horizontalJustification: "",
    supportType: "elastomer",
    loadType: "direct",
    joint: "monolithic",
    roughnessConfirmed: false,
    bearingLength: Math.min(100, length * 0.4),
    bearingWidth: Math.max(10, width - 2 * cover),
    bearingHeight: 10,
    transverseEccentricity: 0,
    transverseForce: 0,
    fatigue: false,
    exposure: "I",
    qualityCoverReduction: false,
    aggregate: 19,
    tieLayers: 1,
    extraTopCover: 0,
    frontAnchor: "loop",
    loopInternalDiameter: 160,
    weldedBarDiameter: 20,
    weldResistancePerBar: 0,
    weldSpecification: "",
    supportAnchor: "straight",
    supportAnchorLength: Math.max(10, column - cover),
    hookNormalCover: cover,
    supportWeldedBar: false,
    anchorRatioFloor: false,
    bond: "poor",
    anchorConfinementArea: 0,
    supportRebarArea: 0,
    lowerStitchCount: 2,
    splittingCount: 0,
    splittingDiameter: 6.3,
    suspensionCount: 0,
    suspensionDiameter: 10,
    fykTransverse: 500,
    inputsConfirmed: false,
    combinations: [],
  };
}
