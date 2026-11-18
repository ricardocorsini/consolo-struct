import { calculate, tieLayout, type CalculationResult } from "../domain/engine";
import { geometryErrors, type Piece } from "../domain/model";
import { stirrupLayout, upperStitchLayout } from "../domain/theory";
import { bottomOffsetDepth, concreteProfile } from "../domain/profile";
import {
  loopPinDefined,
  requiresSupportHook,
  steelClassOf,
  stirrupMandrelDefined,
} from "../domain/steel";
import {
  closedStirrup,
  mandrelDiameter,
  roundedPath,
  steelMass,
  samplePath,
  pathSamplingError,
  type BarPath,
} from "./geometry";
import { beamArrangementActive, beamLayout, beamBarPositions } from "./beam";
import type { BarArrangement } from "./settings";
import {
  constructiveGeometry,
  transverseGeometry,
  translatePath,
  pathsClash,
} from "./transverse";
import { connectionGeometry, weldedFrontIssues } from "./connections";
import {
  partPoints3,
  pathExtent,
  placed,
  type BarInstance,
  type PlacedPath,
} from "./rebarPlacement";
import { pieceVolume } from "../domain/profile";
import { anchorageKey, supportHookGeometry } from "../domain/anchorage";
import {
  lowerStitchLayout,
  stitchAnchorage,
  stitchFront,
  stitchWidth,
} from "./stitches";
export { pinCenters } from "./connections";

export type DetailIssue = {
  code: string;
  severity: "error" | "review";
  message: string;
};
export type BarFamily =
  | "tie"
  | "stitch"
  | "lower"
  | "stirrup"
  | "constructive"
  | "stirrupInner"
  | "pin"
  | "welded"
  | "positive";
/** Anchorage provision of one end, as detailed (developed length along the
 * bar axis from the stated origin). `length` is null when the end is anchored
 * by a device (loop or welded bar) instead of a developed length. These are
 * geometric provisions; normative verification is done by the engine. */
export type BarAnchorage = {
  end: "suporte" | "ponta" | "ganchos" | "embutimento" | "espera";
  type: string;
  length: number | null;
  projection?: number;
};
export type Bar = {
  mark: string;
  family: BarFamily;
  /** Structural function of the position. */
  role: string;
  description: string;
  diameter: number;
  grade: number;
  /** Bars per piece; always equal to `instances.length`. */
  quantity: number;
  /** Quantity and length (mm) for every copy of the piece. */
  totalQuantity: number;
  totalLength: number;
  /** Mass per piece and for every copy of the piece, kg. */
  mass: number;
  totalMass: number;
  /** Fabrication shape (centre line, mm). */
  path: BarPath;
  exactLength: number;
  cutLength: number;
  mandrel: number;
  width: number;
  height: number;
  hookTail: number;
  hookExtra: number;
  note: string;
  /** Axis spacing between consecutive bars of the position, when uniform. */
  spacing: number | null;
  anchorage: BarAnchorage[];
  locations: { x: number; z: number; layer?: number }[];
  /** Physical bars of this position in the piece, one per unit of `quantity`. */
  instances: BarInstance[];
};
export type SteelSummaryRow = {
  grade: number;
  diameter: number;
  count: number;
  length: number;
  mass: number;
  totalLength: number;
  totalMass: number;
};
type ShapedBar = Omit<
  Bar,
  "totalQuantity" | "totalLength" | "mass" | "totalMass"
