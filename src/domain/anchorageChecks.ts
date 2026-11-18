import {
  anchorageFamilies,
  anchorageFields,
  anchorageKey,
  supportHookGeometry,
  supportLimits,
  type AnchorageFamily,
  type AnchorageValues,
} from "./anchorage";
import type { CaseResult, tieLayout } from "./engine";
import { number, type Piece } from "./model";
import type { ConcreteProfile } from "./profile";
import {
  loopPinDefined,
  requiresSupportHook,
  steelClassOf,
  stirrupMandrelDefined,
} from "./steel";
import { upperStitchLayout } from "./theory";
import { check, note } from "./verification";
import { beamArrangementActive, beamLayout } from "../detailing/beam";
import {
  mandrelDiameter,
  pathLengthAfterX,
  stirrupClosure,
} from "../detailing/geometry";
import {
  lowerStitchLayout,
  stitchAnchorage,
  stitchFront,
  stitchWidth,
} from "../detailing/stitches";
import {
  constructiveGeometry,
  transverseGeometry,
} from "../detailing/transverse";

const reference = "NBR 6118 §9.3 e §9.4 conforme issue #65";
const bondFormula = "lb,nec = max(α·lb·razão, 0,3lb, 10φ, 100 mm)";
const closureFormula = "b e h entre eixos ≥ 2R + max(5φ, 50 mm)/√2";
const mm = (x: number) => `${number(x, 2)} mm`;
const smallest = (values: number[]) =>
  values.length ? Math.min(...values) : 0;

export function prepareAnchorageGeometry(
  p: Piece,
  layout: ReturnType<typeof tieLayout>,
  concrete: ConcreteProfile,
) {
  const upper = upperStitchLayout(p, layout);
  const lower = lowerStitchLayout(p, layout, concrete);
  const transverse = transverseGeometry(p, undefined, undefined, {
    concrete,
    checkInterferences: false,
  });
  return {
    tieRows: layout.rows,
    concrete,
    upper: upper.end >= upper.start ? upper.levels : [],
    lower: lower.levels,
    transverse,
    constructive: constructiveGeometry(p, transverse, concrete),
  };
}

