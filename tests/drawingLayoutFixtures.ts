import { newPiece, type Piece } from "../src/domain/model";
import { stirrupLayout } from "../src/domain/theory";
import { cantileverFixture, shortFixture } from "./fixtures";

type LayoutInputs = Pick<Piece, "geometry" | "design" | "detailing" | "rebar">;
type Changes = { [K in keyof LayoutInputs]?: Partial<LayoutInputs[K]> };

export function drawingLayoutFixtures() {
  const fixture = (name: string, changes: Changes, piece = shortFixture()) => {
    Object.assign(piece.geometry, changes.geometry);
    Object.assign(piece.design, changes.design);
    Object.assign(piece.detailing, changes.detailing);
    Object.assign(piece.rebar, changes.rebar);
    piece.name = name;
    return { name, piece };
  };
  const coincidentAxes = shortFixture();
  return [
    fixture("Curto", {}),
    fixture("Muito curto", { geometry: { length: 200, loadOffset: 80 } }),
    fixture("Viga em balanço", {}, cantileverFixture()),
    fixture(
      "Pequeno",
      {
        geometry: {
          width: 200,
          height: 300,
          tipHeight: 150,
          length: 200,
          loadOffset: 80,
          cover: 20,
          columnWidth: 300,
        },
        design: { tieLayers: 2, bearingWidth: 160, bearingLength: 70 },
        detailing: { pins: 2 },
      },
      newPiece(1),
    ),
    fixture(
      "Quatro camadas e vinte pinos",
      {
        geometry: {
          width: 200,
          height: 250,
          tipHeight: 100,
          length: 150,
          loadOffset: 50,
        },
        design: { tieLayers: 4 },
        detailing: { pins: 20 },
        rebar: { tieCount: 16 },
      },
      newPiece(1),
    ),
    fixture("Grande", {
      geometry: {
        width: 700,
        height: 1200,
        tipHeight: 600,
        length: 1500,
        loadOffset: 800,
        columnWidth: 1000,
      },
    }),
    fixture("Estribo com quatro ramos", {
      rebar: { stirrupBranches: 4, tieCount: 6 },
    }),
    fixture("Duas camadas de alças", {
      geometry: { width: 520 },
      design: { tieLayers: 2 },
      detailing: { pins: 2, secondLoopDiameter: 110 },
      rebar: { tieCount: 8 },
    }),
    fixture(
      "Três camadas soldadas",
      {
        geometry: {
          height: 900,
          tipHeight: 450,
          width: 550,
          length: 600,
          loadOffset: 250,
        },
        design: { tieLayers: 3 },
        detailing: { pins: 2 },
        rebar: { tieCount: 12, stirrupBranches: 4 },
      },
      newPiece(1),
    ),
    fixture("Recortado", { design: { excessConcrete: "remove" } }),
    fixture("Armado como viga", {
      geometry: { tipHeight: 400 },
      detailing: { barArrangement: "beam", pins: 2 },
    }),
    fixture(
      "Cotas curtas",
      {
        geometry: { loadOffset: 6, tipHeight: 398 },
        detailing: { pins: 2, pinSpacing: 15, pinCenterOffset: -140 },
      },
      newPiece(1),
    ),
    fixture(
      "Eixos de corte coincidentes",
      {
        geometry: { loadOffset: stirrupLayout(coincidentAxes).positions[0] },
      },
      coincidentAxes,
    ),
    fixture(
      "Nota sem espaços",
      {
        detailing: { notes: "WWW".repeat(650) },
      },
      newPiece(1),
    ),
  ];
}