>;
/** Steel and concrete quantities of one piece, derived from the same bars. */
export type RebarQuantities = {
  mass: number;
  totalMass: number;
  steelSummary: SteelSummaryRow[];
  /** Concrete volume per piece and for all pieces of the type, m³ (pieceVolume). */
  concreteVolume: number;
  totalConcreteVolume: number;
  /** Steel per concrete volume, kg/m³. */
  steelRate: number;
};
/** Pure geometry of every detailed bar, without the ELU report. */
export type RebarGeometry = RebarQuantities & {
  piece: Piece;
  bars: Bar[];
  issues: DetailIssue[];
  arrangement: BarArrangement;
  tieRows: (ReturnType<typeof tieLayout>["rows"][number] & {
    detailedCount: number;
  })[];
};
export type Detail = RebarGeometry & {
  result: CalculationResult;
};
export const familyMark: Record<BarFamily, string> = {
  tie: "N1",
  stitch: "N2",
  lower: "N2I",
  stirrup: "N3",
  stirrupInner: "N3G",
  constructive: "N4",
  positive: "P1",
  welded: "TS",
  pin: "PINO",
};
export const familyRole: Record<BarFamily, string> = {
  tie: "Tirante: armadura principal resistente",
  stitch: "Costura superior: armadura secundária nos 2d/3 superiores",
  lower: "Costura inferior: armadura secundária no trecho restante",
  stirrup: "Estribo vertical",
  stirrupInner: "Estribo interno fechado (4 ramos)",
  constructive: "Armadura construtiva, sem contribuição resistente",
  positive: "Positiva do modo viga, não computada como resistente",
  welded: "Ancoragem frontal do tirante por barra transversal soldada",
  pin: "Ligação com a peça apoiada",
};
/** Uniform axis spacing, when the installed sequence has one. */
function pitchOf(positions: number[]): number | null {
  if (positions.length < 2) return null;
  const sorted = [...positions].sort((a, b) => a - b);
  const pitch = sorted[1] - sorted[0];
  return pitch > 0 &&
    sorted.slice(2).every((x, i) => Math.abs(x - sorted[i + 1] - pitch) < 1e-6)
    ? pitch
    : null;
}
/** Mass, summary and concrete consumption from the bars of one piece. */
export function rebarQuantities(p: Piece, bars: Bar[]): RebarQuantities {
  const mass = bars.reduce((sum, b) => sum + b.mass, 0);
  const steelSummary: SteelSummaryRow[] = [];
  for (const b of bars) {
    let group = steelSummary.find(
      (v) => v.grade === b.grade && v.diameter === b.diameter,
    );
    if (!group) {
      group = {
        grade: b.grade,
        diameter: b.diameter,
        count: 0,
        length: 0,
        mass: 0,
        totalLength: 0,
        totalMass: 0,
      };
      steelSummary.push(group);
    }
    group.count += b.quantity;
    group.length += b.quantity * b.cutLength;
    group.mass += b.mass;
    group.totalLength += b.totalLength;
    group.totalMass += b.totalMass;
  }
  const concreteVolume = pieceVolume(p);
  return {
    mass,
    totalMass: bars.reduce((sum, b) => sum + b.totalMass, 0),
    steelSummary: steelSummary.sort(
      (a, b) => a.grade - b.grade || a.diameter - b.diameter,
    ),
    concreteVolume,
    totalConcreteVolume: concreteVolume * p.quantity,
    steelRate: concreteVolume > 0 ? mass / concreteVolume : 0,
  };
}
const rounded = (n: number) => Math.round(n * 1000) / 1000;
const cm = (mm: number) =>
  (mm / 10).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
export { lowerStitchLayout } from "./stitches";

/** Full detailing of one piece. The bar geometry reuses its ELU anchorage values. */
export function buildDetail(piece: Piece): Detail {
  const result = calculate(piece);
  const geometry = buildRebarGeometry(piece, result.values);
  const issues = [...geometry.issues];
  const issue = (
    code: string,
    message: string,
    severity: DetailIssue["severity"],
  ) => {
    if (!issues.some((i) => i.code === code))
      issues.push({ code, message, severity });
  };
  if (result.status !== "pass")
    issue(
      "calculation",
      `O cálculo desta peça tem situação ${result.status === "fail" ? "não atende" : result.status === "review" ? "pendente de revisão" : result.status === "unsupported" ? "fora do escopo" : "inválida"}. Consulte a memória.`,
      result.status === "fail" ||
        result.status === "invalid" ||
        result.status === "unsupported"
        ? "error"
        : "review",
    );
  issue(
    "support-review",
    "Conferir interferências com as barras do pilar, armadura local de ancoragem e ligação à peça apoiada no projeto de conjunto.",
    "review",
  );
  return { ...geometry, issues, result };
}

/** Single physical source of every reinforcement position of a piece (mm).
 * When `values` are absent, calculate the anchorages before laying out the bars. */
