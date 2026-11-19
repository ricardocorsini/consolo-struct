import type { Piece } from "../domain/model";
import { tieLayout } from "../domain/engine";
import { stirrupLayout } from "../domain/theory";
import type { Bar, BarFamily } from "./model";
import {
  cutPart,
  partPoints3,
  pathExtent,
  projectPart,
} from "./rebarPlacement";

/** One divergence between what is declared and what is placed or shown. */
export type ConsistencyProblem = {
  code: string;
  family: BarFamily;
  /** Where it was found: inputs vs. bars, the steel schedule or a view. */
  scope:
    | "entrada"
    | "relação do aço"
    | "elevação"
    | "planta"
    | "3D"
    | "corte A–A"
    | "corte B–B";
  declared: number;
  found: number;
  message: string;
};
type Source = {
  piece: Piece;
  bars: Bar[];
  arrangement: "consolo" | "beam";
};

const label: Record<BarFamily, [string, string]> = {
  tie: ["N1", "ramos do tirante"],
  stitch: ["N2", "costuras superiores"],
  lower: ["N2I", "costuras inferiores"],
  stirrup: ["N3", "estribos verticais"],
  stirrupInner: ["N3G", "estribos internos"],
  constructive: ["N4", "barras construtivas"],
  positive: ["P1", "barras da positiva"],
  welded: ["TS", "barras transversais soldadas"],
  pin: ["PINO", "pinos"],
};

/** Bars or legs announced by the inputs for each family (issue #64). */
export function declaredCounts(src: Source): Record<BarFamily, number> {
  const p = src.piece,
    r = p.rebar,
    q = p.design,
    s = p.detailing;
  const beam = src.arrangement === "beam";
  const branches = r.stirrupBranches ?? 2;
  const stirrups = stirrupLayout(p).positions.length;
  return {
    tie: tieLayout(p).rows.reduce((n, row) => n + row.count, 0),
    stitch: r.stitchCount,
    lower: q.lowerStitchCount,
    stirrup: stirrups,
    stirrupInner: branches === 4 ? stirrups : 0,
    constructive: branches,
    positive: beam ? s.beamBottomCount : 0,
    welded:
      !beam && q.frontAnchor === "welded"
        ? tieLayout(p).rows.filter((row) => row.count > 0).length
        : 0,
    pin: s.pins,
  };
}

/** Units of a bar in the declared sense: a horizontal loop carries two legs. */
const unitsOf = (src: Source, bar: Bar) =>
  bar.family === "tie" &&
  src.arrangement !== "beam" &&
  src.piece.design.frontAnchor === "loop"
    ? 2
    : 1;

/** Automatic parity audit of the single reinforcement source (issue #64).
 *
 * For every family it compares the declared count, the physical bars placed
 * in the model, the steel schedule (sum of `quantity`) and every view:
 * each placed bar must project onto the elevation, the plan and the 3D scene,
 * and appear in sections A–A (first stirrup) and B–B (load axis) exactly
 * when its 3D path reaches the plane of the cut. */
export function validateRebarConsistency(src: Source): ConsistencyProblem[] {
  const problems: ConsistencyProblem[] = [];
  const declared = declaredCounts(src);
  const families = Object.keys(declared) as BarFamily[];
  const push = (
    family: BarFamily,
    scope: ConsistencyProblem["scope"],
    expected: number,
    found: number,
    detail: string,
  ) => {
    const [mark, name] = label[family];
    problems.push({
      code: `parity-${family}-${scope}`,
      family,
      scope,
      declared: expected,
      found,
      message: `${mark}: ${detail} (${scope}: ${expected} ${name} esperados, ${found} encontrados). Corrigir antes da emissão; a quantidade indicada e a desenhada não podem divergir.`,
    });
  };
  const g = src.piece.geometry;
  const stations: [ConsistencyProblem["scope"], number][] = [
    ["corte A–A", stirrupLayout(src.piece).positions[0]],
    ["corte B–B", g.loadOffset],
  ];
  for (const family of families) {
    const bars = src.bars.filter((bar) => bar.family === family);
    const placed = bars.reduce(
      (n, bar) => n + bar.instances.length * unitsOf(src, bar),
      0,
    );
    const scheduled = bars.reduce(
      (n, bar) => n + bar.quantity * unitsOf(src, bar),
      0,
    );
    if (placed !== declared[family])
      push(
        family,
        "entrada",
        declared[family],
        placed,
        "a quantidade declarada não corresponde às barras detalhadas",
      );
    if (scheduled !== placed)
      push(
        family,
        "relação do aço",
        placed,
        scheduled,
        "a relação do aço não corresponde às barras detalhadas",
      );
    const views: Record<"elevação" | "planta" | "3D", number> = {
      elevação: 0,
      planta: 0,
      "3D": 0,
    };
    const cuts = stations.map(() => ({ expected: 0, found: 0 }));
    for (const bar of bars)
      for (const instance of bar.instances) {
        const units = unitsOf(src, bar);
        const parts = instance.parts;
        if (
          parts.length &&
          parts.every((part) => projectPart(part, "elevation"))
        )
          views.elevação += units;
        if (parts.length && parts.every((part) => projectPart(part, "plan")))
          views.planta += units;
        if (
          parts.length &&
          parts.every((part) => partPoints3(part).length >= 2)
        )
          views["3D"] += units;
        stations.forEach(([, x], i) => {
          // Reference: the exact extent of each part along the axis.
          const reaches = parts.some((part) => {
            if (part.plane === "yz") return Math.abs(part.at - x) < 1e-6;
            const [min, max] = pathExtent(part.path, "x");
            return min <= x + 1e-9 && max >= x - 1e-9;
          });
          const shown = parts.some((part) => {
            const cut = cutPart(part, x);
            return cut.points.length || cut.lines.length || cut.inPlane;
          });
          if (reaches) cuts[i].expected++;
          if (shown) cuts[i].found++;
        });
      }
    for (const view of ["elevação", "planta", "3D"] as const)
      if (views[view] !== placed)
        push(
          family,
          view,
          placed,
          views[view],
          "nem todas as barras detalhadas aparecem na vista",
        );
    stations.forEach(([scope], i) => {
      if (cuts[i].found !== cuts[i].expected)
        push(
          family,
          scope,
          cuts[i].expected,
          cuts[i].found,
          "o corte não mostra exatamente as barras que atravessam o plano",
        );
    });
  }
  return problems;
}

/** Bars or legs actually detailed for each family (loops count two legs). */
export function placedCounts(src: Source): Record<BarFamily, number> {
  const counts = Object.fromEntries(
    Object.keys(label).map((family) => [family, 0]),
  ) as Record<BarFamily, number>;
  for (const bar of src.bars)
    counts[bar.family] += bar.instances.length * unitsOf(src, bar);
  return counts;
}

/** Text of a detailed count; a divergent input is stated, never hidden (#64). */
export const countText = (detailed: number, declared: number) =>
  detailed === declared
    ? `${detailed}`
    : `${detailed} detalhado(s) de ${declared} declarado(s) - CORRIGIR`;
