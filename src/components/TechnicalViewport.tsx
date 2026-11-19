import { memo, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { DetailSection } from "../detailing/job";
import { escapeXml } from "../detailing/exports";

type Camera = { zoom: number; x: number; y: number };
type Visible = { indices: number[]; overview: boolean };
const SceneSection = memo(function SceneSection({
  section,
  overview,
}: {
  section: DetailSection;
  overview: boolean;
}) {
  const markup = overview
    ? `<rect x="2" y="2" width="${section.width - 4}" height="${section.height - 4}" fill="none" stroke="#718096" stroke-width="1"/><text x="12" y="22" font-size="12" fill="#718096">${escapeXml(section.name)} · aproxime para ler</text>`
    : section.markup;
  return (
    <g
      data-detail-section={section.id}
      transform={`translate(0 ${section.y})`}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
});

function TechnicalViewport({
  width,
  height,
  sections,
  focusId,
  scope,
  dark,
  active,
}: {
  width: number;
  height: number;
  sections: DetailSection[];
  focusId: string;
  scope: "one" | "all";
  dark: boolean;
  active: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null),
    model = useRef<SVGGElement>(null),
    label = useRef<HTMLSpanElement>(null);
  const camera = useRef<Camera>({ zoom: 1, x: 0, y: 0 }),
    frame = useRef(0);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    inverse: DOMMatrix;
  } | null>(null);
  const props = useRef({ width, height, sections });
  props.current = { width, height, sections };
  const metrics = useRef<{
    inverse: DOMMatrix;
    top: number;
    bottom: number;
    scale: number;
  } | null>(null);
  const measure = () => {
    const node = svg.current,
      matrix = node?.getScreenCTM();
    if (!node || !matrix) return;
    const bounds = node.getBoundingClientRect(),
      inverse = matrix.inverse();
    metrics.current = {
      inverse,
      top: new DOMPoint(bounds.left, bounds.top).matrixTransform(inverse).y,
      bottom: new DOMPoint(bounds.right, bounds.bottom).matrixTransform(inverse)
        .y,
      scale: Math.abs(matrix.a),
    };
  };
  const [visible, setVisible] = useState<Visible>({
    indices: [0],
    overview: false,
  });
  const visibleKey = useRef(""),
    initial = useRef(true);
  const paint = useRef(() => {});
  paint.current = () => {
    frame.current = 0;
    const c = camera.current,
      { width: w, height: h, sections: ss } = props.current;
    model.current?.setAttribute(
      "transform",
      `translate(${w / 2 + c.x} ${h / 2 + c.y}) scale(${c.zoom}) translate(${-w / 2} ${-h / 2})`,
    );
    if (
      label.current &&
      label.current.textContent !== `${Math.round(c.zoom * 100)}%`
    )
      label.current.textContent = `${Math.round(c.zoom * 100)}%`;
    const m = metrics.current;
    if (!m) return;
    const min = (m.top - h / 2 - c.y) / c.zoom + h / 2 - 25 / c.zoom,
      max = (m.bottom - h / 2 - c.y) / c.zoom + h / 2 + 25 / c.zoom;
    let first = -1,
      last = -1;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (s.y + s.height >= min && s.y <= max) {
        if (first === -1) first = i;
        last = i;
      }
    }
    const overview = ss.length > 4 && m.scale * c.zoom < 0.8;
    const key = `${first}:${last}/${overview}`;
    if (key !== visibleKey.current) {
      visibleKey.current = key;
      const indices: number[] = [];
      if (first !== -1) for (let i = first; i <= last; i++) indices.push(i);
      setVisible({ indices, overview });
    }
  };
  const schedule = () => {
    if (!frame.current)
      frame.current = requestAnimationFrame(() => paint.current());
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d && svg.current?.hasPointerCapture(d.id))
      svg.current.releasePointerCapture(d.id);
  };
  const fit = (all = false) => {
    endDrag();
    const node = svg.current;
    if (!node?.clientWidth || !node.clientHeight) return;
    measure();
    const { width: w, height: h, sections: ss } = props.current;
    if (all) camera.current = { zoom: 1, x: 0, y: 0 };
    else {
      const base = Math.min(node.clientWidth / w, node.clientHeight / h);
      const zoom = Math.min(30, Math.max(1, node.clientWidth / w / base));
      const section = ss.find((s) => s.id === focusId) ?? ss[0];
      camera.current = {
        zoom,
        x: 0,
        y: (h / 2) * (zoom - 1) - (section?.y ?? 0) * zoom,
      };
    }
    schedule();
  };
  const zoom = (factor: number, anchor?: { x: number; y: number }) => {
    const c = camera.current,
      { width: w, height: h } = props.current;
    const next = Math.max(0.15, Math.min(30, c.zoom * factor)),
      ratio = next / c.zoom;
    const a = anchor ?? { x: w / 2, y: h / 2 };
    camera.current = {
      zoom: next,
      x: a.x - w / 2 - (a.x - w / 2 - c.x) * ratio,
      y: a.y - h / 2 - (a.y - h / 2 - c.y) * ratio,
    };
    schedule();
  };
  useLayoutEffect(() => {
    initial.current = true;
  }, [focusId, scope]);
  useLayoutEffect(() => {
    if (!active) return;
    measure();
    if (initial.current) {
      fit();
      initial.current = false;
    } else schedule();
    const node = svg.current;
    if (!node) return;
    const resize = new ResizeObserver(() => {
      endDrag();
      measure();
      if (initial.current) {
        fit();
        initial.current = false;
      } else schedule();
    });
    resize.observe(node);
    window.addEventListener("blur", endDrag);
    return () => {
      resize.disconnect();
      window.removeEventListener("blur", endDrag);
      endDrag();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [width, height, sections, active, focusId, scope]);
  useLayoutEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!metrics.current) measure();
      if (!metrics.current) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
        metrics.current.inverse,
      );
      zoom(Math.exp(-e.deltaY * 0.0015), p);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, []);
  return (
    <div className={`detail-viewport ${dark ? "dark" : ""}`}>
      <div className="detail-view-tools">
        <button
          title="Diminuir detalhes"
          aria-label="Diminuir detalhes"
          onClick={() => zoom(1 / 1.25)}
        >
          <Minus size={15} />
        </button>
        <span ref={label}>100%</span>
        <button
          title="Aumentar detalhes"
          aria-label="Aumentar detalhes"
          onClick={() => zoom(1.25)}
        >
          <Plus size={15} />
        </button>
        <button
          title="Ajustar detalhes à tela"
          aria-label="Ajustar detalhes à tela"
          onClick={() => fit(true)}
        >
          <Maximize size={15} />
        </button>
      </div>
      <svg
        ref={svg}
        className="detail-canvas"
        role="img"
        aria-label={
          scope === "all"
            ? "Detalhes de todos os consolos"
            : `Detalhes de ${sections[0]?.name ?? "consolo"}`
        }
        viewBox={`0 0 ${width} ${height}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            endDrag();
          } else if (e.key.toLowerCase() === "f") {
            e.preventDefault();
            fit(true);
          } else if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            zoom(1.25);
          } else if (e.key === "-") {
            e.preventDefault();
            zoom(1 / 1.25);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (!active || drag.current || (e.button !== 0 && e.button !== 1))
            return;
          measure();
          if (!metrics.current) return;
          e.preventDefault();
          const inverse = metrics.current.inverse,
            p = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
          drag.current = { id: e.pointerId, x: p.x, y: p.y, inverse };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
            d.inverse,
          );
          camera.current = {
            ...camera.current,
            x: camera.current.x + p.x - d.x,
            y: camera.current.y + p.y - d.y,
          };
          d.x = p.x;
          d.y = p.y;
          schedule();
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
            d.inverse,
          );
          if (p.x !== d.x || p.y !== d.y) {
            camera.current = {
              ...camera.current,
              x: camera.current.x + p.x - d.x,
              y: camera.current.y + p.y - d.y,
            };
            schedule();
          }
          endDrag();
        }}
        onPointerCancel={(e) => {
          if (drag.current?.id === e.pointerId) endDrag();
        }}
        onLostPointerCapture={(e) => {
          if (drag.current?.id === e.pointerId) endDrag();
        }}
      >
        <g ref={model} data-testid="detail-model">
          {visible.indices.map((i) =>
            sections[i] ? (
              <SceneSection
                key={sections[i].id}
                section={sections[i]}
                overview={visible.overview}
              />
            ) : null,
          )}
        </g>
      </svg>
      <div className="detail-view-caption">
        Arrastar: pan · Roda: zoom · F: enquadrar · Cotas em cm · Bitolas em mm
        · Desenhos soltos
      </div>
    </div>
  );
}
export default memo(TechnicalViewport);
