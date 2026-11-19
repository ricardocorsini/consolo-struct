import { describe, expect, it } from "vitest";
import {
  closedStirrup,
  roundedPath,
  samplePath,
  steelMass,
} from "../src/detailing/geometry";
import { buildDetail } from "../src/detailing/model";
import { combineDrawings, pieceDrawing } from "../src/detailing/drawing";
import { elevationShapes } from "../src/detailing/projection";
import { projectPlan } from "../src/detailing/rebarModel";
import {
  drawingDxf,
  drawingSvg,
  entitySvg,
  steelCsv,
} from "../src/detailing/exports";
import { buildSceneModel } from "../src/visualization/model3d";
import {
  decodeProject,
  exampleProject,
  newPiece,
  withTieDiameter,
} from "../src/domain/model";
import { tieLayout } from "../src/domain/engine";
import { stirrupLayout } from "../src/domain/theory";
import {
  toCalculationJson,
  toCsv,
  toDxf,
  toPdf,
  toSvg,
} from "../src/lib/exports";
import { cantileverFixture, shortFixture } from "./fixtures";

describe("Armaduras em escala geométrica (#69)", () => {
  it.each([10, 20])(
    "a prancha usa Ø%s em elevação, planta e nos dois cortes",
    (diameter) => {
      const p = shortFixture();
      p.design.frontAnchor = "welded";
      p.design.weldedBarDiameter = p.rebar.tieDiameter = diameter;
      const detail = buildDetail(p);
      const sheet = pieceDrawing(exampleProject(), detail);
      const x = p.geometry.columnWidth / 10 + 15;
      const front = x + (p.geometry.length - p.geometry.cover) / 10;
      const sectionX = x + p.geometry.length / 10 + 46;
      const elevationY = 52;
      const planY = elevationY + p.geometry.height / 10 + 55;
      const depth = tieLayout(p).rows[0].y / 10;
      const inset =
        (p.geometry.cover + p.rebar.stirrupDiameter + diameter / 2) / 10;
      const steel = sheet.entities.filter(
        (entity) => entity.layer === "ARMADURAS",
      );
      for (const y of [elevationY + depth, planY + inset]) {
        const line = steel.find(
          (entity) =>
            entity.type === "line" &&
            Math.abs(entity.a.y - y) < 1e-8 &&
            Math.abs(entity.b.y - y) < 1e-8 &&
            Math.max(entity.a.x, entity.b.x) === front,
        );
        expect(line).toMatchObject({ thickness: diameter / 10 });
        expect(entitySvg(line!)).toContain('stroke-linecap="butt"');
        expect(entitySvg(line!)).toContain(`stroke-width="${diameter / 10}"`);
        expect(front - p.geometry.length / 10 - x).toBeCloseTo(
          -p.geometry.cover / 10,
          8,
        );
      }
      for (const y of [elevationY + depth, planY + depth]) {
        const section = steel.find(
          (entity) =>
            entity.type === "circle" &&
            Math.abs(entity.center.x - sectionX - inset) < 1e-8 &&
            Math.abs(entity.center.y - y) < 1e-8,
        );
        expect(section).toMatchObject({ radius: diameter / 20 });
        expect(entitySvg(section!)).toContain('stroke="none"');
      }
      const n3Cap = steel.find(
        (e) =>
          e.type === "circle" &&
          e.projectionCap &&
          Math.abs(e.center.x - x - stirrupLayout(p).positions[0] / 10) <
            1e-8 &&
          Math.abs(e.center.y - elevationY - stirrupLayout(p).offset / 10) <
            1e-8,
      );
      if (n3Cap?.type !== "circle")
        throw new Error("Top of N3 projection missing");
      expect(n3Cap.center.y - n3Cap.radius - elevationY).toBeCloseTo(
        p.geometry.cover / 10,
        8,
      );
    },
  );

  it("o arco largo do DXF conserva o eixo, a bitola e o raio em cm", () => {
    const project = exampleProject();
    const drawing = pieceDrawing(project, buildDetail(project.pieces[0]));
    const arc = drawing.entities.find(
      (e) => e.type === "arc" && e.thickness === 2,
    );
    if (arc?.type !== "arc") throw new Error("Dobra de N1 Ø20 ausente");
    const dxf = drawingDxf({ ...drawing, entities: [arc] });
    expect(dxf).toContain("$INSUNITS\n70\n5\n");
    const tokens = dxf
      .split("0\nLWPOLYLINE\n")[1]
      .split("0\nENDSEC")[0]
      .split("\n");
    const values = (code: number) =>
      tokens.flatMap((field, i) =>
        i % 2 === 0 && field === String(code) ? [Number(tokens[i + 1])] : [],
      );
    const [ax, bx] = values(10);
    const [ay, by] = values(20);
    const [bulge] = values(42);
    const sweep = 4 * Math.atan(bulge);
    expect(values(43)).toEqual([2]);
    expect(sweep).toBeCloseTo(-arc.sweep, 7);
    expect(
      Math.hypot(bx - ax, by - ay) / (2 * Math.sin(Math.abs(sweep) / 2)),
    ).toBeCloseTo(arc.radius, 4);
    expect(ax).toBeCloseTo(arc.center.x + arc.radius * Math.cos(arc.start), 4);
    expect(-ay).toBeCloseTo(arc.center.y + arc.radius * Math.sin(arc.start), 4);
    expect(bx).toBeCloseTo(
      arc.center.x + arc.radius * Math.cos(arc.start + arc.sweep),
      4,
    );
    expect(-by).toBeCloseTo(
      arc.center.y + arc.radius * Math.sin(arc.start + arc.sweep),
      4,
    );
  });
});

