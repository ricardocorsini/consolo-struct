import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  maxPdfPageSide,
  pieceDrawing,
  type Drawing,
  type Entity,
} from "../src/detailing/drawing";
import {
  detectDrawingCollisions,
  drawingBounds,
  entityBounds,
} from "../src/detailing/layout";
import { buildDetail } from "../src/detailing/model";
import { decodeProject, exampleProject } from "../src/domain/model";
import { drawingLayoutFixtures } from "./drawingLayoutFixtures";
import { sheetOrigins } from "./sheetOrigins";

const project = decodeProject(
  readFileSync(
    new URL(
      "../examples/detalhamento/consolos-detalhados.lume.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const fixtures = drawingLayoutFixtures();

describe("Posicionamento automático da prancha (#73)", () => {
  it.each([
    ...project.pieces.map((piece) => ({ name: piece.name, piece })),
    ...fixtures,
  ])("$name fica dentro da página e sem colisões de anotação", ({ piece }) => {
    const detail = buildDetail(piece);
    const drawing = pieceDrawing(project, detail);
    const collisions = detectDrawingCollisions(drawing);
    expect(collisions).toEqual([]);
    const bounds = drawingBounds(drawing.entities);
    expect(bounds.left).toBeGreaterThan(0);
    expect(bounds.top).toBeGreaterThan(0);
    expect(bounds.right).toBeLessThan(drawing.width);
    expect(bounds.bottom).toBeLessThan(drawing.height);
    expect(Math.max(drawing.width, drawing.height)).toBeLessThan(
      maxPdfPageSide,
    );
    expect(pieceDrawing(project, detail).entities).toEqual(drawing.entities);
  });

  it("cotas curtas deslocam o texto e mantêm os pontos medidos", () => {
    const { piece } = fixtures.find(({ name }) => name === "Cotas curtas")!;
    const drawing = pieceDrawing(project, buildDetail(piece));
    const root = sheetOrigins(drawing, piece.geometry).elevation;
    const label = drawing.entities.find(
      (e) => e.type === "text" && e.text === "A = 0,6",
    )!;
    const cut = root.x + piece.geometry.loadOffset / 10;
    const bounds = entityBounds(label);
    expect(bounds.left > cut || bounds.right < root.x).toBe(true);
    expect(
      drawing.entities.some(
        (e) =>
          e.type === "line" &&
          e.annotation === "dimension" &&
          Math.abs(e.a.x - root.x) < 1e-8 &&
          Math.abs(e.b.x - cut) < 1e-8 &&
          e.a.y < root.y &&
          e.a.y === e.b.y,
      ),
    ).toBe(true);
  });

  it("agrupa todas as marcas de uma camada da planta em uma chamada", () => {
    const { piece } = fixtures.find(
      ({ name }) => name === "Duas camadas de alças",
    )!;
    const detail = buildDetail(piece);
    const upperMarks = detail.bars
      .filter(
        (bar) =>
          bar.family === "tie" &&
          bar.locations.some(({ layer }) => layer === 1),
      )
      .map((bar) => bar.mark);
    expect(upperMarks).toHaveLength(2);
    const drawing = pieceDrawing(project, detail);
    const calls = drawing.entities.filter(
      (e) => e.type === "text" && e.text.endsWith(" - 2ª camada"),
    );
    expect(calls.map((e) => e.text)).toEqual([
      upperMarks.join(" / ") + " - 2ª camada",
    ]);
  });

  it("dimensiona o cabeçalho por glifos largos e conserva os dados do projeto", () => {
    const input = exampleProject();
    input.name = "W".repeat(160);
    const p = input.pieces[0];
    p.name = "M".repeat(80);
    p.description = "W".repeat(160);
    const drawing = pieceDrawing(input, buildDetail(p));
    expect(drawing.entities).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: input.name + " · " + p.description,
      }),
    );
    expect(detectDrawingCollisions(drawing)).toEqual([]);
    expect(drawingBounds(drawing.entities).right).toBeLessThan(drawing.width);
  });

  it("detecta conflitos injetados, incluindo texto rotacionado e linhas paralelas", () => {
    const label: Entity = {
      type: "text",
      text: "H1 = 0,1",
      size: 2.2,
      at: { x: 30, y: 30 },
      layer: "COTAS",
      align: "middle",
      rotate: -90,
    };
    const duplicate = { ...label };
    const bar: Entity = {
      type: "line",
      a: { x: 25, y: 30 },
      b: { x: 32, y: 30 },
      layer: "ARMADURAS",
      thickness: 2,
    };
    const dimension: Entity = {
      type: "line",
      annotation: "dimension",
      a: { x: 2, y: 5 },
      b: { x: 18, y: 5 },
      layer: "COTAS",
    };
    const overlap = { ...dimension, a: { x: 8, y: 5 }, b: { x: 20, y: 5 } };
    const drawing: Drawing = {
      width: 50,
      height: 50,
      name: "Prova",
      entities: [label, duplicate, bar, dimension, overlap],
    };
    const collisions = detectDrawingCollisions(drawing);
    for (const [a, b] of [
      [label, duplicate],
      [label, bar],
      [dimension, overlap],
    ])
      expect(
        collisions.some(
          ({ first, second }) =>
            (first === a && second === b) || (first === b && second === a),
        ),
      ).toBe(true);
  });
});
