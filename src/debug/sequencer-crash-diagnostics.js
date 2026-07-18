// Sequencer crash diagnostics capture the last few bar-relative event commits
// plus any uncaught browser error/rejection that follows. Enable with
// `localStorage.hexatone_debug_sequencer_crash = "true"` or
// `?debugSequencerCrash=1`.

function roundMetric(value, digits = 6) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function readSequencerCrashDiagnosticsFlag() {
  if (typeof globalThis === "undefined") return false;
  try {
    if (globalThis.localStorage?.getItem?.("hexatone_debug_sequencer_crash") === "true") {
      return true;
    }
    const search = String(globalThis.location?.search ?? "");
    return new URLSearchParams(search).get("debugSequencerCrash") === "1";
  } catch {
    return false;
  }
}

export const SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY = "hexatone_sequencer_crash_diagnostics";

export function isSequencerCrashDiagnosticsEnabled() {
  return readSequencerCrashDiagnosticsFlag();
}

export function createSequencerCrashDiagnostics(limit = 100) {
  return {
    limit: Math.max(1, Math.round(Number(limit) || 100)),
    entries: [],
    nextId: 1,
    lastContext: null,
  };
}

export function resetSequencerCrashDiagnostics(state, limit = null) {
  const nextLimit = limit == null
    ? Math.max(1, Math.round(Number(state?.limit) || 100))
    : Math.max(1, Math.round(Number(limit) || 100));
  return createSequencerCrashDiagnostics(nextLimit);
}

function normalizeContext(context) {
  if (!context || typeof context !== "object") return null;
  return {
    source: context.source == null ? null : String(context.source),
    snapshotId: context.snapshotId == null ? null : String(context.snapshotId),
    noteKey: context.noteKey == null ? null : String(context.noteKey),
    kind: context.kind == null ? null : String(context.kind),
    draftKey: context.draftKey == null ? null : String(context.draftKey),
    barNumber: Number.isFinite(Number(context.barNumber)) ? Number(context.barNumber) : null,
    beat: Number.isFinite(Number(context.beat)) ? Number(context.beat) : null,
    numerator: Number.isFinite(Number(context.numerator)) ? Number(context.numerator) : null,
    denominator: Number.isFinite(Number(context.denominator)) ? Number(context.denominator) : null,
    absoluteTime: roundMetric(context.absoluteTime),
    snapshotTime: roundMetric(context.snapshotTime),
    snapshotLength: roundMetric(context.snapshotLength),
    previousStart: roundMetric(context.previousStart),
    previousEnd: roundMetric(context.previousEnd),
    nextStart: roundMetric(context.nextStart),
    nextEnd: roundMetric(context.nextEnd),
    eventRelativeTime: roundMetric(context.eventRelativeTime),
    eventAbsoluteTime: roundMetric(context.eventAbsoluteTime),
    snapshotIndex: Number.isFinite(Number(context.snapshotIndex)) ? Number(context.snapshotIndex) : null,
    cueIndex: Number.isFinite(Number(context.cueIndex)) ? Number(context.cueIndex) : null,
    cueDisplayLead: context.cueDisplayLead === true,
    courtesyStart: context.courtesyStart === true,
    derivedBarNumber: Number.isFinite(Number(context.derivedBarNumber)) ? Number(context.derivedBarNumber) : null,
    derivedBeat: Number.isFinite(Number(context.derivedBeat)) ? Number(context.derivedBeat) : null,
    derivedNumerator: Number.isFinite(Number(context.derivedNumerator)) ? Number(context.derivedNumerator) : null,
    derivedDenominator: Number.isFinite(Number(context.derivedDenominator)) ? Number(context.derivedDenominator) : null,
    timestamp: context.timestamp == null ? null : String(context.timestamp),
  };
}

function serializeError(error) {
  if (!error) return null;
  if (typeof error === "string") return { message: error, name: null, stack: null };
  return {
    name: error.name == null ? null : String(error.name),
    message: error.message == null ? String(error) : String(error.message),
    stack: error.stack == null ? null : String(error.stack),
  };
}

export function pushSequencerCrashDiagnostic(state, entry = {}) {
  const diagnostics = state ?? createSequencerCrashDiagnostics();
  const normalizedEntry = {
    id: diagnostics.nextId,
    type: entry.type == null ? "event" : String(entry.type),
    timestamp: entry.timestamp == null ? new Date().toISOString() : String(entry.timestamp),
    detail: entry.detail == null ? null : String(entry.detail),
    context: normalizeContext(entry.context),
    error: serializeError(entry.error),
  };
  const entries = diagnostics.entries.length >= diagnostics.limit
    ? [...diagnostics.entries.slice(1), normalizedEntry]
    : [...diagnostics.entries, normalizedEntry];
  return {
    ...diagnostics,
    entries,
    nextId: diagnostics.nextId + 1,
    lastContext: normalizedEntry.context ?? diagnostics.lastContext ?? null,
  };
}

export function persistSequencerCrashDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (!storage?.setItem) return;
  storage.setItem(SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({ state }));
}

export function loadPersistedSequencerCrashDiagnostics(storage = globalThis?.sessionStorage) {
  if (!storage?.getItem) return null;
  const raw = storage.getItem(SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPersistedSequencerCrashDiagnostics(storage = globalThis?.sessionStorage) {
  if (!storage?.removeItem) return;
  storage.removeItem(SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY);
}

export function appendPersistedSequencerCrashDiagnostic(entry, storage = globalThis?.sessionStorage) {
  if (!isSequencerCrashDiagnosticsEnabled()) return null;
  const persisted = loadPersistedSequencerCrashDiagnostics(storage);
  const nextState = pushSequencerCrashDiagnostic(persisted?.state, entry);
  persistSequencerCrashDiagnostics(nextState, storage);
  return nextState;
}

let listenersInstalled = false;
let errorListener = null;
let rejectionListener = null;

function installSequencerCrashDiagnosticsGlobal() {
  if (typeof globalThis === "undefined") return;
  if (!isSequencerCrashDiagnosticsEnabled()) {
    clearPersistedSequencerCrashDiagnostics();
    delete globalThis.__hexatoneSequencerCrashDiagnostics;
    if (listenersInstalled && globalThis.removeEventListener) {
      globalThis.removeEventListener("error", errorListener);
      globalThis.removeEventListener("unhandledrejection", rejectionListener);
    }
    listenersInstalled = false;
    errorListener = null;
    rejectionListener = null;
    return;
  }

  if (!listenersInstalled && globalThis.addEventListener) {
    errorListener = (event) => {
      appendPersistedSequencerCrashDiagnostic({
        type: "error",
        detail: event?.message ?? "uncaught error",
        error: event?.error ?? { message: event?.message, stack: null },
      });
    };
    rejectionListener = (event) => {
      appendPersistedSequencerCrashDiagnostic({
        type: "unhandledrejection",
        detail: "unhandled rejection",
        error: event?.reason,
      });
    };
    globalThis.addEventListener("error", errorListener);
    globalThis.addEventListener("unhandledrejection", rejectionListener);
    listenersInstalled = true;
  }

  globalThis.__hexatoneSequencerCrashDiagnostics = {
    enabled: true,
    record: (entry) => appendPersistedSequencerCrashDiagnostic(entry),
    getPersisted: () => loadPersistedSequencerCrashDiagnostics(),
    reset: () => {
      clearPersistedSequencerCrashDiagnostics();
      return null;
    },
  };
}

installSequencerCrashDiagnosticsGlobal();
