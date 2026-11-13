import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import {
  asUpdateError,
  errorTitle,
  formatBytes,
  parsePending,
  parseSnooze,
  pendingKey,
  shouldInterrupt,
  SNOOZE_MS,
  snoozeKey,
  statusLabel,
  updateReducer,
  verifyPending,
  type CheckReport,
  type UpdateState,
} from "../lib/updates";

const RELEASES_URL =
  "https://github.com/ricardocorsini/consolo-struct/releases";
/** Atraso da consulta automática: a interface e o rascunho local carregam antes. */
const AUTO_CHECK_DELAY = 4000;

async function call<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function store(key: string, value: unknown | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Preferência local; a atualização segue sem ela. */
  }
}
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Proteção do trabalho antes do reinício. Devolve `null` quando é seguro reiniciar ou
 * a explicação de por que não é. `saveFile` pede também o arquivo do projeto.
 */
export type PrepareRestart = (saveFile: boolean) => Promise<string | null>;

export function useUpdater(
  notify: (message: string) => void,
  prepareRestart: PrepareRestart,
) {
  const desktop = isTauri();
  const [state, dispatch] = useReducer(updateReducer, { phase: "idle" });
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState("");
  const stateRef = useRef<UpdateState>(state);
  stateRef.current = state;
  const busy = useRef(false);

  const check = useCallback(
    async (manual: boolean) => {
      if (manual) setVisible(true);
      if (!desktop) return;
      const phase = stateRef.current.phase;
      if (
        busy.current ||
        ["checking", "downloading", "ready", "confirm", "applying"].includes(
          phase,
        )
      )
        return;
      busy.current = true;
      setNotice("");
      dispatch({ type: "check", manual });
      try {
        const report = await call<CheckReport>("update_check", { manual });
        dispatch({ type: "checked", report });
        if (
          !manual &&
          shouldInterrupt(report, parseSnooze(read(snoozeKey)), Date.now())
        )
          setVisible(true);
      } catch (error) {
        dispatch({ type: "failed", error: asUpdateError(error) });
      } finally {
        busy.current = false;
      }
    },
    [desktop],
  );

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void (async () => {
      const raw = read(pendingKey);
      if (!raw) return;
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const running = await getVersion();
        if (cancelled) return;
        const outcome = verifyPending(parsePending(raw), running, Date.now());
        if (outcome.kind !== "none") notify(outcome.message);
      } finally {
        if (!cancelled) store(pendingKey, null);
      }
    })();
    const timer = setTimeout(() => void check(false), AUTO_CHECK_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [desktop, check, notify]);

  const download = useCallback(async () => {
    const current = stateRef.current;
    if (
      busy.current ||
      current.phase !== "result" ||
      !current.report.offer ||
      !current.report.install.canInstall
    )
      return;
    busy.current = true;
    setNotice("");
    dispatch({ type: "download" });
    let unlisten: (() => void) | undefined;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ received: number; total: number }>(
        "update://progress",
        (event) => dispatch({ type: "progress", ...event.payload }),
      );
      await call("update_download", { version: current.report.offer.version });
      dispatch({ type: "downloaded" });
    } catch (error) {
      dispatch({ type: "failed", error: asUpdateError(error) });
    } finally {
      unlisten?.();
      busy.current = false;
    }
  }, []);

  const cancel = useCallback(() => void call("update_cancel"), []);

  const later = useCallback(() => {
    const current = stateRef.current;
    if (current.phase === "result" && current.report.offer)
      store(snoozeKey, {
        version: current.report.offer.version,
        until: Date.now() + SNOOZE_MS,
      });
    if (current.phase === "confirm") dispatch({ type: "back" });
    setVisible(false);
  }, []);

  const restart = useCallback(
    async (saveFile: boolean) => {
      const current = stateRef.current;
      if (busy.current || current.phase !== "confirm" || !current.report.offer)
        return;
      busy.current = true;
      setNotice("");
      try {
        const blocked = await prepareRestart(saveFile);
        if (blocked) {
          setNotice(blocked);
          return;
        }
        store(pendingKey, {
          from: current.report.current,
          to: current.report.offer.version,
          mode: current.report.install.mode,
          at: Date.now(),
        });
        dispatch({ type: "apply" });
        await call("update_apply");
      } catch (error) {
        store(pendingKey, null);
        dispatch({ type: "failed", error: asUpdateError(error) });
      } finally {
        busy.current = false;
      }
    },
    [prepareRestart],
  );

  const openLauncher = useCallback(async () => {
    try {
      await call("update_open_launcher");
      notify(
        "Struct Launcher aberto. Feche o ConsoloStruct antes de atualizar por lá.",
      );
    } catch (error) {
      notify(asUpdateError(error).message);
    }
  }, [notify]);

  return {
    desktop,
    state,
    visible,
    notice,
    open: () => setVisible(true),
    close: later,
    check,
    download,
    cancel,
    confirm: () => dispatch({ type: "confirm" }),
    back: () => dispatch({ type: "back" }),
    restart,
    openLauncher,
  };
}