describe("N1 reto com gancho e barra transversal soldada (#67)", () => {
  it("reproduz os 701,37 mm de desenvolvimento com um único BarPath", () => {
    const p = newPiece(1);
    const detail = buildDetail(p);
    const bar = detail.bars.find((b) => b.family === "tie")!;
    const [vertical, bend, horizontal] = bar.path.segments;
    expect(bar.path.valid).toBe(true);
    expect(bar.path.segments.map((s) => s.type)).toEqual([
      "line",
      "arc",
      "line",
    ]);
    if (
      vertical.type !== "line" ||
      bend.type !== "arc" ||
      horizontal.type !== "line"
    )
      throw new Error("Formato de N1 inesperado");
    expect(vertical.a.x).toBe(-265);
    expect(vertical.a.y - vertical.b.y).toBeCloseTo(160, 9);
    expect(bend.radius).toBe(90);
    expect(bend.sweep).toBeCloseTo(Math.PI / 2, 10);
    expect(bend.radius * bend.sweep).toBeCloseTo(141.37, 2);
    expect(horizontal.b.x - horizontal.a.x).toBeCloseTo(400, 10);
    expect(horizontal.b.x).toBe(225);
    expect(bar.mandrel).toBe(160);
    expect(bar.hookExtra).toBe(0);
    expect(bar.exactLength).toBe(bar.path.length);
    expect(bar.exactLength).toBeCloseTo(701.37, 2);
    expect(bar.cutLength).toBe(702);
    expect(
      bar.instances.every(
        (i) => i.parts.length === 1 && i.parts[0].plane === "xz",
      ),
    ).toBe(true);
    const weld = detail.result.checks.find((c) => c.id === "weldForce");
    expect(weld?.demand).toBeCloseTo(157079.63, 2);
    expect(weld?.capacity).toBe(0);
    expect(weld?.status).toBe("fail");
    const sheet = drawingSvg(pieceDrawing(exampleProject(), detail));
    expect(sheet).toContain("Gancho de 90° no suporte");
    expect(sheet).not.toContain("fora do plano da alça");
  });

  it("projeta TS tangente abaixo de N1 na elevação, na planta, no 3D e no quadro", () => {
    const p = newPiece(1);
    const detail = buildDetail(p);
    const bar = detail.bars.find((b) => b.family === "welded")!;
    const { x, z } = bar.locations[0];
    const { geometry: g, rebar: r } = p;
    expect(x).toBe(215);
    expect(z).toBeCloseTo(61.3, 9);
    expect(g.length - x - bar.diameter / 2).toBe(g.cover);
    expect(z - tieLayout(p).rows[0].y).toBeCloseTo(
      (r.tieDiameter + bar.diameter) / 2,
      9,
    );
    expect(z + bar.diameter / 2).toBeLessThanOrEqual(g.height / 5);
    expect(elevationShapes(p).find((s) => s.family === "welded")).toMatchObject(
      {
        center: { x, y: z },
        diameter: 20,
      },
    );
    expect(
      projectPlan(detail).find(({ bar }) => bar.family === "welded")?.shape,
    ).toMatchObject({
      kind: "path",
      path: { segments: [{ type: "line", a: { x, y: 25 }, b: { x, y: 275 } }] },
    });
    expect(buildSceneModel(p).steel.find((b) => b.id === "TS")?.points).toEqual(
      [
        [x, -125, -z],
        [x, 125, -z],
      ],
    );
    expect(drawingSvg(pieceDrawing(exampleProject(), detail))).toContain(
      "Barra transversal soldada",
    );
    expect(steelCsv([detail])).toContain(
      '"TS";"Barra transversal soldada";"CA-50";"20"',
    );
    expect(
      detail.issues
        .filter((i) => i.code.startsWith("weld-"))
        .map((i) => i.code),
    ).toEqual(["weld-review"]);
    const crowded = buildDetail(withTieDiameter(p, 25));
    expect(crowded.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "weld-depth", severity: "error" }),
        expect.objectContaining({
          code: "weld-stitch-clash",
          severity: "error",
        }),
      ]),
    );
  });
});

