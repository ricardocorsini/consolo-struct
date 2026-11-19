import type { Detail } from "./model";
import {
  colors,
  maxPdfPageSide,
  type Drawing,
  type Entity,
  type Layer,
} from "./drawing";
import { at, type Point } from "./geometry";
import { drawingWidth, pdfText } from "./layout";
import { steelLabel } from "../domain/steel";
import { gammaNDecision, gammaNPolicyLabels } from "../domain/gammaN";

export const escapeXml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const n = (v: number) => Number(v.toFixed(5));
// The sheet uses cm. Retain sub-micrometre parity with the editor's coordinates.
const coordinate = (v: number) => Number(v.toFixed(9));
const barWidth = (e: Entity) =>
  e.type === "line" || e.type === "arc" ? e.thickness : undefined;
export function entitySvg(e: Entity): string {
  const thickness = barWidth(e);
  const schematic = (e.type === "line" || e.type === "arc") && e.schematic;
  const steelStyle =
    thickness === undefined
      ? ""
      : ` stroke-linecap="butt" stroke-linejoin="round" ${schematic ? `data-schematic-bar="${escapeXml(schematic)}"` : `data-physical-diameter="${coordinate(thickness * 10)}"`}`;
  const common = `class="detail-${e.layer}" fill="none" stroke="${colors[e.layer]}" stroke-width="${drawingWidth(e)}"${steelStyle}`;
  if (e.type === "line")
    return `<line x1="${coordinate(e.a.x)}" y1="${coordinate(e.a.y)}" x2="${coordinate(e.b.x)}" y2="${coordinate(e.b.y)}" ${common}${e.dash ? ' stroke-dasharray="2 1"' : ""}/>`;
  if (e.type === "arc") {
    const a = at(e.center, e.radius, e.start);
    const b = at(e.center, e.radius, e.start + e.sweep);
    return `<path d="M${coordinate(a.x)} ${coordinate(a.y)} A${coordinate(e.radius)} ${coordinate(e.radius)} 0 ${Math.abs(e.sweep) > Math.PI ? 1 : 0} ${e.sweep > 0 ? 1 : 0} ${coordinate(b.x)} ${coordinate(b.y)}" ${common}${e.dash ? ' stroke-dasharray="2 1"' : ""}/>`;
  }
  if (e.type === "circle") {
    const style =
      e.layer === "ARMADURAS"
        ? `class="detail-ARMADURAS" fill="${colors.ARMADURAS}" stroke="none" ${e.projectionCap ? 'data-projection-cap=""' : `data-physical-diameter="${coordinate(e.radius * 20)}"`}`
        : common;
    return `<circle cx="${coordinate(e.center.x)}" cy="${coordinate(e.center.y)}" r="${coordinate(e.radius)}" ${style}/>`;
  }
  return `<text class="detail-${e.layer}" x="${n(e.at.x)}" y="${n(e.at.y)}" fill="${colors[e.layer]}" font-size="${e.size}" font-family="Arial,Helvetica,sans-serif"${e.align ? ` text-anchor="${e.align}"` : ""}${e.rotate ? ` transform="rotate(${e.rotate} ${n(e.at.x)} ${n(e.at.y)})"` : ""}>${escapeXml(e.text)}</text>`;
}
export const drawingSvg = (drawing: Drawing) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(drawing.width)}mm" height="${n(drawing.height)}mm" viewBox="0 0 ${n(drawing.width)} ${n(drawing.height)}"><title>${escapeXml(drawing.name)} - detalhamento, cm</title><rect width="100%" height="100%" fill="white"/>${drawing.entities.map(entitySvg).join("\n")}</svg>`;