type Updater = ReturnType<typeof useUpdater>;

export function UpdateStatus({ updater }: { updater: Updater }) {
  if (!updater.desktop) return null;
  const { state } = updater;
  const alert =
    state.phase === "error" ||
    (state.phase === "result" && state.report.status === "available");
  return (
    <button
      className={`status-update ${alert ? "is-attention" : ""}`}
      onClick={() =>
        state.phase === "idle" || state.phase === "error"
          ? void updater.check(true)
          : updater.open()
      }
      title="Verificar atualizações do ConsoloStruct"
    >
      {statusLabel(state)}
    </button>
  );
}

function OfferDetails({ report }: { report: CheckReport }) {
  const offer = report.offer!;
  const date = new Date(offer.publishedAt);
  return (
    <>
      <dl className="update-versions">
        <div>
          <dt>Em execução</dt>
          <dd>{report.current}</dd>
        </div>
        <div>
          <dt>Oferecida</dt>
          <dd>{offer.version}</dd>
        </div>
        <div>
          <dt>Pacote</dt>
          <dd>
            {offer.platform} · {offer.arch} · {offer.kind.toUpperCase()} ·{" "}
            {formatBytes(offer.size)}
          </dd>
        </div>
        {Number.isFinite(date.getTime()) && (
          <div>
            <dt>Publicada em</dt>
            <dd>{date.toLocaleDateString("pt-BR")}</dd>
          </div>
        )}
      </dl>
      <h3 className="update-subtitle">Novidades da versão {offer.version}</h3>
      <pre className="update-notes">
        {offer.notes.trim() || "Sem notas publicadas."}
      </pre>
    </>
  );
}