export function buildRebarGeometry(
  piece: Piece,
  values?: Record<string, number>,
): RebarGeometry {
  const p = piece,
    g = p.geometry,
    r = p.rebar,
    q = p.design,
    s = p.detailing;
  const layout = tieLayout(p),
    connections = connectionGeometry(p, layout),
    bars: ShapedBar[] = [],
    issues: DetailIssue[] = [];
  let order = 0;
  const instance = (
    parts: PlacedPath[],
    host?: BarInstance["host"],
  ): BarInstance => ({ order: order++, parts, ...(host ? { host } : {}) });
  const issue = (
    code: string,
    message: string,
    severity: DetailIssue["severity"] = "error",
  ) => {
    if (!issues.some((i) => i.code === code))
      issues.push({ code, message, severity });
  };
  geometryErrors(p).forEach((message, i) => issue(`geometry-${i}`, message));
  const add = (
    b: Omit<
      ShapedBar,
      "mark" | "exactLength" | "cutLength" | "role" | "quantity"
    >,
  ) => {
    const exactLength = b.path.length + b.hookExtra;
    if (!Number.isFinite(exactLength) || exactLength <= 0 || !b.path.valid) {
      issue(
        `shape-${b.family}`,
        `A forma de ${b.description.toLowerCase()} não comporta o mandril e as pontas informados.`,
      );
      return;
    }
    const quantity = b.instances.length;
    if (!quantity) return;
    const cutLength = Math.ceil(exactLength - 1e-7);
    const key = JSON.stringify([
      b.family,
      b.grade,
      b.diameter,
      rounded(b.width),
      rounded(b.height),
      rounded(exactLength),
      cutLength,
      b.note,
    ]);
    const existing = bars.find(
      (x) =>
        JSON.stringify([
          x.family,
          x.grade,
          x.diameter,
          rounded(x.width),
          rounded(x.height),
          rounded(x.exactLength),
          x.cutLength,
          x.note,
        ]) === key,
    );
    if (existing) {
      existing.quantity += quantity;
      existing.locations.push(...b.locations);
      existing.instances.push(...b.instances);
      // Merged positions keep a spacing only when it is the same in both.
      if (existing.spacing !== b.spacing) existing.spacing = null;
    } else
      bars.push({
        ...b,
        mark: "",
        role: familyRole[b.family],
        quantity,
        exactLength,
        cutLength,
      });
  };
  const designValues = values ?? calculate(p).values;
  const beam = beamArrangementActive(p);
  const beamBars = beam ? beamLayout(p, designValues) : null;
  if (s.barArrangement === "beam" && !beam)
    issue(
      "beam-unavailable",
      "O detalhamento “Armado como viga” só se aplica quando o concreto excedente é mantido. Com o recorte, a peça foi detalhada no modo de consolo atual.",
      "review",
    );
  const mainD = mandrelDiameter(r.tieDiameter, p.materials.fyk);
  const steel = steelClassOf(p.materials.fyk);
  if (requiresSupportHook(steel))
    issue(
      "smooth-detail",
      "Barras lisas CA-25 exigem ancoragem com gancho semicircular. A forma completa desse gancho não está implementada no gerador; detalhar especificamente antes da execução.",
    );
  const mainR = (mainD + r.tieDiameter) / 2;
  const mainFront = g.length - g.cover - r.tieDiameter / 2;
  const anchorRequired =
    designValues[anchorageKey("N1", "required")] ??
    designValues.anchorRequired ??
    0;
  const hook =
    !beam && q.supportAnchor === "hook"
      ? supportHookGeometry(p, layout.rows, mainR, anchorRequired)
      : null;
  const hookTail = hook?.tail ?? 0;
  /** Support hook of N1 in the vertical plane of one leg (as in Detail.hookExtra). */
  const supportHook = (startX: number, depth: number) =>
    roundedPath(
      [
        { x: startX, y: depth },
        { x: startX - mainR, y: depth },
        { x: startX - mainR, y: depth + mainR + hookTail },
      ],
      mainR,
    );
  const backExtent = hook
    ? (hook.layers[0]?.outerProjection ?? 0)
    : q.supportAnchorLength;
  if (!beam && backExtent > g.columnWidth - g.cover)
    issue(
      "tie-back",
      "O tirante ultrapassa o cobrimento na face posterior do suporte.",
    );
  if (hook) {
    if (hook.tail < hook.tailMinimum)
      issue(
        "hook-tail",
        "A ponta reta do gancho de 90° do tirante deve ter pelo menos 8 diâmetros.",
      );
    const short = hook.layers.filter(
      ({ available }) => available + 1e-6 < anchorRequired,
    );
    if (short.length)
      issue(
        "hook-available",
        `A projeção do gancho é menor que a ancoragem necessária no suporte. Camada(s) ${short.map(({ layer }) => layer + 1).join(", ")}.`,
      );
    const outside = hook.layers.filter(
      ({ projection, tailAvailable, outerProjection }) =>
        projection + 1e-6 < mainR ||
        hook.tail > tailAvailable + 1e-6 ||
        outerProjection > hook.declared + 1e-6,
    );
    if (outside.length)
      issue(
        "hook-fit",
        `O gancho do tirante não cabe no trecho de suporte representado. Camada(s) ${outside.map(({ layer }) => layer + 1).join(", ")}.`,
      );
  }
  if (!loopPinDefined(steel, r.tieDiameter))
    issue(
      "main-grade",
      "A tabela de mandris não define este diâmetro de CA-60 para a ancoragem adotada.",
    );
  layout.rows
    .filter((row) => row.count)
    .forEach((row, layer) => {
      const beamTop = beamBars?.top[layer];
      if (beamTop) {
        const { back: b, front: f } = beamTop;
        if (!b.fits || !f.fits)
          issue(
            "beam-top-anchor",
            `As dobras do tirante não alcançam a ancoragem necessária (lb,nec = ${cm(beamBars!.lbNecTop)} cm) dentro do contorno com o cobrimento informado. Reveja altura, bitola ou o comprimento do suporte.`,
          );
        const positions = beamBarPositions(p, row.count, r.tieDiameter);
        add({
          family: "tie",
          description: "Tirante (negativa) dobrado",
          diameter: r.tieDiameter,
          grade: p.materials.fyk,
          path: beamTop.path,
          mandrel: beamTop.mandrel,
          width: 0,
          height: beamTop.span,
          hookTail: 0,
          hookExtra: 0,
          note: `Camada ${layer + 1}; armado como viga: dobras de 90° no suporte (${cm(b.leg)} cm) e na ponta (${cm(f.leg)} cm)`,
          spacing: pitchOf(positions),
          anchorage: [
            { end: "suporte", type: "dobra de 90°", length: b.developed },
            { end: "ponta", type: "dobra de 90°", length: f.developed },
          ],
          locations: Array.from({ length: row.count }, (_, i) => ({
            x: i,
            z: row.y,
            layer,
          })),
          instances: positions.map((v) =>
            instance([placed("xz", v, beamTop.path)]),
          ),
        });
        return;
      }
      const layerHook = hook?.layers[layer];
      const back = layerHook?.projection ?? q.supportAnchorLength;
      const supportAnchorage: BarAnchorage = layerHook
        ? {
            end: "suporte",
            type: "gancho de 90°",
            length: layerHook.developed,
            projection: back,
          }
        : { end: "suporte", type: "reta", length: back };
      if (q.frontAnchor === "loop") {
        if (row.count % 2)
          issue(
            "tie-even",
            "Alças horizontais exigem número par de ramos em cada camada. Ajuste a quantidade ou as camadas.",
          );
        const specifiedD =
          layer > 0 && s.secondLoopDiameter > 0
            ? s.secondLoopDiameter
            : q.loopInternalDiameter;
        const loops = Math.floor(row.count / 2),
          d = Math.max(specifiedD, mainD);
        if (specifiedD < mainD)
          issue(
            "loop-mandrel",
            "O diâmetro interno da alça informado é menor que o mandril mínimo do tirante.",
          );
        const radius = (d + r.tieDiameter) / 2;
        const outerWidth =
          g.width - 2 * (g.cover + r.stirrupDiameter) - r.tieDiameter;
        const gap = layout.spacingHorizontalMin + r.tieDiameter;
        const maxPitch = Math.min(layout.d, 15 * r.tieDiameter);
        const innerTarget = Math.min(
          maxPitch,
          outerWidth - 2 * gap * (loops - 1),
        );
        const nestingPitch =
          loops > 1 ? (outerWidth - innerTarget) / (2 * (loops - 1)) : 0;
        if (loops === 1 && outerWidth > maxPitch + 1e-6)
          issue(
            "tie-real-pitch",
            "A distância real entre os ramos da alça ultrapassa o limite em planta. Use mais alças por camada ou reveja a largura.",
          );
        const startX = -back + (layerHook ? mainR : 0);
        const supportPath = layerHook ? supportHook(startX, row.y) : null;
        for (let i = 0; i < loops; i++) {
          const width = outerWidth - 2 * i * nestingPitch;
          if (width < 2 * radius) {
            issue(
              "nested-loops",
              "As alças do tirante se sobrepõem transversalmente. Aumente b, reduza ramos ou distribua em mais camadas.",
            );
            continue;
          }
          const path = roundedPath(
            [
              { x: startX, y: 0 },
              { x: mainFront, y: 0 },
              { x: mainFront, y: width },
              { x: startX, y: width },
            ],
            radius,
          );
          const inset = (g.width - width) / 2;
          add({
            family: "tie",
            description: "Tirante em alça",
            diameter: r.tieDiameter,
            grade: p.materials.fyk,
            path,
            mandrel: d,
            width,
            height: mainFront + back,
            hookTail,
            hookExtra: supportPath ? 2 * supportPath.length : 0,
            note: `Camada ${layer + 1}; 2 ramos por alça${q.supportAnchor === "hook" ? "; 2 ganchos de 90° fora do plano" : "; ancoragem reta no suporte"}`,
            spacing: null,
            anchorage: [
              supportAnchorage,
              { end: "ponta", type: "alça horizontal", length: null },
            ],
            locations: [{ x: i, z: row.y, layer }],
            instances: [
              instance([
                placed("xy", row.y, translatePath(path, 0, inset)),
                ...(supportPath
                  ? [inset, g.width - inset].map((v) =>
                      placed("xz", v, supportPath, "hook"),
                    )
                  : []),
              ]),
            ],
          });
        }
        if (
          mainFront - radius - r.tieDiameter / 2 <
          g.loadOffset + q.bearingLength / 2
        )
          issue(
            "bearing-loop",
            "A curva frontal da alça invade a projeção da placa de apoio. Aumente a distância da placa à ponta.",
          );
      } else {
        const front = g.length - g.cover;
        const path = roundedPath(
          [
            ...(layerHook ? [{ x: -back, y: mainR + hookTail }] : []),
            { x: -back, y: 0 },
            { x: front, y: 0 },
          ],
          layerHook ? mainR : 0,
        );
        const positions = beamBarPositions(p, row.count, r.tieDiameter);
        add({
          family: "tie",
          description: "Tirante reto",
          diameter: r.tieDiameter,
          grade: p.materials.fyk,
          path,
          mandrel: mainD,
          width: 0,
          height: front + back,
          hookTail,
          hookExtra: 0,
          note: `Camada ${layer + 1}; ancoragem frontal soldada${q.supportAnchor === "hook" ? "; gancho de 90° no suporte" : ""}`,
          spacing: pitchOf(positions),
          anchorage: [
            supportAnchorage,
            {
              end: "ponta",
              type: "barra transversal soldada",
              length: null,
            },
          ],
          locations: Array.from({ length: row.count }, (_, i) => ({
            x: i,
            z: row.y,
            layer,
          })),
          instances: positions.map((v) =>
            instance([placed("xz", v, translatePath(path, 0, row.y))]),
          ),
        });
        const welded = connections.welded.find((bar) => bar.layer === layer)!;
        add({
          family: "welded",
          description: "Barra transversal soldada",
          diameter: welded.diameter,
          grade: p.materials.fyk,
          path: roundedPath(
            [
              { x: 0, y: 0 },
              { x: welded.length, y: 0 },
            ],
            0,
          ),
          mandrel: 0,
          width: 0,
          height: g.width - 2 * g.cover,
          hookExtra: 0,
          hookTail: 0,
          note: `Camada ${layer + 1}; solda conforme especificação do projeto`,
          spacing: null,
          anchorage: [],
          locations: [{ x: welded.x, z: welded.depth, layer: welded.layer }],
          instances: [
            instance([
              placed(
                "xy",
                welded.depth,
                roundedPath(
                  [
                    { x: welded.x, y: g.cover },
                    { x: welded.x, y: g.cover + welded.length },
                  ],
                  0,
                ),
              ),
            ]),
          ],
        });
        issue(
          "weld-review",
          "Conferir soldas e a ligação do tirante à barra transversal conforme a especificação e qualificação do processo.",
          "review",
        );
      }
    });
  // Bottom face, with the excess-concrete cut when it applies.
  const concrete = concreteProfile(p);
  const bottomAt = (x: number, offset: number) =>
    bottomOffsetDepth(concrete, x, offset);
  if (
    !stirrupMandrelDefined(
      steelClassOf(p.materials.fykTransverse),
      r.stitchDiameter,
    ) ||
    !stirrupMandrelDefined(
      steelClassOf(p.materials.fykTransverse),
      r.stirrupDiameter,
    )
  )
    issue(
      "transverse-mandrel",
      "A tabela 9.2 não define mandril de estribo CA-60 para bitola superior a 10 mm; adote aço/bitola compatíveis.",
    );
  const addHorizontal = (
    count: number,
    start: number,
    end: number,
    family: "stitch" | "lower",
    levels: number[],
  ) => {
    if (!count) return;
    if (end < start) {
      issue(
        `zone-${family}`,
        "Não há altura suficiente para distribuir a costura preservando o cobrimento e a separação das barras.",
      );
      return;
    }
    const step = (end - start) / Math.max(count - 1, 1);
    const mark = family === "stitch" ? "N2" : "N2I";
    const embedment =
      designValues[anchorageKey(mark, "adopted")] ??
      stitchAnchorage(p, mark, levels, 0, 0).adopted;
    if (embedment + 1e-8 < (designValues[anchorageKey(mark, "required")] ?? 0))
      issue(
        `stitch-back-${mark}`,
        `${mark} não alcança a ancoragem necessária no eixo da costura no suporte.`,
      );
    const width = stitchWidth(p);
    for (const z of levels) {
      const front = stitchFront(p, concrete, z);
      const depth = front + embedment,
        mandrel = mandrelDiameter(
          r.stitchDiameter,
          p.materials.fykTransverse,
          true,
        );
      if (front < g.cover + r.stitchDiameter / 2)
        issue(
          "horizontal-front",
          "Uma costura não alcança o consolo mantendo cobrimento na face inferior. Reveja a distribuição vertical.",
        );
      if (
        embedment > g.columnWidth - g.cover - r.stitchDiameter / 2 ||
        embedment <= 0
      )
        issue(
          "stitch-back",
          "A penetração da costura no suporte é incompatível com a sua dimensão e cobrimento.",
        );
      const path = closedStirrup(depth, width, r.stitchDiameter, mandrel);
      const hookTail = Math.max(5 * r.stitchDiameter, 50);
      add({
        family,
        description:
          family === "stitch" ? "Costura superior" : "Costura inferior",
        diameter: r.stitchDiameter,
        grade: p.materials.fykTransverse,
        path,
        mandrel,
        width: depth,
        height: width,
        hookExtra: 0,
        hookTail,
        note: `Fechado; 2 ganchos de 135°; c/${(step / 10).toFixed(1)} cm`,
        spacing: count > 1 ? step : null,
        anchorage: [
          {
            end: "embutimento",
            type: "penetração no suporte",
            length: embedment,
          },
          { end: "ganchos", type: "2 ganchos de 135°", length: hookTail },
        ],
        locations: [{ x: front, z }],
        instances: [
          instance([
            placed(
              "xy",
              z,
              translatePath(path, -embedment, (g.width - width) / 2),
            ),
          ]),
        ],
      });
    }
    if (
      count > 1 &&
      step - r.stitchDiameter <
        Math.max(20, r.stitchDiameter, 0.5 * q.aggregate)
    )
      issue(
        `spacing-${family}`,
        "O espaçamento livre da costura é insuficiente no arranjo desenhado.",
      );
    if (count > 1 && step > Math.min(100, g.loadOffset))
      issue(
        `max-spacing-${family}`,
        "O espaçamento real da costura ultrapassa o limite adotado no cálculo.",
      );
  };
  const upperStitch = upperStitchLayout(p, layout);
  const stitchStart = upperStitch.start;
  const stitchEnd = upperStitch.end;
  weldedFrontIssues(
    p,
    connections.welded,
    stitchEnd >= stitchStart ? upperStitch.levels : [],
    concrete,
  ).forEach(({ code, message }) => issue(code, message));
  if (stitchStart >= stitchEnd)
    issue(
      "stitch-zone",
      "Não há altura disponível para a costura abaixo de todas as camadas do tirante.",
    );
  addHorizontal(
    r.stitchCount,
    stitchStart,
    stitchEnd,
    "stitch",
    upperStitch.levels,
  );
  const lowerStitch = lowerStitchLayout(p, layout, concrete);
  addHorizontal(
    q.lowerStitchCount,
    lowerStitch.start,
    lowerStitch.end,
    "lower",
    lowerStitch.levels,
  );
  const { offset: transverseOffset, pitch } = stirrupLayout(p);
  // A horizontal loop contributes the axes of its two longitudinal legs.
  // Only placed ties can define the width of the matching N3G.
  const tieRows = layout.rows.map((row) => ({ ...row, detailedCount: 0 }));
  const firstLayerPositions: number[] = [];
  for (const bar of bars.filter((bar) => bar.family === "tie"))
    bar.instances.forEach(({ parts: [body] }, index) => {
      const layer = bar.locations[index].layer!;
      const positions =
        body.plane === "xy" ? pathExtent(body.path, "y") : [body.at];
      tieRows[layer].detailedCount += positions.length;
      if (layer === 0) firstLayerPositions.push(...positions);
    });
  firstLayerPositions.sort((a, b) => a - b);
  const transverse = transverseGeometry(p, undefined, firstLayerPositions);
  transverse.problems.forEach(({ code, message }) => issue(code, message));
  const placedStirrups = transverse.sections.filter(({ path }) => path.valid);
  const outerPitch = pitchOf(
    placedStirrups.filter(({ internal }) => !internal).map(({ x }) => x),
  );
  const innerPitch = pitchOf(
    placedStirrups.filter(({ internal }) => internal).map(({ x }) => x),
  );
  for (const section of transverse.sections) {
    const hookTail = Math.max(5 * r.stirrupDiameter, 50);
    const spacing = section.internal ? innerPitch : outerPitch;
    add({
      family: section.internal ? "stirrupInner" : "stirrup",
      description: section.internal
        ? "N3 · Estribo interno fechado"
        : "N3 · Estribo vertical externo",
      diameter: r.stirrupDiameter,
      grade: p.materials.fykTransverse,
      path: section.path,
      mandrel: transverse.mandrel,
      width: section.width,
      height: section.height,
      hookExtra: 0,
      hookTail,
      note: `${section.internal ? "Estribo interno fechado" : "Fechado externo"}; 2 ramos; 2 ganchos de 135°${spacing ? `; c/${(spacing / 10).toFixed(1)} cm` : ""}${section.internal ? `; pareado com N3, justaposto com afastamento longitudinal ${(transverse.innerShift / 10).toFixed(2)} cm` : ""}`,
      spacing,
      anchorage: [
        { end: "ganchos", type: "2 ganchos de 135°", length: hookTail },
      ],
      locations: [{ x: section.x, z: transverseOffset }],
      instances: [
        {
          ...instance([
            placed(
              "yz",
              section.x,
              translatePath(
                section.path,
                section.offset,
                transverse.stirrupOffset,
              ),
            ),
          ]),
          ...(section.internal ? { pairedWith: section.pairedWith } : {}),
        },
      ],
    });
  }
  if (
    r.stirrupCount > 1 &&
    pitch - r.stirrupDiameter <
      Math.max(20, r.stirrupDiameter, 1.2 * q.aggregate)
  )
    issue(
      "stirrup-spacing",
      "Há congestionamento de estribos verticais; reveja a quantidade e o agregado.",
    );
  if (beamBars) {
    const bottom = beamBars.bottom;
    if (!loopPinDefined(steel, bottom.diameter))
      issue(
        "beam-bottom-mandrel",
        "O pino de dobramento da positiva CA-60 com bitola ≥ 20 mm não está definido na tabela 9.1. A forma mostrada é esquemática; detalhar especificamente antes da execução.",
      );
    const edge = g.cover + r.stirrupDiameter + bottom.diameter / 2;
    const gap = (g.width - 2 * edge) / (bottom.count - 1) - bottom.diameter;
    if (gap < Math.max(20, bottom.diameter, 1.2 * q.aggregate))
      issue(
        "beam-bottom-spacing",
        "As barras da armadura positiva não cabem na largura com o espaçamento livre mínimo. Reveja a quantidade, a bitola ou a largura da peça.",
      );
    if (!bottom.back.fits || !bottom.front.fits)
      issue(
        "beam-bottom-anchor",
        `As dobras da armadura positiva não alcançam a ancoragem de referência (lb,nec = ${cm(beamBars.lbNecBottom)} cm) sem interferir no tirante. Reveja a bitola da positiva ou a altura da peça.`,
      );
    const positions = beamBarPositions(p, bottom.count, bottom.diameter);
    add({
      family: "positive",
      description: "Armadura positiva dobrada",
      diameter: bottom.diameter,
      grade: p.materials.fyk,
      path: bottom.path,
      mandrel: bottom.mandrel,
      width: 0,
      height: bottom.span,
      hookTail: 0,
      hookExtra: 0,
      note: `Armado como viga: dobras de 90° no suporte (${cm(bottom.back.leg)} cm) e na ponta (${cm(bottom.front.leg)} cm); não computada como armadura resistente`,
      spacing: pitchOf(positions),
      anchorage: [
        {
          end: "suporte",
          type: "dobra de 90°",
          length: bottom.back.developed,
        },
        { end: "ponta", type: "dobra", length: bottom.front.developed },
      ],
      locations: [
        { x: 0, z: bottom.depthSupport },
        { x: bottom.vertices.at(-1)!.x, z: bottom.depthTip },
      ],
      instances: positions.map((v) => instance([placed("xz", v, bottom.path)])),
    });
    issue(
      "beam-review",
      "Armado como viga: a ancoragem do tirante na ponta é feita por dobra, e não por alça ou barra transversal soldada (NBR 9062 §7.3.3.6–7). O cálculo por bielas e tirantes não muda, e a armadura positiva não entra como armadura resistente. Conferir a adequação do modo à peça e as interferências das dobras.",
      "review",
    );
  }
  const constructive = constructiveGeometry(p, transverse, concrete);
  constructive.problems.forEach((message, i) =>
    issue(`constructive-fit-${i}`, message),
  );
  if (
    !loopPinDefined(
      steelClassOf(p.materials.fykTransverse),
      constructive.diameter,
    )
  )
    issue(
      "constructive-mandrel",
      "O mandril de N4 não está definido para esta classe de aço e bitola; conferir especificamente.",
    );
  add({
    family: "constructive",
    description: "N4 · Armadura construtiva",
    diameter: constructive.diameter,
    grade: p.materials.fykTransverse,
    path: constructive.path,
    mandrel: constructive.mandrel,
    width: 0,
    height: g.height - g.tipHeight,
    hookTail: constructive.tail,
    hookExtra: 0,
    note: `${constructive.positions.length} barras, uma por vértice inferior de N3; dobra frontal e prolongamento no suporte; sem contribuição resistente`,
    spacing: null,
    anchorage: [
      {
        end: "suporte",
        type: "prolongamento no suporte",
        length: -constructive.back,
      },
      { end: "ponta", type: "dobra frontal", length: constructive.tail },
    ],
    locations: constructive.positions.map((v) => ({ x: v, z: 0 })),
    // Each N4 sits in a lower corner of its own N3 (outer) or N3G (inner).
    instances: constructive.positions.map((v, i, all) =>
      instance(
        [placed("xz", v, constructive.path)],
        i > 0 && i < all.length - 1 ? "stirrupInner" : "stirrup",
      ),
    ),
  });
  const point3 = (part: PlacedPath) =>
    partPoints3(part, 24).map((pt): [number, number, number] => [
      pt.x,
      pt.y,
      pt.z,
    ]);
  // Segment distances catch crossings between vertices, not only coincident samples.
  const n4Paths = constructive.positions.map((v) =>
    point3(placed("xz", v, constructive.path)),
  );
  const transversePaths = transverse.sections.map((section) => {
    // Closing hooks overlap out of plane in the fabrication projection (closedStirrup).
    // Check the physical perimeter; only chord approximation error is discounted.
    const outline = translatePath(
      { ...section.path, segments: section.path.segments.slice(2, -2) },
      section.offset,
      transverse.stirrupOffset,
    );
    return {
      points: samplePath(outline, 48).map((pt): [number, number, number] => [
        section.x,
        pt.x,
        pt.y,
      ]),
      tolerance: pathSamplingError(outline, 48),
    };
  });
  const n4Clashes = {
    tie: [
      "constructive-tie-clash",
      "N4 interfere com N1. Reveja o arranjo de armaduras.",
    ],
    positive: [
      "constructive-positive-clash",
      "N4 e a positiva P1 do modo viga interferem. Compatibilize o arranjo. As barras estão quantificadas separadamente.",
    ],
    welded: [
      "constructive-welded-clash",
      "A dobra frontal de N4 interfere com a barra transversal soldada TS. Reveja a altura e o arranjo na ponta.",
    ],
  } as const;
  for (const other of bars) {
    if (
      other.family !== "tie" &&
      other.family !== "positive" &&
      other.family !== "welded"
    )
      continue;
    // The very same placed bars (bodies and support hooks) shown in every view.
    const paths = other.instances.flatMap((bar) =>
      bar.parts.map((part) => ({
        points: point3(part),
        tolerance: pathSamplingError(part.path, 24),
      })),
    );
    const minimum = (other.diameter + constructive.diameter) / 2;
    if (
      n4Paths.some((n4) =>
        paths.some((path) => pathsClash(n4, path.points, minimum)),
      )
    ) {
      const [code, message] = n4Clashes[other.family];
      issue(code, message);
    }
    if (
      other.family === "tie" &&
      transversePaths.some((stirrup) =>
        paths.some((path) =>
          pathsClash(
            stirrup.points,
            path.points,
            (other.diameter + r.stirrupDiameter) / 2 -
              stirrup.tolerance -
              path.tolerance,
          ),
        ),
      )
    )
      issue(
        "transverse-tie-clash",
        "N3/N3G interfere com N1; rever o arranjo sem reduzir cobrimento, bitola ou dobra.",
      );
  }
  if (s.pins > 0) {
    const len = connections.pins?.length ?? 0;
    const pins = connections.pins;
    add({
      family: "pin",
      description: "Pino de ligação",
      diameter: s.pinDiameter,
      grade: 500,
      path: roundedPath(
        [
          { x: 0, y: 0 },
          { x: 0, y: len },
        ],
        0,
      ),
      mandrel: 0,
      width: 0,
      height: len,
      hookExtra: 0,
      hookTail: 0,
      note: `Embutido ${(s.pinEmbedment / 10).toFixed(1)} cm; espera ${(s.pinProjection / 10).toFixed(1)} cm; verificar ligação`,
      spacing: pins ? pitchOf(pins.centers) : null,
      anchorage: [
        {
          end: "embutimento",
          type: "embutido no consolo",
          length: s.pinEmbedment,
        },
        {
          end: "espera",
          type: "espera acima do topo",
          length: s.pinProjection,
        },
      ],
      locations: [{ x: pins?.x ?? g.loadOffset, z: 0 }],
      instances: pins
        ? pins.centers.map((v) =>
            instance([
              placed(
                "xz",
                v,
                roundedPath(
                  [
                    { x: pins.x, y: pins.top },
                    { x: pins.x, y: pins.bottom },
                  ],
                  0,
                ),
              ),
            ]),
          )
        : [],
    });
    issue(
      "pins",
      "Pinos representados e quantificados; a resistência da ligação e seu embutimento exigem verificação específica.",
      "review",
    );
    if (s.pinEmbedment > bottomAt(g.loadOffset, g.cover) || s.pinEmbedment <= 0)
      issue(
        "pin-fit",
        "O embutimento do pino ultrapassa a face inferior do consolo.",
      );
    const centers = pins?.centers ?? [];
    const pinGap =
      centers.length > 1 ? centers[1] - centers[0] - s.pinDiameter : Infinity;
    if (s.pins > 1 && pinGap < Math.max(20, s.pinDiameter, 1.2 * q.aggregate))
      issue(
        "pin-spacing",
        "Os pinos não cabem na largura do apoio com espaçamento livre suficiente.",
      );
    const padEdge = (g.width - q.bearingWidth) / 2;
    if (
      centers.some(
        (v) =>
          v - s.pinDiameter / 2 < padEdge ||
          v + s.pinDiameter / 2 > g.width - padEdge,
      )
    )
      issue(
        "pin-pad",
        "Um pino ultrapassa a largura do apoio. Reveja o espaçamento e o deslocamento transversal.",
      );
    const pinAxes =
      bars
        .find((bar) => bar.family === "pin")
        ?.instances.map(({ parts: [axis] }) => point3(axis)) ?? [];
    const tieClash = bars.some(
      (bar) =>
        bar.family === "tie" &&
        bar.instances.some(({ parts }) =>
          parts.some((part) => {
            const path = point3(part);
            const clearance =
              (s.pinDiameter + bar.diameter) / 2 -
              pathSamplingError(part.path, 24);
            return pinAxes.some((axis) => pathsClash(axis, path, clearance));
          }),
        ),
    );
    if (tieClash)
      issue(
        "pin-tie-clash",
        "Há interferência geométrica entre pino e tirante. Ajuste o espaçamento ou o deslocamento transversal dos pinos.",
      );
    for (const b of bars.filter((b) => b.family === "stirrup"))
      if (
        b.locations.some(
          (loc) =>
            Math.abs(loc.x - g.loadOffset) < (s.pinDiameter + b.diameter) / 2,
        )
      )
        issue(
          "pin-stirrup-clash",
          "O eixo de um pino coincide com o estribo vertical. Compatibilize a posição dos pinos e a distribuição dos estribos.",
        );
  }
  if (q.splittingCount || q.suspensionCount)
    issue(
      "special-bars",
      "A armadura de fendilhamento ou suspensão informada no cálculo requer definição própria de forma e ancoragem; não foi incluída no quadro. Detalhe este reforço antes da execução.",
    );
  const positions: Bar[] = bars.map((b) => {
    const group = bars.filter((v) => v.family === b.family);
    const mark =
      familyMark[b.family] +
      (group.length > 1 ? `-${group.indexOf(b) + 1}` : "");
    const totalQuantity = b.quantity * p.quantity;
    const mass = steelMass(b.cutLength, b.diameter) * b.quantity;
    return {
      ...b,
      mark,
      totalQuantity,
      totalLength: b.cutLength * totalQuantity,
      mass,
      totalMass: mass * p.quantity,
    };
  });
  return {
    piece: p,
    bars: positions,
    issues,
    arrangement: beam ? "beam" : "consolo",
    tieRows,
    ...rebarQuantities(p, positions),
  };
}
