// Estado e regras da checagem de atualizações (issue #45).
//
// A consulta e a instalação ficam no lado nativo (src-tauri/src/update). Aqui ficam as
// regras de apresentação, independentes de React e de Tauri, para serem testadas.

export type InstallInfo = {
  mode:
    | "launcher"
    | "nsis"
    | "appimage"
    | "development"
    | "package"
    | "portable"
    | "unsupported";
  canInstall: boolean;
  message: string;
  path: string;
  launcherAvailable: boolean;
};

export type Offer = {
  version: string;
  notes: string;
  publishedAt: string;
  size: number;
  fileName: string;
  platform: string;
  arch: string;
  kind: string;
};

export type CheckReport = {
  current: string;
  status: "upToDate" | "available" | "incompatible";
  offer?: Offer;
  latest?: string;
  target: string;
  install: InstallInfo;
  checkedAt: number;
};

export type UpdateError = {
  kind: string;
  message: string;
  version?: string;
};

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking"; manual: boolean }
  | { phase: "result"; report: CheckReport; manual: boolean }
  | { phase: "error"; error: UpdateError; manual: boolean }
  | {
      phase: "downloading";
      report: CheckReport;
      received: number;
      total: number;
    }
  | { phase: "ready"; report: CheckReport }
  | { phase: "confirm"; report: CheckReport }
  | { phase: "applying"; report: CheckReport };

export type UpdateAction =
  | { type: "check"; manual: boolean }
  | { type: "checked"; report: CheckReport }
  | { type: "failed"; error: UpdateError }
  | { type: "download" }
  | { type: "progress"; received: number; total: number }
  | { type: "downloaded" }
  | { type: "confirm" }
  | { type: "back" }
  | { type: "apply" }
  | { type: "reset" };

const manualOf = (state: UpdateState) =>
  "manual" in state ? state.manual : true;

/** Transições permitidas; ações fora de ordem (cliques repetidos) são ignoradas. */
export function updateReducer(
  state: UpdateState,
  action: UpdateAction,
): UpdateState {
  switch (action.type) {
    case "check":
      if (
        state.phase === "checking" ||
        state.phase === "downloading" ||
        state.phase === "ready" ||
        state.phase === "confirm" ||
        state.phase === "applying"
      )
        return state;
      return { phase: "checking", manual: action.manual };
    case "checked":
      if (state.phase !== "checking") return state;
      return { phase: "result", report: action.report, manual: state.manual };
    case "failed":
      if (state.phase === "downloading" || state.phase === "applying") {
        // A falha do download ou da instalação mantém a oferta para nova tentativa.
        return { phase: "error", error: action.error, manual: true };
      }
      if (state.phase === "idle" || state.phase === "result") return state;
      return { phase: "error", error: action.error, manual: manualOf(state) };
    case "download":
      if (
        state.phase !== "result" ||
        state.report.status !== "available" ||
        !state.report.install.canInstall
      )
        return state;
      return {
        phase: "downloading",
        report: state.report,
        received: 0,
        total: state.report.offer?.size ?? 0,
      };
    case "progress":
      if (state.phase !== "downloading") return state;
      return {
        ...state,
        received: action.received,
        total: action.total || state.total,
      };
    case "downloaded":
      if (state.phase !== "downloading") return state;
      return { phase: "ready", report: state.report };
    case "confirm":
      if (state.phase !== "ready") return state;
      return { phase: "confirm", report: state.report };
    case "back":
      if (state.phase !== "confirm") return state;
      return { phase: "ready", report: state.report };
    case "apply":
      if (state.phase !== "confirm") return state;
      return { phase: "applying", report: state.report };
    case "reset":
      if (state.phase === "downloading" || state.phase === "applying")
        return state;
      return { phase: "idle" };
  }
}

