import type { Piece } from "../domain/model";
import { tieLayout } from "../domain/engine";
import { detailingLoopDiameter, loopNesting } from "../domain/loops";
import { stirrupLayout } from "../domain/theory";
import { bottomOffsetDepth, concreteProfile } from "../domain/profile";
import { beamArrangementActive, beamBarPositions } from "./beam";
import {
  closedStirrup,
  mandrelDiameter,
  roundedPath,
  samplePath,
  type BarPath,
} from "./geometry";
import { translatePath } from "./rebarPlacement";

type Point3 = [number, number, number];
/** Minimum distance of two centre-line segments, including crossings between samples. */
function segmentDistance(p: Point3, q: Point3, a: Point3, b: Point3) {
  const sub = (u: Point3, v: Point3) => u.map((n, i) => n - v[i]) as Point3;
  const dot = (u: Point3, v: Point3) =>
    u.reduce((sum, n, i) => sum + n * v[i], 0);
  const u = sub(q, p),
    v = sub(b, a),
    w = sub(p, a);
  const uu = dot(u, u),
    vv = dot(v, v),
    uv = dot(u, v),
    uw = dot(u, w),
    vw = dot(v, w);
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const distance = (s: number, t: number) =>
    Math.hypot(...w.map((n, i) => n + s * u[i] - t * v[i]));
  const candidates = [
    distance(0, vv ? clamp(vw / vv) : 0),
    distance(1, vv ? clamp((vw + uv) / vv) : 0),
    distance(uu ? clamp(-uw / uu) : 0, 0),
    distance(uu ? clamp((uv - uw) / uu) : 0, 1),
  ];
  const det = uu * vv - uv * uv;
  if (det > 1e-10) {
    const s = (uv * vw - vv * uw) / det,
      t = (uu * vw - uv * uw) / det;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) candidates.push(distance(s, t));
  }
  return Math.min(...candidates);
}
export function pathsClash(first: Point3[], second: Point3[], minimum: number) {
  return first
    .slice(1)
    .some((q, i) =>
      second
        .slice(1)
        .some(
          (b, j) => segmentDistance(first[i], q, second[j], b) < minimum - 1e-5,
        ),
    );
}

/** One physical source for N3/N4, in mm. Cross sections use (width, depth);
 * longitudinal bars use (length from support, depth). No resistance from N4. */
export { translatePath };

/** All intersections with a section x, including arcs; no assumed straight chord. */
export function sectionDepths(path: BarPath, x: number): number[] {
  const depths: number[] = [];
  const add = (y: number) => {
    if (!depths.some((d) => Math.abs(d - y) < 1e-6)) depths.push(y);
  };
  for (const s of path.segments) {
    if (s.type === "line") {
      if (Math.abs(s.b.x - s.a.x) < 1e-8) {
        if (Math.abs(x - s.a.x) < 1e-6) {
          add(s.a.y);
          add(s.b.y);
        }
      } else {
        const t = (x - s.a.x) / (s.b.x - s.a.x);
        if (t >= -1e-8 && t <= 1 + 1e-8) add(s.a.y + t * (s.b.y - s.a.y));
      }
    } else {
      const cosine = (x - s.center.x) / s.radius;
      if (Math.abs(cosine) > 1 + 1e-8) continue;
      for (const angle of [
        Math.acos(Math.max(-1, Math.min(1, cosine))),
        -Math.acos(Math.max(-1, Math.min(1, cosine))),
      ]) {
        const turn =
          (((Math.sign(s.sweep) * (angle - s.start)) % (2 * Math.PI)) +
            2 * Math.PI) %
          (2 * Math.PI);
        if (turn <= Math.abs(s.sweep) + 1e-8)
          add(s.center.y + s.radius * Math.sin(angle));
      }
    }
  }
  return depths.sort((a, b) => a - b);
}

export function firstLayerTiePositions(p: Piece): number[] {
  const layout = tieLayout(p);
  const firstRow = layout.rows.find((row) => row.count > 0);
  if (!firstRow) return [];
  const g = p.geometry,
    q = p.design,
    r = p.rebar;
  if (!beamArrangementActive(p) && q.frontAnchor === "loop") {
    // The loops as detailed (#64): same nesting and the same clamp to the
    // narrowest width that holds the curve, so no leg is lost here either.
    const nest = loopNesting(
      p,
      firstRow.count,
      // The detailing numbers layers among the non-empty rows: this is the first.
      detailingLoopDiameter(p, 0),
      layout,
    );
    return nest.widths
      .flatMap((w) => {
        const inset = (g.width - Math.max(w, nest.required)) / 2;
        return [inset, g.width - inset];
      })
      .sort((a, b) => a - b);
  }
  return beamBarPositions(p, firstRow.count, r.tieDiameter);
}

