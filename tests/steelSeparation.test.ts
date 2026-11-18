import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { calculate, materialProperties } from "../src/domain/engine";
import {
  decodeProject,
  exampleProject,
  fingerprint,
  newPiece,
} from "../src/domain/model";
import {
  secondarySteelClasses,
  tieSteelClasses,
  tieSteelClassOf,
} from "../src/domain/steel";
import { toCalculationJson, toPdf } from "../src/lib/exports";
import { buildDetail } from "../src/detailing/model";
import { pieceDrawing } from "../src/detailing/drawing";
import { drawingSvg, steelCsv } from "../src/detailing/exports";
import { shortFixture, cantileverFixture } from "./fixtures";
import { legacyAnchorageContract } from "./reference/legacy-anchorage-contract";

describe("Separação dos aços e migração para esquema 6 (#35)", () => {
  it("oferece classes por função, com padrão CA-50 em ambas", () => {
    expect(tieSteelClasses).toEqual(["CA-25", "CA-50"]);
    expect(secondarySteelClasses).toEqual(["CA-25", "CA-50", "CA-60"]);
    expect(tieSteelClassOf(600)).toBeUndefined();
    expect(tieSteelClassOf(420)).toBeUndefined();
    expect(newPiece(1).materials).toEqual({
      fck: 30,
      fyk: 500,
      fykTransverse: 500,
    });
    expect(newPiece(1).design).not.toHaveProperty("fykTransverse");
    expect(exampleProject().schemaVersion).toBe(6);
  });

  it.each([1, 2, 3, 4, 5])(
    "migra esquema %s sem perder aços, inclusive antes do reset v1",
    (schemaVersion) => {
      for (const fykTransverse of [500, 600]) {
        const raw = JSON.parse(JSON.stringify(exampleProject()));
        raw.schemaVersion = schemaVersion;
        for (const [i, p] of raw.pieces.entries()) {
          p.materials.fyk = i === 0 ? 600 : 420.5;
          delete p.materials.fykTransverse;
          p.design.fykTransverse = fykTransverse;
        }
        const untouched = structuredClone(raw);
        const migrated = decodeProject(JSON.stringify(raw));
        expect(raw).toEqual(untouched);
        expect(migrated.schemaVersion).toBe(6);
        for (const [i, p] of migrated.pieces.entries()) {
          expect(p.materials).toEqual({
            fck: raw.pieces[i].materials.fck,
            fyk: i === 0 ? 600 : 420.5,
            fykTransverse,
          });
          expect(p.design).not.toHaveProperty("fykTransverse");
          expect(p.geometry).toEqual(raw.pieces[i].geometry);
          expect(p.loads).toEqual(raw.pieces[i].loads);
          expect(p.rebar).toEqual(raw.pieces[i].rebar);
          const result = calculate(p);
          expect(result.status).toBe("unsupported");
          expect(result.values).toEqual({});
          expect(result.combinations).toEqual([]);
          expect(result.reasons.join(" ")).toContain("somente CA-25 ou CA-50");
        }
        expect(decodeProject(JSON.stringify(migrated))).toEqual(migrated);
      }
    },
  );

  it.each([1, 2, 3, 4, 5])(
    "preenche secundárias ausentes com 500 no esquema %s",
    (schemaVersion) => {
      const raw = JSON.parse(JSON.stringify(exampleProject()));
      raw.schemaVersion = schemaVersion;
      delete raw.pieces[0].materials.fykTransverse;
      expect(
        decodeProject(JSON.stringify(raw)).pieces[0].materials.fykTransverse,
      ).toBe(500);
    },
  );

  it("preserva demais entradas do esquema 4 e invalida a assinatura antiga", () => {
    const p = shortFixture();
    const raw = JSON.parse(
      JSON.stringify({ ...exampleProject(), schemaVersion: 4, pieces: [p] }),
    );
    delete raw.pieces[0].materials.fykTransverse;
    raw.pieces[0].design.fykTransverse = 600;
    const migrated = decodeProject(JSON.stringify(raw)).pieces[0];
    expect(migrated).toEqual({
      ...p,
      materials: { ...p.materials, fykTransverse: 600 },
    });
    expect(fingerprint(migrated)).not.toBe(fingerprint(raw.pieces[0]));
    const before = fingerprint(migrated);
    migrated.materials.fykTransverse = 250;
    expect(fingerprint(migrated)).not.toBe(before);
  });

  it.each([250, 500, 600] as const)(
    "persiste secundárias %s numéricas apenas em materiais",
    (fykTransverse) => {
      const project = exampleProject();
      project.pieces[0].materials.fykTransverse = fykTransverse;
      expect(decodeProject(JSON.stringify(project))).toEqual(project);
      expect(project.pieces[1].materials.fykTransverse).toBe(500);
    },
  );

  it("rejeita secundárias inválidas e esquema futuro sem aproximar classes", () => {
    for (const fykTransverse of [420, 499.99, 601, "500", null]) {
      const raw = JSON.parse(JSON.stringify(exampleProject()));
      raw.pieces[0].materials.fykTransverse = fykTransverse;
      expect(() => decodeProject(JSON.stringify(raw))).toThrow(
        "Projeto inválido",
      );
    }
    expect(() =>
      decodeProject(JSON.stringify({ ...exampleProject(), schemaVersion: 99 })),
    ).toThrow("versão não suportada");
  });

  it("migra o esquema 5 de N4 sem perder ramos, bitola, política ou ligações", () => {
    const raw = JSON.parse(JSON.stringify(exampleProject()));
    raw.schemaVersion = 5;
    const p = raw.pieces[0];
    p.rebar.stirrupBranches = 4;
    p.rebar.constructiveDiameter = 12.5;
    p.detailing.barArrangement = "beam";
    p.detailing.pins = 3;
    p.design.gammaNPolicy = "table9062";
    p.design.gammaNJustification =
      "Premissas mantidas na migração dos materiais.";
    delete p.materials.fykTransverse;
    p.design.fykTransverse = 600;
    const decoded = decodeProject(JSON.stringify(raw));
    expect(decoded.schemaVersion).toBe(6);
    expect(decoded.pieces[0].materials.fykTransverse).toBe(600);
    expect(decoded.pieces[0].rebar).toEqual(p.rebar);
    expect(decoded.pieces[0].detailing).toEqual(p.detailing);
    const { fykTransverse: _old, ...design } = p.design;
    expect(decoded.pieces[0].design).toEqual(design);
    expect(decodeProject(JSON.stringify(decoded))).toEqual(decoded);
  });

  it("rejeita materiais divergentes sem escolher uma classe implicitamente", () => {
    const raw = JSON.parse(JSON.stringify(exampleProject()));
    raw.schemaVersion = 5;
    raw.pieces[0].design.fykTransverse = 600;
    expect(() => decodeProject(JSON.stringify(raw))).toThrow("divergem");
    raw.pieces[0].materials.fykTransverse = 600;
    const p = decodeProject(JSON.stringify(raw)).pieces[0];
    expect(p.materials.fykTransverse).toBe(600);
    expect(p.design).not.toHaveProperty("fykTransverse");
  });

  it("o esquema 6 exige a classe em Materiais e rejeita o campo antigo", () => {
    const raw = JSON.parse(JSON.stringify(exampleProject()));
    delete raw.pieces[0].materials.fykTransverse;
    expect(() => decodeProject(JSON.stringify(raw))).toThrow(
      "Projeto inválido",
    );
    expect(calculate(raw.pieces[0]).status).toBe("invalid");
    raw.pieces[0].materials.fykTransverse = 500;
    raw.pieces[0].design.fykTransverse = 500;
    expect(() => decodeProject(JSON.stringify(raw))).toThrow("esquema 6");
  });
});

