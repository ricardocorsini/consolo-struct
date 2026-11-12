import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  calculate,
  materialProperties,
  type CalculationResult,
} from "../src/domain/engine";
import { corbelDuctility, ductilityRows } from "../src/domain/ductility";
import { suggestReinforcement } from "../src/domain/autodesign";
import { decodeProject, exampleProject, newPiece } from "../src/domain/model";
import { toCalculationJson, toCsv, toPdf } from "../src/lib/exports";
import CalculationReport from "../src/components/CalculationReport";
import { cantileverFixture, shortFixture } from "./fixtures";
import { withoutAddedDuctility } from "./reference/without-added-ductility";

const ids = ["ductilityXd", "maxSteel", "plasticRotation"];
function reference(method: "strut" | "friction", a = 125) {
  const p = newPiece(1);
  p.id = "ductility-reference";
  p.name = "Ductilidade";
  Object.assign(p.geometry, { length: 400, loadOffset: a, columnWidth: 600 });
  Object.assign(p.design, {
    method,
    forceMode: "design",
    horizontalMode: "analysis",
    horizontalJustification: "Esforços simultâneos do exemplo da issue #4.",
    literatureRecommendations: false,
    bearingHeight: 0,
    bearingWidth: 300,
    bearingLength: 100,
    inputsConfirmed: true,
  });
  p.loads.vertical = 588000;
  p.loads.horizontal = 94080;
  return p;
}
const check = (r: CalculationResult, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("Ductilidade — referências numéricas independentes da issue #4", () => {
  it.each(["strut", "friction"] as const)(
    "reproduz seção e máximo em %s",
    (method) => {
      const r = calculate(reference(method)),
        v = r.values;
      expect(r.status).not.toBe("invalid");
      expect(r.status).not.toBe("unsupported");
      expect(v.dPrime).toBeCloseTo(41.3, 10);
      expect(v.d).toBeCloseTo(358.7, 10);
      expect(v.tieProvided).toBeCloseTo(1256.6370614359173, 9);
      expect(v.ductility_x).toBeCloseTo(106.23743273008961, 9);
      expect(v.ductility_xd).toBeCloseTo(0.29617349520515646, 12);
      expect(v.maxSteel).toBe(4800);
      expect(check(r, "ductilityXd")).toMatchObject({
        status: "pass",
        demand: v.ductility_xd,
        capacity: 0.45,
      });
      expect(check(r, "maxSteel")).toMatchObject({
        status: "pass",
        demand: v.tieProvided,
        capacity: 4800,
      });
      for (const id of ids) {
        expect(r.checks.filter((c) => c.id === id)).toHaveLength(1);
        expect(check(r, id).reference).toContain("citad");
        expect(check(r, id).reference).toContain("GN Corbel");
        expect(check(r, id).formula).not.toBe("");
      }
      if (method === "friction")
        expect(check(r, "ductility").status).toBe("review");
    },
  );
  it.each([
    [
      125,
      192.74881996434937,
      81526.40640087568,
      73.1717064792428,
      0.254989219679547,
      "pass",
    ],
    [
      250,
      317.74881996434937,
      50955.996418701005,
      132.96565077795313,
      0.46335953017128917,
      "fail",
    ],
  ] as const)("rotação com a=%s mm", (a, aexc, radicand, x, ratio, status) => {
    for (const method of (a === 250 ? ["strut"] : ["strut", "friction"]) as (
      | "strut"
      | "friction"
    )[]) {
      const r = calculate(reference(method, a)),
        v = r.values;
      expect(v.plastic_fcdCCC).toBeCloseTo(16.02857142857143, 12);
      expect(v.plastic_a1).toBeCloseTo(122.28163992869874, 10);
      expect(v.plastic_aexc).toBeCloseTo(aexc, 10);
      expect(v.plastic_radicand).toBeCloseTo(radicand, 8);
      expect(v.plastic_x).toBeCloseTo(x, 10);
      expect(v.plastic_ratio).toBeCloseTo(ratio, 12);
      expect(check(r, "plasticRotation")).toMatchObject({
        status,
        demand: v.plastic_ratio,
        capacity: 0.45,
      });
    }
  });
  it.each([50, 50.001, 60, 90])("usa λ e limite corretos em C%s", (fck) => {
    for (const method of ["strut", "friction"] as const) {
      const p = reference(method);
      p.materials.fck = fck;
      const r = calculate(p),
        v = r.values;
      expect(v.lambda).toBe(fck <= 50 ? 0.8 : 0.8 - (fck - 50) / 400);
      expect(v.ductility_limit).toBe(fck <= 50 ? 0.45 : 0.35);
      expect(check(r, "ductilityXd").capacity).toBe(v.ductility_limit);
      expect(check(r, "plasticRotation").capacity).toBe(v.ductility_limit);
      if (fck === 60) {
        expect(v.lambda).toBe(0.775);
        expect(v.ductility_limit).toBe(0.35);
      }
    }
  });
  it("usa fyd=fyk/γs sem limitar a 435 MPa e os coeficientes adotados", () => {
    const p = reference("strut");
    p.materials.fyk = 600;
    Object.assign(p.design, { gammaC: 1.3, gammaS: 1.1 });
    const v = calculate(p).values;
    expect(v.fyd).toBeCloseTo(600 / 1.1, 12);
    expect(v.fydLimited).toBe(435);
    expect(v.ductility_x).toBeCloseTo(
      (400 * Math.PI * (600 / 1.1)) / (0.8 * 300 * (30 / 1.3)),
      10,
    );
    expect(v.plastic_fcdCCC).toBeCloseTo(0.85 * 0.88 * (30 / 1.3), 12);
  });
  it("conserva os esforços já majorados e usa as ações características uma única vez", () => {
    const p = reference("friction"),
      r = calculate(p);
    p.design.forceMode = "characteristic";
    p.design.horizontalMode = "estimated";
    p.design.supportType = "elastomer";
    p.loads = { vertical: 350000, horizontal: 0, gamma: 1.4 };
    const v = calculate(p).values;
    expect(v.vertical).toBeCloseTo(588000, 8);
    expect(v.horizontal).toBeCloseTo(94080, 8);
    expect(v.plastic_ratio).toBeCloseTo(r.values.plastic_ratio, 12);
  });
  it("usa b da seção, independentemente da largura do apoio", () => {
    const p = reference("strut"),
      r = calculate(p);
    p.design.bearingWidth = 100;
    const changed = calculate(p);
    for (const key of [
      "ductility_x",
      "ductility_xd",
      "maxSteel",
      "plastic_fcdCCC",
      "plastic_a1",
      "plastic_aexc",
      "plastic_radicand",
      "plastic_x",
      "plastic_ratio",
    ])
      expect(changed.values[key]).toBe(r.values[key]);
  });
  it("usa a reação de cálculo e peso próprio já calculados, sem alterar sua fórmula", () => {
    const p = reference("strut", 295);
    p.design.reactionPosition = "threeQuarter";
    const v = calculate(p).values;
    expect(v.a).toBe(300);
    expect(v.plastic_aexc).toBeCloseTo(
      v.plastic_a1 / 2 + 300 + (94080 / 588000) * 41.3,
      10,
    );
    p.design.reactionPosition = "specified";
    p.design.forceMode = "characteristic";
    p.design.horizontalMode = "estimated";
    p.design.includeSelfWeight = true;
    p.loads = { vertical: 350000, horizontal: 0, gamma: 1.4 };
    const weighted = calculate(p).values;
    expect(weighted.selfWeight).toBeGreaterThan(0);
    expect(weighted.plastic_a1).toBeCloseTo(
      weighted.vertical / (300 * weighted.plastic_fcdCCC),
      10,
    );
  });
});

describe("Ductilidade — falhas, domínio e envelope", () => {
  it.each(["strut", "friction"] as const)(
    "radicando negativo em %s é fail sem valor ou sentinela",
    (method) => {
      const p = reference(method);
      p.loads.vertical = 5e6;
      const r = calculate(p),
        v = r.values;
      expect(r.status).toBe("fail");
      expect(v.plastic_radicand).toBeLessThan(0);
      expect(v).not.toHaveProperty("plastic_x");
      expect(v).not.toHaveProperty("plastic_ratio");
      expect(Object.values(v).every(Number.isFinite)).toBe(true);
      expect(check(r, "plasticRotation")).toMatchObject({
        status: "fail",
        demand: null,
        capacity: 0.45,
        utilization: null,
      });
      expect(check(r, "plasticRotation").detail).toContain("Sem solução");
      expect(
        ductilityRows(v).filter((row) => row.value === undefined),
      ).toHaveLength(2);
    },
  );
  it("radicando zero mantém a solução real x=d, sem arredondar", () => {
    const data = {
      b: 1,
      h: 200,
      d: 100,
      dPrime: 20,
      a: 0,
      vertical: 8500,
      horizontal: 0,
      asTie: 10,
      fck: 30,
      fcd: 100,
      fyd: 10,
      lambda: 0.8,
      alphaV2: 1,
    };
    const values = corbelDuctility(data);
    expect(values.plastic_radicand).toBe(0);
    expect(values.plastic_x).toBe(100);
    expect(values.plastic_ratio).toBe(1.25);
    const negative = corbelDuctility({ ...data, a: 0.0000001 });
    expect(negative.plastic_radicand).toBeLessThan(0);
    expect(negative).not.toHaveProperty("plastic_x");
  });
  it("reprova x/d e As acima de 4% Ac com a demanda/capacidade na ordem correta", () => {
    const p = reference("friction");
    p.rebar.tieDiameter = 40;
    p.design.tieLayers = 3;
    const r = calculate(p);
    expect(r.values.tieProvided).toBeGreaterThan(4800);
    for (const id of ["ductilityXd", "maxSteel"]) {
      const c = check(r, id);
      expect(c.status).toBe("fail");
      expect(c.demand!).toBeGreaterThan(c.capacity!);
      expect(c.utilization).toBeGreaterThan(1);
    }
  });
  it("cada verificação usa seu caso crítico sem misturar V/H", () => {
    const p = shortFixture();
    p.design.bearingHeight = 0;
    p.loads.vertical = 100000;
    p.loads.horizontal = 400000;
    p.design.combinations = [
      { name: "V dominante", vertical: 600000, horizontal: 0, gamma: 1.4 },
    ];
    const r = calculate(p);
    expect(r.combinations).toHaveLength(2);
    expect(r.governingCase).toBe("Principal");
    expect(check(r, "plasticRotation").detail).toContain("[V dominante]");
    expect(check(r, "plasticRotation").demand).toBe(
      r.combinations[1].values.plastic_ratio,
    );
    expect(check(r, "ductilityXd").detail).toContain("[Principal]");
    for (const c of r.combinations) {
      const v = c.values;
      expect(v.plastic_aexc).toBeCloseTo(
        v.plastic_a1 / 2 + v.a + (v.horizontal / v.vertical) * v.dPrime,
        12,
      );
    }
  });
  it.each([false, true])(
    "ausência de raiz governa também sobre falha finita, ordem invertida=%s",
    (reverse) => {
      const p = shortFixture();
      p.design.bearingHeight = 0;
      p.loads.vertical = reverse ? 1800000 : 1200000;
      p.loads.horizontal = 0;
      p.design.combinations = [
        {
          name: "Outro",
          vertical: reverse ? 1200000 : 1800000,
          horizontal: 0,
          gamma: 1.4,
        },
      ];
      const r = calculate(p),
        c = check(r, "plasticRotation");
      expect(c.status).toBe("fail");
      expect(c.demand).toBeNull();
      expect(c.detail).toContain(reverse ? "[Principal]" : "[Outro]");
      expect(
        r.combinations.some(
          (c) =>
            c.values.plastic_ratio !== undefined &&
            c.values.plastic_ratio > 0.45,
        ),
      ).toBe(true);
    },
  );
  it("a sugestão inclui as novas restrições e conserva a pendência do atrito", () => {
    for (const friction of [false, true]) {
      const p = shortFixture();
      if (friction) p.geometry.loadOffset = 180;
      const proposal = suggestReinforcement(p);
      expect(proposal.changed).toBe(true);
      for (const id of ids)
        expect(check(proposal.result, id).status).toBe("pass");
      if (friction)
        expect(check(proposal.result, "ductility").status).toBe("review");
    }
    const impossible = reference("strut");
    impossible.loads.vertical = 1e7;
    const before = structuredClone(impossible);
    const proposal = suggestReinforcement(impossible);
    expect(proposal.changed).toBe(false);
    expect(impossible).toEqual(before);
  });
  it("não acrescenta as verificações aos casos fora do domínio ou a viga", () => {
    const p = reference("strut");
    p.loads.vertical = 0;
    expect(calculate(p).checks).toEqual([]);
    const outsideFriction = calculate(reference("friction", 250));
    expect(outsideFriction.status).toBe("unsupported");
    expect(outsideFriction.checks).toEqual([]);
    const beam = calculate(cantileverFixture());
    expect(beam.checks.some((c) => ids.includes(c.id))).toBe(false);
    expect(
      Object.keys(beam.values).some(
        (key) => key.startsWith("plastic_") || key.startsWith("ductility_"),
      ),
    ).toBe(false);
    expect(withoutAddedDuctility(beam)).toEqual(beam);
  });
});

describe("Ductilidade — exemplos oficiais e saídas", () => {
  it.each([
    ["examples/casos-validacao.lume.json", ["pass", "review", "review"]],
    ["examples/detalhamento/consolos-detalhados.lume.json", ["pass", "pass"]],
    [
      "examples/base-consolo.lume.json",
      ["pass", "pass", "fail", "unsupported"],
    ],
    ["examples/pavilhao-horizonte.lume.json", ["fail", "fail"]],
  ])("preserva todos os estados oficiais de %s", (path, expected) => {
    const project = decodeProject(readFileSync(path as string, "utf8"));
    expect(project.pieces.map((p) => calculate(p).status)).toEqual(expected);
    for (const p of project.pieces)
      for (const c of calculate(p).combinations)
        for (const id of ids)
          if (c.method !== "beam")
            expect(c.checks.find((c) => c.id === id)?.status).toBe("pass");
  });
  it.each([false, true])(
    "tela, memória, PDF, CSV e auditoria: sem solução=%s",
    async (unsolved) => {
      const p = reference("strut", 250);
      if (unsolved) p.loads.vertical = 5e6;
      const project = { ...exampleProject(), pieces: [p] },
        r = calculate(p),
        html = renderToStaticMarkup(
          createElement(CalculationReport, { result: r }),
        );
      for (const c of r.checks.filter((c) => ids.includes(c.id)))
        expect(html).toContain(c.label.replaceAll("&", "&amp;"));
      const csv = toCsv(project);
      for (const id of ids) {
        expect(csv).toContain(`${id} formula`);
        expect(csv).toContain(`${id} referencia`);
      }
      expect(csv).toContain("GN Corbel");
      const pdf = new TextDecoder("latin1").decode(await toPdf(project, p));
      expect(pdf).toContain("Armadura longitudinal maxima");
      expect(pdf).toContain("Radicando da rotacao plastica");
      expect(pdf).toContain("GN Corbel");
      expect(pdf.includes("sqrt\\(R\\)")).toBe(true);
      const audit = JSON.parse(toCalculationJson(project, p));
      expect(audit.result).toEqual(JSON.parse(JSON.stringify(r)));
      if (unsolved) {
        expect(html).toContain("sem solução");
        expect(csv).toContain("sem solução");
        expect(pdf).toContain("sem solucao");
        expect(audit.result.values).not.toHaveProperty("plastic_ratio");
      } else
        expect(
          ductilityRows(r.values).find(
            (r) => r.label === "x/(λd) da rotação plástica",
          )?.value,
        ).toBeCloseTo(0.46335953017128917, 12);
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("Infinity");
    },
  );
  it("não altera entradas ou o esquema do projeto", () => {
    const project = exampleProject(),
      before = structuredClone(project);
    project.pieces.forEach(calculate);
    expect(project).toEqual(before);
    expect(project.schemaVersion).toBe(4);
    expect(decodeProject(JSON.stringify(project))).toEqual(project);
  });
  it("a função de material mantém a definição existente de λ", () => {
    expect(materialProperties(50, 500).lambda).toBe(0.8);
    expect(materialProperties(60, 500).lambda).toBe(0.775);
  });
});
