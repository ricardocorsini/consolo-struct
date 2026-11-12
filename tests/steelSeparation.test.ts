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

describe("Separação dos aços e migração para esquema 5 (#35)", () => {
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
    expect(exampleProject().schemaVersion).toBe(5);
  });

  it.each([1, 2, 3, 4])(
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
        expect(migrated.schemaVersion).toBe(5);
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

describe("Regressão numérica contra master fa8c890 antes da migração", () => {
  it.each([
    [
      "strut",
      "f48fee40adf60e8891b61ef6d67071601b724645ca5b2ef1ef9c14b8dfb8b50d",
    ],
    [
      "friction",
      "48a1efe7304e7a211fc974981b5e3907fa4f75f41270d207161c390824847976",
    ],
    [
      "beam",
      "72c15d105cd1d62a3ebc8da5bc98778394c61fc249b03adb4660c29aac7d0b86",
    ],
  ] as const)(
    "preserva todos os valores, estados e verificações de %s com CA-50/CA-50 e γs=1,15",
    (method, expected) => {
      const p = method === "beam" ? cantileverFixture() : shortFixture();
      if (method !== "beam") p.design.method = method;
      if (method === "friction") p.geometry.loadOffset = 120;
      // Hash capturado na master original, antes da implementação da issue #35.
      // Exclui a assinatura (contrato mudou) e apenas o texto das fórmulas.
      // Demandas, capacidades, referências, detalhes e estados continuam incluídos.
      const r = calculate(p);
      const raw = JSON.stringify({
        values: r.values,
        checks: r.checks.map(({ formula: _formula, ...c }) => c),
        status: r.status,
      });
      expect(createHash("sha256").update(raw).digest("hex")).toBe(expected);
    },
  );
});
