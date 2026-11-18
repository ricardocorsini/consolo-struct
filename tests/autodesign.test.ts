import { afterEach, describe, expect, it, vi } from "vitest";
import * as engine from "../src/domain/engine";
import { suggestReinforcement } from "../src/domain/autodesign";
import { area, fingerprint, type Piece } from "../src/domain/model";
import { shortFixture } from "./fixtures";
import { legacySuggestReinforcement } from "./reference/autodesign-before";
import { exhaustiveSecondarySearch } from "./reference/autodesign-exhaustive";
import {
  autodesignCases,
  beamHorizontalFixture,
} from "./reference/autodesign-cases";

afterEach(() => vi.restoreAllMocks());

describe("CA1/CA6 — referência histórica e contratos", () => {
  it.each(
    Object.entries(autodesignCases).filter(
      ([name]) => name !== "beamHorizontalCompatible",
    ),
  )("preserva peça e resultado anterior em %s", (_, fixture) => {
    const p = fixture(),
      before = structuredClone(p);
    const old = legacySuggestReinforcement(p),
      result = suggestReinforcement(p);
    expect(result.piece).toEqual(old.piece);
    expect(result.result).toEqual(old.result);
    expect(result.changed).toBe(old.changed);
    expect(p).toEqual(before);
    expect(result.result.fingerprint).toBe(fingerprint(result.piece));
    expect(Object.keys(result).sort()).toEqual(
      ["piece", "result", "changed", "message", "candidates"].sort(),
    );
  });
  it("um arranjo já ótimo continua changed=false", () => {
    const input = legacySuggestReinforcement(shortFixture()).piece;
    expect(legacySuggestReinforcement(input).changed).toBe(false);
    expect(suggestReinforcement(input).changed).toBe(false);
  });
  it("mantém pele em review sem dimensionar costura quando h > 600 mm", () => {
    const p = autodesignCases.beamSkin();
    p.rebar.stitchCount = 37;
    const result = suggestReinforcement(p);
    expect(result.changed).toBe(true);
    expect(result.piece.rebar.stitchCount).toBe(37);
    expect(result.result.checks.find((c) => c.id === "beamSkin")?.status).toBe(
      "review",
    );
    expect(
      result.result.checks.find((c) => c.id === "beamStitch"),
    ).toBeUndefined();
    expect(result.piece).toEqual(legacySuggestReinforcement(p).piece);
  });
});

