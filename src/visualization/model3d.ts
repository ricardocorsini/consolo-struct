import { number, type GeometryKey, type Piece } from "../domain/model";
import {
  dimensionLabel,
  elevationDimensions,
  type ElevationDimension,
} from "../domain/dimensions";
import { reactionGeometry } from "../domain/theory";
import { concreteProfile } from "../domain/profile";
import { rebarModel, scenePaths, viewFamily } from "../detailing/rebarModel";

/** World coordinates in mm: X = corbel length, Y = width, Z = up. */
export type Point3 = [number, number, number];
export interface Dimension3D {
  id: GeometryKey | "heightDifference";
  label: string;
  from: Point3;
  to: Point3;
  witnesses: [Point3, Point3][];
  anchor: Point3;
  value: number;
}
export interface Load3D {
  id: "vertical" | "horizontal";
  label: string;
  from: Point3;
  to: Point3;
  anchor: Point3;
  value: number;
}
export interface SteelPath {
  /** Modelling family: N4 is mandatory constructive steel; P1 is the
   * independent beam positive family; TS and PINO are the connections. */
  id: "N1" | "N2" | "N3" | "N4" | "P1" | "TS" | "PINO";
  /** Fabrication position (N1-2, N2I, N3G…) of the detailing. */
  mark: string;
  points: Point3[];
  diameter: number;
}
export interface SceneModel {
  profile: [number, number][];
  width: number;
  support: { center: Point3; size: Point3 };
  bearing: { center: Point3; length: number; width: number };
  dimensions: Dimension3D[];
  loads: Load3D[];
  steel: SteelPath[];
  bounds: { min: Point3; max: Point3 };
  span: number;
}
const mid = (a: Point3, b: Point3): Point3 =>
  a.map((v, i) => (v + b[i]) / 2) as Point3;
export function buildSceneModel(p: Piece): SceneModel {
  const g = p.geometry,
    q = p.design;
  const span = Math.max(g.columnWidth + g.length, g.height, g.width);
  const reaction = reactionGeometry(p);
  const margin = Math.max(22, span * 0.075),
    side = g.width / 2;
  const concrete = concreteProfile(p);
  const cap = Math.max(60, g.height * 0.2);
  const above = Math.max(cap, q.bearingHeight) + margin;
  const below = -Math.max(g.height, g.tipHeight) - 1.25 * margin;
  const dim = (
    id: Dimension3D["id"],
    value: number,
    a: Point3,
    b: Point3,
    from: Point3,
    to: Point3,
  ): Dimension3D => ({
    id,
    label: dimensionLabel(id, value, true),
    from,
    to,
    anchor: mid(from, to),
    witnesses: [
      [a, from],
      [b, to],
    ],
    value,
  });
  const dimensions = elevationDimensions(g).map((d) => {
    const reference = ({ x, depth }: ElevationDimension["from"]): Point3 => [
      x,
      -side,
      -depth,
    ];
    const project = ({ x, depth }: ElevationDimension["from"]): Point3 => {
      if (d.placement === "top" || d.placement === "bottom")
        return [x, -side - margin, d.placement === "top" ? above : below];
      return [
        g.length + margin * (d.placement === "outer" ? 2.5 : 1),
        -side,
        -depth,
      ];
    };
    return dim(
      d.id,
      d.value,
      reference(d.from),
      d.id === "loadOffset" ? [d.to.x, 0, -d.to.depth] : reference(d.to),
      project(d.from),
      project(d.to),
    );
  });
  dimensions.push(
    dim(
      "width",
      g.width,
      [g.length, -side, -g.tipHeight],
      [g.length, side, -g.tipHeight],
      [g.length, -side, -g.tipHeight - margin],
      [g.length, side, -g.tipHeight - margin],
    ),
  );
  const loads: Load3D[] = [];
  const vLabel = q.forceMode === "design" ? "Vd" : "Vk";
  const hLabel =
    q.horizontalMode === "estimated"
      ? "H adicional"
      : q.forceMode === "design"
        ? "Hd total"
        : "Hk total";
  if (p.loads.vertical !== 0)
    loads.push({
      id: "vertical",
      label: `${vLabel} = ${number(p.loads.vertical / 1000, 1)} kN${reaction.shift ? ` · a_calc ${number(reaction.a / 10, 1)} cm` : ""}`,
      value: p.loads.vertical,
      from: [reaction.a, 0, q.bearingHeight + span * 0.26],
      to: [reaction.a, 0, q.bearingHeight],
      anchor: [reaction.a, 0, q.bearingHeight + span * 0.29],
    });
  if (p.loads.horizontal !== 0)
    loads.push({
      id: "horizontal",
      label: `${hLabel} = ${number(p.loads.horizontal / 1000, 1)} kN`,
      value: p.loads.horizontal,
      from: [reaction.a, 0, q.bearingHeight],
      to: [
        reaction.a + Math.sign(p.loads.horizontal) * span * 0.24,
        0,
        q.bearingHeight,
      ],
      anchor: [
        reaction.a + Math.sign(p.loads.horizontal) * span * 0.27,
        0,
        q.bearingHeight + margin * 0.65,
      ],
    });
  // Every placed bar of the single reinforcement source, with its real
  // bends, loops, hooks and connections (detailing coordinates: y from the
  // lateral face, z as depth; the scene is centred in Y with Z up).
  const steel: SteelPath[] = scenePaths(rebarModel(p)).map(
    ({ bar, points }) => ({
      id: viewFamily(bar) as SteelPath["id"],
      mark: bar.mark,
      diameter: bar.diameter,
      points: points.map((pt): Point3 => [pt.x, pt.y - side, -pt.z]),
    }),
  );
  const support = {
    center: [-g.columnWidth / 2, 0, -g.height / 2] as Point3,
    size: [g.columnWidth, g.width, g.height + 2 * cap] as Point3,
  };
  const points: Point3[] = [
    [-g.columnWidth, -side, -g.height - cap],
    [g.length, -side, cap],
    ...dimensions.flatMap((x) => [x.from, x.to]),
    ...loads.flatMap((x) => [x.from, x.to, x.anchor]),
  ];
  const bounds = {
    min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))) as Point3,
    max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))) as Point3,
  };
  return {
    profile: [
      [0, 0],
      [g.length, 0],
      ...[...concrete.bottom]
        .reverse()
        .map((v): [number, number] => [v.x, -v.depth]),
    ],
    width: g.width,
    support,
    bearing: {
      center: [g.loadOffset, 0, 0],
      length: q.bearingLength,
      width: q.bearingWidth,
    },
    dimensions,
    loads,
    steel,
    bounds,
    span,
  };
}
