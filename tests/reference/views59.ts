import { exampleProject } from "../../src/domain/model";
import { shortFixture } from "../fixtures";

/** Synthetic, versioned workload; no user's projects or calculated results. */
export function viewsFixture(pieces = 20, combinations = 20) {
  return {
    ...exampleProject(),
    name: "Regressão das vistas #59",
    pieces: Array.from({ length: pieces }, (_, i) => {
      const p = shortFixture();
      p.id = `views-${i}`;
      p.name = `C${String(i + 1).padStart(2, "0")}`;
      p.rebar.stirrupBranches = i % 2 ? 4 : 2;
      p.design.combinations = Array.from({ length: combinations }, (_, j) => ({
        name: `Caso ${j + 1}`,
        vertical: 120000 + j * 1000,
        horizontal: 10000,
        gamma: 1.4,
      }));
      return p;
    }),
  };
}
