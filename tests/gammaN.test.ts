import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { calculate } from "../src/domain/engine";
import { suggestReinforcement } from "../src/domain/autodesign";
import { designSchema } from "../src/domain/design";
import { exampleProject, fingerprint } from "../src/domain/model";
import { gammaNDecision } from "../src/domain/gammaN";
import { pieceVolume } from "../src/domain/profile";
import {
  toCalculationJson,
  toCsv,
  toDxf,
  toPdf,
  toSvg,
} from "../src/lib/exports";
import { buildDetail } from "../src/detailing/model";
import { pieceDrawing } from "../src/detailing/drawing";
import { drawingDxf, drawingSvg, steelCsv } from "../src/detailing/exports";
import { cantileverFixture, shortFixture } from "./fixtures";
import { legacyN4Labels } from "./reference/legacy-n4-labels";

const justification =
  "GN-9062-TESTE: enquadramento da produção conferido pelo responsável.";
function tablePiece() {
  const p = shortFixture();
  Object.assign(p.design, {
    gammaNPolicy: "table9062",
    gammaNJustification: justification,
    forceMode: "characteristic",
    production: "precast",
    permanentPredominant: true,
  });
  p.loads = { vertical: 350000, horizontal: 40000, gamma: 1.4 };
  return p;
}