export function transverseGeometry(
  p: Piece,
  sectionX?: number,
  placedTiePositions?: number[],
) {
  const g = p.geometry,
    r = p.rebar;
  const branches = r.stirrupBranches ?? 2,
    diameter = r.constructiveDiameter ?? 8;
  const concrete = concreteProfile(p),
    layout = stirrupLayout(p);
  const mandrel = mandrelDiameter(
    r.stirrupDiameter,
    p.materials.fykTransverse,
    true,
  );
  const radius = (mandrel + r.stirrupDiameter) / 2;
  // Clearance includes the rounded internal corner, not just two infinite straight faces.
  const offset =
    g.cover + r.stirrupDiameter + diameter / 2 + radius * (1 - Math.SQRT1_2);
  const innerCornerOffset =
    r.stirrupDiameter / 2 + diameter / 2 + radius * (1 - Math.SQRT1_2);
  const tiePositions =
    branches === 4 ? (placedTiePositions ?? firstLayerTiePositions(p)) : [];
  const hasCentralTies = tiePositions.length >= 4;
  let innerLeft = 0,
    innerRight = 0;
  let positions = [offset, offset + (g.width - 2 * offset)];
  if (branches === 4 && hasCentralTies) {
    const n = tiePositions.length;
    const leftIdx = n % 2 === 0 ? n / 2 - 1 : (n - 3) / 2;
    const rightIdx = n % 2 === 0 ? n / 2 : (n + 1) / 2;
    innerLeft =
      tiePositions[leftIdx] - r.tieDiameter / 2 - r.stirrupDiameter / 2;
    innerRight =
      tiePositions[rightIdx] + r.tieDiameter / 2 + r.stirrupDiameter / 2;
    positions = [
      offset,
      innerLeft + innerCornerOffset,
      innerRight - innerCornerOffset,
      g.width - offset,
    ];
  }
  // N3G is a closed internal stirrup juxtaposed to N3 (center-to-center = stirrupDiameter).
  // Free spacing between consecutive N3/N3G pairs preserves the existing N3 criterion.
  const clearance = Math.max(20, r.stirrupDiameter, 1.2 * p.design.aggregate);
  const innerShift = r.stirrupDiameter;
  const assemblies = (
    sectionX === undefined ? layout.positions : [sectionX]
  ).map((x) => {
    const width = g.width - 2 * layout.offset;
    const height =
      bottomOffsetDepth(concrete, x, layout.offset) - layout.offset;
    const outer = {
      x,
      pairedWith: undefined,
      internal: false,
      width,
      height,
      offset: layout.offset,
      path: closedStirrup(width, height, r.stirrupDiameter, mandrel),
    };
    // No central N1 pair means there is no physical width for N3G or its N4 bars.
    if (branches === 2 || !hasCentralTies) return [outer];
    const w = innerRight - innerLeft;
    // Shift toward the tip (+x) except at the last station (-x), keeping monotonic order.
    const innerX =
      x < layout.positions.at(-1)! - 1e-6 ? x + innerShift : x - innerShift;
    const innerHeight =
      bottomOffsetDepth(concrete, innerX, layout.offset) - layout.offset;
    const path = closedStirrup(w, innerHeight, r.stirrupDiameter, mandrel);
    const inner = {
      x: innerX,
      pairedWith: x,
      internal: true,
      width: w,
      height: innerHeight,
      offset: innerLeft,
      path,
    };
    return innerX < x ? [inner, outer] : [outer, inner];
  });
  const sections = assemblies.flat();
  const problems: { code: string; message: string }[] = [];
  if (branches === 4 && sectionX === undefined) {
    if (!hasCentralTies)
      problems.push({
        code: "transverse-inner-tie",
        message:
          "A 1ª camada de N1 não possui as duas barras centrais necessárias para definir a largura do estribo interno fechado N3G.",
      });
    if (
      sections.some(
        (s) => s.x < layout.first - 1e-6 || s.x > layout.last + 1e-6,
      )
    )
      problems.push({
        code: "transverse-cover",
        message:
          "O par N3/N3G não cabe entre as linhas de cobrimento longitudinal; reveja a geometria sem reduzir o afastamento, a bitola ou as dobras.",
      });
    const pairs = assemblies.map((assembly) => ({
      minX: Math.min(...assembly.map((s) => s.x)),
      maxX: Math.max(...assembly.map((s) => s.x)),
    }));
    if (
      pairs
        .slice(1)
        .some(
          (pair, i) =>
            pair.minX - pairs[i].maxX < r.stirrupDiameter + clearance - 1e-6,
        )
    )
      problems.push({
        code: "transverse-clearance",
        message: `Falta espaço longitudinal entre os pares de N3/N3G: manter folga livre de ${clearance.toLocaleString("pt-BR")} mm entre pares consecutivos. Rever quantidade, agregado ou geometria; os quatro ramos calculados não validam este arranjo físico.`,
      });
    const points = (s: (typeof sections)[number]) =>
      samplePath(translatePath(s.path, s.offset, layout.offset), 24).map(
        (pt) => [s.x, pt.x, pt.y] as Point3,
      );
    for (let i = 0; i < sections.length; i++) {
      if (
        sections
          .slice(i + 1)
          .some(
            (s) =>
              Math.abs(s.x - sections[i].x) < r.stirrupDiameter - 1e-6 &&
              pathsClash(points(sections[i]), points(s), r.stirrupDiameter),
          )
      ) {
        problems.push({
          code: "transverse-clash",
          message:
            "Há interferência física entre estribos N3 e/ou estribos internos fechados N3G, inclusive trechos inferiores e dobras. O arranjo de quatro ramos não pode ser fabricado assim.",
        });
        break;
      }
    }
  }
  return {
    branches,
    clearance,
    innerShift,
    problems,
    diameter,
    offset,
    positions,
    sections,
    mandrel,
    radius,
    pitch: layout.pitch,
    stirrupOffset: layout.offset,
  };
}

