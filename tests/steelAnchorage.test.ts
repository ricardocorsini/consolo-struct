import { describe, expect, it } from "vitest";
import { calculate, materialProperties, tieLayout } from "../src/domain/engine";
import { basicAnchorage, requiredAnchorage } from "../src/domain/anchorage";
import { suggestReinforcement } from "../src/domain/autodesign";
import {
  decodeProject,
  exampleProject,
  fingerprint,
} from "../src/domain/model";
import { bondCoefficientEta1, steelBondDescription } from "../src/domain/steel";
import { closedStirrup, mandrelDiameter } from "../src/detailing/geometry";
import { buildDetail } from "../src/detailing/model";
import { toCalculationJson } from "../src/lib/exports";
import { cantileverFixture, shortFixture } from "./fixtures";

describe("Referências numéricas de ancoragem da issue #65", () => {
  it.each([
    ["N1", 20, 0.7, 0.7, 0.8, 953.07, 533.72],
    ["N2 com redução", 6.3, 0.7, 0.7, 0.85, 300.22, 178.63],
    ["N2 sem redução", 6.3, 0.7, 1, 1, 300.22, 300.22],
    ["N4 em má aderência", 8, 0.7, 1, 0, 381.23, 114.37],
    ["N4 em boa aderência", 8, 1, 1, 0, 266.86, 100],
  ] as const)(
    "%s em C30 e CA-50",
    (_name, diameter, eta2, alpha, ratio, expectedLb, expectedRequired) => {
      const material = materialProperties(30, 500, 500, 1.4, 1.15);
      const { fbd, lb } = basicAnchorage({
        diameter,
        fyd: material.fyd,
        fctd: material.fctd,
        eta1: bondCoefficientEta1("CA-50"),
        eta2,
      });
      expect(fbd).toBeCloseTo(eta2 === 0.7 ? 2.280969 : 3.258527, 6);
      expect(Math.abs(lb - expectedLb)).toBeLessThanOrEqual(0.02);
      expect(
        Math.abs(
          requiredAnchorage(diameter, lb, alpha * lb * ratio) -
            expectedRequired,
        ),
      ).toBeLessThanOrEqual(0.02);
    },
  );

  it("o estribo fechado de Ø6,3 mm requer 60,56 mm entre eixos", () => {
    const diameter = 6.3;
    const mandrel = mandrelDiameter(diameter, 500, true);
    expect(mandrel).toBeCloseTo(18.9, 12);
    expect(closedStirrup(60.56, 60.56, diameter, mandrel).valid).toBe(true);
    expect(closedStirrup(60.54, 60.56, diameter, mandrel).valid).toBe(false);
    expect(closedStirrup(60.56, 60.54, diameter, mandrel).valid).toBe(false);
  });
});

const verification = (result: ReturnType<typeof calculate>, id: string) =>
  result.checks.find((c) => c.id === id);