describe("Política de γn e ações em N", () => {
  it.each([
    ["factory", true, 1],
    ["factory", false, 1.1],
    ["precast", true, 1.1],
    ["precast", false, 1.2],
  ] as const)(
    "preserva a tabela de %s, permanente=%s",
    (production, permanentPredominant, expected) => {
      const p = tablePiece();
      Object.assign(p.design, { production, permanentPredominant, gammaN: 3 });
      const r = calculate(p);
      expect(r.values.gammaN9062).toBe(expected);
      expect(r.values.gammaN).toBe(expected);
      expect(r.values.factor).toBe(1.4 * expected);
      expect(r.values.vertical).toBe(350000 * (1.4 * expected));
      expect(r.values.horizontal).toBe(40000 * (1.4 * expected));
      const warning = r.checks.find((c) => c.id === "gammaNPolicy")!;
      expect(warning.status).toBe("review");
      expect(warning.detail).toContain("γn adotado");
      expect(warning.detail).toContain("γn do piso 1,2");
      expect(warning.detail).toContain(justification);
      expect(r.status).not.toBe("pass");
    },
  );
  it("reproduz 539 kN em vez de 588 kN, sem alterar γf ou materiais", () => {
    const p = tablePiece(),
      table = calculate(p);
    expect(table.values.vertical).toBe(539000);
    p.design.gammaNPolicy = "floor12";
    const floor = calculate(p);
    expect(floor.values.vertical).toBe(588000);
    for (const key of ["fcd", "fyd", "fctd", "fywd", "gammaC", "gammaS"])
      expect(table.values[key]).toBe(floor.values[key]);
    expect(p.loads.gamma).toBe(1.4);
  });
  it("inclui peso próprio e os modos de H com o mesmo fator de ações", () => {
    const p = tablePiece();
    p.design.includeSelfWeight = true;
    expect(calculate(p).values.vertical).toBe(
      (350000 + pieceVolume(p) * 25000) * (1.4 * 1.1),
    );
    p.design.includeSelfWeight = false;
    p.design.horizontalMode = "estimated";
    expect(calculate(p).values.horizontal).toBe(40000 * 1.54 + 0.16 * 539000);
    p.design.literatureRecommendations = true;
    p.design.supportType = "ptfe";
    p.loads.horizontal = 0;
    expect(calculate(p).values.horizontal).toBe(0.2 * 539000);
  });
  it("não majora forças de cálculo e conserva review em todas as combinações", () => {
    const p = tablePiece();
    p.design.forceMode = "design";
    p.design.combinations = [
      { name: "Outra", vertical: 100000, horizontal: 10000, gamma: 1.8 },
    ];
    const r = calculate(p);
    expect(r.combinations[0].values.vertical).toBe(350000);
    expect(r.combinations[0].values.horizontal).toBe(40000);
    for (const c of r.combinations) {
      expect(c.values.factor).toBe(1);
      expect(c.values.gammaN).toBe(1.1);
      expect(c.checks.find((c) => c.id === "gammaNPolicy")?.status).toBe(
        "review",
      );
    }
  });
  it.each([1.2, 1.5])(
    "moldado no local mantém a regra atual com mínimo %s mesmo num arquivo que peça tabela",
    (minimum) => {
      const p = tablePiece();
      Object.assign(p.design, {
        production: "cast",
        gammaN: minimum,
        gammaNJustification: "",
      });
      const r = calculate(p);
      expect(r.values.gammaN9062).toBe(1.2);
      expect(r.values.gammaN).toBe(minimum);
      expect(r.checks.find((c) => c.id === "gammaNPolicy")).toBeUndefined();
      expect(r.gammaNDecision?.policy).toBe("floor12");
      p.design.gammaNPolicy = "floor12";
      expect(calculate(p).values).toEqual(r.values);
    },
  );
  it.each(["", "         ", "123456789", "    curta  "])(
    "exige ao menos 10 caracteres após trim: %j",
    (text) => {
      const p = tablePiece();
      p.design.gammaNJustification = text;
      const r = calculate(p);
      expect(r.status).toBe("unsupported");
      expect(r.reasons.join(" ")).toContain(
        "justificativa de ao menos 10 caracteres",
      );
      expect(r.values).toEqual({});
      expect(r.combinations).toEqual([]);
    },
  );
  it("aceita exatamente dez caracteres, respeita 1000 e mantém o mínimo numérico antigo", () => {
    const p = tablePiece();
    p.design.gammaNJustification = " 1234567890 ";
    expect(calculate(p).combinations).toHaveLength(1);
    expect(calculate(p).gammaNDecision?.justification).toBe(" 1234567890 ");
    expect(
      designSchema.safeParse({
        ...p.design,
        gammaNJustification: "a".repeat(1000),
      }).success,
    ).toBe(true);
    expect(
      designSchema.safeParse({
        ...p.design,
        gammaNJustification: "a".repeat(1001),
      }).success,
    ).toBe(false);
    expect(designSchema.safeParse({ ...p.design, gammaN: 1.1 }).success).toBe(
      false,
    );
    expect(
      designSchema.safeParse({ ...p.design, gammaNPolicy: "other" }).success,
    ).toBe(false);
  });
  it("conserva escolhas e pendência na sugestão, sem mutar a entrada", () => {
    const p = shortFixture();
    Object.assign(p.design, {
      gammaNPolicy: "table9062",
      gammaNJustification: justification,
    });
    const before = structuredClone(p),
      result = suggestReinforcement(p);
    expect(result.changed).toBe(true);
    expect(result.piece.design).toMatchObject({
      gammaNPolicy: "table9062",
      gammaNJustification: justification,
    });
    expect(
      result.result.checks.find((c) => c.id === "gammaNPolicy")?.status,
    ).toBe("review");
    expect(result.result.status).toBe("review");
    expect(p).toEqual(before);
  });
});

