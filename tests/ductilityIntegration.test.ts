import { describe, expect, it } from "vitest";
import { calculate } from "../src/domain/engine";
import { exampleProject, decodeProject } from "../src/domain/model";
import { toCsv } from "../src/lib/exports";
import { shortFixture, cantileverFixture } from "./fixtures";

describe("Ductilidade com N3/N4 e política γn integrados", () => {
  it.each([2, 4] as const)(
    "mantém colunas e resultados alinhados no CSV misto com %s ramos",
    (branches) => {
      const floor = shortFixture();
      floor.name = "Piso";
      floor.rebar.stirrupBranches = branches;
      Object.assign(floor.design, {
        forceMode: "characteristic",
        production: "factory",
        permanentPredominant: true,
        gammaNPolicy: "floor12",
      });
      const table = structuredClone(floor);
      table.id = "table";
      table.name = "Tabela";
      Object.assign(table.design, {
        gammaNPolicy: "table9062",
        gammaNJustification:
          "Escolha explícita para conferir as colunas integradas.",
      });
      const unsolved = structuredClone(table);
      unsolved.id = "unsolved";
      unsolved.name = "Sem raiz";
      unsolved.loads.vertical = 5e6;
      const beam = cantileverFixture({ length: 700 });
      beam.name = "Viga";
      const project = {
        ...exampleProject(),
        pieces: [floor, table, unsolved, beam],
      };
      expect(decodeProject(JSON.stringify(project))).toEqual(project);
      const rows = toCsv(project)
        .replace(/^\uFEFF/, "")
        .split("\r\n")
        .map((row) =>
          [...row.matchAll(/"((?:[^"]|"")*)"(?:;|$)/g)].map((m) =>
            m[1].replaceAll('""', '"'),
          ),
        );
      const header = rows[1],
        data = rows.slice(2);
      for (const row of data) expect(row).toHaveLength(header.length);
      const cell = (i: number, key: string) => {
        const index = header.indexOf(key);
        expect(index).toBeGreaterThanOrEqual(0);
        return data[i][index];
      };
      expect(cell(0, "N3 ramos efetivos por posicao")).toBe(String(branches));
      expect(cell(1, "N4 barras por peca")).toBe(String(branches));
      expect(cell(0, "gamma n adotado")).toBe("1.2");
      expect(cell(1, "gamma n adotado")).toBe("1");
      expect(cell(1, "Justificativa informada gamma n")).toBe(
        table.design.gammaNJustification,
      );
      for (const [i, p] of project.pieces.entries()) {
        const r = calculate(p);
        for (const id of ["ductilityXd", "maxSteel", "plasticRotation"]) {
          const c = r.checks.find((c) => c.id === id);
          expect(cell(i, `${id} estado`)).toBe(c?.status ?? "");
          expect(cell(i, `${id} formula`)).toBe(c?.formula ?? "");
          expect(cell(i, `${id} referencia`)).toBe(c?.reference ?? "");
          expect(cell(i, `${id} detalhe/combinacao`)).toBe(c?.detail ?? "");
          expect(cell(i, `${id} limite`)).toBe(c ? String(c.capacity) : "");
        }
      }
      expect(cell(0, "plasticRotation estado")).toBe("pass");
      expect(cell(2, "plasticRotation estado")).toBe("fail");
      expect(cell(2, "plasticRotation valor")).toBe("sem solução");
      expect(cell(3, "plasticRotation valor")).toBe("");
      expect(calculate(unsolved).values).not.toHaveProperty("plastic_ratio");
    },
  );
});