describe("Resistências por família e ancoragem limitada", () => {
  it.each([
    [250, 250, 1.15, 250 / 1.15, 250 / 1.15],
    [500, 500, 1.15, 500 / 1.15, 500 / 1.15],
    [500, 600, 1.15, 500 / 1.15, 435],
    [500, 600, 1.1, 435, 435],
    [500, 250, 1, 435, 250],
    [250, 600, 2, 125, 300],
  ])(
    "aplica os tetos para tirante %s / secundárias %s / γs %s",
    (tie, secondary, gammaS, fyd, fywd) => {
      const m = materialProperties(30, tie, secondary, 1.4, gammaS);
      expect(m.fyd).toBe(fyd);
      expect(m.fydLimited).toBe(fyd);
      expect(m.fywd).toBe(fywd);
    },
  );

  it.each([shortFixture, cantileverFixture])(
    "usa exatamente 435 MPa também em lb e confinamento",
    (fixture) => {
      const p = fixture();
      p.design.gammaS = 1.1;
      p.materials.fykTransverse = 250;
      const v = calculate(p).values;
      expect(v.fyd).toBe(435);
      expect(v.lb).toBe(
        Math.max(
          (p.rebar.tieDiameter * 435) / (4 * v.fbd),
          25 * p.rebar.tieDiameter,
        ),
      );
      expect(v.confinementRequired).toBe(
        (0.25 * ((Math.PI * p.rebar.tieDiameter ** 2) / 4) * 435) / v.fywd,
      );
      const changed = structuredClone(p);
      changed.materials.fykTransverse = 600;
      const other = calculate(changed).values;
      for (const key of ["fyd", "fbd", "lb", "tieRequired", "anchorRequired"])
        expect(other[key]).toBe(v[key]);
    },
  );

  it.each(["strut", "friction"] as const)(
    "usa aço secundário nas parcelas por força de N2 (%s), suspensão, fendilhamento e confinamento",
    (method) => {
      const p = shortFixture();
      p.design.method = method;
      p.design.loadType = "indirect";
      p.design.bearingWidth = 250;
      if (method === "friction") p.geometry.loadOffset = 120;
      const standard = calculate(p).values;
      p.materials.fykTransverse = 250;
      const v = calculate(p).values;
      expect(v.fywd).toBe(250 / 1.15);
      for (const key of [
        "asV",
        "stitchLiterature",
        "suspensionRequired",
        "splittingRequired",
        "confinementRequired",
      ]) {
        expect(standard[key]).toBeGreaterThan(0);
        expect(v[key]).toBeCloseTo(standard[key] * 2, 9);
      }
      for (const key of [
        "fyd",
        "fbd",
        "lb",
        "tieRequired",
        "stirrupNormative",
        "stirrupLiterature",
        "lowerRequired",
      ])
        expect(v[key]).toBe(standard[key]);
      expect(v.stitchRequired).toBeGreaterThanOrEqual(standard.stitchRequired);
    },
  );

  it("muda a demanda resistente dos estribos de viga sem alterar tirante ou mínimos por área", () => {
    const p = cantileverFixture();
    const standard = calculate(p).values;
    p.materials.fykTransverse = 250;
    const v = calculate(p).values;
    expect(v.beam_stirrupRateRequired).toBeCloseTo(
      standard.beam_stirrupRateRequired * 2,
      12,
    );
    for (const key of ["fyd", "lb", "tieRequired", "stitchRequired"])
      expect(v[key]).toBe(standard[key]);
  });

  it("publica materiais separados e resistências adotadas no PDF, auditoria e detalhamento", async () => {
    const p = shortFixture();
    p.materials.fykTransverse = 250;
    p.design.gammaS = 1.1;
    const project = { ...exampleProject(), pieces: [p] };
    const audit = JSON.parse(toCalculationJson(project, p));
    expect(audit.input.materials).toEqual({
      fck: 30,
      fyk: 500,
      fykTransverse: 250,
    });
    expect(audit.input.design).not.toHaveProperty("fykTransverse");
    expect(audit.result.values).toMatchObject({
      fyd: 435,
      fydLimited: 435,
      fywd: 250 / 1.1,
    });
    const pdf = new TextDecoder("latin1").decode(await toPdf(project, p));
    expect(pdf).toContain("CA-25");
    expect(pdf).toContain("435");
    expect(pdf).toContain("ancoragem");
    const detail = buildDetail(p);
    expect(drawingSvg(pieceDrawing(project, detail))).toContain("CA-25");
    expect(steelCsv([detail])).toContain('"CA-25"');
    expect(steelCsv([detail])).toContain('"CA-50"');
  });
});