describe("Centro de gravidade das barras e comprimentos de oficina", () => {
  it("alça U inclui duas curvas de 90° sem somar os cantos virtuais", () => {
    const r = 58;
    const path = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 300 },
        { x: 0, y: 300 },
      ],
      r,
    );
    expect(path.valid).toBe(true);
    expect(path.length).toBeCloseTo(2300 + (Math.PI - 4) * r, 8);
    expect(path.segments.filter((s) => s.type === "arc")).toHaveLength(2);
    const points = samplePath(path);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 0, y: 300 });
  });
  it("estribo fechado soma três cantos de 90° e dois ganchos de 135°", () => {
    const path = closedStirrup(300, 400, 6.3, 18.9),
      radius = 12.6;
    expect(path.valid).toBe(true);
    expect(path.length).toBeCloseTo(1400 + (3 * Math.PI - 8) * radius + 100, 8);
    const arcs = path.segments.filter((s) => s.type === "arc");
    expect(arcs).toHaveLength(5);
    expect(arcs.reduce((s, a) => s + Math.abs(a.sweep), 0)).toBeCloseTo(
      3 * Math.PI,
      10,
    );
  });
  it("não reduz mandris para fazer uma forma impossível caber", () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
        ],
        40,
      ).valid,
    ).toBe(false);
    expect(closedStirrup(30, 40, 16, 80).valid).toBe(false);
  });
  it("massa usa comprimento desenvolvido e densidade de 7850 kg/m³", () => {
    expect(steelMass(1000, 10)).toBeCloseTo(0.616537558, 8);
  });
});
describe("Posições, tirante duplo e quadro de aço", () => {
  it("quatro ramos são duas alças e não quatro alças", () => {
    const detail = buildDetail(shortFixture());
    // The rounded N3 corner penetrates N1 by 0.601 mm; counting two loops
    // must not certify their physical clearance or suppress that diagnostic.
    expect(
      detail.issues.filter((i) => i.severity === "error").map((i) => i.code),
    ).toEqual(["transverse-tie-clash"]);
    const loops = detail.bars.filter((b) => b.family === "tie");
    expect(loops.reduce((n, b) => n + b.quantity, 0)).toBe(2);
    expect(loops).toHaveLength(2); // nested loops have different cut lengths
  });
  it("a segunda camada tem posição, mandril, comprimento e altura útil próprios", () => {
    const p = shortFixture();
    p.design.tieLayers = 2;
    p.detailing.secondLoopDiameter = 160;
    const detail = buildDetail(p),
      ties = detail.bars.filter((b) => b.family === "tie");
    expect(ties).toHaveLength(2);
    expect(ties[0].mandrel).toBe(100);
    expect(ties[1].mandrel).toBe(160);
    expect(ties[0].locations[0].z).toBeLessThan(ties[1].locations[0].z);
    expect(ties[0].cutLength).not.toBe(ties[1].cutLength);
    expect(detail.result.fingerprint).toContain('"tieLayers":2');
  });
  it("separa comprimentos variáveis dos estribos em cada x", () => {
    const p = shortFixture(),
      detail = buildDetail(p);
    const stirrups = detail.bars.filter((b) => b.family === "stirrup");
    expect(stirrups).toHaveLength(5);
    expect(new Set(stirrups.map((b) => b.cutLength)).size).toBe(5);
    expect(stirrups[0].cutLength).toBeGreaterThan(stirrups[4].cutLength);
    expect(stirrups.flatMap((b) => b.locations).at(-1)!.x).toBeCloseTo(
      p.geometry.length - p.geometry.cover - p.rebar.stirrupDiameter / 2,
      8,
    );
  });
  it("quantidades do tipo multiplicam barras e massa uma única vez", () => {
    const p = shortFixture();
    p.quantity = 7;
    const d = buildDetail(p);
    expect(d.totalMass).toBeCloseTo(d.mass * 7, 10);
    expect(d.steelSummary.reduce((s, v) => s + v.mass, 0)).toBeCloseTo(
      d.mass,
      10,
    );
    for (const b of d.bars) {
      expect(b.cutLength).toBeGreaterThanOrEqual(b.exactLength - 1e-6);
      expect(b.cutLength - b.exactLength).toBeLessThan(1.00001);
    }
  });
  it("denuncia alças que não cabem e ramos ímpares por camada", () => {
    const p = shortFixture();
    p.geometry.width = 220;
    expect(buildDetail(p).issues.some((i) => i.code === "nested-loops")).toBe(
      true,
    );
    p.geometry.width = 400;
    p.rebar.tieCount = 6;
    p.design.tieLayers = 2;
    expect(buildDetail(p).issues.some((i) => i.code === "tie-even")).toBe(true);
  });
  it("verifica o percurso real do gancho em vez de reutilizar o valor declarado", () => {
    const p = shortFixture();
    p.design.supportAnchor = "hook";
    p.detailing.supportHookProjection = 250;
    p.detailing.supportHookTail = 200;
    expect(buildDetail(p).issues.some((i) => i.code === "hook-available")).toBe(
      true,
    );
  });
  it("incorpora ancoragens adotadas no comprimento de corte de N1, N2/N2I e N4", () => {
    const p = shortFixture();
    p.design.supportAnchor = "hook";
    const d = buildDetail(p);
    p.detailing.supportHookTail = 158;
    p.detailing.stitchEmbedment = 250;
    const manual = buildDetail(p);
    const first = (detail: typeof d, mark: string) =>
      detail.bars.find((b) => b.mark.startsWith(mark))!;
    const { values } = d.result;
    expect(
      first(manual, "N1").exactLength - first(d, "N1").exactLength,
    ).toBeCloseTo(2 * (158 - values.anchorN1_tail), 8);
    for (const [mark, family, automatic] of [
      ["N2-", "stitch", values.anchorN2_adopted],
      ["N2I-", "lower", values.anchorN2I_adopted],
    ] as const) {
      const a = d.bars.find((b) => b.family === family)!;
      const b = manual.bars.find((b) => b.mark === a.mark)!;
      expect(a.mark.startsWith(mark.slice(0, -1))).toBe(true);
      expect(b.exactLength - a.exactLength).toBeCloseTo(
        2 * (250 - automatic),
        8,
      );
      expect(b.cutLength).toBe(Math.ceil(b.exactLength - 1e-7));
    }
    p.geometry.columnWidth = 140;
    const limited = buildDetail(p);
    expect(first(limited, "N4").exactLength).toBeCloseTo(
      first(d, "N4").exactLength -
        (values.anchorN4_adopted - limited.result.values.anchorN4_adopted),
      8,
    );
    expect(first(limited, "N4").cutLength).toBeLessThan(
      first(d, "N4").cutLength,
    );
  });
  it("pinos não ganham aprovação estrutural por serem desenhados", () => {
    const p = shortFixture();
    p.detailing.pins = 2;
    const d = buildDetail(p);
    expect(d.bars.find((b) => b.family === "pin")?.quantity).toBe(2);
    expect(d.issues.find((i) => i.code === "pins")?.severity).toBe("review");
  });
  it("detecta pino atravessando o tirante e permite ajustar a distribuição transversal", () => {
    const p = shortFixture();
    p.detailing.pins = 2;
    p.detailing.pinSpacing = 321.4;
    expect(buildDetail(p).issues.some((i) => i.code === "pin-tie-clash")).toBe(
      true,
    );
    p.detailing.pinSpacing = 0;
    expect(buildDetail(p).issues.some((i) => i.code === "pin-tie-clash")).toBe(
      false,
    );
  });
});
describe("Interoperabilidade e arquivos", () => {
  it("exporta a ancoragem por família e os limites nominal e no eixo", async () => {
    const p = shortFixture();
    p.geometry.columnWidth = 207;
    const project = { ...exampleProject(), pieces: [p] };
    const d = buildDetail(p);
    const audit = JSON.parse(toCalculationJson(project, p));
    expect(audit.result.values).toEqual(d.result.values);
    expect(audit.result.combinations[0].values).toEqual(
      d.result.combinations[0].values,
    );
    const [, header, row] = toCsv(project)
      .split("\r\n")
      .map((line) => line.split(";"));
    expect(row[header.indexOf('"N2 Limite nominal P − c (mm)"')]).toBe(
      '"182,000"',
    );
    expect(row[header.indexOf('"N2 Limite no eixo P − c − φ/2 (mm)"')]).toBe(
      '"178,850"',
    );
    const pdf = Buffer.from(await toPdf(project, p)).toString("latin1");
    expect(pdf).toContain("Ancoragem por familia de armadura");
    expect(pdf).toContain("Limite nominal P - c");
    expect(pdf).toContain("Limite no eixo P - c - phi/2");
  });
  it("migra esquemas 1 e 2 sem inventar aprovação do detalhamento", () => {
    const project = exampleProject();
    const legacy = {
      ...project,
      schemaVersion: 2,
      pieces: project.pieces.map(({ detailing: _d, ...p }) => p),
    };
    const converted = decodeProject(JSON.stringify(legacy));
    expect(converted.schemaVersion).toBe(6);
    expect(converted.pieces[0].detailing.revision).toBe("R00");
    converted.pieces[0].detailing.notes = "Dobra conferida";
    expect(decodeProject(JSON.stringify(converted))).toEqual(converted);
  });
  it("DXF trabalha em cm e mantém arcos e textos editáveis", () => {
    const p = shortFixture(),
      project = { ...exampleProject(), pieces: [p] };
    const drawing = pieceDrawing(project, buildDetail(p));
    const dxf = drawingDxf(drawing);
    expect(dxf).toContain("$INSUNITS\n70\n5\n");
    expect(dxf).toContain("\nLWPOLYLINE\n");
    expect(dxf).toContain("\n42\n");
    expect(dxf).toContain("AcDbText");
    expect(dxf).toContain("C unit cm");
    expect(dxf).toContain("FORMAS");
    expect(dxf).not.toContain("NaN");
  });
  it("exporta todos os tipos, com marcas locais e identidade preservada", () => {
    const project = exampleProject();
    project.pieces = [
      shortFixture(),
      { ...shortFixture(), id: "second", name: "Outro" },
    ];
    const drawings = project.pieces.map((p) =>
      pieceDrawing(project, buildDetail(p)),
    );
    const combined = combineDrawings(drawings);
    expect(drawingSvg(combined)).toContain("Outro");
    expect(combined.height).toBeGreaterThan(
      drawings[0].height + drawings[1].height,
    );
  });
  it("escapa SVG e fórmulas CSV nos campos editáveis", () => {
    const p = shortFixture();
    p.name = '=HYPERLINK("x")';
    p.detailing.notes = '<script>alert("x")</script>';
    const project = { ...exampleProject(), pieces: [p] };
    const svg = drawingSvg(pieceDrawing(project, buildDetail(p)));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(steelCsv([buildDetail(p)])).toContain("\"'=HYPERLINK");
  });
});
describe("Viga em balanço (1 < a/d ≤ 2)", () => {
  it("detalha, desenha e exporta sem depender de valores de bielas", () => {
    for (const p of [
      cantileverFixture(),
      cantileverFixture({ vertical: 350000, loadOffset: 700, length: 800 }),
      cantileverFixture({ height: 700, loadOffset: 1000, length: 1100 }),
    ]) {
      const detail = buildDetail(p);
      expect(detail.result.combinations[0].method).toBe("beam");
      expect(detail.bars.length).toBeGreaterThan(0);
      const project = { ...exampleProject(), pieces: [p] };
      const drawing = pieceDrawing(project, detail);
      for (const text of [
        drawingDxf(drawing),
        drawingSvg(drawing),
        steelCsv([detail]),
        toCsv(project),
        toDxf(p),
        toSvg(p),
      ])
        expect(text).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
  it("o passo de N3 verificado pelo motor é o mesmo do detalhamento", () => {
    const p = cantileverFixture();
    p.rebar.stirrupCount = 7;
    const drawn = buildDetail(p)
      .bars.filter((b) => b.family === "stirrup")
      .map((b) => b.locations[0].x);
    const layout = stirrupLayout(p);
    expect(drawn).toEqual(layout.positions);
    expect(drawn[1] - drawn[0]).toBeCloseTo(layout.pitch, 10);
    const spacing = buildDetail(p).result.checks.find(
      (c) => c.id === "beamStirrupSpacing",
    )!;
    expect(spacing.demand).toBeCloseTo(layout.pitch, 10);
  });
});