describe("Ancoragem física por família", () => {
  it("dimensiona o gancho automático de N1 e verifica projeção, ponta e altura manual", () => {
    const p = shortFixture();
    p.design.supportAnchor = "hook";
    const automatic = calculate(p);
    const { values: v } = automatic;
    expect(verification(automatic, "anchorage")?.status).toBe("pass");
    expect(verification(automatic, "anchorN1HookHeight")?.status).toBe("pass");
    expect(v.anchorN1_adopted + p.rebar.tieDiameter / 2).toBeCloseTo(
      v.anchorN1_required,
      9,
    );
    expect(v.anchorN1_tail).toBe(8 * p.rebar.tieDiameter);
    expect(v.anchorN1_developed).toBeGreaterThan(v.anchorN1_available);
    p.detailing.supportHookProjection = 250;
    p.detailing.supportHookTail = 127;
    const short = calculate(p);
    expect(verification(short, "anchorage")?.status).toBe("fail");
    expect(verification(short, "anchorN1HookTail")?.status).toBe("fail");
    p.detailing.supportHookTail = 500;
    p.geometry.columnWidth = 260;
    const tight = calculate(p);
    expect(verification(tight, "anchorN1HookHeight")?.status).toBe("fail");
    expect(verification(tight, "anchorN1HookCover")?.status).toBe("fail");
  });

  it("reserva a projeção automática para as camadas ocupadas e verifica a mais interna", () => {
    const p = shortFixture();
    p.design.frontAnchor = "welded";
    p.design.supportAnchor = "hook";
    p.design.tieLayers = 2;
    p.design.aggregate = 50;
    p.geometry.columnWidth = 1500;
    p.design.supportAnchorLength = 1400;
    const detail = buildDetail(p);
    const ties = detail.bars.filter((bar) => bar.family === "tie");
    const inner =
      detail.result.values.anchorN1_required - p.rebar.tieDiameter / 2;
    const pitch = 41;
    expect(verification(detail.result, "anchorage")?.status).toBe("pass");
    expect(ties).toHaveLength(2);
    expect(ties[0].anchorage[0].projection).toBeCloseTo(inner + pitch, 8);
    expect(ties[1].anchorage[0].projection).toBeCloseTo(inner, 8);
    expect(detail.result.values.anchorN1_adopted).toBeCloseTo(inner, 8);
    expect(detail.result.values.anchorN1_developed).toBe(
      ties[1].anchorage[0].length,
    );

    p.design.supportAnchorLength = detail.result.values.anchorN1_required + 20;
    const limited = buildDetail(p);
    const check = verification(limited.result, "anchorage")!;
    expect(check.status).toBe("fail");
    expect(check.capacity).toBeCloseTo(p.design.supportAnchorLength - pitch, 8);
    expect(check.detail).toContain("Camada 1");
    expect(check.detail).toContain("Camada 2");
    expect(verification(limited.result, "anchorN1HookCover")?.status).toBe(
      "pass",
    );
    expect(
      limited.issues.find((issue) => issue.code === "hook-available")?.message,
    ).toContain("Camada(s) 2.");

    p.design.tieLayers = 4;
    p.rebar.tieCount = 2;
    const preview = buildDetail(p);
    const radius =
      (mandrelDiameter(p.rebar.tieDiameter, p.materials.fyk) +
        p.rebar.tieDiameter) /
      2;
    expect(preview.result.status).toBe("invalid");
    expect(
      preview.bars
        .filter((bar) => bar.family === "tie")
        .map((bar) => bar.anchorage[0].projection),
    ).toEqual([radius + pitch, radius]);
  });

  it("verifica o cobrimento na primeira camada e o espaço de dobra e ponta na interna", () => {
    const p = shortFixture();
    p.design.supportAnchor = "hook";
    p.design.tieLayers = 2;
    p.geometry.columnWidth = 650;
    p.detailing.supportHookProjection = 620;
    const phi = p.rebar.tieDiameter;
    const radius = (mandrelDiameter(phi, p.materials.fyk) + phi) / 2;
    const [top, bottom] = tieLayout(p).rows;
    const height = p.geometry.height - p.geometry.cover - radius;
    p.detailing.supportHookTail = height - top.y;

    const tight = calculate(p);
    const cover = verification(tight, "anchorN1HookCover")!;
    expect(cover).toMatchObject({ status: "fail", demand: 628, capacity: 625 });
    expect(cover.detail).toContain("camada 1");
    const leg = verification(tight, "anchorN1HookHeight")!;
    expect(leg.status).toBe("fail");
    expect(leg.capacity).toBeCloseTo(height - bottom.y, 8);
    expect(leg.detail).toContain("camada 2");

    p.detailing.supportHookProjection = 60;
    p.detailing.supportHookTail = 8 * phi;
    const shortBend = buildDetail(p);
    const bend = verification(shortBend.result, "anchorN1HookBend")!;
    expect(bend).toMatchObject({ status: "fail", demand: 56, capacity: 32 });
    expect(
      shortBend.issues.find((issue) => issue.code === "hook-fit")?.message,
    ).toContain("Camada(s) 2.");
  });

  it.each(["N2", "N2I"] as const)(
    "%s reprova quando cabe na distância nominal e falta espaço no eixo",
    (family) => {
      const p = shortFixture();
      if (family === "N2I") {
        p.geometry.loadOffset = 175;
        p.design.lowerStitchCount = 2;
      }
      const lookup = (field: string) => `anchor${family}_${field}`;
      const initial = calculate(p);
      const necessary = initial.values[lookup("required")];
      const phi = p.rebar.stitchDiameter;
      expect(verification(initial, `anchor${family}`)?.status).toBe("pass");
      p.geometry.columnWidth = necessary + p.geometry.cover + phi / 4;
      const tight = calculate(p);
      expect(tight.values[lookup("nominal")]).toBeGreaterThan(necessary);
      expect(tight.values[lookup("axis")]).toBeCloseTo(necessary - phi / 4, 10);
      expect(tight.values[lookup("adopted")]).toBe(
        tight.values[lookup("axis")],
      );
      expect(verification(tight, `anchor${family}`)).toMatchObject({
        demand: necessary,
        capacity: tight.values[lookup("axis")],
        status: "fail",
      });
    },
  );

  it("usa o aço secundário e a posição da camada na aderência das costuras", () => {
    const p = shortFixture();
    p.design.bond = "good";
    p.materials.fykTransverse = 600;
    const good = calculate(p).values;
    expect(good.anchorN2_eta2).toBe(0.7);
    expect(good.anchorN2I_eta2).toBe(1);
    expect(good.anchorN2_lb).toBeCloseTo(
      Math.max(
        25 * p.rebar.stitchDiameter,
        (p.rebar.stitchDiameter * 435) / (4 * good.anchorN2_fbd),
      ),
      9,
    );
    expect(good.anchorN2I_required).toBeCloseTo(good.anchorN2I_lb * 0.3, 9);
    p.design.bond = "poor";
    p.design.anchorRatioFloor = true;
    const poor = calculate(p).values;
    expect(poor.anchorN2I_eta2).toBe(0.7);
    expect(poor.anchorN2I_ratio).toBe(0);
    expect(poor.anchorN2I_required).toBeCloseTo(poor.anchorN2I_lb * 0.3, 9);
    expect(poor.anchorN2_ratio).toBeGreaterThanOrEqual(1);
  });

  it("verifica o comprimento e a ponta reta disponível de N4", () => {
    const p = shortFixture();
    const adequate = calculate(p);
    expect(adequate.values.anchorN4_required).toBeCloseTo(114.37, 2);
    expect(verification(adequate, "anchorN4Front")?.status).toBe("pass");
    expect(verification(adequate, "anchorN4Tail")?.status).toBe("pass");
    p.geometry.columnWidth = 140;
    const narrow = calculate(p);
    expect(narrow.values.anchorN4_nominal).toBe(115);
    expect(narrow.values.anchorN4_axis).toBe(111);
    expect(verification(narrow, "anchorN4")).toMatchObject({
      status: "fail",
      capacity: 111,
    });
    p.geometry.tipHeight = 130;
    const shallow = calculate(p);
    expect(verification(shallow, "anchorN4Tail")).toMatchObject({
      status: "fail",
      demand: 64,
    });
    expect(shallow.values.anchorN4_tailAvailable).toBeLessThan(64);
  });

  it("confere cada fechamento de N3 e N3G pela menor dimensão entre eixos", () => {
    const p = shortFixture();
    p.rebar.stirrupBranches = 4;
    const adequate = calculate(p);
    expect(verification(adequate, "anchorN3GClosure")?.status).toBe("pass");
    expect(adequate.values.anchorN3G_required).toBeCloseTo(60.56, 2);
    p.geometry.width = 230;
    expect(verification(calculate(p), "anchorN3GClosure")?.status).toBe("fail");
    p.geometry.tipHeight = 90;
    const shallow = calculate(p);
    expect(shallow.values.anchorN3_height).toBeLessThan(
      shallow.values.anchorN3_required,
    );
    expect(verification(shallow, "anchorN3Closure")?.status).toBe("fail");
  });

  it("verifica P1 pelo menor percurso dos extremos e mantém as ligações externas em conferência", () => {
    const p = shortFixture();
    p.detailing.barArrangement = "beam";
    p.geometry.tipHeight = 450;
    const adequate = calculate(p);
    expect(verification(adequate, "anchorP1")?.status).toBe("pass");
    expect(adequate.values.anchorP1_available).toBe(
      Math.min(
        adequate.values.anchorP1_developed,
        adequate.values.anchorP1_front,
      ),
    );
    p.geometry.tipHeight = 140;
    const shallow = calculate(p);
    expect(verification(shallow, "anchorP1")?.status).toBe("fail");
    expect(verification(shallow, "anchorP1Tail")?.status).toBe("fail");
    p.design.splittingCount = 1;
    p.design.suspensionCount = 1;
    p.detailing.pins = 1;
    const external = calculate(p);
    for (const mark of ["N5", "N6", "PINO"])
      expect(verification(external, `anchor${mark}Review`)?.status).toBe(
        "review",
      );
  });

  it("preserva entradas manuais no esquema 6 e usa zero quando ausentes", () => {
    const project = exampleProject();
    const p = project.pieces[0];
    const manual = {
      supportHookProjection: 250,
      supportHookTail: 200,
      stitchEmbedment: 200,
    };
    Object.assign(p.detailing, manual);
    expect(
      decodeProject(JSON.stringify(project)).pieces[0].detailing,
    ).toMatchObject(manual);
    const legacy = JSON.parse(JSON.stringify(project));
    for (const key of Object.keys(manual))
      delete legacy.pieces[0].detailing[key];
    expect(
      decodeProject(JSON.stringify(legacy)).pieces[0].detailing,
    ).toMatchObject({
      supportHookProjection: 0,
      supportHookTail: 0,
      stitchEmbedment: 0,
    });
  });
});

