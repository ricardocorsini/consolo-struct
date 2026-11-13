import { describe, expect, it } from "vitest";
import {
  ribbonCommands,
  ribbonGroups,
  ribbonTabs,
  type Action,
} from "../src/components/ribbonCommands";

// Inventário do baseline 54abc400, independente do catálogo que está sendo testado.
const baseline = [
  "new",
  "open",
  "save",
  "project",
  "add",
  "duplicate",
  "rename",
  "delete",
  "select",
  "pan",
  "geometry",
  "loads",
  "materials",
  "rebar",
  "elevation",
  "section",
  "three",
  "fit",
  "zoomIn",
  "zoomOut",
  "calculate",
  "autodesign",
  "design",
  "export",
  "dimensions",
  "steel",
  "forces",
  "grid",
  "browser",
  "properties",
  "checks",
  "theme",
  "pdf",
  "dxf",
  "svg",
  "csv",
  "report",
  "details",
  "pieces",
];
const actions = (tab: (typeof ribbonTabs)[number]) =>
  ribbonGroups[tab].flatMap((group) =>
    group.tools.flatMap((tool) => ("action" in tool ? [tool.action] : [])),
  );

describe("Catálogo e composição do ribbon", () => {
  it("preserva as 39 identidades e acrescenta coeficientes dos materiais, concreto excedente, armado como viga e atualizações, sem duplicação dentro de uma aba", () => {
    const expected = [
      ...baseline,
      "strutLimit",
      "materialSafety",
      "excessConcrete",
      "barArrangement",
      "updates",
    ].sort();
    expect(Object.keys(ribbonCommands).sort()).toEqual(expected);
    const reachable = new Set<Action>();
    for (const tab of ribbonTabs) {
      const groups = ribbonGroups[tab];
      expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length);
      const ids = actions(tab);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(ribbonCommands[id].label.trim()).not.toBe("");
        expect(ribbonCommands[id].tip.trim()).not.toBe("");
        reachable.add(id);
      }
    }
    expect([...reachable].sort()).toEqual(expected);
  });

  it("limita Início ao fluxo principal e mantém a edição completa em Modelo", () => {
    expect(actions("Início")).toEqual([
      "add",
      "geometry",
      "loads",
      "calculate",
      "autodesign",
      "report",
      "details",
      "export",
    ]);
    expect(actions("Início").length).toBeLessThanOrEqual(8);
    expect(actions("Modelo")).toEqual(
      expect.arrayContaining([
        "duplicate",
        "rename",
        "delete",
        "materials",
        "rebar",
        "design",
      ]),
    );
    for (const tab of ["Início", "Modelo"] as const) {
      expect(actions(tab)).not.toContain("select");
      expect(actions(tab)).not.toContain("pan");
    }
    expect(actions("Arquivo")).toEqual([
      "new",
      "open",
      "save",
      "project",
      "export",
    ]);
    expect(actions("Documentação")).toEqual([
      "report",
      "pieces",
      "details",
      "pdf",
      "dxf",
      "svg",
      "csv",
    ]);
  });

  it("mantém as repetições intencionais de Início e Configurações", () => {
    const repeated = Object.fromEntries(
      baseline
        .map((id) => [
          id,
          ribbonTabs.filter((tab) => actions(tab).includes(id as Action)),
        ])
        .filter(([, tabs]) => tabs.length > 1),
    );
    expect(repeated).toEqual({
      add: ["Início", "Modelo"],
      geometry: ["Início", "Modelo"],
      loads: ["Início", "Modelo"],
      calculate: ["Início", "Modelo"],
      autodesign: ["Início", "Modelo"],
      design: ["Modelo", "Configurações"],
      dimensions: ["Exibir", "Configurações"],
      steel: ["Exibir", "Configurações"],
      forces: ["Exibir", "Configurações"],
      grid: ["Exibir", "Configurações"],
      report: ["Início", "Documentação"],
      details: ["Início", "Documentação"],
      export: ["Arquivo", "Início"],
    });
    expect(actions("Exibir")).toEqual(
      expect.arrayContaining(["dimensions", "steel", "forces", "grid"]),
    );
  });

  it("preserva os cinco grupos de Configurações e os onze itens futuros", () => {
    expect(ribbonTabs.at(-1)).toBe("Configurações");
    const groups = ribbonGroups.Configurações;
    expect(groups.map(({ id }) => id)).toEqual([
      "general",
      "drawing",
      "three",
      "design",
      "detailing",
    ]);
    expect(groups.every(({ description }) => !!description)).toBe(true);
    const future = groups.flatMap(({ tools }) =>
      tools.flatMap((tool) => ("future" in tool ? [tool] : [])),
    );
    expect(future).toHaveLength(11);
    expect(new Set(future.map(({ future }) => future)).size).toBe(11);
    expect(actions("Configurações")).toEqual([
      "theme",
      "updates",
      "dimensions",
      "steel",
      "forces",
      "grid",
      "design",
      "strutLimit",
      "materialSafety",
      "excessConcrete",
      "barArrangement",
    ]);
    expect(actions("Exibir")).not.toContain("theme");
  });

  it("separa edição, visibilidade, documentos, exportação e salvamento", () => {
    expect(ribbonCommands.rebar.label).toBe("Editar armaduras");
    expect(ribbonCommands.steel.label).toBe("Mostrar armaduras");
    expect(ribbonCommands.loads.label).toBe("Ações da peça");
    expect(ribbonCommands.forces.label).toBe("Mostrar cargas");
    for (const pair of [
      ["rebar", "steel"],
      ["loads", "forces"],
      ["report", "pdf"],
      ["save", "export"],
    ] as const) {
      expect(ribbonCommands[pair[0]]).not.toBe(ribbonCommands[pair[1]]);
      expect(ribbonCommands[pair[0]].label).not.toBe(
        ribbonCommands[pair[1]].label,
      );
    }
    expect(ribbonCommands.save.tip).toContain(".consolo.json");
    expect(ribbonCommands.autodesign.tip).toContain("modificar a peça");
  });
});
