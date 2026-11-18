import { afterEach, describe, expect, it, vi } from "vitest";
import * as engine from "../src/domain/engine";
import { suggestReinforcement } from "../src/domain/autodesign";
import { fingerprint } from "../src/domain/model";
import { shortFixture, cantileverFixture } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

describe("Ancoragem na busca com secundárias por candidato (#12 + #16)", () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "preserva soldada=%s e piso=%s em candidatos e resultado",
    (welded, floor) => {
      for (const fixture of [
        shortFixture,
        () => {
          const p = cantileverFixture({ length: 700 });
          p.geometry.columnWidth = 1050;
          p.design.supportAnchorLength = 1000;
          return p;
        },
      ]) {
        const input = fixture();
        input.design.supportWeldedBar = welded;
        input.design.anchorRatioFloor = floor;
        input.design.supportAnchor = "hook";
        input.design.hookNormalCover = 75;
        const before = structuredClone(input);
        const evaluated: [boolean, boolean][] = [];
        const calculate = engine.calculate;
        const spy = vi
          .spyOn(engine, "calculate")
          .mockImplementation((piece) => {
            evaluated.push([
              piece.design.supportWeldedBar,
              piece.design.anchorRatioFloor,
            ]);
            return calculate(piece);
          });
        const proposal = suggestReinforcement(input);
        spy.mockRestore();
        expect(proposal.changed).toBe(true);
        expect(
          proposal.result.checks.find((c) => c.id === "anchorage")?.status,
        ).toBe("pass");
        expect(evaluated.length).toBeGreaterThan(proposal.candidates);
        expect(evaluated.every(([w, f]) => w === welded && f === floor)).toBe(
          true,
        );
        expect(input).toEqual(before);
        expect(proposal.piece.design.supportWeldedBar).toBe(welded);
        expect(proposal.piece.design.anchorRatioFloor).toBe(floor);
        expect(proposal.result).toEqual(calculate(proposal.piece));
        expect(proposal.result.fingerprint).toBe(fingerprint(proposal.piece));
        for (const c of proposal.result.combinations) {
          const v = c.values;
          const alpha = welded ? 0.5 : 0.7;
          const ratio = v.tieRequired / v.tieProvided;
          const used = floor ? Math.max(1, ratio) : ratio;
          expect(v.anchorAlpha).toBe(alpha);
          expect(v.anchorRatio).toBe(used);
          expect(v.anchorRequired).toBeCloseTo(
            Math.max(
              alpha * v.lb * used,
              0.3 * v.lb,
              10 * proposal.piece.rebar.tieDiameter,
              100,
            ),
            9,
          );
          expect(
            c.checks.find((ch) => ch.id === "anchorWeldedBar")?.status,
          ).toBe(welded ? "review" : undefined);
        }
      }
    },
  );
  it("mantém as opções e entradas quando a busca não encontra solução", () => {
    const input = shortFixture();
    input.loads.vertical = 1e7;
    input.design.supportWeldedBar = true;
    input.design.anchorRatioFloor = true;
    const before = structuredClone(input);
    const proposal = suggestReinforcement(input);
    expect(proposal.changed).toBe(false);
    expect(proposal.piece).toBe(input);
    expect(input).toEqual(before);
    expect(proposal.result).toEqual(engine.calculate(input));
    expect(
      proposal.result.checks.find((ch) => ch.id === "anchorWeldedBar")?.status,
    ).toBe("review");
  });
});