describe("Classes de aço com ancoragem e busca integradas (#3 + #12 + #16)", () => {
  it.each([250, 500, 600])(
    "preserva fyk=%s, opções físicas e pendências na busca",
    (fyk) => {
      for (const welded of [false, true])
        for (const floor of [false, true])
          for (const fixture of [
            shortFixture,
            () => cantileverFixture({ length: 700 }),
          ]) {
            const input = fixture();
            input.materials.fyk = fyk;
            input.design.supportWeldedBar = welded;
            input.design.anchorRatioFloor = floor;
            input.design.supportAnchor = "hook";
            input.design.hookNormalCover = 75;
            const before = structuredClone(input);
            const proposal = suggestReinforcement(input);
            expect(input).toEqual(before);
            expect(proposal.piece.materials).toEqual(input.materials);
            expect(proposal.piece.design.supportWeldedBar).toBe(welded);
            expect(proposal.piece.design.anchorRatioFloor).toBe(floor);
            expect(proposal.result).toEqual(calculate(proposal.piece));
            expect(proposal.result.fingerprint).toBe(
              fingerprint(proposal.piece),
            );
            for (const c of proposal.result.combinations) {
              const v = c.values;
              const alpha = welded ? 0.5 : 0.7;
              const ratio = v.tieRequired / v.tieProvided;
              const used = floor ? Math.max(1, ratio) : ratio;
              expect(v.anchorAlpha).toBe(alpha);
              expect(v.anchorRatio).toBe(used);
              expect(v.anchorWeldedBar).toBe(Number(welded));
              expect(v.anchorRatioFloor).toBe(Number(floor));
              expect(v.anchorRequired).toBe(
                Math.max(
                  alpha * v.lb * used,
                  0.3 * v.lb,
                  10 * proposal.piece.rebar.tieDiameter,
                  100,
                ),
              );
              expect(
                c.checks.find((ch) => ch.id === "anchorWeldedBar")?.status,
              ).toBe(welded ? "review" : undefined);
            }
          }
      if (fyk === 600)
        expect(steelBondDescription(fyk)).toContain("pendente de confirmação");
    },
  );
  it("preserva opções físicas e aço legado sem tornar o projeto calculável", () => {
    const project = exampleProject();
    const input = shortFixture();
    input.materials.fyk = 420.5;
    input.design.supportWeldedBar = true;
    input.design.anchorRatioFloor = true;
    project.pieces = [input];
    const restored = decodeProject(JSON.stringify(project));
    expect(restored).toEqual(project);
    const proposal = suggestReinforcement(restored.pieces[0]);
    expect(proposal.changed).toBe(false);
    expect(proposal.piece).toEqual(input);
    expect(proposal.result.status).toBe("unsupported");
    const audit = JSON.parse(toCalculationJson(restored, restored.pieces[0]));
    expect(audit.input).toEqual(input);
    expect(audit.result).toEqual(calculate(input));
  });
});
