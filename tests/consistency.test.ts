import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculate } from "../src/domain/engine";
import { suggestReinforcement } from "../src/domain/autodesign";
import { exampleProject, newPiece, type Piece } from "../src/domain/model";
import { stirrupLayout } from "../src/domain/theory";
import { buildDetail } from "../src/detailing/model";
import {
  declaredCounts,
  placedCounts,
  validateRebarConsistency,
} from "../src/detailing/consistency";
import { sectionBars } from "../src/detailing/projection";
import { projectPlan, scenePaths } from "../src/detailing/rebarModel";
import { pieceDrawing } from "../src/detailing/drawing";
import { drawingSvg } from "../src/detailing/exports";
import { buildSceneModel } from "../src/visualization/model3d";
import Drawing from "../src/components/Drawing";
import { shortFixture } from "./fixtures";

const svg = (p: Piece) =>
  drawingSvg(
    pieceDrawing({ ...exampleProject(), pieces: [p] }, buildDetail(p)),
  );
const section = (p: Piece) =>
  renderToStaticMarkup(
    createElement(Drawing, {
      piece: p,
      section: true,
      rebar: true,
      dimensions: false,
      grid: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      forces: false,
      selectedBar: "N1",
      onDimension: () => {},
      onBar: () => {},
    }),
  );
/** Legs of N1 represented by a list of placed parts (a loop part holds two). */
const legs = (p: Piece, items: { bar: { family: string } }[]) =>
  items.filter((i) => i.bar.family === "tie").length *
  (p.design.frontAnchor === "loop" && p.detailing.barArrangement !== "beam"
    ? 2
    : 1);

