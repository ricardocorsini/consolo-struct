import { memo, useMemo } from "react";
import { FileText } from "lucide-react";
import { number, type Piece, type Project } from "../domain/model";
import { rebarModel } from "../detailing/rebarModel";
import { ENGINE_VERSION, type CalculationResult } from "../domain/engine";
import CalculationReport from "./CalculationReport";
import BrandSignature from "./BrandSignature";
import { steelBondDescription, steelLabel } from "../domain/steel";
import { retainedDocumentEqual } from "../lib/retainedDocument";
function MemoryPage({
  project,
  piece: p,
  result,
  stale,
  saving,
  active: _active,
  select,
  calculate,
  exportPdf,
}: {
  project: Project;
  piece: Piece;
  result?: CalculationResult;
  stale: boolean;
  saving: boolean;
  active: boolean;
  select: (id: string) => void;
  calculate: () => void;
  exportPdf: () => void;
}) {
  // Same quantities as the detailing sheet (single reinforcement source).
  const rebar = useMemo(
    () => rebarModel(p, stale ? undefined : result?.values),
    [p, result, stale],
  );
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
        <p className="table-note" data-testid="memory-consumption">
          Consumo por peça: concreto {number(rebar.concreteVolume, 3)} m³ · aço
          detalhado {number(rebar.mass, 2)} kg · taxa de aço{" "}
          {number(rebar.steelRate, 1)} kg/m³ · {p.quantity} peça(s):{" "}
          {number(rebar.totalConcreteVolume, 3)} m³ e{" "}
          {number(rebar.totalMass, 2)} kg
        </p>
        {rebar.issues.some(({ severity }) => severity === "error") && (
          <p className="check-error">
            Consumo com pendências impeditivas. Consulte o Detalhamento.
          </p>
        )}
        <button className="button" onClick={calculate}>
          Calcular revisão atual
        </button>
        <CalculationReport result={result} stale={stale} />
      </article>
    </section>
  );
}
export default memo(MemoryPage, retainedDocumentEqual);