describe("Padrão e assinaturas de entradas", () => {
  it.each([
    [
      "strut",
      2,
      "693eef3ed1245c9c4de4a38f9b912819776503bb56de1496f119e4de244d170b",
    ],
    [
      "strut",
      4,
      "af4fc17c40ab1527775bc84599c915f5444c0f5215298770b93564c55f48928a",
    ],
    [
      "friction",
      2,
      "b90c2814463be5826850776aa58ef971dbf6853e37ba8c140ae691d324b09ad5",
    ],
    [
      "friction",
      4,
      "9fc13cb0eb68683be24c78a4f214e8ace392daacfa6da2abf8958167dd23bceb",
    ],
    [
      "beam",
      2,
      "752a8788a6f66d5eebaa175ad546dc05816af18716f84b12b7f465662be93d80",
    ],
    [
      "beam",
      4,
      "38db0cae7fbde7034e0bf8d638416114229e6bef459fcbb9fb84766ed6489bcc",
    ],
  ] as const)(
    "mantém o resultado integral de %s com %i ramos capturado na master 38e4fb1 antes da integração",
    (model, branches, hash) => {
      const p =
        model === "beam" ? cantileverFixture({ length: 700 }) : shortFixture();
      p.materials.fck = 20;
      p.rebar.stirrupBranches = branches;
      Object.assign(p.design, {
        production: "factory",
        permanentPredominant: true,
        gammaN: 1.2,
        forceMode: "characteristic",
        includeSelfWeight: false,
      });
      if (model === "friction") {
        p.design.method = "friction";
        p.geometry.loadOffset = 180;
      }
      const legacy = JSON.parse(JSON.stringify(p));
      delete legacy.design.gammaNPolicy;
      delete legacy.design.gammaNJustification;
      expect(
        createHash("sha256")
          .update(JSON.stringify(calculate(legacy)))
          .digest("hex"),
      ).toBe(hash);
    },
  );
  it.each([
    [
      "strut",
      "231ada16ace31012fe36a9f4efe765ca2c9d7549991ea9c93f74373d33e31770",
    ],
    [
      "friction",
      "7c7d337c8cfffcdffc9a0af2f2e6ef18882f14366a695ef11730bfd1f93ff0ab",
    ],
    [
      "beam",
      "32d1a7989f09f1c2f0a1a57b6e149248a94e717c8f915855ae87743eac895c7d",
    ],
  ] as const)(
    "mantém resultado completo legado de %s capturado em fa8c890",
    (model, hash) => {
      const p =
        model === "beam" ? cantileverFixture({ length: 700 }) : shortFixture();
      p.materials.fck = 20;
      Object.assign(p.design, {
        production: "factory",
        permanentPredominant: true,
        gammaN: 1.2,
        forceMode: "characteristic",
        includeSelfWeight: false,
      });
      if (model === "friction") {
        p.design.method = "friction";
        p.geometry.loadOffset = 180;
      }
      const legacy = JSON.parse(JSON.stringify(p));
      delete legacy.design.gammaNPolicy;
      delete legacy.design.gammaNJustification;
      // Os hashes de fa8c890 antecedem N3/N4; conserve a entrada histórica e
      // reverta somente os rótulos públicos, sem retirar números ou estados.
      delete legacy.rebar.stirrupBranches;
      delete legacy.rebar.constructiveDiameter;
      const result = legacyN4Labels(calculate(legacy));
      expect(result).not.toHaveProperty("gammaNDecision");
      expect(
        createHash("sha256").update(JSON.stringify(result)).digest("hex"),
      ).toBe(hash);
    },
  );
  it("floor12 explícito mantém valores, verificações e hipóteses; os novos campos entram na assinatura", () => {
    const p = tablePiece();
    p.design.gammaNPolicy = "floor12";
    p.design.gammaNJustification = "";
    const legacy = JSON.parse(JSON.stringify(p));
    delete legacy.design.gammaNPolicy;
    delete legacy.design.gammaNJustification;
    const { fingerprint: _legacy, ...oldResult } = calculate(legacy),
      { fingerprint: _explicit, ...explicit } = calculate(p);
    expect(explicit).toEqual(oldResult);
    const first = fingerprint(p);
    p.design.gammaNPolicy = "table9062";
    expect(fingerprint(p)).not.toBe(first);
    const second = fingerprint(p);
    p.design.gammaNJustification = justification;
    expect(fingerprint(p)).not.toBe(second);
    expect(gammaNDecision(p.design).gammaN).toBe(1.1);
  });
});