/** Add family checks to the same combination as the area demands. */
export function addAnchorageChecks(
  p: Piece,
  geometry: ReturnType<typeof prepareAnchorageGeometry>,
  result: CaseResult,
) {
  const { geometry: g, rebar: r, design: q } = p;
  const { checks, values: v } = result;
  const write = (family: AnchorageFamily, values: AnchorageValues) => {
    for (const field of anchorageFields) {
      const value = values[field];
      if (value !== undefined && Number.isFinite(value))
        v[anchorageKey(family, field)] = value;
    }
  };
  const compare = (
    id: string,
    label: string,
    demand: number,
    capacity: number,
    formula: string,
    detail = "",
  ) =>
    checks.push(
      check(id, label, demand, capacity, "mm", formula, reference, detail),
    );
  const replaceTieCheck = (
    demand: number,
    capacity: number,
    detail: string,
  ) => {
    const index = checks.findIndex(({ id }) => id === "anchorage");
    if (index >= 0)
      checks[index] = check(
        "anchorage",
        "Ancoragem do tirante N1",
        demand,
        capacity,
        "mm",
        bondFormula,
        reference,
        detail,
      );
  };
  const eta2N1 = q.bond === "good" ? 1 : 0.7;
  const tieData = {
    diameter: r.tieDiameter,
    eta2: eta2N1,
    fbd: v.fbd,
    lb: v.lb,
    alpha: v.anchorAlpha,
    ratio: v.anchorRatio,
    required: v.anchorRequired,
  };
  const secondary = steelClassOf(p.materials.fykTransverse);
  const tieSteel = steelClassOf(p.materials.fyk);
  const limits = supportLimits(p, r.tieDiameter);
  if (beamArrangementActive(p)) {
    const beam = beamLayout(p, v);
    const support = smallest(beam.top.map((bar) => bar.back.developed));
    const front = smallest(beam.top.map((bar) => bar.front.developed));
    const tail = smallest(
      beam.top.flatMap((bar) => [bar.back.leg, bar.front.leg]),
    );
    const valid = beam.top.every((bar) => bar.path.valid);
    write("N1", {
      ...tieData,
      alpha: g.cover + r.stirrupDiameter >= 3 * r.tieDiameter ? 0.7 : 1,
      required: Number.isFinite(v.anchorRequired) ? beam.lbNecTop : undefined,
      available: Math.min(support, front),
      developed: support,
      front,
      tail,
      tailMinimum: 8 * r.tieDiameter,
      mandrel: beam.top[0]?.mandrel,
    });
    if (Number.isFinite(v.anchorRequired))
      replaceTieCheck(
        beam.lbNecTop,
        valid ? Math.min(support, front) : 0,
        `N1 dobrado no suporte e na ponta. Trechos desenvolvidos de ${mm(support)} e ${mm(front)}.`,
      );
    compare(
      "anchorN1BeamTail",
      "N1 · ponta reta das dobras",
      8 * r.tieDiameter,
      valid ? tail : 0,
      "ponta ≥ 8φ",
    );
    const p1 = beam.bottom;
    const p1Min = Math.min(p1.back.developed, p1.front.developed);
    const p1Tail = Math.min(p1.back.leg, p1.front.leg);
    write("P1", {
      ...beam.bottomBond,
      diameter: p1.diameter,
      ratio: 1,
      required: beam.lbNecBottom,
      available: p1Min,
      developed: p1.back.developed,
      front: p1.front.developed,
      tail: p1Tail,
      tailMinimum: 8 * p1.diameter,
      tailAvailable: Math.min(p1.back.legMax, p1.front.legMax),
      mandrel: p1.mandrel,
    });
    compare(
      "anchorP1",
      "P1 · ancoragem no suporte e na ponta",
      beam.lbNecBottom,
      p1.path.valid ? p1Min : 0,
      bondFormula,
      `Suporte ${mm(p1.back.developed)} · ponta ${mm(p1.front.developed)}.`,
    );
    compare(
      "anchorP1Tail",
      "P1 · ponta reta das dobras",
      8 * p1.diameter,
      p1.path.valid ? p1Tail : 0,
      "ponta ≥ 8φ",
    );
  } else if (q.supportAnchor === "hook") {
    const mandrel = mandrelDiameter(r.tieDiameter, p.materials.fyk);
    const radius = (mandrel + r.tieDiameter) / 2;
    const hook = supportHookGeometry(
      p,
      geometry.tieRows,
      radius,
      Number.isFinite(v.anchorRequired) ? v.anchorRequired : 0,
    );
    // Projections and height decrease with each layer. Rear cover is
    // controlled by the first layer, and the other limits by the last.
    const outermost = hook.layers[0]!;
    const innermost = hook.layers.at(-1)!;
    const byLayer = hook.layers
      .map(
        ({ layer, projection, available, developed }) =>
          `Camada ${layer + 1} · eixo a ${mm(projection)} · disponível ${mm(available)} · percurso no suporte ${mm(developed)}.`,
      )
      .join(" ");
    write("N1", {
      ...tieData,
      ...hook,
      ...innermost,
      adopted: innermost.projection,
      mandrel,
    });
    if (Number.isFinite(v.anchorRequired))
      replaceTieCheck(
        v.anchorRequired,
        innermost.available,
        `Projeção até o exterior da dobra, limitada pelo suporte e pelo comprimento informado. ${byLayer}`,
      );
    compare(
      "anchorN1HookBend",
      "N1 · espaço horizontal da dobra",
      radius + r.tieDiameter / 2,
      innermost.available,
      "projeção exterior ≥ R + φ/2",
      `Menor projeção disponível na camada ${innermost.layer + 1}.`,
    );
    compare(
      "anchorN1HookCover",
      "N1 · cobrimento posterior do gancho",
      outermost.outerProjection,
      hook.declared,
      "projeção exterior ≤ min(lb declarado, P − c)",
      `Maior projeção exterior na camada ${outermost.layer + 1}.`,
    );
    compare(
      "anchorN1HookTail",
      "N1 · ponta reta mínima",
      hook.tailMinimum,
      hook.tail,
      "ponta ≥ 8φ",
    );
    compare(
      "anchorN1HookHeight",
      "N1 · altura disponível para a ponta",
      hook.tail,
      innermost.tailAvailable,
      "ponta ≤ h − c − profundidade do eixo de N1 − R",
      `Menor altura disponível na camada ${innermost.layer + 1}.`,
    );
  } else {
    write("N1", {
      ...tieData,
      nominal: limits.nominal,
      available: Math.min(q.supportAnchorLength, limits.nominal),
      adopted: q.supportAnchorLength,
    });
  }
  if (
    tieSteel &&
    requiresSupportHook(tieSteel) &&
    (q.supportAnchor === "hook" || beamArrangementActive(p))
  )
    checks.push(
      note(
        "anchorN1Smooth",
        "N1 · gancho de barra lisa",
        "O percurso representado tem dobra de 90°. A forma de fabricação de barra lisa exige verificação específica.",
        reference,
      ),
    );

  for (const [family, levels, needed, provided] of [
    ["N2", geometry.upper, v.stitchRequired, v.stitchProvided],
    ["N2I", geometry.lower, v.lowerRequired, v.lowerProvided],
  ] as const) {
    if (family === "N2I" && q.lowerStitchCount === 0) continue;
    const determined = Number.isFinite(needed);
    const anchor = stitchAnchorage(
      p,
      family,
      levels,
      determined ? needed : 0,
      provided,
      { fctd: v.fctd, fywd: v.fywd },
    );
    const front = smallest(
      levels.map((depth) => stitchFront(p, geometry.concrete, depth)),
    );
    const width = stitchWidth(p);
    const mandrel = mandrelDiameter(
      anchor.diameter,
      p.materials.fykTransverse,
      true,
    );
    const closure = stirrupClosure(anchor.diameter, mandrel);
    write(family, {
      ...anchor,
      required: determined ? anchor.required : undefined,
      ratio: determined ? anchor.ratio : undefined,
      available: anchor.axis,
      front,
      width,
      tail: closure.tail,
      mandrel,
    });
    if (determined)
      compare(
        `anchor${family}`,
        `${family} · ancoragem no suporte`,
        anchor.required,
        anchor.axis,
        bondFormula,
        `P − c = ${mm(anchor.nominal)} · limite no eixo P − c − φ/2 = ${mm(anchor.axis)} · penetração adotada ${mm(anchor.adopted)}.`,
      );
    compare(
      `anchor${family}Front`,
      `${family} · alcance frontal com cobrimento`,
      g.cover + anchor.diameter / 2,
      front,
      "alcance ao longo do eixo ≥ c + φ/2",
      "Verifica a estação de menor alcance abaixo da face inclinada.",
    );
    compare(
      `anchor${family}Closure`,
      `${family} · fechamento e mandril`,
      closure.minimum,
      levels.length && stirrupMandrelDefined(secondary, anchor.diameter)
        ? Math.min(width, front + anchor.adopted)
        : 0,
      closureFormula,
    );
  }

  const { transverse: t } = geometry;
  const closure = stirrupClosure(r.stirrupDiameter, t.mandrel);
  for (const family of ["N3", "N3G"] as const) {
    if (family === "N3G" && t.branches !== 4) continue;
    const sections = t.sections.filter(
      (s) => s.internal === (family === "N3G"),
    );
    const width = smallest(sections.map((s) => s.width));
    const height = smallest(sections.map((s) => s.height));
    const available = stirrupMandrelDefined(secondary, r.stirrupDiameter)
      ? Math.min(width, height)
      : 0;
    write(family, {
      diameter: r.stirrupDiameter,
      required: closure.minimum,
      available,
      width,
      height,
      tail: closure.tail,
      mandrel: t.mandrel,
    });
    compare(
      `anchor${family}Closure`,
      `${family} · fechamento com ganchos de 135°`,
      closure.minimum,
      available,
      closureFormula,
      `Menores dimensões entre eixos das estações ${mm(width)} × ${mm(height)}.`,
    );
  }
  const n4 = geometry.constructive;
  const n4Support = n4.support;
  const tipOrigin = Math.max(0, g.loadOffset - q.bearingLength / 2);
  const excessTail = n4.end >= tipOrigin ? n4.tail - n4.tailAvailable : 0;
  const front = n4.path.valid
    ? Math.max(0, pathLengthAfterX(n4.path, tipOrigin) - excessTail)
    : 0;
  write("N4", {
    ...n4Support,
    available: n4Support.axis,
    front,
    tail: n4.tail,
    tailMinimum: 8 * n4.diameter,
    tailAvailable: n4.tailAvailable,
    mandrel: n4.mandrel,
  });
  compare(
    "anchorN4",
    "N4 · ancoragem construtiva no suporte",
    n4Support.required,
    n4Support.axis,
    "lb,nec = max(0,3lb, 10φ, 100 mm)",
    `P − c = ${mm(n4Support.nominal)} · limite no eixo P − c − φ/2 = ${mm(n4Support.axis)} · trecho adotado ${mm(n4Support.adopted)}.`,
  );
  compare(
    "anchorN4Front",
    "N4 · ancoragem na ponta",
    n4Support.required,
    front,
    "percurso a partir da borda interna do apoio ≥ lb,nec",
  );
  compare(
    "anchorN4Tail",
    "N4 · espaço para a ponta reta",
    8 * n4.diameter,
    n4.tailAvailable,
    "ponta ≥ 8φ e abaixo de N1",
  );
  if (n4.problems.length || !loopPinDefined(secondary, n4.diameter))
    checks.push(
      note(
        "anchorN4Geometry",
        "N4 · compatibilidade das dobras e cobrimentos",
        [
          ...n4.problems,
          ...(!loopPinDefined(secondary, n4.diameter)
            ? ["Mandril fora das classes e bitolas definidas."]
            : []),
        ].join(" "),
        reference,
        "fail",
      ),
    );

  for (const [mark, count] of [
    ["N5", q.splittingCount],
    ["N6", q.suspensionCount],
    ["PINO", p.detailing.pins],
  ] as const)
    if (count > 0)
      checks.push(
        note(
          `anchor${mark}Review`,
          `${mark} · ancoragem a conferir`,
          mark === "PINO"
            ? "Embutimento e ligação com a peça apoiada exigem verificação específica."
            : "A área informada exige projeto específico da forma, do percurso e da ancoragem.",
          reference,
        ),
      );
}

/** Keep each family together with the combination that governs its geometry. */
export function envelopeAnchorage(
  values: Record<string, number>,
  cases: CaseResult[],
) {
  for (const family of anchorageFamilies) {
    const required = anchorageKey(family, "required");
    const governing = cases.reduce((a, b) =>
      (b.values[required] ?? -Infinity) > (a.values[required] ?? -Infinity)
        ? b
        : a,
    );
    for (const field of anchorageFields) {
      const key = anchorageKey(family, field);
      if (key in governing.values) values[key] = governing.values[key];
      else delete values[key];
    }
  }
}
