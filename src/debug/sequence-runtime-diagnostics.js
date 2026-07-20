// Sequence runtime diagnostics profile the expensive derivation steps that turn
// snapshots, bars, tempi, and repeats into the playback-ready sequencer model.
// Enable with `localStorage.hexatone_debug_sequence_runtime = "true"` or
// `?debugSequenceRuntime=1`.

function roundMetric(value, digits = 3) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function readSequenceRuntimeDiagnosticsFlag() {
  if (typeof globalThis === "undefined") return false;
  try {
    if (globalThis.localStorage?.getItem?.("hexatone_debug_sequence_runtime") === "true") {
      return true;
    }
    const search = String(globalThis.location?.search ?? "");
    return new URLSearchParams(search).get("debugSequenceRuntime") === "1";
  } catch {
    return false;
  }
}

export const SEQUENCE_RUNTIME_DIAGNOSTICS_STORAGE_KEY = "hexatone_sequence_runtime_diagnostics";

export function isSequenceRuntimeDiagnosticsEnabled() {
  return readSequenceRuntimeDiagnosticsFlag();
}

export function createSequenceRuntimeDiagnostics(limit = 200) {
  return {
    limit: Math.max(1, Math.round(Number(limit) || 200)),
    entries: [],
    nextId: 1,
  };
}

export function resetSequenceRuntimeDiagnostics(state, limit = null) {
  const nextLimit = limit == null
    ? Math.max(1, Math.round(Number(state?.limit) || 200))
    : Math.max(1, Math.round(Number(limit) || 200));
  return createSequenceRuntimeDiagnostics(nextLimit);
}