describe("Rastreabilidade nas saídas", () => {
  it.each([2, 4] as const)(
    "mantém colunas N3/N4 alinhadas à política γn no CSV misto de %i ramos",
    (branches) => {
      const floor = tablePiece(),
        table = tablePiece(),
        project = exampleProject();
      floor.name = "Piso";
      floor.design.gammaNPolicy = "floor12";
      floor.design.gammaNJustification = "";
      table.name = "Tabela";
      table.id = "table-csv";
      floor.rebar.stirrupBranches = table.rebar.stirrupBranches = branches;
      project.pieces = [floor, table];
      const rows = toCsv(project)
        .split("\r\n")
        .slice(1)
        .map((line) =>
          [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((cell) =>
            cell[1].replaceAll('""', '"'),
          ),
        );
      const [header, a, b] = rows;
      expect(a).toHaveLength(header.length);
      expect(b).toHaveLength(header.length);
      for (const row of [a, b]) {
        expect(row[header.indexOf("N3 ramos efetivos por posicao")]).toBe(
          String(branches),
        );
        expect(row[header.indexOf("N4 barras por peca")]).toBe(
          String(branches),
        );
        expect(row[header.indexOf("N4 diametro (mm)")]).toBe("8");
        expect(row[header.indexOf("N4 massa total (kg)")]).not.toBe("");
      }
      for (const name of header.filter(
        (name) => name.startsWith("N3 ") || name.startsWith("N4 "),
      ))
        expect(a[header.indexOf(name)]).toBe(b[header.indexOf(name)]);
      expect(a[header.indexOf("gamma n adotado")]).toBe("1.2");
      expect(b[header.indexOf("gamma n adotado")]).toBe("1.1");
      expect(a[header.indexOf("Justificativa informada gamma n")]).toBe("");
      expect(b[header.indexOf("Justificativa informada gamma n")]).toBe(
        justification,
      );
    },
  );
  it.each([shortFixture, cantileverFixture])(
    "registra decisão, números e justificativa no PDF e cálculo auditável",
    async (fixture) => {
      const p = fixture(),
        project = exampleProject();
      Object.assign(p.design, {
        gammaNPolicy: "table9062",
        gammaNJustification: justification,
      });
      project.pieces = [p];
      const audit = JSON.parse(toCalculationJson(project, p));
      expect(audit.input.design).toMatchObject({
        gammaNPolicy: "table9062",
        gammaNJustification: justification,
      });
      expect(audit.result.gammaNDecision).toMatchObject({
        policy: "table9062",
        gammaN: 1.1,
        gammaN9062: 1.1,
        floor: 1.2,
        justification,
      });
      expect(audit.result).toEqual(calculate(p));
      const pdf = new TextDecoder("latin1").decode(await toPdf(project, p));
      expect(pdf).toContain("Tabela NBR 9062, sem piso de 1,2");
      expect(pdf).toContain("GN-9062-TESTE");
      expect(pdf).toContain("gamma n adotado");
      expect(pdf).toContain("gamma n 9062");
    },
  );
  it("inclui a escolha em CSV, desenhos geométricos e detalhamento, escapando texto", () => {
    const p = shortFixture(),
      project = exampleProject();
    const text = "GN-9062-TESTE <script>& decisão explícita do responsável";
    Object.assign(p.design, {
      gammaNPolicy: "table9062",
      gammaNJustification: text,
    });
    project.pieces = [p];
    expect(toSvg(p)).toContain("&lt;script&gt;&amp;");
    expect(toSvg(p)).not.toContain("<script>");
    const narrow = structuredClone(p);
    Object.assign(narrow.geometry, {
      columnWidth: 200,
      length: 225,
      loadOffset: 150,
    });
    const noteRows = [
      ...toSvg(narrow).matchAll(/<text x="[^"]+" y="(\d+)">([^<]*)<\/text>/g),
    ].filter((row) => Number(row[1]) > narrow.geometry.height + 85);
    expect(noteRows.length).toBeGreaterThan(0);
    for (const row of noteRows)
      expect(row[2].replace(/&[^;]+;/g, "x").length).toBeLessThanOrEqual(60);
    expect(toDxf(p)).toContain("GN-9062-TESTE");
    expect(toCsv(project)).toContain(text);
    const detail = buildDetail(p),
      drawing = pieceDrawing(project, detail);
    const notes = drawing.entities
      .flatMap((e) => (e.type === "text" ? [e.text] : []))
      .join(" ");
    expect(notes).toContain("Tabela NBR 9062, sem piso de 1,2");
    expect(notes).toContain("GN-9062-TESTE");
    expect(drawingSvg(drawing)).toContain("&lt;script&gt;&amp;");
    expect(drawingDxf(drawing)).toContain("GN-9062-TESTE");
    expect(steelCsv([detail])).toContain(text);
    p.design.gammaNJustification =
      "=GN-9062-TESTE: valor explicitamente informado";
    expect(toCsv(project)).toContain("\"'=GN-9062-TESTE");
    expect(steelCsv([buildDetail(p)])).toContain("\"'=GN-9062-TESTE");
  });
});
