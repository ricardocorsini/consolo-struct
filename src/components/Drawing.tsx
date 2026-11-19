import { at, type BarPath, type Point } from "../detailing/geometry";
import { projectElevation, rebarModel } from "../detailing/rebarModel";
import { pathExtent } from "../detailing/rebarPlacement";
import { tieLayout } from "../domain/engine";
import { reactionGeometry, stirrupLayout } from "../domain/theory";
import { bottomDepth, concreteProfile } from "../domain/profile";
import { Fragment, useId, useMemo } from "react";
import { number, type Piece, type GeometryKey } from "../domain/model";
import {
  elevationShapes,
  elevationTieBars,
  sectionBars,
} from "../detailing/projection";
type Props = {
  piece: Piece;
  section?: boolean;
  rebar: boolean;
  dimensions: boolean;
  grid: boolean;
  zoom: number;
  pan: { x: number; y: number };
  forces: boolean;
  focus?: GeometryKey;
  selectedBar: string;
  onDimension: (key: GeometryKey, anchor: { x: number; y: number }) => void;
  onBar: (id: string) => void;
};
function Dim({
  x1,
  y1,
  x2,
  y2,
  label,
  active,
  onClick,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  active?: boolean;
  onClick: (anchor: { x: number; y: number }) => void;
}) {
  const vertical = x1 === x2;
  return (
    <g
      className={`dimension ${active ? "dimension-active" : ""}`}
      role="button"
      aria-label={`Editar ${label}`}
      tabIndex={0}
      onClick={(e) => {
        const r = e.currentTarget
          .querySelector("rect")!
          .getBoundingClientRect();
        onClick({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          const r = e.currentTarget
            .querySelector("rect")!
            .getBoundingClientRect();
          onClick({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
        }
      }}
    >
      <path
        d={`M${x1} ${y1}L${x2} ${y2} M${x1 - 4} ${y1 + 4}l8 -8 M${x2 - 4} ${y2 + 4}l8 -8`}
        fill="none"
      />
      <rect
        x={vertical ? x1 - 16 : (x1 + x2) / 2 - 35}
        y={vertical ? (y1 + y2) / 2 - 34 : y1 - 23}
        width={vertical ? 26 : 70}
        height={vertical ? 68 : 24}
        rx="0"
      />
      <text
        x={vertical ? x1 + 4 : (x1 + x2) / 2}
        y={vertical ? (y1 + y2) / 2 : y1 - 7}
        textAnchor="middle"
        transform={
          vertical ? `rotate(-90 ${x1 + 4} ${(y1 + y2) / 2})` : undefined
        }
      >
        {label}
      </text>
    </g>
  );
}
export default function Drawing({
  piece: p,
  section = false,
  rebar,
  dimensions,
  grid,
  zoom,
  pan,
  forces,
  focus,
  selectedBar,
  onDimension,
  onBar,
}: Props) {
  const uid = useId().replaceAll(":", "");
  const g = p.geometry;
  const stations = stirrupLayout(p);
  const sectionX = stations.positions[0];
  // Single reinforcement source shared with the 3D view and the detailing
  // sheet; memoized per piece, so pan/zoom never rebuild it.
  const detail = useMemo(() => rebarModel(p), [p]);
  const transverseInvalid = detail.issues.some(
    (issue) =>
      issue.code.startsWith("transverse-") ||
      issue.code.startsWith("shape-stirrup"),
  );
  const reaction = reactionGeometry(p);
  const layout = tieLayout(p);
  const lowerStitchMissing = detail.issues.some(
    (issue) => issue.code === "zone-lower",
  );
  // Section A–A at the first stirrup: the juxtaposed N3/N3G pair is projected.
  const sectionRebar = useMemo(
    () =>
      sectionBars(p, detail, sectionX, {
        pairWindow: p.rebar.stirrupDiameter,
      }),
    [p, detail, sectionX],
  );
  const elevation = useMemo(() => projectElevation(detail), [detail]);
  const elevationOf = (...families: string[]) =>
    elevation.filter((item) => families.includes(item.bar.family));
  const elevationTies = useMemo(() => elevationTieBars(p, detail), [p, detail]);
  const beam = detail.arrangement === "beam";
  const connections = useMemo(
    () => (rebar && !section ? elevationShapes(p) : []),
    [p, rebar, section],
  );
  const stitchProjectionFits = useMemo(() => {
    const n3 = sectionRebar.stirrups.find((bar) => bar.family === "stirrup");
    if (!n3) return sectionRebar.stitches.length === 0;
    const [left, right] = pathExtent(n3.path, "x");
    const [top, bottom] = pathExtent(n3.path, "y");
    const radius =
      n3.path.segments.find((segment) => segment.type === "arc")?.radius ?? 0;
    return sectionRebar.stitches.every(({ depth, diameter, positions }) =>
      positions.every((v) => {
        // Signed distance from the cut center to the nominal N3 axis contour.
        const dx = Math.max(left - v, v - right) + radius;
        const dy = Math.max(top - depth, depth - bottom) + radius;
        const distance =
          Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
          Math.min(0, Math.max(dx, dy)) -
          radius;
        return distance + (diameter + n3.diameter) / 2 <= 1e-6;
      }),
    );
  }, [sectionRebar]);
  const sectionHeadroom = Math.max(
    0,
    ...sectionRebar.lines.flatMap((line) => [-line.a.y, -line.b.y]),
  );
  const sectionBottom = Math.max(
    g.height,
    ...sectionRebar.lines.flatMap((line) => [line.a.y, line.b.y]),
  );
  const s = Math.min(
    480 / (g.columnWidth + g.length),
    340 / (section ? sectionHeadroom + sectionBottom + 80 : g.height + 80),
    // Keep the section and its external dimensions inside the drawing.
    // Elevation keeps its existing scale; narrow sections are unchanged.
    section ? 480 / g.width : Infinity,
  );
  const sectionLeft = 400 - (g.width * s) / 2;
  const sectionTop = 140 + sectionHeadroom * s;
  const across = (v: number) => sectionLeft + v * s;
  const depthAt = (depth: number) => sectionTop + depth * s;
  const sectionCentroid = sectionTop + layout.dPrime * s;
  const dPrimeLabel = `d’ = ${number(layout.dPrime / 10, 1)} cm`;
  const ox = (800 - (g.columnWidth + g.length) * s) / 2 + g.columnWidth * s,
    oy = 185;
  const X = (x: number) => ox + x * s,
    Y = (y: number) => oy + y * s;
  const concrete = concreteProfile(p);
  const sectionHeight = bottomDepth(concrete, sectionX);
  const cut = concrete.status === "removed";
  const bottomPath = [...concrete.bottom]
    .reverse()
    .map((v) => `L${X(v.x)} ${Y(v.depth)}`)
    .join("");
  const path = `M${X(-g.columnWidth)} ${Y(-100)}H${X(0)}V${Y(0)}H${X(g.length)}${bottomPath}V${Y(g.height + 80)}H${X(-g.columnWidth)}Z`;
  // Original face, shown dashed where the excess concrete was cut away.
  const removedPath = cut
    ? `M${X(0)} ${Y(g.height)}L${X(g.length)} ${Y(g.tipHeight)}`
    : "";
  const barPathData = (path: BarPath, x = X, y = Y) => {
    const svgPoint = (point: Point) => `${x(point.x)} ${y(point.y)}`;
    return path.segments
      .map((segment, i) => {
        if (segment.type === "line")
          return `${i === 0 ? `M${svgPoint(segment.a)}` : ""}L${svgPoint(segment.b)}`;
        const start = at(segment.center, segment.radius, segment.start);
        const end = at(
          segment.center,
          segment.radius,
          segment.start + segment.sweep,
        );
        const radius = segment.radius * s;
        return `${i === 0 ? `M${svgPoint(start)}` : ""}A${radius} ${radius} 0 ${Math.abs(segment.sweep) > Math.PI ? 1 : 0} ${segment.sweep > 0 ? 1 : 0} ${svgPoint(end)}`;
      })
      .join("");
  };
  const barStroke = (diameter: number) => ({
    strokeWidth: diameter * s,
    "data-physical-diameter": diameter,
  });
  const barCircle = (diameter: number) => ({
    r: (diameter * s) / 2,
    stroke: "none",
    "data-physical-diameter": diameter,
  });
  const sectionHitArea = (x: number, y: number, diameter: number) =>
    diameter * s < 6 && (
      <rect
        x={x - 3}
        y={y - 3}
        width={6}
        height={6}
        fill="transparent"
        stroke="none"
        pointerEvents="all"
        data-selection-hit=""
        aria-hidden="true"
      />
    );
  const projectedCaps = (endCaps: Point[] | undefined, diameter: number) =>
    endCaps?.map((point, i) => (
      <circle
        key={i}
        data-projection-cap=""
        cx={X(point.x)}
        cy={Y(point.y)}
        r={(diameter * s) / 2}
        stroke="none"
      />
    ));
  const groupProps = (id: string) => ({
    className: `steel steel-${id} ${selectedBar === id ? "steel-selected" : ""}`,
    role: "button",
    tabIndex: 0,
    "aria-label": `Selecionar armadura ${id}`,
    onClick: () => onBar(id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onBar(id);
      }
    },
  });
  const cm = (key: GeometryKey) =>
    `${key === "width" ? "b" : key === "height" ? "h" : key === "tipHeight" ? "h₂" : key === "length" ? "L" : key === "loadOffset" ? "a" : "P"} = ${number(g[key] / 10, 1)}`;
  return (
    <svg
      id="piece-drawing"
      className="technical-drawing"
      viewBox="0 0 800 600"
      role="group"
      aria-label={`${section ? "Seção transversal" : "Elevação"} do consolo ${p.name}`}
    >
      <defs>
        <pattern
          id={`${uid}grid`}
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r=".7" fill="var(--grid-dot)" />
        </pattern>
        <pattern
          id={`${uid}concrete`}
          width="13"
          height="13"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="3" cy="5" r=".8" fill="var(--line-muted)" opacity=".23" />
          <path d="M9 8l2 2" stroke="var(--line-muted)" opacity=".25" />
        </pattern>
        <marker
          id={`${uid}arrow`}
          markerWidth="9"
          markerHeight="9"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0 0L6 3L0 6Z" fill="var(--force)" />
        </marker>
      </defs>
      {grid && <rect width="800" height="600" fill={`url(#${uid}grid)`} />}
      <g
        data-testid="drawing-model"
        transform={`translate(${400 + pan.x} ${300 + pan.y}) scale(${zoom}) translate(-400 -300)`}
      >
        {section ? (
          <>
            <rect
              x={400 - (g.width * s) / 2}
              y={sectionTop}
              width={g.width * s}
              height={sectionHeight * s}
              fill="var(--concrete)"
              stroke="var(--line)"
              strokeWidth="1.5"
            />
            <rect
              x={400 - (g.width * s) / 2}
              y={sectionTop}
              width={g.width * s}
              height={sectionHeight * s}
              fill={`url(#${uid}concrete)`}
            />
            {rebar && transverseInvalid && (
              <text
                x={400}
                y={80}
                textAnchor="middle"
                className="dimension-text"
                fill="var(--danger)"
              >
                Arranjo N3/N3G inválido para fabricação: conferir espaçamento,
                forma ou interferência com N1.
              </text>
            )}
            {rebar && !stitchProjectionFits && (
              <text
                x={400}
                y={135}
                textAnchor="middle"
                className="dimension-text"
                fill="var(--danger)"
              >
                N2 sem espaço no contorno projetado de N3. Confira a disposição
                nas coordenadas exibidas.
              </text>
            )}
            {rebar &&
              sectionRebar.stirrups.some(
                (item) => item.family === "stirrupInner",
              ) && (
                <text
                  x={400}
                  y={120}
                  textAnchor="middle"
                  className="dimension-text"
                >
                  N3/N3G e N4: projeção do par · x ={" "}
                  {sectionRebar.stirrups
                    .map((item) => number(item.x / 10, 2))
                    .join(" / ")}{" "}
                  cm
                </text>
              )}
            {rebar && (
              <>
                <g {...groupProps("N3")}>
                  {sectionRebar.stirrups.map((item, i) => (
                    <path
                      key={i}
                      data-mark={item.mark}
                      data-n3-part={
                        item.family === "stirrupInner" ? "grampo" : "externo"
                      }
                      data-longitudinal-position={item.x}
                      d={barPathData(item.path, across, depthAt)}
                      {...barStroke(item.diameter)}
                    />
                  ))}
                </g>
                <g {...groupProps("N4")}>
                  {sectionRebar.constructive.map(
                    ({ v, depth, x, diameter, mark }, i) => (
                      <Fragment key={i}>
                        {sectionHitArea(across(v), depthAt(depth), diameter)}
                        <circle
                          data-mark={mark}
                          data-longitudinal-position={x}
                          cx={across(v)}
                          cy={depthAt(depth)}
                          {...barCircle(diameter)}
                        />
                      </Fragment>
                    ),
                  )}
                </g>
                <g {...groupProps("N1")}>
                  {sectionRebar.ties.map(({ v, depth, diameter, mark }, i) => (
                    <Fragment key={i}>
                      {sectionHitArea(across(v), depthAt(depth), diameter)}
                      <circle
                        data-mark={mark}
                        cx={across(v)}
                        cy={depthAt(depth)}
                        {...barCircle(diameter)}
                      />
                    </Fragment>
                  ))}
                </g>
                {beam && (
                  <g
                    className="steel-positive"
                    data-testid="beam-positive-section"
                  >
                    {sectionRebar.positives.map(
                      ({ v, depth, diameter, mark }, i) => (
                        <circle
                          key={i}
                          data-mark={mark}
                          cx={across(v)}
                          cy={depthAt(depth)}
                          {...barCircle(diameter)}
                        />
                      ),
                    )}
                  </g>
                )}
                <g {...groupProps("N2")}>
                  {sectionRebar.stitches.map(
                    ({ depth, positions, mark, diameter }, t) => (
                      <g key={t} data-mark={mark}>
                        {positions.map((v, i) => (
                          <Fragment key={i}>
                            {sectionHitArea(
                              across(v),
                              depthAt(depth),
                              diameter,
                            )}
                            <circle
                              cx={across(v)}
                              cy={depthAt(depth)}
                              {...barCircle(diameter)}
                            />
                          </Fragment>
                        ))}
                      </g>
                    ),
                  )}
                </g>
                <g className="steel-detail-families">
                  {sectionRebar.lines.map((line, i) => (
                    <path
                      key={i}
                      data-family={line.family}
                      data-mark={line.mark}
                      d={`M${across(line.a.x)} ${depthAt(line.a.y)}L${across(line.b.x)} ${depthAt(line.b.y)}`}
                      fill="none"
                      {...barStroke(line.diameter)}
                    >
                      <title>{`${line.mark} · no plano de corte A–A`}</title>
                    </path>
                  ))}
                </g>
              </>
            )}
            {dimensions && (
              <>
                <g
                  className="dimension dimension-derived"
                  role="img"
                  aria-label={`${dPrimeLabel} · topo ao centroide do tirante`}
                >
                  <title>
                    Distância do topo ao centroide nominal do tirante usado no
                    cálculo; o corte pode atravessar dobras ou omitir alças
                    inválidas
                  </title>
                  <path
                    d={`M${sectionLeft - 40} ${sectionTop}V${sectionCentroid}`}
                    fill="none"
                  />
                  <path
                    d={`M${sectionLeft - 44} ${sectionTop + 4}l8 -8 M${sectionLeft - 44} ${sectionCentroid + 4}l8 -8`}
                    fill="none"
                  />
                  <g className="dimension-extension" fill="none">
                    <path
                      d={`M${sectionLeft} ${sectionTop}H${sectionLeft - 48} M${sectionLeft} ${sectionCentroid}H${sectionLeft - 48}`}
                    />
                  </g>
                  <text
                    x={sectionLeft - 54}
                    y={(sectionTop + sectionCentroid) / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {dPrimeLabel}
                  </text>
                </g>
                <Dim
                  x1={400 - (g.width * s) / 2}
                  y1={110}
                  x2={400 + (g.width * s) / 2}
                  y2={110}
                  label={cm("width")}
                  onClick={(anchor) => onDimension("width", anchor)}
                  active={focus === "width"}
                />
                <g
                  className="dimension dimension-derived"
                  role="img"
                  aria-label={`h(x1) = ${number(sectionHeight / 10, 1)} cm · altura do concreto na seção A–A`}
                >
                  <title>Altura do concreto na estação do 1º estribo</title>
                  <path
                    d={`M${440 + (g.width * s) / 2} ${sectionTop}V${sectionTop + sectionHeight * s}`}
                    fill="none"
                  />
                  <path
                    d={`M${436 + (g.width * s) / 2} ${sectionTop + 4}l8 -8 M${436 + (g.width * s) / 2} ${sectionTop + sectionHeight * s + 4}l8 -8`}
                    fill="none"
                  />
                  <g className="dimension-extension" fill="none">
                    <path
                      d={`M${400 + (g.width * s) / 2} ${sectionTop}H${448 + (g.width * s) / 2} M${400 + (g.width * s) / 2} ${sectionTop + sectionHeight * s}H${448 + (g.width * s) / 2}`}
                    />
                  </g>
                  <text
                    x={444 + (g.width * s) / 2}
                    y={(2 * sectionTop + sectionHeight * s) / 2}
                    textAnchor="middle"
                    transform={`rotate(-90 ${444 + (g.width * s) / 2} ${(2 * sectionTop + sectionHeight * s) / 2})`}
                  >
                    {`h = ${number(sectionHeight / 10, 1)}`}
                  </text>
                </g>
              </>
            )}
            {rebar && lowerStitchMissing && (
              <text
                x={400}
                y={sectionTop + 15 + sectionBottom * s}
                textAnchor="middle"
                className="dimension-text"
                fill="var(--danger)"
              >
                N2I sem altura suficiente para distribuir as barras.
              </text>
            )}
            <text
              className="drawing-caption"
              x="400"
              y={Math.min(
                555,
                sectionTop +
                  30 +
                  Math.max(
                    sectionHeight,
                    ...sectionRebar.lines.map((line) => line.b.y),
                  ) *
                    s,
              )}
              textAnchor="middle"
            >
              {`SEÇÃO A–A · 1º ESTRIBO · x = ${number(sectionX / 10, 2)} cm`}
            </text>
          </>
        ) : (
          <>
            <path
              d={path}
              fill="var(--concrete)"
              stroke="var(--line)"
              strokeWidth="1.5"
            />
            <path d={path} fill={`url(#${uid}concrete)`} />
            {cut && (
              <path
                className="excess-concrete-outline"
                d={removedPath}
                fill="none"
                stroke="var(--line-muted)"
                strokeDasharray="4 4"
                opacity=".7"
              >
                <title>Face original; concreto excedente removido</title>
              </path>
            )}
            <path
              d={`M${X(0)} ${Y(-100)}V${Y(g.height + 80)}`}
              stroke="var(--line-muted)"
              strokeDasharray="5 5"
              opacity=".5"
            />
            {rebar && (
              <>
                <g {...groupProps("N2")}>
                  {elevationOf("stitch", "lower").map(
                    ({ bar, shape }, i) =>
                      shape.kind === "path" && (
                        <Fragment key={i}>
                          <path
                            data-mark={bar.mark}
                            data-quantity={bar.quantity}
                            d={barPathData(shape.path)}
                            {...barStroke(bar.diameter)}
                          >
                            <title>{`${bar.mark} · ${bar.quantity} barra(s)`}</title>
                          </path>
                          {projectedCaps(shape.endCaps, bar.diameter)}
                        </Fragment>
                      ),
                  )}
                </g>
                <g {...groupProps("N3")}>
                  {elevationOf("stirrup", "stirrupInner").map(
                    ({ bar, part, shape }, i) =>
                      shape.kind === "path" && (
                        <Fragment key={i}>
                          <path
                            data-mark={bar.mark}
                            data-n3-part={
                              bar.family === "stirrupInner"
                                ? "grampo"
                                : "externo"
                            }
                            data-longitudinal-position={part.at}
                            d={barPathData(shape.path)}
                            {...barStroke(bar.diameter)}
                          />
                          {projectedCaps(shape.endCaps, bar.diameter)}
                        </Fragment>
                      ),
                  )}
                </g>
                <g {...groupProps("N4")}>
                  {elevationOf("constructive").map(
                    ({ bar, part, shape }, i, all) =>
                      shape.kind === "path" && (
                        <path
                          key={i}
                          data-mark={bar.mark}
                          data-transverse-position={part.at}
                          d={barPathData(shape.path)}
                          {...barStroke(bar.diameter)}
                        >
                          <title>
                            {`N4 construtiva · barra ${i + 1} de ${all.length} · sem contribuição resistente`}
                          </title>
                        </path>
                      ),
                  )}
                </g>
                <g {...groupProps("N1")}>
                  {elevationTies.map(({ bar, path, endCaps }, i) => (
                    <Fragment key={i}>
                      <path
                        d={barPathData(path)}
                        data-mark={bar.mark}
                        data-quantity={bar.quantity}
                        {...barStroke(bar.diameter)}
                      >
                        <title>{`${bar.mark} · ${bar.quantity} barra(s)`}</title>
                      </path>
                      {projectedCaps(endCaps, bar.diameter)}
                    </Fragment>
                  ))}
                </g>
                {beam && (
                  <g
                    className="steel-positive"
                    data-testid="beam-positive"
                    fill="none"
                  >
                    <title>Armadura positiva (armado como viga)</title>
                    {elevationOf("positive")
                      // Every P1 bar projects onto the same elevation path.
                      .filter(
                        (item, i, all) =>
                          all.findIndex((other) => other.bar === item.bar) ===
                          i,
                      )
                      .map(
                        ({ bar, shape }) =>
                          shape.kind === "path" && (
                            <path
                              key={bar.mark}
                              data-mark={bar.mark}
                              data-quantity={bar.quantity}
                              d={barPathData(shape.path)}
                              {...barStroke(bar.diameter)}
                            />
                          ),
                      )}
                  </g>
                )}
                {connections.length > 0 && (
                  <g
                    className="steel-detail-families"
                    data-testid="detail-families"
                    fill="none"
                  >
                    {connections.map((shape) => (
                      <g
                        key={shape.mark}
                        data-family={shape.family}
                        data-mark={shape.mark}
                        data-quantity={shape.quantity}
                        role="img"
                        aria-label={`${shape.mark} · ${shape.quantity} × Ø${number(shape.diameter)} mm · ${shape.description}`}
                      >
                        <title>
                          {`${shape.mark} · ${shape.quantity} × Ø${number(shape.diameter)} mm · ${shape.description}${shape.family === "pin" ? "; projeção dos pinos sobrepostos na elevação" : ""}`}
                        </title>
                        {shape.kind === "line" ? (
                          <path
                            d={`M${X(shape.a.x)} ${Y(shape.a.y)}L${X(shape.b.x)} ${Y(shape.b.y)}`}
                            {...barStroke(shape.diameter)}
                          />
                        ) : (
                          <circle
                            cx={X(shape.center.x)}
                            cy={Y(shape.center.y)}
                            {...barCircle(shape.diameter)}
                          />
                        )}
                      </g>
                    ))}
                  </g>
                )}
              </>
            )}
            <rect
              x={X(g.loadOffset - p.design.bearingLength / 2)}
              y={Y(-p.design.bearingHeight)}
              width={p.design.bearingLength * s}
              height={Math.max(3, p.design.bearingHeight * s)}
              fill="var(--line-muted)"
              opacity=".55"
            />
            {forces && (
              <>
                <path
                  d={`M${X(reaction.a)} ${Y(-100)}V${Y(-9)}`}
                  stroke="var(--force)"
                  strokeWidth="2.5"
                  markerEnd={`url(#${uid}arrow)`}
                />
                <text className="force-label" x={X(reaction.a) + 12} y={Y(-85)}>
                  {p.design.forceMode === "design" ? "Vd" : "Vk"} ={" "}
                  {number(p.loads.vertical / 1000, 0)} kN
                </text>
                {p.loads.horizontal !== 0 && (
                  <>
                    <path
                      d={
                        p.loads.horizontal > 0
                          ? `M${X(reaction.a)} ${Y(-15)}h65`
                          : `M${X(reaction.a)} ${Y(-15)}h-65`
                      }
                      stroke="var(--force)"
                      strokeWidth="2"
                      markerEnd={`url(#${uid}arrow)`}
                    />
                    <text
                      className="force-label"
                      x={X(reaction.a) + 12}
                      y={Y(-15) - 12}
                    >
                      {p.design.horizontalMode === "estimated"
                        ? "H adic."
                        : "H total"}{" "}
                      = {number(p.loads.horizontal / 1000, 0)} kN
                    </text>
                  </>
                )}
              </>
            )}
            {dimensions && (
              <>
                <g className="dimension-extension" fill="none">
                  <path
                    d={`M${X(-g.columnWidth)} ${Y(-105)}V${Y(-160)} M${X(0)} ${Y(-105)}V${Y(-160)} M${X(g.length)} ${Y(-5)}V${Y(-160)} M${X(g.length) + 5} ${Y(0)}h95 M${X(g.length) + 5} ${Y(g.tipHeight)}h48 M${X(0) + 5} ${Y(g.height)}H${X(g.length) + 100} M${X(0)} ${Y(g.height) + 5}V${Y(g.height + 55)} M${X(g.loadOffset)} ${Y(g.height) + 5}V${Y(g.height + 55)}`}
                  />
                </g>
                <Dim
                  x1={X(0)}
                  y1={Y(-145)}
                  x2={X(g.length)}
                  y2={Y(-145)}
                  label={cm("length")}
                  onClick={(anchor) => onDimension("length", anchor)}
                  active={focus === "length"}
                />
                <Dim
                  x1={X(0)}
                  y1={Y(g.height + 40)}
                  x2={X(g.loadOffset)}
                  y2={Y(g.height + 40)}
                  label={cm("loadOffset")}
                  onClick={(anchor) => onDimension("loadOffset", anchor)}
                  active={focus === "loadOffset"}
                />
                {reaction.shift !== 0 && (
                  <text
                    className="drawing-caption"
                    x={X(reaction.a)}
                    y={Y(g.height + 75)}
                    textAnchor="middle"
                  >
                    a_calc = {number(reaction.a / 10, 1)} cm
                  </text>
                )}
                <Dim
                  x1={X(g.length) + 38}
                  y1={Y(0)}
                  x2={X(g.length) + 38}
                  y2={Y(g.tipHeight)}
                  label={cm("tipHeight")}
                  onClick={(anchor) => onDimension("tipHeight", anchor)}
                  active={focus === "tipHeight"}
                />
                <Dim
                  x1={X(g.length) + 85}
                  y1={Y(0)}
                  x2={X(g.length) + 85}
                  y2={Y(g.height)}
                  label={cm("height")}
                  onClick={(anchor) => onDimension("height", anchor)}
                  active={focus === "height"}
                />
                <Dim
                  x1={X(-g.columnWidth)}
                  y1={Y(-145)}
                  x2={X(0)}
                  y2={Y(-145)}
                  label={cm("columnWidth")}
                  onClick={(anchor) => onDimension("columnWidth", anchor)}
                  active={focus === "columnWidth"}
                />
              </>
            )}
            <text
              className="drawing-caption"
              x={X(-g.columnWidth / 2)}
              y={Y(g.height + 45)}
              textAnchor="middle"
            >
              PILAR
            </text>
            {rebar && (
              <>
                <path
                  d={`M${X(g.length - g.cover)} ${Y(g.cover)}l32 20h38`}
                  stroke="var(--force)"
                  fill="none"
                />
                <text
                  x={X(g.length - g.cover) + 77}
                  y={Y(g.cover) + 24}
                  className="bar-label"
                >
                  N1
                </text>
              </>
            )}
          </>
        )}
      </g>
      <g className="axis" transform="translate(38 550)">
        <path d="M0 0h30M0 0v-30" fill="none" />
        <text x="34" y="4">
          x
        </text>
        <text x="-3" y="-36">
          z
        </text>
        <circle r="2" />
      </g>
    </svg>
  );
}
