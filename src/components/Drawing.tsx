import { samplePath } from "../detailing/geometry";
import { projectElevation, rebarModel } from "../detailing/rebarModel";
import { tieLayout } from "../domain/engine";
import { reactionGeometry, stirrupLayout } from "../domain/theory";
import { bottomDepth, concreteProfile } from "../domain/profile";
import { useId, useMemo } from "react";
import { number, type Piece, type GeometryKey } from "../domain/model";
import {
  dimensionLabel,
  dimensionMetadata,
  elevationDimensions,
  type ElevationDimension,
} from "../domain/dimensions";
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
const verticalDimensionLabelHeight = 68;
function Dim({
  x1,
  y1,
  x2,
  y2,
  label,
  active,
  description,
  onClick,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  active?: boolean;
  description?: string;
  onClick?: (anchor: { x: number; y: number }) => void;
}) {
  const vertical = x1 === x2;
  const labelX = vertical ? x1 + 20 : (x1 + x2) / 2;
  const labelY = vertical ? (y1 + y2) / 2 : y1 - 7;
  const edit = (group: SVGGElement) => {
    const r = group.querySelector("rect")!.getBoundingClientRect();
    onClick?.({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  };
  return (
    <g
      className={`dimension${onClick ? "" : " dimension-derived"}${active ? " dimension-active" : ""}`}
      role={onClick ? "button" : "img"}
      aria-label={onClick ? `Editar ${label}` : `${label} cm · ${description}`}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick && ((e) => edit(e.currentTarget))}
      onKeyDown={
        onClick &&
        ((e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            edit(e.currentTarget);
          }
        })
      }
    >
      {description && <title>{description}</title>}
      <rect
        x={vertical ? x1 + 6 : labelX - 35}
        y={vertical ? labelY - verticalDimensionLabelHeight / 2 : y1 - 23}
        width={vertical ? 26 : 70}
        height={vertical ? verticalDimensionLabelHeight : 24}
        rx="0"
      />
      <path
        d={`M${x1} ${y1}L${x2} ${y2} M${x1 - 4} ${y1 + 4}l8 -8 M${x2 - 4} ${y2 + 4}l8 -8`}
        fill="none"
      />
      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        transform={vertical ? `rotate(-90 ${labelX} ${labelY})` : undefined}
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
  // Outer N3 cut by A–A: its physical corner radius and height bound the N2 symbols.
  const outerStirrup = detail.bars.find(
    (bar) =>
      bar.mark ===
      sectionRebar.stirrups.find((item) => item.family === "stirrup")?.mark,
  );
  const rootSection = {
    radius: outerStirrup
      ? (outerStirrup.mandrel + outerStirrup.diameter) / 2
      : 0,
    stirrupOffset: outerStirrup?.locations[0].z ?? stations.offset,
  };
  const rootOuter = {
    height:
      outerStirrup?.height ??
      bottomDepth(concreteProfile(p), sectionX) - 2 * stations.offset,
  };
  const sectionHeadroom = Math.max(
    0,
    ...sectionRebar.lines.flatMap((line) => [-line.a.y, -line.b.y]),
  );
  const sectionBottom = Math.max(
    g.height,
    ...sectionRebar.lines.flatMap((line) => [line.a.y, line.b.y]),
  );
  const bearingLeft = g.loadOffset - p.design.bearingLength / 2;
  const bearingRight = g.loadOffset + p.design.bearingLength / 2;
  const elevationLeft = Math.min(-g.columnWidth, bearingLeft);
  const elevationRight = Math.max(g.length, bearingRight);
  const s = Math.min(
    480 / (section ? g.columnWidth + g.length : elevationRight - elevationLeft),
    340 /
      (section
        ? sectionHeadroom + sectionBottom + 80
        : Math.max(g.height + 80, g.tipHeight)),
    // Leave room above the pillar and pad for dimensions and force arrows.
    section
      ? 480 / g.width
      : Math.min(1, 40 / Math.max(1, p.design.bearingHeight)),
  );
  const sectionLeft = 400 - (g.width * s) / 2;
  const stitchRadius = (p.rebar.stitchDiameter * s) / 2;
  const stitchInset = (depth: number) => {
    // Erode the actual outer N3 contour, with its physical radius and stroke.
    // This symbol clearance does not change N2 levels or reinforcement design.
    const corner = rootSection.radius * s;
    const clearance =
      stitchRadius + s / 2 + (p.rebar.stirrupDiameter * s) / 2 + s / 2;
    const edgeDistance =
      Math.min(
        depth - rootSection.stirrupOffset,
        rootSection.stirrupOffset + rootOuter.height - depth,
      ) * s;
    const innerCorner = Math.max(0, corner - clearance);
    const cornerInset =
      corner -
      Math.sqrt(
        Math.max(0, innerCorner ** 2 - Math.max(0, corner - edgeDistance) ** 2),
      );
    return rootSection.stirrupOffset * s + Math.max(clearance, cornerInset);
  };
  const stitchProjectionFits = sectionRebar.stitches.every(
    ({ depth }) =>
      Math.min(
        depth - rootSection.stirrupOffset,
        rootSection.stirrupOffset + rootOuter.height - depth,
      ) >=
      (p.rebar.stirrupDiameter + p.rebar.stitchDiameter) / 2,
  );
  const sectionTop = 140 + sectionHeadroom * s;
  const sectionCentroid = sectionTop + layout.dPrime * s;
  const dPrimeLabel = dimensionLabel("tieCentroid", layout.dPrime, true);
  const ox = 400 - ((elevationLeft + elevationRight) * s) / 2;
  const oy = 185;
  const X = (x: number) => ox + x * s,
    Y = (y: number) => oy + y * s;
  const tipX = X(g.length);
  const bearingTop = Y(-p.design.bearingHeight);
  const columnTop = Y(-100);
  const tipBottom = Y(g.tipHeight);
  const rootBottom = Y(g.height);
  const forceX = X(reaction.a);
  const verticalForceEnd = bearingTop - 4;
  const horizontalForceY = verticalForceEnd - 14;
  const verticalForceStart = horizontalForceY - 42;
  const forceLabelOnLeft = tipX - forceX < 84;
  const forceLabelX = forceX + (forceLabelOnLeft ? -12 : 12);
  const forceLabelAnchor = forceLabelOnLeft ? "end" : "start";
  const loadLineEnd = forces ? verticalForceStart : bearingTop;
  const loadDimensionY = Math.min(
    columnTop - 16,
    loadLineEnd - (reaction.shift ? 28 : 12),
  );
  const pillarDimensionY =
    (g.columnWidth + g.loadOffset) * s < 160
      ? loadDimensionY - 30
      : loadDimensionY;
  const lengthDimensionY = Y(g.height + 80) + 32;
  const measured = elevationDimensions(g);
  const heightDifference =
    measured.find((d) => d.id === "heightDifference")?.value ?? 0;
  const tipHeightX = tipX + 35;
  // A short segment needs its own column so both height labels stay legible.
  const separateHeight =
    heightDifference > 0 &&
    Math.min(g.tipHeight, heightDifference) * s < verticalDimensionLabelHeight;
  const heightDifferenceX = tipHeightX + (separateHeight ? 43 : 0);
  const heightX = heightDifferenceX + 48;
  const dimensionAxes: Record<ElevationDimension["id"], number> = {
    columnWidth: pillarDimensionY,
    loadOffset: loadDimensionY,
    length: lengthDimensionY,
    tipHeight: tipHeightX,
    heightDifference: heightDifferenceX,
    height: heightX,
  };
  const concrete = concreteProfile(p);
  const sectionHeight = bottomDepth(concrete, sectionX);
  const sectionFoot = sectionTop + sectionHeight * s;
  const sectionWidthY = sectionFoot + 30;
  const sectionRight = sectionLeft + g.width * s;
  const sectionNoteY = Math.max(
    sectionTop + 15 + sectionBottom * s,
    dimensions ? sectionFoot + 46 : 0,
  );
  const sectionCaptionY = Math.min(
    555,
    Math.max(
      sectionTop +
        Math.max(sectionHeight, ...sectionRebar.lines.map((line) => line.b.y)) *
          s +
        (dimensions ? 55 : 30),
      rebar && lowerStitchMissing ? sectionNoteY + 15 : 0,
    ),
  );
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
  const polyline = (pts: { x: number; y: number }[]) =>
    pts.map((v, i) => `${i ? "L" : "M"}${X(v.x)} ${Y(v.y)}`).join("");
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
                N2 sem espaço no contorno projetado de N3: conferir disposição;
                níveis preservados.
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
                <g
                  {...groupProps("N3")}
                  fill="none"
                  strokeWidth={p.rebar.stirrupDiameter * s}
                >
                  {sectionRebar.stirrups.map((item, i) => (
                    <path
                      key={i}
                      data-mark={item.mark}
                      data-n3-part={
                        item.family === "stirrupInner" ? "grampo" : "externo"
                      }
                      data-longitudinal-position={item.x}
                      d={samplePath(item.path, 24)
                        .map(
                          (pt, j) =>
                            `${j ? "L" : "M"}${400 + (pt.x - g.width / 2) * s} ${sectionTop + pt.y * s}`,
                        )
                        .join("")}
                    />
                  ))}
                </g>
                <g {...groupProps("N4")}>
                  {sectionRebar.constructive.map(
                    ({ v, depth, x, diameter, mark }, i) => (
                      <circle
                        key={i}
                        data-mark={mark}
                        data-longitudinal-position={x}
                        cx={400 + (v - g.width / 2) * s}
                        cy={sectionTop + depth * s}
                        r={(diameter * s) / 2}
                        strokeWidth="0.5"
                      />
                    ),
                  )}
                </g>
                <g {...groupProps("N1")}>
                  {sectionRebar.ties.map(({ v, depth, diameter, mark }, i) => (
                    <circle
                      key={i}
                      data-mark={mark}
                      cx={400 + (v - g.width / 2) * s}
                      cy={sectionTop + depth * s}
                      r={Math.max(3, (diameter * s) / 2)}
                      strokeWidth="1"
                    />
                  ))}
                </g>
                {beam && (
                  <g
                    className="steel-positive"
                    data-testid="beam-positive-section"
                  >
                    {sectionRebar.positives.map(({ v, depth, diameter }, i) => (
                      <circle
                        key={i}
                        cx={400 + (v - g.width / 2) * s}
                        cy={sectionTop + depth * s}
                        r={Math.max(3, (diameter * s) / 2)}
                        strokeWidth="1"
                      />
                    ))}
                  </g>
                )}
                <g {...groupProps("N2")} strokeWidth={s}>
                  {sectionRebar.stitches.map(
                    ({ depth, positions, mark }, t) => (
                      <g key={t} data-mark={mark}>
                        {positions.map((v, i) => {
                          const inset = Math.max(
                            Math.min(v, g.width - v) * s,
                            stitchInset(depth),
                          );
                          return (
                            <circle
                              key={i}
                              cx={
                                sectionLeft +
                                (v <= g.width / 2 ? inset : g.width * s - inset)
                              }
                              cy={sectionTop + depth * s}
                              r={stitchRadius}
                            />
                          );
                        })}
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
                      d={`M${sectionLeft + line.a.x * s} ${sectionTop + line.a.y * s}L${sectionLeft + line.b.x * s} ${sectionTop + line.b.y * s}`}
                      fill="none"
                      strokeWidth={line.diameter * s}
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
                  aria-label={`${dPrimeLabel} · ${dimensionMetadata.tieCentroid.label}`}
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
                <g className="dimension-extension" fill="none">
                  <path
                    d={`M${sectionLeft} ${sectionFoot + 5}V${sectionWidthY + 6} M${sectionRight} ${sectionFoot + 5}V${sectionWidthY + 6} M${sectionRight} ${sectionTop}H${sectionRight + 48} M${sectionRight} ${sectionFoot}H${sectionRight + 48}`}
                  />
                </g>
                <Dim
                  x1={sectionLeft}
                  y1={sectionWidthY}
                  x2={sectionRight}
                  y2={sectionWidthY}
                  label={dimensionLabel("width", g.width)}
                  onClick={(anchor) => onDimension("width", anchor)}
                  active={focus === "width"}
                />
                <Dim
                  x1={sectionRight + 40}
                  y1={sectionTop}
                  x2={sectionRight + 40}
                  y2={sectionFoot}
                  label={dimensionLabel("sectionHeight", sectionHeight)}
                  description={dimensionMetadata.sectionHeight.label}
                />
              </>
            )}
            {rebar && lowerStitchMissing && (
              <text
                x={400}
                y={sectionNoteY}
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
              y={sectionCaptionY}
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
                <g {...groupProps("N2")} fill="none" strokeWidth="2">
                  {elevationOf("stitch", "lower").map(
                    ({ bar, shape }, i) =>
                      shape.kind === "path" && (
                        <path
                          key={i}
                          data-mark={bar.mark}
                          data-quantity={bar.quantity}
                          d={polyline(samplePath(shape.path, 24))}
                        >
                          <title>{`${bar.mark} · ${bar.quantity} barra(s)`}</title>
                        </path>
                      ),
                  )}
                </g>
                <g {...groupProps("N3")} fill="none" strokeWidth="2">
                  {elevationOf("stirrup", "stirrupInner").map(
                    ({ bar, part, shape }, i) =>
                      shape.kind === "path" && (
                        <path
                          key={i}
                          data-mark={bar.mark}
                          data-n3-part={
                            bar.family === "stirrupInner" ? "grampo" : "externo"
                          }
                          data-longitudinal-position={part.at}
                          d={polyline(samplePath(shape.path, 24))}
                        />
                      ),
                  )}
                </g>
                <g {...groupProps("N4")} fill="none" strokeWidth="2.5">
                  {elevationOf("constructive").map(
                    ({ bar, part, shape }, i, all) =>
                      shape.kind === "path" && (
                        <path
                          key={i}
                          data-mark={bar.mark}
                          data-transverse-position={part.at}
                          d={polyline(samplePath(shape.path, 24))}
                        >
                          <title>
                            {`N4 construtiva · barra ${i + 1} de ${all.length} · sem contribuição resistente`}
                          </title>
                        </path>
                      ),
                  )}
                </g>
                <g
                  {...groupProps("N1")}
                  fill="none"
                  strokeWidth="4"
                  strokeLinejoin="round"
                >
                  {elevationTies.map(({ bar, path }, i) => (
                    <path
                      key={i}
                      d={polyline(samplePath(path, 24))}
                      data-mark={bar.mark}
                      data-quantity={bar.quantity}
                    >
                      <title>{`${bar.mark} · ${bar.quantity} barra(s)`}</title>
                    </path>
                  ))}
                </g>
                {beam && (
                  <g
                    className="steel-positive"
                    data-testid="beam-positive"
                    fill="none"
                    strokeWidth="3"
                    strokeLinejoin="round"
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
                              d={polyline(samplePath(shape.path, 24))}
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
                            strokeWidth={shape.diameter * s}
                          />
                        ) : (
                          <circle
                            cx={X(shape.center.x)}
                            cy={Y(shape.center.y)}
                            r={(shape.diameter * s) / 2}
                            strokeWidth="0.5"
                          />
                        )}
                      </g>
                    ))}
                  </g>
                )}
              </>
            )}
            <rect
              x={X(bearingLeft)}
              y={bearingTop}
              width={p.design.bearingLength * s}
              height={Math.max(3, p.design.bearingHeight * s)}
              fill="var(--line-muted)"
              opacity=".55"
            />
            {forces && (
              <g className="elevation-forces">
                <path
                  d={`M${forceX} ${verticalForceStart}V${verticalForceEnd}`}
                  stroke="var(--force)"
                  strokeWidth="2.5"
                  markerEnd={`url(#${uid}arrow)`}
                />
                <text
                  className="force-label"
                  x={forceLabelX}
                  y={verticalForceStart + 11}
                  textAnchor={forceLabelAnchor}
                >
                  {p.design.forceMode === "design" ? "Vd" : "Vk"} ={" "}
                  {number(p.loads.vertical / 1000, 0)} kN
                </text>
                {p.loads.horizontal !== 0 && (
                  <>
                    <path
                      d={`M${forceX} ${horizontalForceY}h${p.loads.horizontal > 0 ? 65 : -65}`}
                      stroke="var(--force)"
                      strokeWidth="2"
                      markerEnd={`url(#${uid}arrow)`}
                    />
                    <text
                      className="force-label"
                      x={forceLabelX}
                      y={horizontalForceY - 8}
                      textAnchor={forceLabelAnchor}
                    >
                      {p.design.horizontalMode === "estimated"
                        ? "H adic."
                        : "H total"}{" "}
                      = {number(p.loads.horizontal / 1000, 0)} kN
                    </text>
                  </>
                )}
              </g>
            )}
            {dimensions && (
              <>
                <g className="dimension-extension" fill="none">
                  <path
                    d={`M${X(-g.columnWidth)} ${columnTop - 5}V${pillarDimensionY - 6} M${X(0)} ${Math.min(columnTop, loadLineEnd) - 5}V${pillarDimensionY - 6} M${X(g.loadOffset)} ${loadLineEnd - 5}V${loadDimensionY - 6}`}
                  />
                  <path
                    d={`M${X(0)} ${rootBottom + 5}V${lengthDimensionY + 6} M${tipX} ${tipBottom + 5}V${lengthDimensionY + 6}`}
                  />
                  <path
                    d={`M${tipX + 5} ${Y(0)}H${heightX + 8} M${X(0) + 5} ${rootBottom}H${heightX + 8}`}
                  />
                  {tipBottom !== rootBottom && (
                    <path
                      d={`M${tipX + 5} ${tipBottom}H${heightDifferenceX + 8}`}
                    />
                  )}
                </g>
                {measured.map(({ id, from, to, placement, value }) => {
                  const axis = dimensionAxes[id];
                  const horizontal =
                    placement === "top" || placement === "bottom";
                  return (
                    <Dim
                      key={id}
                      x1={horizontal ? X(from.x) : axis}
                      y1={horizontal ? axis : Y(from.depth)}
                      x2={horizontal ? X(to.x) : axis}
                      y2={horizontal ? axis : Y(to.depth)}
                      label={dimensionLabel(id, value)}
                      active={focus === id}
                      description={
                        id === "heightDifference"
                          ? dimensionMetadata[id].label
                          : undefined
                      }
                      onClick={
                        id === "heightDifference"
                          ? undefined
                          : (anchor) => onDimension(id, anchor)
                      }
                    />
                  );
                })}
                {reaction.shift !== 0 && (
                  <text
                    className="drawing-caption"
                    x={X(g.loadOffset) + 12}
                    y={loadDimensionY + 18}
                  >
                    a_calc = {number(reaction.a / 10, 1)} cm
                  </text>
                )}
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
                  d={`M${X(g.length - g.cover)} ${Y(g.cover)}L${tipX + 9} ${Y(g.cover) + 20}`}
                  stroke="var(--force)"
                  fill="none"
                />
                <text x={tipX + 12} y={Y(g.cover) + 24} className="bar-label">
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
