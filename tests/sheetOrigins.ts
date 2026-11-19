import type { Drawing } from "../src/detailing/drawing";
import type { Geometry } from "../src/domain/model";

/** Recover the view origins from the concrete, independently of the labels' tracks. */
export function sheetOrigins(drawing: Drawing, geometry: Geometry) {
  const outline = drawing.entities.filter(
    (entity) => entity.type === "line" && entity.layer === "FORMAS",
  );
  // The second edge of the elevation joins the support cap to the corbel top.
  const elevation = outline[1].b;
  const topEdge = (title: string, width: number) => {
    const caption = drawing.entities.find(
      (entity) => entity.type === "text" && entity.text.startsWith(title),
    );
    if (caption?.type !== "text") throw new Error("Vista ausente: " + title);
    const edge = outline.find(
      ({ a, b }) =>
        a.y > caption.at.y &&
        Math.abs(a.x - caption.at.x) < 1e-8 &&
        Math.abs(b.x - a.x - width) < 1e-8 &&
        Math.abs(a.y - b.y) < 1e-8,
    );
    if (!edge) throw new Error("Contorno ausente: " + title);
    return edge;
  };
  return {
    elevation,
    plan: topEdge("PLANTA DAS ARMADURAS", geometry.columnWidth / 10).b,
    sectionA: topEdge("CORTE A-A /", geometry.width / 10).a,
    sectionB: topEdge("CORTE B-B /", geometry.width / 10).a,
  };
}