export function constructiveGeometry(p: Piece, t = transverseGeometry(p)) {
  const g = p.geometry,
    r = p.rebar;
  const concrete = concreteProfile(p),
    diameter = t.diameter;
  const nominalMandrel = mandrelDiameter(diameter, p.materials.fykTransverse);
  const nominalRadius = (nominalMandrel + diameter) / 2;
  const radius =
    concrete.status === "removed"
      ? Math.max(nominalRadius, t.offset)
      : nominalRadius;
  // Inset the complete lower polygon by its normal distance, including cut vertices.
  const lines = concrete.bottom.slice(1).map((v, i) => {
    const a = concrete.bottom[i],
      m = (v.depth - a.depth) / (v.x - a.x);
    return { m, b: a.depth - m * a.x - t.offset * Math.sqrt(1 + m * m) };
  });
  const end = g.length - g.cover - r.tieDiameter - diameter / 2;
  const back = -(g.columnWidth - g.cover - diameter / 2);
  const corners = lines
    .slice(1)
    .map((line, i) => {
      const prev = lines[i],
        x = (line.b - prev.b) / (prev.m - line.m);
      return { x, y: line.m * x + line.b };
    })
    .filter((v) => v.x > 0 && v.x < end);
  const bottom = (x: number) => bottomOffsetDepth(concrete, x, t.offset);
  const lastSlope =
    [...lines]
      .reverse()
      .find((line) => Math.abs(line.m * end + line.b - bottom(end)) < 1e-4)
      ?.m ?? lines.at(-1)!.m;
  const tangent = radius * Math.tan((Math.PI / 2 + Math.atan(lastSlope)) / 2);
  const ceiling =
    tieLayout(p).maxDepth +
    r.tieDiameter / 2 +
    diameter / 2 +
    Math.max(20, diameter);
  const tail = Math.max(8 * diameter, bottom(end) - tangent - ceiling);
  const vertices = [
    { x: back, y: bottom(0) },
    { x: 0, y: bottom(0) },
    ...corners,
    { x: end, y: bottom(end) },
    { x: end, y: bottom(end) - tangent - tail },
  ];
  const path = roundedPath(vertices, radius);
  const problems: string[] = [];
  if (g.width - 2 * t.offset <= (t.positions.length - 1) * diameter)
    problems.push("As barras N4 não cabem transversalmente dentro de N3.");
  if (bottom(end) - tangent - tail < ceiling - 1e-6)
    problems.push(
      "A dobra frontal de N4 não comporta o mandril e a ponta sem invadir N1.",
    );
  if (!path.valid || end <= 0 || back >= 0)
    problems.push(
      "N4 não comporta o percurso, o mandril e as dobras no contorno informado.",
    );
  for (const pt of samplePath(path, 32)) {
    if (
      pt.y < g.cover + diameter / 2 - 1e-6 ||
      pt.x < -g.columnWidth + g.cover + diameter / 2 - 1e-6 ||
      pt.x > g.length - g.cover - diameter / 2 + 1e-6 ||
      pt.y >
        (pt.x < 0
          ? g.height - g.cover - diameter / 2
          : bottomOffsetDepth(concrete, pt.x, g.cover + diameter / 2)) +
          1e-6
    ) {
      problems.push(
        "O percurso de N4 invade o cobrimento; rever geometria sem reduzir bitola, cobrimento ou dobra.",
      );
      break;
    }
  }
  return {
    ...t,
    path,
    vertices,
    end,
    back,
    ceiling,
    tail,
    radius,
    mandrel: 2 * radius - diameter,
    problems,
  };
}

/** Project a paired N3/N3G assembly; each N4 is cut in its own containing plane. */
export function projectedConstructiveSection(
  constructive: ReturnType<typeof constructiveGeometry>,
  sections: ReturnType<typeof transverseGeometry>["sections"],
) {
  return constructive.positions.flatMap((v, i) => {
    const internal = i > 0 && i < constructive.positions.length - 1;
    const plane = sections.find((s) => s.internal === internal);
    if (!plane) return [];
    return sectionDepths(constructive.path, plane.x).map((depth) => ({
      v,
      depth,
      x: plane.x,
    }));
  });
}
