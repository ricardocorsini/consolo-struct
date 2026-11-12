import { useId } from "react";
import { strutLimitSchema, type StrutLimit } from "../domain/design";
import { materialProperties } from "../domain/engine";
import type { Piece } from "../domain/model";
import { number } from "../domain/model";
import {
  strutLimitAllowed,
  strutLimitCriteria,
  strutLimitValue,
} from "../domain/strutLimit";

export default function StrutLimitControl({
  piece,
  onChange,
}: {
  piece: Piece;
  onChange: (criterion: StrutLimit) => void;
}) {
  const id = useId();
  const selected = piece.design.strutLimit ?? "fcd2";
  const allowed = strutLimitAllowed(selected, piece.design.loadType);
  const material = materialProperties(
    piece.materials.fck,
    piece.materials.fyk,
    piece.materials.fykTransverse,
    piece.design.gammaC,
    piece.design.gammaS,
  );
  const standard = strutLimitValue("fcd2", piece.design.loadType, material);
  const limit = strutLimitValue(selected, piece.design.loadType, material);
  return (
    <section
      className="strut-limit-control"
      aria-label="Critério da biela da peça"
    >
      <label className="field" htmlFor={id}>
        <span className="field-label">Critério do limite da biela</span>
        <select
          id={id}
          value={selected}
          aria-invalid={!allowed}
          aria-describedby={`${id}-help`}
          onChange={(event) => onChange(event.target.value as StrutLimit)}
        >
          {strutLimitSchema.options.map((value) => (
            <option
              key={value}
              value={value}
              disabled={!strutLimitAllowed(value, piece.design.loadType)}
            >
              {strutLimitCriteria[value].label}
            </option>
          ))}
        </select>
      </label>
      <p>
        <strong>
          {allowed
            ? `Limite escolhido: ${number(limit, 4)} MPa`
            : "Critério incompatível com a carga"}
        </strong>
        <br />
        Padrão fcd2: {number(standard, 4)} MPa · fck ={" "}
        {number(piece.materials.fck, 0)} MPa
      </p>
      <p id={`${id}-help`}>
        Critério da peça {piece.name}, salvo no projeto. Aplica-se somente à
        verificação da biela no modelo de bielas e tirantes. Nós, apoio,
        escoamento prévio, inclinação, complemento de El Debs,
        atrito-cisalhamento e viga em balanço mantêm seus critérios.
      </p>
      {!allowed && (
        <p className="strut-limit-warning" role="alert">
          A opção selecionada exige carga{" "}
          {selected === "direct100" ? "direta" : "indireta"}. Escolha um
          critério compatível; o motor não calcula essa combinação.
        </p>
      )}
      {selected !== "fcd2" && (
        <p className="strut-limit-warning">
          Critério menos conservador. Quando aplicado à biela, gera “Conferir” e
          exige avaliação do responsável; não aprova o projeto por si só.
        </p>
      )}
      <small>
        {strutLimitCriteria[selected].formula} ·{" "}
        {strutLimitCriteria[selected].reference}
      </small>
    </section>
  );
}