describe("CA2/CA3 — secundária por candidato e diagnóstico", () => {
  it("recusa o antigo vencedor quando N2 e a ponta reta de N4 são insuficientes", () => {
    const input = beamHorizontalFixture(10);
    const old = legacySuggestReinforcement(input);
    expect(old.changed).toBe(true);
    for (const id of ["anchorN2", "anchorN4Tail"])
      expect(old.result.checks.find((c) => c.id === id)?.status).toBe("fail");
    const result = suggestReinforcement(input);
    expect(result.changed).toBe(false);
    expect(result.piece).toBe(input);
    expect(result.message).toContain("N2 · ancoragem no suporte");
  });
  it("recusa o antigo vencedor da combinação H que falhava em stitchClear", () => {
    const input = beamHorizontalFixture(),
      before = structuredClone(input);
    const old = legacySuggestReinforcement(input);
    expect(old.changed).toBe(true);
    expect(old.result.checks.find((c) => c.id === "stitchClear")?.status).toBe(
      "fail",
    );
    const result = suggestReinforcement(input);
    expect(result.changed).toBe(false);
    expect(result.piece).toBe(input);
    expect(exhaustiveSecondarySearch(input).found).toBe(false);
    expect(result.message).toContain("Espaço livre vertical da costura");
    expect(result.message).toContain("Nenhum dado foi alterado.");
    expect(input).toEqual(before);
  });
  it("dimensiona costura inferior, estribos, fendilhamento e suspensão antes do julgamento", () => {
    const p = autodesignCases.friction();
    p.design.loadType = "indirect";
    p.design.bearingWidth = 300;
    p.design.suspensionDiameter = 5;
    p.rebar.stitchCount = 1;
    p.rebar.stirrupCount = 1;
    p.design.lowerStitchCount = 0;
    p.design.splittingCount = 0;
    p.design.suspensionCount = 0;
    const result = suggestReinforcement(p);
    expect(result.changed).toBe(true);
    for (const id of [
      "stitch",
      "stitchSpacing",
      "stitchZone",
      "stitchClear",
      "stitchDiameter",
      "lowerStitch",
      "lowerSpacing",
      "transverse",
      "suspension",
      "splitting",
    ])
      expect(result.result.checks.find((c) => c.id === id)?.status).toBe(
        "pass",
      );
    expect(result.piece.design.lowerStitchCount).toBeGreaterThan(0);
    expect(result.piece.design.suspensionCount).toBeGreaterThan(0);
    expect(result.piece.design.splittingCount).toBeGreaterThan(0);
    expect(result.piece).toEqual(exhaustiveSecondarySearch(p).piece);
  });
  it.each([
    autodesignCases.concreteFailure,
    autodesignCases.shearFailure,
    autodesignCases.literatureFailure,
  ])("falha com rótulo crítico e sem alterar dados", (fixture) => {
    const p = fixture(),
      before = structuredClone(p),
      result = suggestReinforcement(p);
    const labels = result.result.checks
      .filter((c) => c.status === "fail")
      .map((c) => c.label);
    expect(result.changed).toBe(false);
    expect(result.piece).toBe(p);
    expect(labels.some((label) => result.message.includes(label))).toBe(true);
    expect(result.message).toContain("Nenhum dado foi alterado.");
    expect(p).toEqual(before);
  });
  it("preserva a mensagem de domínio das secundárias e não oferece contagens inválidas", () => {
    const p = autodesignCases.concreteFailure();
    const result = suggestReinforcement(p);
    expect(result.changed).toBe(false);
    expect(result.message).toContain(
      "As armaduras secundárias excedem o domínio de edição. Revise a seção e as bitolas.",
    );
    expect(result.piece).toBe(p);
  });
  it("explica domínio não suportado sem dimensionar a partir de valores ausentes", () => {
    const p = shortFixture();
    p.design.fatigue = true;
    const result = suggestReinforcement(p);
    expect(result.changed).toBe(false);
    expect(result.result.status).toBe("unsupported");
    expect(result.message).toContain("Fadiga");
    expect(result.piece).toBe(p);
  });
});

describe("CA4/CA5 — parada e poda comparadas à varredura completa", () => {
  it("usa passo de uma barra na ancoragem soldada e conta também as contagens ímpares", () => {
    const input = shortFixture();
    input.design.frontAnchor = "welded";
    const full = exhaustiveSecondarySearch(input);
    expect(full.candidates).toBe(476);
    const spy = vi.spyOn(engine, "calculate");
    const result = suggestReinforcement(input);
    const assessed = new Set(
      spy.mock.calls.map(([p]) => p).filter((p) => p !== input),
    );
    expect([...assessed].some((p) => p.rebar.tieCount % 2 === 1)).toBe(true);
    expect(result.candidates).toBe(assessed.size);
    expect(result.piece).toEqual(full.piece);
    expect(result.result).toEqual(full.result);
    expect(result.piece.design.weldResistancePerBar).toBe(
      input.design.weldResistancePerBar,
    );
  });
  it.each(Object.entries(autodesignCases))(
    "é idêntica à referência exaustiva com secundária em %s",
    (_, fixture) => {
      const p = fixture(),
        full = exhaustiveSecondarySearch(p),
        result = suggestReinforcement(p);
      expect(result.piece).toEqual(full.piece);
      expect(result.result).toEqual(full.result);
      expect(result.changed).toBe(full.changed);
      expect(result.candidates).toBeLessThanOrEqual(full.candidates);
    },
  );
  it.each([shortFixture, autodesignCases.beam])(
    "conta os objetos efetivamente avaliados e reduz a varredura",
    (fixture) => {
      const input = fixture(),
        full = exhaustiveSecondarySearch(input);
      const spy = vi.spyOn(engine, "calculate");
      const proposal = suggestReinforcement(input);
      const assessed = new Set(
        spy.mock.calls.map(([p]) => p).filter((p) => p !== input),
      );
      expect(proposal.candidates).toBe(assessed.size);
      expect(proposal.candidates).toBeLessThan(full.candidates);
      expect(proposal.message).toContain(
        `Arranjo sugerido entre ${proposal.candidates} candidatos`,
      );
    },
  );
});

