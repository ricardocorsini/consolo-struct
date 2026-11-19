import { describe, expect, it } from "vitest";
import { retainedDocumentEqual } from "../src/lib/retainedDocument";
import { DetailBuilder, detailRequestKey } from "../src/detailing/job";
import {
  drawingDxf,
  drawingPdf,
  drawingSvg,
  steelCsv,
} from "../src/detailing/exports";
import { viewsFixture } from "./reference/views59";

describe("Documentos retidos", () => {
  it("suspende somente abas já ocultas e compara dados e callbacks nas visíveis", () => {
    const callback = () => {},
      piece = viewsFixture(1).pieces[0];
    const props = { active: true, piece, callback };
    expect(retainedDocumentEqual(props, { ...props })).toBe(true);
    expect(retainedDocumentEqual(props, { ...props, callback: () => {} })).toBe(
      false,
    );
    expect(
      retainedDocumentEqual(props, {
        ...props,
        piece: { ...piece, quantity: 2 },
      }),
    ).toBe(false);
    expect(retainedDocumentEqual(props, { ...props, active: false })).toBe(
      false,
    );
    const hidden = { ...props, active: false };
    expect(
      retainedDocumentEqual(hidden, {
        ...hidden,
        piece: { ...piece, quantity: 2 },
      }),
    ).toBe(true);
    expect(retainedDocumentEqual(hidden, props)).toBe(false);
  });
});

describe("Payload de uma peça", () => {
  it.each([0, 1, 19])(
    "preserva desenho, quantitativos e exportações da peça %i",
    async (index) => {
      const project = viewsFixture(),
        piece = project.pieces[index];
      const reduced = { ...project, pieces: [piece] };
      const fullBundle = new DetailBuilder().build(project, piece.id, "one");
      const smallBundle = new DetailBuilder().build(reduced, piece.id, "one");
      expect(detailRequestKey(reduced, piece.id, "one")).toBe(
        detailRequestKey(project, piece.id, "one"),
      );
      expect(smallBundle).toEqual(fullBundle);
      expect(steelCsv(smallBundle.details)).toBe(steelCsv(fullBundle.details));
      expect(drawingSvg(smallBundle.drawing)).toBe(
        drawingSvg(fullBundle.drawing),
      );
      expect(drawingDxf(smallBundle.drawing)).toBe(
        drawingDxf(fullBundle.drawing),
      );
      // Ignore only jsPDF's volatile timestamp and random document identifier;
      // all page dimensions, compressed content streams and xref remain compared.
      const stablePdf = (bytes: Uint8Array) =>
        Buffer.from(bytes)
          .toString("latin1")
          .replace(/\/CreationDate \(D:[^)]+\)/g, "/CreationDate (timestamp)")
          .replace(
            /\/ID \[ <[A-Fa-f\d]+> <[A-Fa-f\d]+> \]/g,
            "/ID [identifier]",
          );
      expect(stablePdf(await drawingPdf(smallBundle.drawings))).toBe(
        stablePdf(await drawingPdf(fullBundle.drawings)),
      );
    },
  );
});