describe("Paridade entre quantidade indicada e desenhada (#64)", () => {
  it("CA1: peça padrão 4 Ø20 em alça com b = 30 cm mostra 4 ramos em todas as vistas e acusa a falha", () => {
    const p = newPiece(1);
    expect(p.geometry.width).toBe(300);
    expect(p.rebar.tieCount).toBe(4);
    expect(p.rebar.tieDiameter).toBe(20);
    expect(p.design.frontAnchor).toBe("loop");
    // Engine: the physical nesting fails explicitly.
    const nesting = calculate(p).checks.find((c) => c.id === "loopNesting");
    expect(nesting?.status).toBe("fail");
    // Detailing: blocking error, no leg dropped, no parity problem.
    const d = buildDetail(p);
    expect(d.issues).toContainEqual(
      expect.objectContaining({ code: "nested-loops", severity: "error" }),
    );
    expect(validateRebarConsistency(d)).toEqual([]);
    const ties = d.bars.filter((b) => b.family === "tie");
    // Steel schedule: 2 loops × 2 legs.
    expect(ties.reduce((n, b) => n + 2 * b.quantity, 0)).toBe(4);
    // Sections A–A and B–B of the sheet and of the modelling view.
    const x1 = stirrupLayout(p).positions[0];
    expect(sectionBars(p, d, x1).ties).toHaveLength(4);
    expect(sectionBars(p, d, p.geometry.loadOffset).ties).toHaveLength(4);
    const n1 = section(p).match(/steel-N1[^]*?<\/g>/)![0];
    expect(n1.match(/<circle/g)).toHaveLength(4);
    // Plan and 3D.
    expect(legs(p, projectPlan(d))).toBe(4);
    expect(legs(p, scenePaths(d))).toBe(4);
    expect(
      buildSceneModel(p).steel.filter((s) => s.id === "N1").length * 2,
    ).toBe(4);
    // Texts announce exactly what is drawn.
    const sheet = svg(p);
    expect(sheet).toContain("Tirante: 4 ramos detalhados em 1 camada(s) ·");
    expect(sheet).toContain("Tirante detalhado: 4 ramos Ø20,0 / 1 camada(s)");
    expect(sheet).toContain("1ª: 4 ramos detalhados;");
    expect(sheet).not.toContain("declarado(s)");
  });

  it("CA2: a sugestão nunca entrega alças que geram nested-loops no detalhamento", () => {
    for (const width of [250, 300, 350, 400])
      for (const D of [100, 160]) {
        const p = shortFixture();
        p.geometry.width = width;
        p.design.bearingWidth = Math.min(p.design.bearingWidth, width - 50);
        p.design.loopInternalDiameter = D;
        const proposal = suggestReinforcement(p);
        if (!proposal.changed) continue;
        const d = buildDetail(proposal.piece);
        expect(
          d.issues.some((i) => i.code === "nested-loops"),
          `b=${width} D=${D}`,
        ).toBe(false);
        expect(proposal.result.checks.some((c) => c.id === "loopNesting")).toBe(
          false,
        );
      }
  });

  const variations: [string, (p: Piece) => void][] = [
    ["tieCount 2", (p) => (p.rebar.tieCount = 2)],
    ["tieCount 6", (p) => (p.rebar.tieCount = 6)],
    [
      "tieCount 8 / 2 camadas",
      (p) => ((p.rebar.tieCount = 8), (p.design.tieLayers = 2)),
    ],
    ["tieCount ímpar (alça)", (p) => (p.rebar.tieCount = 5)],
    [
      "soldada 5 ramos",
      (p) => ((p.design.frontAnchor = "welded"), (p.rebar.tieCount = 5)),
    ],
    ["stitchCount 9", (p) => (p.rebar.stitchCount = 9)],
    ["stitchCount 40", (p) => (p.rebar.stitchCount = 40)],
    ["lowerStitchCount 4", (p) => (p.design.lowerStitchCount = 4)],
    ["stirrupCount 1", (p) => (p.rebar.stirrupCount = 1)],
    ["stirrupCount 8", (p) => (p.rebar.stirrupCount = 8)],
    [
      "4 ramos com 8 N1",
      (p) => ((p.rebar.stirrupBranches = 4), (p.rebar.tieCount = 8)),
    ],
    [
      "4 ramos sem N1 centrais",
      (p) => ((p.rebar.stirrupBranches = 4), (p.rebar.tieCount = 2)),
    ],
    ["pins 3", (p) => (p.detailing.pins = 3)],
    [
      "pinos sem comprimento",
      (p) => (
        (p.detailing.pins = 2),
        (p.detailing.pinEmbedment = 0),
        (p.detailing.pinProjection = 0)
      ),
    ],
    [
      "viga, positiva 3",
      (p) => (
        (p.detailing.barArrangement = "beam"),
        (p.detailing.beamBottomCount = 3)
      ),
    ],
    [
      "viga, 6 ramos",
      (p) => ((p.detailing.barArrangement = "beam"), (p.rebar.tieCount = 6)),
    ],
    ["recorte", (p) => (p.design.excessConcrete = "remove")],
  ];
  it.each(variations)(
    "CA3: %s mantém paridade entre vistas e relação do aço; divergência de entrada só com erro explícito",
    (_name, change) => {
      const p = shortFixture();
      change(p);
      const d = buildDetail(p);
      const problems = validateRebarConsistency(d);
      // Views and schedule always show exactly the detailed bars.
      expect(problems.filter((x) => x.scope !== "entrada")).toEqual([]);
      // A declared count that cannot be detailed is a blocking error, stated
      // with both numbers in the issues and on the sheet.
      for (const problem of problems) {
        expect(d.issues).toContainEqual(
          expect.objectContaining({ code: problem.code, severity: "error" }),
        );
        expect(problem.message).toMatch(/\d+ .* esperados, \d+ encontrados/);
      }
      const placed = placedCounts(d),
        declared = declaredCounts(d);
      const sheet = svg(p);
      if (placed.tie !== declared.tie)
        expect(sheet).toContain(
          `${placed.tie} detalhado(s) de ${declared.tie} declarado(s)`,
        );
      else expect(sheet).toContain(`Tirante: ${placed.tie} ramos`);
    },
  );

  it("alças coincidentes na largura mínima aparecem todas no corte", () => {
    const p = shortFixture();
    p.geometry.width = 100;
    const d = buildDetail(p);
    expect(d.issues.some((i) => i.code === "nested-loops")).toBe(true);
    const x1 = stirrupLayout(p).positions[0];
    expect(sectionBars(p, d, x1).ties).toHaveLength(p.rebar.tieCount);
    expect(
      section(p)
        .match(/steel-N1[^]*?<\/g>/)![0]
        .match(/<circle/g),
    ).toHaveLength(p.rebar.tieCount);
  });

  it("CA3: contagens inviáveis são acusadas, nunca escondidas", () => {
    const odd = shortFixture();
    odd.rebar.tieCount = 5;
    const d = buildDetail(odd);
    expect(validateRebarConsistency(d).map((x) => x.code)).toContain(
      "parity-tie-entrada",
    );
    expect(d.issues.some((i) => i.code === "tie-even")).toBe(true);
    const noCentral = shortFixture();
    noCentral.rebar.stirrupBranches = 4;
    noCentral.rebar.tieCount = 2;
    const codes = validateRebarConsistency(buildDetail(noCentral)).map(
      (x) => x.code,
    );
    expect(codes).toContain("parity-stirrupInner-entrada");
    expect(codes).toContain("parity-constructive-entrada");
  });

  it("costuras sem faixa disponível continuam desenhadas e quantificadas", () => {
    // Same case as the e2e warning of tests/e2e/editor.spec.ts.
    const p = exampleProject().pieces[0];
    Object.assign(p.geometry, { height: 260, cover: 40, loadOffset: 95 });
    p.design.lowerStitchCount = 2;
    const d = buildDetail(p);
    expect(d.issues.some((i) => i.code.startsWith("zone-"))).toBe(true);
    const placed = placedCounts(d);
    expect(placed.stitch + placed.lower).toBe(
      p.rebar.stitchCount + p.design.lowerStitchCount,
    );
    expect(
      validateRebarConsistency(d).filter((x) => x.scope !== "entrada"),
    ).toEqual([]);
  });

  it("CA4: o validador acusa divergências injetadas artificialmente", () => {
    const d = buildDetail(shortFixture());
    expect(validateRebarConsistency(d)).toEqual([]);
    // 1. A physical bar removed from the model (drawn ≠ declared ≠ schedule).
    const removed = structuredClone(d);
    removed.bars.find((b) => b.family === "stitch")!.instances.pop();
    const a = validateRebarConsistency(removed).map((x) => x.code);
    expect(a).toContain("parity-stitch-entrada");
    expect(a).toContain("parity-stitch-relação do aço");
    // 2. The schedule announces one bar more than is placed.
    const scheduled = structuredClone(d);
    scheduled.bars.find((b) => b.family === "stirrup")!.quantity += 1;
    expect(validateRebarConsistency(scheduled).map((x) => x.code)).toEqual([
      "parity-stirrup-relação do aço",
    ]);
    // 3. A bar that no view can show (no placed part).
    const hidden = structuredClone(d);
    hidden.bars.find((b) => b.family === "constructive")!.instances[0].parts =
      [];
    const c = validateRebarConsistency(hidden).map((x) => x.code);
    expect(c).toContain("parity-constructive-elevação");
    expect(c).toContain("parity-constructive-planta");
    expect(c).toContain("parity-constructive-3D");
  });
});