export function pushSequenceRuntimeDiagnostic(state, entry = {}) {
  const diagnostics = state ?? createSequenceRuntimeDiagnostics();
  const normalizedEntry = {
    id: diagnostics.nextId,
    type: String(entry.type || "step"),
    source: entry.source == null ? null : String(entry.source),
    step: entry.step == null ? null : String(entry.step),
    durationMs: roundMetric(entry.durationMs),
    latencyMs: roundMetric(entry.latencyMs),
    snapshotCount: Number.isFinite(Number(entry.snapshotCount)) ? Number(entry.snapshotCount) : null,
    playbackSnapshotCount: Number.isFinite(Number(entry.playbackSnapshotCount)) ? Number(entry.playbackSnapshotCount) : null,
    barCount: Number.isFinite(Number(entry.barCount)) ? Number(entry.barCount) : null,
    tempoCount: Number.isFinite(Number(entry.tempoCount)) ? Number(entry.tempoCount) : null,
    repeatCount: Number.isFinite(Number(entry.repeatCount)) ? Number(entry.repeatCount) : null,
    eventCount: Number.isFinite(Number(entry.eventCount)) ? Number(entry.eventCount) : null,
    cueCount: Number.isFinite(Number(entry.cueCount)) ? Number(entry.cueCount) : null,
    burstCount: Number.isFinite(Number(entry.burstCount)) ? Number(entry.burstCount) : null,
    expandedCount: Number.isFinite(Number(entry.expandedCount)) ? Number(entry.expandedCount) : null,
    rowCount: Number.isFinite(Number(entry.rowCount)) ? Number(entry.rowCount) : null,
    visibleRowCount: Number.isFinite(Number(entry.visibleRowCount)) ? Number(entry.visibleRowCount) : null,
    scrollTop: Number.isFinite(Number(entry.scrollTop)) ? Number(entry.scrollTop) : null,
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

export function summarizeSequenceRuntimeDiagnostics(state) {
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  const byStep = {};
  const byType = {};
  entries.forEach((entry) => {
    const step = String(entry?.step || "unknown");
    if (!byStep[step]) {
      byStep[step] = {
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
      };
    }
    byStep[step].count += 1;
    const duration = Number(entry?.durationMs) || 0;
    byStep[step].totalDurationMs += duration;
    byStep[step].maxDurationMs = Math.max(byStep[step].maxDurationMs, duration);

    const type = String(entry?.type || "unknown");
    if (!byType[type]) {
      byType[type] = {
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        totalLatencyMs: 0,
        maxLatencyMs: 0,
      };
    }
    byType[type].count += 1;
    byType[type].totalDurationMs += duration;
    byType[type].maxDurationMs = Math.max(byType[type].maxDurationMs, duration);
    const latency = Number(entry?.latencyMs) || 0;
    byType[type].totalLatencyMs += latency;
    byType[type].maxLatencyMs = Math.max(byType[type].maxLatencyMs, latency);
  });
  Object.values(byStep).forEach((stepSummary) => {
    stepSummary.totalDurationMs = roundMetric(stepSummary.totalDurationMs);
    stepSummary.maxDurationMs = roundMetric(stepSummary.maxDurationMs);
    stepSummary.meanDurationMs = roundMetric(stepSummary.totalDurationMs / Math.max(1, stepSummary.count));
  });
  Object.values(byType).forEach((typeSummary) => {
    typeSummary.totalDurationMs = roundMetric(typeSummary.totalDurationMs);
    typeSummary.maxDurationMs = roundMetric(typeSummary.maxDurationMs);
    typeSummary.meanDurationMs = roundMetric(typeSummary.totalDurationMs / Math.max(1, typeSummary.count));
    typeSummary.totalLatencyMs = roundMetric(typeSummary.totalLatencyMs);
    typeSummary.maxLatencyMs = roundMetric(typeSummary.maxLatencyMs);
    typeSummary.meanLatencyMs = roundMetric(typeSummary.totalLatencyMs / Math.max(1, typeSummary.count));
  });
  return {
    entryCount: entries.length,
    byStep,
    byType,
    recent: entries.slice(-20),
  };
}

export function persistSequenceRuntimeDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (!storage?.setItem) return;
  storage.setItem(
    SEQUENCE_RUNTIME_DIAGNOSTICS_STORAGE_KEY,
    JSON.stringify({
      state,
      summary: summarizeSequenceRuntimeDiagnostics(state),
    }),
  );
}

export function loadPersistedSequenceRuntimeDiagnostics(storage = globalThis?.sessionStorage) {
  if (!storage?.getItem) return null;
  const raw = storage.getItem(SEQUENCE_RUNTIME_DIAGNOSTICS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function appendPersistedSequenceRuntimeDiagnostic(entry, storage = globalThis?.sessionStorage) {
  const persisted = loadPersistedSequenceRuntimeDiagnostics(storage);
  const nextState = pushSequenceRuntimeDiagnostic(persisted?.state, entry);
  persistSequenceRuntimeDiagnostics(nextState, storage);
  return nextState;
}

export function measureSequenceRuntimeStep(step, compute, entry = {}) {
  if (!isSequenceRuntimeDiagnosticsEnabled()) {
    return compute();
  }
  const start = performance.now();
  const result = compute();
  appendPersistedSequenceRuntimeDiagnostic({
    type: "step",
    step,
    durationMs: performance.now() - start,
    ...entry,
  });
  return result;
}

function installSequenceRuntimeDiagnosticsGlobal() {
  if (typeof globalThis === "undefined") return;
  const existing = globalThis.__hexatoneSequenceRuntimeDiagnostics ?? {};
  globalThis.__hexatoneSequenceRuntimeDiagnostics = {
    ...existing,
    enabled: isSequenceRuntimeDiagnosticsEnabled(),
    getPersisted: () => loadPersistedSequenceRuntimeDiagnostics(),
    reset: () => {
      const nextState = resetSequenceRuntimeDiagnostics(loadPersistedSequenceRuntimeDiagnostics()?.state);
      persistSequenceRuntimeDiagnostics(nextState);
      return summarizeSequenceRuntimeDiagnostics(nextState);
    },
  };
}

installSequenceRuntimeDiagnosticsGlobal();