describe("Regressão numérica contra master afec1f3 antes da migração", () => {
  it.each([
    [
      "strut",
      "ecf1de8a976377dc6a3ae031ecc19d86648fbb541b6d521cc35602f382073602",
    ],
    [
      "friction",
      "60bc3c1c76e1d01b7955d7fb85f1ee781ef87d9fa4d049f7345b178c1d79c13a",
    ],
    [
      "beam",
      "6e1539c67adbd29d9da35c01b5499f7eba7951c2195a1aec2767c1ed7ba8ec04",
    ],
  ] as const)(
    "preserva todos os valores, estados e verificações de %s com CA-50/CA-50 e γs=1,15",
    (method, expected) => {
      const p = method === "beam" ? cantileverFixture() : shortFixture();
      if (method !== "beam") p.design.method = method;
      if (method === "friction") p.geometry.loadOffset = 120;
      // Hash capturado na master afec1f3 (antes desta integração), antes da implementação da issue #35.
      // Exclui a assinatura (contrato mudou) e apenas o texto das fórmulas.
      // Demandas, capacidades, referências, detalhes e estados continuam incluídos.
      const r = legacyAnchorageContract(calculate(p));
      const raw = JSON.stringify({
        values: r.values,
        checks: r.checks.map(({ formula: _formula, ...c }) => c),
        status: r.status,
      });
      expect(createHash("sha256").update(raw).digest("hex")).toBe(expected);
    },
  );
});
