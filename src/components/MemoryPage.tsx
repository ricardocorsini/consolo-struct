import { memo } from "react";
import { FileText } from "lucide-react";
import type { Piece, Project } from "../domain/model";
import { ENGINE_VERSION, type CalculationResult } from "../domain/engine";
import CalculationReport from "./CalculationReport";
import BrandSignature from "./BrandSignature";
import { steelBondDescription, steelLabel } from "../domain/steel";
function MemoryPage({
  project,
  piece: p,
  result,
  stale,
  saving,
  select,
  calculate,
  exportPdf,
}: {
  project: Project;
  piece: Piece;
  result?: CalculationResult;
  stale: boolean;
  saving: boolean;
  select: (id: string) => void;
  calculate: () => void;
  exportPdf: () => void;
}) {
  return (
    <section className="full-page report-page">
      <div className="report-selection">
        <label>
          Peça{" "}
          <select
            aria-label="Peça do relatório"
            value={p.id}
            onChange={(e) => select(e.target.value)}
          >
            {project.pieces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.description}
              </option>
            ))}
          </select>
        </label>
        <button className="button" onClick={exportPdf} disabled={saving}>
          <FileText size={16} />
          Baixar PDF
        </button>
      </div>
      <article className="report-paper">
        <div className="report-brand">
          <BrandSignature />
          <span>MEMÓRIA DE CÁLCULO · MOTOR {ENGINE_VERSION}</span>
        </div>
        <div className="eyebrow">{project.name}</div>
        <h2>
          {p.name} · {p.description}
        </h2>
        <p>
          Consolo simples · {p.geometry.width / 10} × {p.geometry.height / 10}{" "}
          cm · fck {p.materials.fck} MPa · Tirante {steelLabel(p.materials.fyk)}{" "}
          · Transversal {steelLabel(p.materials.fykTransverse)} · Quantidade:{" "}
          {p.quantity}
        </p>
        <p className="table-note">{steelBondDescription(p.materials.fyk)}</p>
        <button className="button" onClick={calculate}>
          Calcular revisão atual
        </button>
        <CalculationReport result={result} stale={stale} />
      </article>
    </section>
  );
}
export default memo(MemoryPage);
