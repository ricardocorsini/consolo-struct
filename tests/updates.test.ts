import { describe, expect, it } from "vitest";
import {
  asUpdateError,
  errorTitle,
  parsePending,
  parseSnooze,
  shouldInterrupt,
  SNOOZE_MS,
  statusLabel,
  updateReducer,
  verifyPending,
  type CheckReport,
  type UpdateState,
} from "../src/lib/updates";

const install = {
  mode: "nsis" as const,
  canInstall: true,
  message: "",
  path: "C:/x",
  launcherAvailable: false,
};
const available: CheckReport = {
  current: "0.7.1",
  status: "available",
  offer: {
    version: "0.8.0",
    notes: "Novidades",
    publishedAt: "2026-11-20T10:00:00Z",
    size: 5_000_000,
    fileName: "consolostruct-0.8.0-windows-x86_64.exe",
    platform: "windows",
    arch: "x86_64",
    kind: "nsis",
  },
  target: "windows/x86_64/nsis",
  install,
  checkedAt: 0,
};
const upToDate: CheckReport = {
  ...available,
  status: "upToDate",
  offer: undefined,
  latest: "0.7.1",
};
const run = (
  state: UpdateState,
  ...actions: Parameters<typeof updateReducer>[1][]
) => actions.reduce(updateReducer, state);

describe("estado da atualização", () => {
  it("consulta, oferece, baixa, confirma e aplica em ordem", () => {
    let s = run({ phase: "idle" }, { type: "check", manual: false });
    expect(s.phase).toBe("checking");
    s = run(s, { type: "checked", report: available });
    expect(s).toMatchObject({ phase: "result", manual: false });
    s = run(s, { type: "download" });
    expect(s).toMatchObject({ phase: "downloading", total: 5_000_000 });
    s = run(s, { type: "progress", received: 1000, total: 5_000_000 });
    expect(statusLabel(s)).toBe("Baixando atualização 0%");
    s = run(s, { type: "downloaded" }, { type: "confirm" });
    expect(s.phase).toBe("confirm");
    s = run(s, { type: "back" });
    expect(s.phase).toBe("ready");
    s = run(s, { type: "confirm" }, { type: "apply" });
    expect(s.phase).toBe("applying");
  });

  it("cliques repetidos não iniciam uma segunda operação", () => {
    const downloading = run(
      { phase: "result", report: available, manual: true },
      { type: "download" },
    );
    expect(run(downloading, { type: "download" })).toBe(downloading);
    expect(run(downloading, { type: "check", manual: true })).toBe(downloading);
    expect(run(downloading, { type: "reset" })).toBe(downloading);
    const checking = run({ phase: "idle" }, { type: "check", manual: true });
    expect(run(checking, { type: "check", manual: true })).toBe(checking);
    // Aplicar exige a confirmação de proteção do trabalho.
    const ready = run(downloading, { type: "downloaded" });
    expect(run(ready, { type: "apply" })).toBe(ready);
  });

  it("não baixa quando não há oferta ou a instalação não aceita atualização interna", () => {
    const none = { phase: "result" as const, report: upToDate, manual: true };
    expect(run(none, { type: "download" })).toBe(none);
    const managed = {
      phase: "result" as const,
      manual: true,
      report: {
        ...available,
        install: { ...install, mode: "launcher" as const, canInstall: false },
      },
    };
    expect(run(managed, { type: "download" })).toBe(managed);
  });

  it("falhas viram erro e nunca aparecem como atualizado", () => {
    for (const kind of [
      "offline",
      "timeout",
      "catalog",
      "signature",
      "package",
      "integrity",
      "permission",
      "space",
      "cancelled",
      "changed",
      "desconhecido",
    ]) {
      const s = run(
        { phase: "idle" },
        { type: "check", manual: false },
        { type: "failed", error: { kind, message: "x" } },
      );
      expect(s.phase).toBe("error");
      expect(statusLabel(s)).toBe("Atualizações não verificadas");
      expect(errorTitle({ kind, message: "x" })).not.toMatch(/atualizado/i);
    }
    const failedDownload = run(
      { phase: "result", report: available, manual: false },
      { type: "download" },
      { type: "failed", error: { kind: "integrity", message: "x" } },
    );
    expect(failedDownload).toMatchObject({ phase: "error", manual: true });
  });

  it("rótulos distinguem atualizado, disponível e incompatível", () => {
    expect(statusLabel({ phase: "idle" })).toBe("Verificar atualizações");
    expect(
      statusLabel({ phase: "result", report: upToDate, manual: true }),
    ).toBe("Versão 0.7.1 atualizada");
    expect(
      statusLabel({ phase: "result", report: available, manual: true }),
    ).toBe("Atualização 0.8.0 disponível");
    expect(
      statusLabel({
        phase: "result",
        manual: true,
        report: { ...upToDate, status: "incompatible", latest: "0.9.0" },
      }),
    ).toBe("Nova versão sem pacote compatível");
  });

  it("normaliza erros nativos e inesperados", () => {
    expect(asUpdateError({ kind: "timeout", message: "lento" })).toEqual({
      kind: "timeout",
      message: "lento",
    });
    expect(asUpdateError(new Error("falhou")).kind).toBe("state");
    expect(asUpdateError("texto").message).toBe("texto");
    expect(asUpdateError(undefined).message).toMatch(/inesperada/);
  });
});

describe("avisos automáticos", () => {
  it("adiar silencia apenas a mesma versão e apenas pelo prazo", () => {
    const now = 1_000_000;
    const snooze = { version: "0.8.0", until: now + SNOOZE_MS };
    expect(shouldInterrupt(available, null, now)).toBe(true);
    expect(shouldInterrupt(available, snooze, now)).toBe(false);
    expect(shouldInterrupt(available, snooze, now + SNOOZE_MS + 1)).toBe(true);
    expect(
      shouldInterrupt(
        { ...available, offer: { ...available.offer!, version: "0.8.1" } },
        snooze,
        now,
      ),
    ).toBe(true);
    expect(shouldInterrupt(upToDate, null, now)).toBe(false);
  });

  it("ignora preferências corrompidas", () => {
    expect(parseSnooze("{")).toBeNull();
    expect(parseSnooze('{"version":1}')).toBeNull();
    expect(parseSnooze(null)).toBeNull();
    expect(parsePending("[]")).toBeNull();
  });
});

describe("conferência da versão aberta após o reinício", () => {
  const pending = { from: "0.7.1", to: "0.8.0", mode: "nsis", at: 0 };
  it("confirma a versão nova em execução", () => {
    expect(verifyPending(pending, "0.8.0", 1000)).toMatchObject({
      kind: "updated",
    });
  });
  it("avisa quando a cópia aberta ainda é a anterior (atalho antigo ou cancelamento)", () => {
    const outcome = verifyPending(pending, "0.7.1", 1000);
    expect(outcome.kind).toBe("notApplied");
    expect(outcome.kind !== "none" && outcome.message).toMatch(/atalho/);
  });
  it("descarta registros antigos ou de outra origem", () => {
    expect(verifyPending(pending, "0.8.0", 8 * 24 * 3600 * 1000).kind).toBe(
      "none",
    );
    expect(verifyPending(pending, "0.9.0", 1000).kind).toBe("none");
    expect(verifyPending(null, "0.8.0", 1000).kind).toBe("none");
  });
});
