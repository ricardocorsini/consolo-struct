import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  Check,
  X,
  Maximize,
  ZoomIn,
  ZoomOut,
  Hand,
  MousePointer2,
} from "lucide-react";
import Drawing from "./Drawing";
import { type GeometryKey, type Piece } from "../domain/model";

export type ViewportHandle = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};
type Camera = { zoom: number; x: number; y: number };
const initialCamera: Camera = { zoom: 1, x: 0, y: 0 };
export function zoomCamera(
  camera: Camera,
  factor: number,
  point = { x: 400, y: 300 },
): Camera {
  const zoom = Math.min(8, Math.max(0.15, camera.zoom * factor));
  const ratio = zoom / camera.zoom;
  return {
    zoom,
    x: point.x - 400 - (point.x - 400 - camera.x) * ratio,
    y: point.y - 300 - (point.y - 300 - camera.y) * ratio,
  };
}
const labels: Record<GeometryKey, string> = {
  width: "Largura b",
  height: "Altura H",
  tipHeight: "Altura na ponta H2",
  length: "Comprimento L",
  loadOffset: "Posição da carga A",
  columnWidth: "Dimensão do pilar P",
  cover: "Cobrimento c",
};
export default function Viewport({
  piece,
  section,
  rebar,
  dimensions,
  grid,
  forces,
  focus,
  selectedBar,
  mode,
  onMode,
  onDimension,
  onBar,
  onUpdate,
  onZoom,
  apiRef,
}: {
  piece: Piece;
  section: boolean;
  rebar: boolean;
  dimensions: boolean;
  grid: boolean;
  forces: boolean;
  focus?: GeometryKey;
  selectedBar: string;
  mode: "select" | "pan";
  onMode: (mode: "select" | "pan") => void;
  onDimension: (key: GeometryKey) => void;
  onBar: (id: string) => void;
  onUpdate: (piece: Piece) => void;
  onZoom: (zoom: number) => void;
  apiRef: Ref<ViewportHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<Camera>(initialCamera);
  const [space, setSpace] = useState(false),
    [panning, setPanning] = useState(false);
  const [editor, setEditor] = useState<{
    key: GeometryKey;
    left: number;
    top: number;
  } | null>(null);
  const [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  const drag = useRef<{
    id: number;
    point: { x: number; y: number };
    camera: Camera;
  } | null>(null);
  const moved = useRef(false);
  const fit = () => setCamera(initialCamera);
  useImperativeHandle(
    apiRef,
    () => ({
      fit,
      zoomIn: () => setCamera((c) => zoomCamera(c, 1.2)),
      zoomOut: () => setCamera((c) => zoomCamera(c, 1 / 1.2)),
    }),
    [],
  );
  useEffect(() => onZoom(camera.zoom), [camera.zoom, onZoom]);
  useEffect(() => {
    if (editor) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editor]);
  useEffect(() => {
    const editable = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest(
        "input,textarea,select,.ribbon,[contenteditable],[role=dialog]",
      );
    const keydown = (e: KeyboardEvent) => {
      if (editable(e.target) || document.querySelector("[role=dialog]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpace(true);
      }
      if (
        e.key.toLowerCase() === "f" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        fit();
      }
      if (e.key === "Escape") {
        setEditor(null);
        onMode("select");
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      drag.current = null;
      setPanning(false);
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, [onMode]);
  const localPoint = (clientX: number, clientY: number) => {
    const svg = root.current?.querySelector("svg.technical-drawing");
    if (!(svg instanceof SVGSVGElement)) return { x: 400, y: 300 };
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 400, y: 300 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: point.x, y: point.y };
  };
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest(".dimension-editor"))
        return;
      e.preventDefault();
      const delta =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      const point = localPoint(e.clientX, e.clientY);
      setCamera((c) =>
        zoomCamera(
          c,
          Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015),
          point,
        ),
      );
      setEditor(null);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const edit = (key: GeometryKey, anchor: { x: number; y: number }) => {
    if (mode === "pan" || space || moved.current) return;
    const bounds = root.current!.getBoundingClientRect();
    onDimension(key);
    setDraft(
      new Intl.NumberFormat("pt-BR", {
        useGrouping: false,
        maximumFractionDigits: 8,
      }).format(piece.geometry[key] / 10),
    );
    setError("");
    setEditor({
      key,
      left: Math.max(
        8,
        Math.min(bounds.width - 240, anchor.x - bounds.left - 110),
      ),
      top: Math.max(
        42,
        Math.min(bounds.height - 120, anchor.y - bounds.top + 12),
      ),
    });
  };
  const confirm = () => {
    if (!editor) return false;
    const text = draft.trim().replace(",", ".");
    const value = Number(text) * 10;
    const min = editor.key === "cover" ? 10 : 5,
      max = editor.key === "cover" ? 100 : 6000;
    if (!text || !Number.isFinite(value) || value < min || value > max) {
      setError(`Informe de ${min / 10} a ${max / 10} cm.`);
      return false;
    }
    onUpdate({
      ...piece,
      geometry: { ...piece.geometry, [editor.key]: value },
    });
    setEditor(null);
    root.current?.focus();
    return true;
  };
  return (
    <div
      ref={root}
      className={`canvas ${mode === "pan" || space ? "pan-ready" : ""} ${panning ? "panning" : ""}`}
      tabIndex={0}
      aria-label="Área de desenho navegável"
      onPointerDown={(e) => {
        if (
          e.target instanceof Element &&
          e.target.closest("button,input,.dimension-editor")
        )
          return;
        moved.current = false;
        if (e.button === 1 || (e.button === 0 && (mode === "pan" || space))) {
          e.preventDefault();
          setEditor(null);
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            id: e.pointerId,
            point: localPoint(e.clientX, e.clientY),
            camera,
          };
          setPanning(true);
        } else if (
          e.button === 0 &&
          !(e.target instanceof Element && e.target.closest(".dimension"))
        )
          setEditor(null);
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (!start || start.id !== e.pointerId) return;
        const point = localPoint(e.clientX, e.clientY),
          dx = point.x - start.point.x,
          dy = point.y - start.point.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
        setCamera({
          ...start.camera,
          x: start.camera.x + dx,
          y: start.camera.y + dy,
        });
      }}
      onPointerUp={(e) => {
        if (drag.current?.id !== e.pointerId) return;
        drag.current = null;
        setPanning(false);
        if (e.button === 1) moved.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPanning(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setPanning(false);
      }}
      onClickCapture={(e) => {
        if (moved.current) {
          e.preventDefault();
          e.stopPropagation();
          moved.current = false;
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
    >
      <div className="canvas-heading">
        <span>
          {piece.name} / {section ? "SEÇÃO A–A" : "ELEVAÇÃO"}
        </span>
        <span>cm · kN</span>
      </div>
      <Drawing
        piece={piece}
        section={section}
        rebar={rebar}
        dimensions={dimensions}
        grid={grid}
        forces={forces}
        zoom={camera.zoom}
        pan={{ x: camera.x, y: camera.y }}
        focus={focus}
        selectedBar={selectedBar}
        onDimension={edit}
        onBar={onBar}
      />
      <div className="view-tools" aria-label="Navegação do desenho">
        <button
          className={mode === "select" ? "active" : ""}
          title="Selecionar e editar cotas"
          aria-label="Selecionar no desenho"
          aria-pressed={mode === "select"}
          onClick={() => onMode("select")}
        >
          <MousePointer2 size={18} />
        </button>
        <button
          className={mode === "pan" ? "active" : ""}
          title="Pan · Espaço + arrastar"
          aria-label="Pan no desenho"
          aria-pressed={mode === "pan"}
          onClick={() => onMode("pan")}
        >
          <Hand size={18} />
        </button>
        <span />
        <button
          aria-label="Aumentar zoom no desenho"
          title="Aumentar zoom"
          onClick={() => setCamera((c) => zoomCamera(c, 1.2))}
        >
          <ZoomIn size={18} />
        </button>
        <button
          aria-label="Diminuir zoom no desenho"
          title="Diminuir zoom"
          onClick={() => setCamera((c) => zoomCamera(c, 1 / 1.2))}
        >
          <ZoomOut size={18} />
        </button>
        <button
          aria-label="Ajustar desenho à tela"
          title="Ajustar à tela · F"
          onClick={fit}
        >
          <Maximize size={18} />
        </button>
      </div>
      <div className="viewport-hint">
        {panning
          ? "Movendo vista"
          : mode === "pan"
            ? "Arraste para mover a vista"
            : "Clique na cota para editar"}
        <span>Roda: zoom · Botão do meio: pan</span>
      </div>
      {editor && (
        <form
          className="dimension-editor"
          style={{ left: editor.left, top: editor.top }}
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditor(null);
              root.current?.focus();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              if (!confirm()) e.stopPropagation();
            }
          }}
          aria-label="Editar cota"
        >
          <label htmlFor="dimension-value">{labels[editor.key]}</label>
          <div>
            <input
              ref={input}
              id="dimension-value"
              aria-label="Valor da cota"
              inputMode="decimal"
              value={draft}
              aria-invalid={!!error}
              onChange={(e) => {
                setDraft(e.target.value);
                setError("");
              }}
            />
            <span>cm</span>
            <button
              type="submit"
              aria-label="Confirmar cota"
              title="Confirmar · Enter"
            >
              <Check size={17} />
            </button>
            <button
              type="button"
              aria-label="Cancelar cota"
              title="Cancelar · Esc"
              onClick={() => {
                setEditor(null);
                root.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          {error ? (
            <small role="alert">{error}</small>
          ) : (
            <small>Enter confirma · Esc cancela</small>
          )}
        </form>
      )}
    </div>
  );
}