export default function UpdatePanel({ updater }: { updater: Updater }) {
  const { state, visible, notice } = updater;
  if (!visible) return null;
  const title = !updater.desktop
    ? "Atualizações"
    : state.phase === "checking"
      ? "Verificando atualizações"
      : state.phase === "error"
        ? errorTitle(state.error)
        : state.phase === "result" && state.report.status === "available"
          ? "Atualização disponível"
          : state.phase === "result" && state.report.status === "incompatible"
            ? "Nova versão sem pacote compatível"
            : state.phase === "result"
              ? "ConsoloStruct atualizado"
              : state.phase === "downloading"
                ? "Baixando atualização"
                : state.phase === "ready"
                  ? "Atualização pronta"
                  : state.phase === "confirm"
                    ? "Antes de reiniciar"
                    : state.phase === "applying"
                      ? "Instalando atualização"
                      : "Atualizações";
  const closable = state.phase !== "applying" && state.phase !== "downloading";
  return (
    <section
      className="update-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="update-panel-title"
    >
      <header>
        <h2 id="update-panel-title">
          {state.phase === "error" ? (
            <AlertTriangle size={17} />
          ) : state.phase === "result" && state.report.status === "upToDate" ? (
            <CheckCircle2 size={17} />
          ) : state.phase === "checking" ||
            state.phase === "downloading" ||
            state.phase === "applying" ? (
            <LoaderCircle size={17} className="update-spin" />
          ) : (
            <Download size={17} />
          )}
          {title}
        </h2>
        {closable && (
          <button
            className="icon-button"
            aria-label="Fechar aviso de atualização"
            onClick={updater.close}
          >
            <X size={16} />
          </button>
        )}
      </header>
      <div className="update-body">
        {!updater.desktop && (
          <p>
            A verificação de atualizações funciona no aplicativo desktop. Na
            interface web, atualize o checkout do repositório.
          </p>
        )}
        {updater.desktop && state.phase === "idle" && (
          <p>Nenhuma consulta feita nesta sessão.</p>
        )}
        {state.phase === "checking" && (
          <p>Consultando o catálogo assinado do OpenStruct…</p>
        )}
        {state.phase === "error" && (
          <>
            <p role="alert">{state.error.message}</p>
            <p className="update-muted">
              Nenhum arquivo foi instalado. O aplicativo continua na versão
              atual.
            </p>
          </>
        )}
        {state.phase === "result" && state.report.status === "upToDate" && (
          <p>
            A versão {state.report.current} é a mais recente estável para{" "}
            {state.report.target}.
          </p>
        )}
        {state.phase === "result" && state.report.status === "incompatible" && (
          <p>
            A versão {state.report.latest} foi publicada, mas não há pacote
            oficial para {state.report.target}. A versão {state.report.current}{" "}
            continua em uso.
          </p>
        )}
        {state.phase === "result" && state.report.status === "available" && (
          <>
            <OfferDetails report={state.report} />
            {!state.report.install.canInstall && (
              <p className="update-limit">
                {state.report.install.message}
                {state.report.install.mode !== "launcher" && (
                  <>
                    {" "}
                    Página oficial: <code>{RELEASES_URL}</code>
                  </>
                )}
              </p>
            )}
          </>
        )}
        {state.phase === "downloading" && (
          <>
            <p>
              Versão {state.report.offer?.version}:{" "}
              {formatBytes(state.received)} de {formatBytes(state.total)}. O
              arquivo é conferido pela assinatura e pelo SHA-256 antes do uso.
            </p>
            <progress
              value={state.received}
              max={state.total || 1}
              aria-label="Progresso do download"
            />
          </>
        )}
        {state.phase === "ready" && (
          <p>
            A versão {state.report.offer?.version} foi baixada e conferida. Nada
            foi instalado ainda. Ao reiniciar, o ConsoloStruct fecha, instala a
            atualização e abre a nova versão.
          </p>
        )}
        {state.phase === "confirm" && (
          <p>
            O projeto aberto fica guardado como rascunho neste dispositivo e
            reabre na nova versão. Para ter também o arquivo .consolo.json,
            salve antes de reiniciar.
          </p>
        )}
        {state.phase === "applying" && (
          <p>Iniciando a instalação; o aplicativo será fechado.</p>
        )}
        {notice && (
          <p className="update-limit" role="alert">
            {notice}
          </p>
        )}
      </div>
      <footer className="update-actions">
        {state.phase === "result" && state.report.status === "available" && (
          <>
            {state.report.install.canInstall ? (
              <button
                className="button primary"
                onClick={() => void updater.download()}
              >
                <Download size={15} /> Atualizar
              </button>
            ) : state.report.install.mode === "launcher" &&
              state.report.install.launcherAvailable ? (
              <button
                className="button primary"
                onClick={() => void updater.openLauncher()}
              >
                <ExternalLink size={15} /> Abrir o Struct Launcher
              </button>
            ) : null}
            <button className="button" onClick={updater.close}>
              Agora não
            </button>
          </>
        )}
        {state.phase === "downloading" && (
          <button className="button" onClick={updater.cancel}>
            Cancelar download
          </button>
        )}
        {state.phase === "ready" && (
          <>
            <button className="button primary" onClick={updater.confirm}>
              <RefreshCw size={15} /> Reiniciar e instalar
            </button>
            <button className="button" onClick={updater.close}>
              Agora não
            </button>
          </>
        )}
        {state.phase === "confirm" && (
          <>
            <button
              className="button primary"
              onClick={() => void updater.restart(true)}
            >
              Salvar projeto e reiniciar
            </button>
            <button
              className="button"
              onClick={() => void updater.restart(false)}
            >
              Reiniciar agora
            </button>
            <button className="button" onClick={updater.back}>
              Cancelar
            </button>
          </>
        )}
        {(state.phase === "error" ||
          (state.phase === "result" &&
            state.report.status !== "available")) && (
          <button className="button" onClick={() => void updater.check(true)}>
            <RefreshCw size={15} /> Verificar novamente
          </button>
        )}
        {updater.desktop && state.phase === "idle" && (
          <button
            className="button primary"
            onClick={() => void updater.check(true)}
          >
            <RefreshCw size={15} /> Verificar agora
          </button>
        )}
      </footer>
    </section>
  );
}