export function drawingDxf(drawing: Drawing): string {
  const parts: (string | number)[] = [];
  const pair = (code: number, value: number | string) =>
    parts.push(code, typeof value === "number" ? coordinate(value) : value);
  const text = (value: string) =>
    value
      .replace(/[\r\n]+/g, " ")
      .replace(
        /[^\x20-\x7e]/g,
        (c) =>
          `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
      );
  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1027");
  pair(9, "$INSUNITS");
  pair(70, 5); // centimetres, including geometry, arcs and text heights
  pair(9, "$MEASUREMENT");
  pair(70, 1);
  pair(9, "$LUNITS");
  pair(70, 2);
  pair(9, "$LUPREC");
  pair(70, 1);
  pair(9, "$EXTMIN");
  pair(10, 0);
  pair(20, -drawing.height);
  pair(30, 0);
  pair(9, "$EXTMAX");
  pair(10, drawing.width);
  pair(20, 0);
  pair(30, 0);
  pair(0, "ENDSEC");
  pair(0, "SECTION");
  pair(2, "TABLES");
  pair(0, "TABLE");
  pair(2, "LTYPE");
  pair(5, "10");
  pair(100, "AcDbSymbolTable");
  pair(70, 2);
  pair(0, "LTYPE");
  pair(100, "AcDbSymbolTableRecord");
  pair(100, "AcDbLinetypeTableRecord");
  pair(2, "CONTINUOUS");
  pair(70, 0);
  pair(3, "Continuous");
  pair(72, 65);
  pair(73, 0);
  pair(40, 0);
  pair(0, "LTYPE");
  pair(100, "AcDbSymbolTableRecord");
  pair(100, "AcDbLinetypeTableRecord");
  pair(2, "TRACEJADO");
  pair(70, 0);
  pair(3, "Tracejado");
  pair(72, 65);
  pair(73, 2);
  pair(40, 3);
  pair(49, 2);
  pair(74, 0);
  pair(49, -1);
  pair(74, 0);
  pair(0, "ENDTAB");
  pair(0, "TABLE");
  pair(2, "LAYER");
  pair(5, "11");
  pair(100, "AcDbSymbolTable");
  pair(70, 6);
  const layerColors: Record<Layer, number> = {
    FORMAS: 7,
    ARMADURAS: 5,
    COTAS: 8,
    TEXTOS: 7,
    EIXOS: 8,
    ALERTAS: 1,
  };
  for (const layer of Object.keys(layerColors) as Layer[]) {
    pair(0, "LAYER");
    pair(100, "AcDbSymbolTableRecord");
    pair(100, "AcDbLayerTableRecord");
    pair(2, layer);
    pair(70, 0);
    pair(62, layerColors[layer]);
    pair(6, "CONTINUOUS");
    pair(370, layer === "ARMADURAS" ? 0 : layer === "FORMAS" ? 25 : 13);
  }
  pair(0, "ENDTAB");
  pair(0, "TABLE");
  pair(2, "STYLE");
  pair(5, "12");
  pair(100, "AcDbSymbolTable");
  pair(70, 1);
  pair(0, "STYLE");
  pair(100, "AcDbSymbolTableRecord");
  pair(100, "AcDbTextStyleTableRecord");
  pair(2, "Standard");
  pair(70, 0);
  pair(40, 0);
  pair(41, 1);
  pair(50, 0);
  pair(71, 0);
  pair(42, 2.5);
  pair(3, "arial.ttf");
  pair(4, "");
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");
  pair(0, "SECTION");
  pair(2, "ENTITIES");
  for (const e of drawing.entities) {
    const thickness = barWidth(e);
    if (
      e.type === "line" &&
      thickness !== undefined &&
      Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) < 1e-10
    )
      continue;
    pair(0, thickness === undefined ? e.type.toUpperCase() : "LWPOLYLINE");
    pair(100, "AcDbEntity");
    pair(8, e.layer);
    if ((e.type === "line" || e.type === "arc") && e.dash) pair(6, "TRACEJADO");
    if (thickness !== undefined && (e.type === "line" || e.type === "arc")) {
      pair(100, "AcDbPolyline");
      pair(90, 2);
      pair(70, 0);
      pair(43, thickness);
      const a = e.type === "line" ? e.a : at(e.center, e.radius, e.start);
      const b =
        e.type === "line" ? e.b : at(e.center, e.radius, e.start + e.sweep);
      pair(10, a.x);
      pair(20, -a.y);
      // CAD uses Y up, so the signed turn is the opposite of the sheet's.
      if (e.type === "arc") pair(42, Math.tan(-e.sweep / 4));
      pair(10, b.x);
      pair(20, -b.y);
      continue;
    }
    if (e.type === "line") {
      pair(100, "AcDbLine");
      pair(10, e.a.x);
      pair(20, -e.a.y);
      pair(30, 0);
      pair(11, e.b.x);
      pair(21, -e.b.y);
      pair(31, 0);
    }
    if (e.type === "circle" || e.type === "arc") {
      pair(100, "AcDbCircle");
      pair(10, e.center.x);
      pair(20, -e.center.y);
      pair(30, 0);
      pair(40, e.radius);
      if (e.type === "arc") {
        pair(100, "AcDbArc");
        const a = (-e.start * 180) / Math.PI,
          b = (-(e.start + e.sweep) * 180) / Math.PI;
        pair(50, (((e.sweep > 0 ? b : a) % 360) + 360) % 360);
        pair(51, (((e.sweep > 0 ? a : b) % 360) + 360) % 360);
      }
    }
    if (e.type === "text") {
      pair(100, "AcDbText");
      pair(10, e.at.x);
      pair(20, -e.at.y);
      pair(30, 0);
      // DXF TEXT measures uppercase height. SVG and PDF size the full em.
      pair(40, e.size * 0.718);
      pair(1, text(e.text));
      pair(50, -(e.rotate ?? 0));
      pair(7, "Standard");
      if (e.align) {
        pair(72, e.align === "middle" ? 1 : 2);
        pair(11, e.at.x);
        pair(21, -e.at.y);
        pair(31, 0);
      }
      pair(100, "AcDbText");
      pair(73, 0);
    }
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return parts.join("\n") + "\n";
}
export async function drawingPdf(drawings: Drawing[]): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { pdfIcon } = await import("../branding/pdfIcon");
  // Custom page dimensions are the loose detail bounds, not a prescribed A1/A3 layout.
  const first = drawings[0];
  if (!first) throw new Error("Selecione ao menos um consolo.");
  const pageSize = (drawing: Drawing) =>
    [
      Math.min(maxPdfPageSide, drawing.width),
      Math.min(maxPdfPageSide, drawing.height),
    ] as [number, number];
  const doc = new jsPDF({
    unit: "mm",
    format: pageSize(first),
    orientation: first.width > first.height ? "landscape" : "portrait",
    compress: true,
  });
  doc.setProperties({
    title: "ConsoloStruct - detalhamento de consolos",
    subject: "Dimensões em centímetros; detalhes soltos; escala nominal 1:10",
    creator: "ConsoloStruct 0.7",
  });
  doc.setLineCap("butt");
  doc.setLineJoin("round");
  // PDF has cubic paths. Small turns bound the error of a circular arc
  // below the sheet's dimensional tolerance, including the cut circles.
  const curve = (
    center: Point,
    radius: number,
    start: number,
    sweep: number,
  ) => {
    const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 8)));
    const turn = sweep / count;
    const tangent = (4 / 3) * radius * Math.tan(turn / 4);
    let angle = start;
    let a = at(center, radius, angle);
    doc.moveTo(a.x, a.y);
    for (let i = 1; i <= count; i++) {
      const next = start + i * turn;
      const b = at(center, radius, next);
      doc.curveTo(
        a.x - tangent * Math.sin(angle),
        a.y + tangent * Math.cos(angle),
        b.x + tangent * Math.sin(next),
        b.y - tangent * Math.cos(next),
        b.x,
        b.y,
      );
      a = b;
      angle = next;
    }
  };
  drawings.forEach((drawing, index) => {
    if (drawing.width > maxPdfPageSide || drawing.height > maxPdfPageSide)
      throw new Error(
        "Este detalhe ultrapassa o tamanho máximo do PDF. Use DXF ou SVG para este arranjo.",
      );
    if (index)
      doc.addPage(
        pageSize(drawing),
        drawing.width > drawing.height ? "landscape" : "portrait",
      );
    doc.addImage(
      pdfIcon,
      "PNG",
      drawing.width - 25,
      drawing.detail ? 18 : 8,
      10,
      10,
    );
    for (const e of drawing.entities) {
      const hex = colors[e.layer];
      doc.setDrawColor(hex);
      doc.setTextColor(hex);
      doc.setLineWidth(drawingWidth(e));
      doc.setLineDashPattern(
        (e.type === "line" || e.type === "arc") && e.dash ? [2, 1] : [],
        0,
      );
      if (e.type === "line") doc.line(e.a.x, e.a.y, e.b.x, e.b.y);
      if (e.type === "circle") {
        if (e.layer === "ARMADURAS") {
          doc.setFillColor(hex);
          curve(e.center, e.radius, 0, 2 * Math.PI);
          doc.close().fill();
        } else doc.circle(e.center.x, e.center.y, e.radius, "S");
      }
      if (e.type === "arc") {
        curve(e.center, e.radius, e.start, e.sweep);
        doc.stroke();
      }
      if (e.type === "text") {
        doc.setFont("helvetica", "normal");
        doc.setFontSize((e.size * 72) / 25.4);
        doc.text(pdfText(e.text), e.at.x, e.at.y, {
          align:
            e.align === "middle"
              ? "center"
              : e.align === "end"
                ? "right"
                : "left",
          angle: -(e.rotate ?? 0),
        });
      }
    }
  });
  return new Uint8Array(doc.output("arraybuffer"));
}
function csvCell(value: string | number) {
  let v = String(value);
  if (/^[=+@\-\t\r]/.test(v)) v = "'" + v;
  return `"${v.replace(/"/g, '""')}"`;
}
export function steelCsv(details: Detail[]): string {
  const withGammaN = details.some(
    (d) => d.piece.design.gammaNPolicy === "table9062",
  );
  const rows: (string | number)[][] = [
    [
      "Peça",
      "Revisão",
      "Quantidade de peças",
      "Posição",
      "Descrição",
      "Aço",
      "Bitola (mm)",
      "Barras por peça",
      "Barras totais",
      "C unitário (cm)",
      "C total (cm)",
      "kg por peça",
      "kg total",
      "Situação",
      "Observação",
    ],
  ];
  if (withGammaN)
    rows[0].push(
      "Política γn",
      "γn da tabela",
      "γn adotado",
      "Piso de referência γn",
      "Justificativa informada γn",
    );
  for (const d of details)
    for (const b of d.bars)
      rows.push([
        d.piece.name,
        d.piece.detailing.revision,
        d.piece.quantity,
        b.mark,
        b.description,
        steelLabel(b.grade),
        b.diameter,
        b.quantity,
        b.totalQuantity,
        (b.cutLength / 10).toFixed(1).replace(".", ","),
        (b.totalLength / 10).toFixed(1).replace(".", ","),
        b.mass.toFixed(3).replace(".", ","),
        b.totalMass.toFixed(3).replace(".", ","),
        d.issues.some((i) => i.severity === "error")
          ? "Pendências impeditivas"
          : "Para conferência",
        b.note,
        ...(withGammaN
          ? [
              gammaNPolicyLabels[gammaNDecision(d.piece.design).policy],
              d.result.values.gammaN9062 ?? "",
              d.result.values.gammaN ?? "",
              1.2,
              d.piece.design.gammaNJustification ?? "",
            ]
          : []),
      ]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