/** Uma oferta automática adiada não volta a interromper antes do prazo. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
export const snoozeKey = "consolostruct.update.snooze";
export const pendingKey = "consolostruct.update.pending";

export type Snooze = { version: string; until: number };

export function parseSnooze(raw: string | null): Snooze | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value &&
      typeof value.version === "string" &&
      Number.isFinite(value.until)
      ? { version: value.version, until: value.until }
      : null;
  } catch {
    return null;
  }
}

/** Decide se o resultado de uma consulta deve abrir o aviso sem o usuário pedir. */
export function shouldInterrupt(
  report: CheckReport,
  snooze: Snooze | null,
  now: number,
): boolean {
  if (report.status !== "available" || !report.offer) return false;
  return !(
    snooze &&
    snooze.version === report.offer.version &&
    snooze.until > now
  );
}

/** Registro gravado antes do reinício para conferir a versão realmente aberta depois. */
export type Pending = { from: string; to: string; mode: string; at: number };
export const PENDING_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function parsePending(raw: string | null): Pending | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value &&
      typeof value.from === "string" &&
      typeof value.to === "string" &&
      typeof value.mode === "string" &&
      Number.isFinite(value.at)
      ? value
      : null;
  } catch {
    return null;
  }
}

export type PendingOutcome =
  | { kind: "none" }
  | { kind: "updated"; message: string }
  | { kind: "notApplied"; message: string };

export function verifyPending(
  pending: Pending | null,
  running: string,
  now: number,
): PendingOutcome {
  if (!pending || now - pending.at > PENDING_MAX_AGE) return { kind: "none" };
  if (running === pending.to)
    return {
      kind: "updated",
      message: `ConsoloStruct atualizado de ${pending.from} para ${pending.to}.`,
    };
  if (running === pending.from)
    return {
      kind: "notApplied",
      message:
        pending.mode === "nsis"
          ? `A atualização para ${pending.to} não está em execução: esta janela abriu a versão ${running}. O instalador pode ter sido cancelado ou o atalho usado aponta para outra cópia.`
          : `A atualização para ${pending.to} não está em execução: esta janela abriu a versão ${running}. Confira se o atalho aponta para o AppImage atualizado.`,
    };
  return { kind: "none" };
}

export function asUpdateError(error: unknown): UpdateError {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as UpdateError).kind === "string" &&
    typeof (error as UpdateError).message === "string"
  )
    return error as UpdateError;
  return {
    kind: "state",
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Falha inesperada na atualização.",
  };
}

const errorTitles: Record<string, string> = {
  offline: "Sem conexão com o servidor de atualizações",
  timeout: "A consulta excedeu o tempo limite",
  http: "O servidor de atualizações respondeu com erro",
  catalog: "Catálogo de atualizações inválido",
  signature: "Assinatura do catálogo recusada",
  notListed: "Produto ausente do catálogo",
  package: "Pacote da nova versão recusado",
  integrity: "O arquivo baixado não confere",
  permission: "Sem permissão para gravar a atualização",
  space: "Espaço em disco insuficiente",
  io: "Falha ao gravar a atualização",
  busy: "Atualização em andamento",
  changed: "A versão disponível mudou",
  unsupported: "Atualização indisponível nesta instalação",
  cancelled: "Download cancelado",
  relaunch: "Reabra o ConsoloStruct",
  state: "Falha na atualização",
};

/** Título curto do erro. Nunca descreve uma falha como "atualizado". */
export const errorTitle = (error: UpdateError) =>
  errorTitles[error.kind] ?? errorTitles.state;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} MB`;
}

/** Rótulo da barra de status; erros e ausência de consulta nunca aparecem como atualizado. */
export function statusLabel(state: UpdateState): string {
  switch (state.phase) {
    case "idle":
      return "Verificar atualizações";
    case "checking":
      return "Verificando atualizações…";
    case "error":
      return "Atualizações não verificadas";
    case "downloading":
      return `Baixando atualização ${state.total ? Math.floor((state.received / state.total) * 100) : 0}%`;
    case "ready":
    case "confirm":
      return "Atualização pronta para instalar";
    case "applying":
      return "Instalando atualização…";
    case "result":
      return state.report.status === "available"
        ? `Atualização ${state.report.offer?.version} disponível`
        : state.report.status === "incompatible"
          ? "Nova versão sem pacote compatível"
          : `Versão ${state.report.current} atualizada`;
  }
}