/** Controlled engine responses isolate search order and diagnostics from formulas. */
function controlledChecks(checks: (p: Piece) => [string, string][]) {
  const base = engine.calculate(shortFixture());
  return vi.spyOn(engine, "calculate").mockImplementation((p) => {
    const result = structuredClone(base),
      failures = checks(p);
    result.status = failures.length ? "fail" : "pass";
    result.checks = failures.map(([id, label]) => ({
      ...base.checks[0],
      id,
      label,
      status: "fail" as const,
    }));
    return result;
  });
}

describe("R1/R4/R5 — tentativas de refutar a parada e os empates", () => {
  it("continua após contagens inviáveis, testa todas as camadas e só então para a bitola", () => {
    const spy = controlledChecks((p) =>
      p.rebar.tieDiameter === 6.3 && p.rebar.tieCount === 12
        ? []
        : [["tie", "Tirante bloqueado"]],
    );
    const result = suggestReinforcement(shortFixture());
    const pieces = [...new Set(spy.mock.calls.map(([p]) => p))].filter(
      (p) => p.rebar.tieDiameter === 6.3,
    );
    expect(
      pieces
        .filter((p) => p.rebar.tieCount === 12)
        .map((p) => p.design.tieLayers),
    ).toEqual([1, 2, 3]);
    expect(pieces.some((p) => p.rebar.tieCount > 12)).toBe(false);
    expect(result.piece.design.tieLayers).toBe(1);
    expect(result.piece.rebar.tieCount).toBe(12);
  });
  it.each([1, 2])(
    "não poda área igual e mantém desempates por camadas/contagem (camadas iniciais=%s)",
    (layers) => {
      expect(area(8, 10)).toBe(area(2, 20));
      controlledChecks((p) =>
        (p.rebar.tieDiameter === 10 &&
          p.rebar.tieCount === 8 &&
          p.design.tieLayers === layers) ||
        (p.rebar.tieDiameter === 20 &&
          p.rebar.tieCount === 2 &&
          p.design.tieLayers === 1)
          ? []
          : [["tie", "Tirante bloqueado"]],
      );
      const input = shortFixture(),
        full = exhaustiveSecondarySearch(input),
        result = suggestReinforcement(input);
      expect(result.piece.rebar.tieDiameter).toBe(20);
      expect(result.piece.rebar.tieCount).toBe(2);
      expect(result.piece.design.tieLayers).toBe(1);
      expect(result.piece).toEqual(full.piece);
    },
  );
  it("a menor área continua tendo prioridade sobre a quantidade de camadas", () => {
    controlledChecks((p) =>
      (p.rebar.tieDiameter === 6.3 &&
        p.rebar.tieCount === 8 &&
        p.design.tieLayers === 1) ||
      (p.rebar.tieDiameter === 8 &&
        p.rebar.tieCount === 4 &&
        p.design.tieLayers === 2)
        ? []
        : [["tie", "Tirante bloqueado"]],
    );
    const result = suggestReinforcement(shortFixture());
    expect(result.piece.rebar.tieDiameter).toBe(8);
    expect(result.piece.rebar.tieCount).toBe(4);
    expect(result.piece.design.tieLayers).toBe(2);
  });
  it("usa a interseção dos ids reprovados, apresentando somente seus rótulos", () => {
    controlledChecks((p) => [
      ["tie", "Aço insuficiente"],
      ...(p.rebar.tieDiameter < 25
        ? [["bearing", "Contato ocasional"] as [string, string]]
        : []),
    ]);
    const result = suggestReinforcement(shortFixture());
    expect(result.message).toContain(
      "Verificações bloqueadoras: Aço insuficiente.",
    );
    expect(result.message).not.toContain("Contato ocasional");
  });
  it("sem interseção, usa as falhas do último arranjo avaliado da maior bitola", () => {
    controlledChecks((p) =>
      p.rebar.tieDiameter < 25
        ? [["tie", "Aço das bitolas menores"]]
        : [["bearing", "Contato na maior bitola"]],
    );
    const result = suggestReinforcement(shortFixture());
    expect(result.message).toContain("Contato na maior bitola");
    expect(result.message).not.toContain("Aço das bitolas menores");
  });
  it("informa quando todos os arranjos são descartados antes de avaliar", () => {
    const p = shortFixture(),
      layout = engine.tieLayout(p);
    vi.spyOn(engine, "tieLayout").mockReturnValue({
      ...layout,
      rows: [{ count: 1, y: 30 }],
    });
    const result = suggestReinforcement(p);
    expect(result.candidates).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.message).toContain("Nenhum candidato chegou a ser avaliado");
    expect(result.message).toContain("Nenhum dado foi alterado.");
  });
});
