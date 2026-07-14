// Timed transport diagnostics live under debug/ so the runtime can keep the
// tooling available without paying for it during normal playback. Enable with
// `localStorage.hexatone_debug_timed_transport = "true"` or
// `?debugTimedTransport=1`.

function roundMetric(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function readTimedTransportDiagnosticsFlag() {
  if (typeof globalThis === "undefined") return false;
  try {
    if (globalThis.localStorage?.getItem?.("hexatone_debug_timed_transport") === "true") {
      return true;
    }
    const search = String(globalThis.location?.search ?? "");
    return new URLSearchParams(search).get("debugTimedTransport") === "1";
  } catch {
    return false;
  }
}

export const TIMED_TRANSPORT_DIAGNOSTICS_STORAGE_KEY = "hexatone_timed_transport_diagnostics";

export function isTimedTransportDiagnosticsEnabled() {
  return readTimedTransportDiagnosticsFlag();
}

export function createTimedTransportDiagnostics(limit = 200) {
  return {
    limit: Math.max(1, Math.round(Number(limit) || 200)),
    entries: [],
    nextId: 1,
  };
}

export function resetTimedTransportDiagnostics(state, limit = null) {
  const nextLimit = limit == null
    ? Math.max(1, Math.round(Number(state?.limit) || 200))
    : Math.max(1, Math.round(Number(limit) || 200));
  return createTimedTransportDiagnostics(nextLimit);
}

export function pushTimedTransportDiagnostic(state, entry = {}) {
  const diagnostics = state ?? createTimedTransportDiagnostics();
  const normalizedEntry = {
    id: diagnostics.nextId,
    type: String(entry.type || "event"),
    clockSeconds: roundMetric(entry.clockSeconds, 6),
    elapsedSeconds: roundMetric(entry.elapsedSeconds, 6),
    cueIndex: Number.isFinite(Number(entry.cueIndex)) ? Number(entry.cueIndex) : null,
    playbackIndex: Number.isFinite(Number(entry.playbackIndex)) ? Number(entry.playbackIndex) : null,
    scheduledDelayMs: roundMetric(entry.scheduledDelayMs),
    latenessMs: roundMetric(entry.latenessMs),
    durationMs: roundMetric(entry.durationMs),
    queueDepth: Number.isFinite(Number(entry.queueDepth)) ? Number(entry.queueDepth) : null,
    timeoutCount: Number.isFinite(Number(entry.timeoutCount)) ? Number(entry.timeoutCount) : null,
    activeNotes: Number.isFinite(Number(entry.activeNotes)) ? Number(entry.activeNotes) : null,
    noteCount: Number.isFinite(Number(entry.noteCount)) ? Number(entry.noteCount) : null,
    nextPlaybackIndex: Number.isFinite(Number(entry.nextPlaybackIndex)) ? Number(entry.nextPlaybackIndex) : null,
    status: entry.status == null ? null : String(entry.status),
    detail: entry.detail == null ? null : String(entry.detail),
  };
  const entries = diagnostics.entries.length >= diagnostics.limit
    ? [...diagnostics.entries.slice(1), normalizedEntry]
    : [...diagnostics.entries, normalizedEntry];
  return {
    ...diagnostics,
    entries,
    nextId: diagnostics.nextId + 1,
  };
}

export function summarizeTimedTransportDiagnostics(state) {
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  const latenessSamples = entries
    .map((entry) => Number(entry?.latenessMs))
    .filter((value) => Number.isFinite(value));
  const maxLatenessMs = latenessSamples.length > 0 ? Math.max(...latenessSamples) : null;
  const overrunCount = latenessSamples.filter((value) => value > 25).length;
  return {
    entryCount: entries.length,
    overrunCount,
    maxLatenessMs: roundMetric(maxLatenessMs),
    recent: entries.slice(-20),
  };
}

export function persistTimedTransportDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (!storage?.setItem) return;
  storage.setItem(
    TIMED_TRANSPORT_DIAGNOSTICS_STORAGE_KEY,
    JSON.stringify({
      state,
      summary: summarizeTimedTransportDiagnostics(state),
    }),
  );
}

export function loadPersistedTimedTransportDiagnostics(storage = globalThis?.sessionStorage) {
  if (!storage?.getItem) return null;
  const raw = storage.getItem(TIMED_TRANSPORT_DIAGNOSTICS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function appendPersistedTimedTransportDiagnostic(entry, storage = globalThis?.sessionStorage) {
  const persisted = loadPersistedTimedTransportDiagnostics(storage);
  const nextState = pushTimedTransportDiagnostic(persisted?.state, entry);
  persistTimedTransportDiagnostics(nextState, storage);
  return nextState;
}

function installTimedTransportDiagnosticsGlobal() {
  if (typeof globalThis === "undefined") return;
  const existing = globalThis.__hexatoneTimedTransportDiagnostics ?? {};
  globalThis.__hexatoneTimedTransportDiagnostics = {
    ...existing,
    enabled: isTimedTransportDiagnosticsEnabled(),
    record: (entry) => (
      isTimedTransportDiagnosticsEnabled()
        ? appendPersistedTimedTransportDiagnostic(entry)
        : null
    ),
    getPersisted: () => loadPersistedTimedTransportDiagnostics(),
  };
}

installTimedTransportDiagnosticsGlobal();
