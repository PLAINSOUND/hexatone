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

function nullableNumber(value) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

let bufferedDiagnosticsState = null;
let bufferedDiagnosticsStorage = null;
let pendingPersistenceTimer = null;

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
  const nextLimit =
    limit == null
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
    snapshotCount: nullableNumber(entry.snapshotCount),
    playbackSnapshotCount: nullableNumber(entry.playbackSnapshotCount),
    barCount: nullableNumber(entry.barCount),
    tempoCount: nullableNumber(entry.tempoCount),
    repeatCount: nullableNumber(entry.repeatCount),
    eventCount: nullableNumber(entry.eventCount),
    cueCount: nullableNumber(entry.cueCount),
    burstCount: nullableNumber(entry.burstCount),
    expandedCount: nullableNumber(entry.expandedCount),
    rowCount: nullableNumber(entry.rowCount),
    visibleRowCount: nullableNumber(entry.visibleRowCount),
    scrollTop: nullableNumber(entry.scrollTop),
    runtimeInstanceId: nullableNumber(entry.runtimeInstanceId),
    playbackRuntimeToken:
      entry.playbackRuntimeToken == null ? null : String(entry.playbackRuntimeToken),
    timedTriggerToken: entry.timedTriggerToken == null ? null : String(entry.timedTriggerToken),
    transportStatus: entry.transportStatus == null ? null : String(entry.transportStatus),
    changedKeys:
      entry.changedKeys == null
        ? null
        : Array.isArray(entry.changedKeys)
          ? entry.changedKeys.map((key) => String(key))
          : String(entry.changedKeys)
              .split(",")
              .map((key) => key.trim())
              .filter(Boolean),
    detail: entry.detail == null ? null : String(entry.detail),
  };
  const entries =
    diagnostics.entries.length >= diagnostics.limit
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
  const rebuildCauseCounts = {};
  const rebuildCauseSetCounts = {};
  const recentRebuilds = [];
  let previousPlaybackRuntimeToken = null;
  let previousTimedTriggerToken = null;
  let playbackRuntimeTokenChangeCount = 0;
  let timedTriggerTokenChangeCount = 0;
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

    if (type === "rebuild-cause") {
      const changedKeys = Array.isArray(entry?.changedKeys) ? entry.changedKeys : [];
      const causeSet = changedKeys.length > 0 ? changedKeys.join(" + ") : "unknown";
      rebuildCauseSetCounts[causeSet] = (rebuildCauseSetCounts[causeSet] ?? 0) + 1;
      changedKeys.forEach((key) => {
        rebuildCauseCounts[key] = (rebuildCauseCounts[key] ?? 0) + 1;
      });
      const playbackTokenChanged =
        previousPlaybackRuntimeToken != null &&
        entry?.playbackRuntimeToken != null &&
        previousPlaybackRuntimeToken !== entry.playbackRuntimeToken;
      const timedTriggerTokenChanged =
        previousTimedTriggerToken != null &&
        entry?.timedTriggerToken != null &&
        previousTimedTriggerToken !== entry.timedTriggerToken;
      if (playbackTokenChanged) playbackRuntimeTokenChangeCount += 1;
      if (timedTriggerTokenChanged) timedTriggerTokenChangeCount += 1;
      recentRebuilds.push({
        id: entry.id,
        changedKeys,
        playbackTokenChanged,
        timedTriggerTokenChanged,
        runtimeInstanceId: entry.runtimeInstanceId,
        snapshotCount: entry.snapshotCount,
        playbackSnapshotCount: entry.playbackSnapshotCount,
        barCount: entry.barCount,
        tempoCount: entry.tempoCount,
        repeatCount: entry.repeatCount,
      });
      previousPlaybackRuntimeToken = entry?.playbackRuntimeToken ?? previousPlaybackRuntimeToken;
      previousTimedTriggerToken = entry?.timedTriggerToken ?? previousTimedTriggerToken;
    }
  });
  Object.values(byStep).forEach((stepSummary) => {
    stepSummary.totalDurationMs = roundMetric(stepSummary.totalDurationMs);
    stepSummary.maxDurationMs = roundMetric(stepSummary.maxDurationMs);
    stepSummary.meanDurationMs = roundMetric(
      stepSummary.totalDurationMs / Math.max(1, stepSummary.count),
    );
  });
  Object.values(byType).forEach((typeSummary) => {
    typeSummary.totalDurationMs = roundMetric(typeSummary.totalDurationMs);
    typeSummary.maxDurationMs = roundMetric(typeSummary.maxDurationMs);
    typeSummary.meanDurationMs = roundMetric(
      typeSummary.totalDurationMs / Math.max(1, typeSummary.count),
    );
    typeSummary.totalLatencyMs = roundMetric(typeSummary.totalLatencyMs);
    typeSummary.maxLatencyMs = roundMetric(typeSummary.maxLatencyMs);
    typeSummary.meanLatencyMs = roundMetric(
      typeSummary.totalLatencyMs / Math.max(1, typeSummary.count),
    );
  });
  return {
    entryCount: entries.length,
    byStep,
    byType,
    rebuilds: {
      count: recentRebuilds.length,
      byChangedKey: rebuildCauseCounts,
      byChangedKeySet: rebuildCauseSetCounts,
      playbackRuntimeTokenChangeCount,
      timedTriggerTokenChangeCount,
      recent: recentRebuilds.slice(-20),
    },
    recent: entries.slice(-20),
  };
}

function writeSequenceRuntimeDiagnostics(state, storage) {
  if (!storage?.setItem) return;
  storage.setItem(
    SEQUENCE_RUNTIME_DIAGNOSTICS_STORAGE_KEY,
    JSON.stringify({
      state,
      summary: summarizeSequenceRuntimeDiagnostics(state),
    }),
  );
}

export function persistSequenceRuntimeDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (pendingPersistenceTimer != null) {
    globalThis.clearTimeout?.(pendingPersistenceTimer);
    pendingPersistenceTimer = null;
  }
  bufferedDiagnosticsState = state;
  bufferedDiagnosticsStorage = storage;
  writeSequenceRuntimeDiagnostics(state, storage);
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

export function appendPersistedSequenceRuntimeDiagnostic(
  entry,
  storage = globalThis?.sessionStorage,
) {
  if (bufferedDiagnosticsStorage && bufferedDiagnosticsStorage !== storage) {
    writeSequenceRuntimeDiagnostics(bufferedDiagnosticsState, bufferedDiagnosticsStorage);
    bufferedDiagnosticsState = null;
  }
  const currentState =
    bufferedDiagnosticsStorage === storage && bufferedDiagnosticsState
      ? bufferedDiagnosticsState
      : loadPersistedSequenceRuntimeDiagnostics(storage)?.state;
  const nextState = pushSequenceRuntimeDiagnostic(currentState, entry);
  bufferedDiagnosticsState = nextState;
  bufferedDiagnosticsStorage = storage;
  if (pendingPersistenceTimer == null) {
    pendingPersistenceTimer =
      globalThis.setTimeout?.(() => {
        pendingPersistenceTimer = null;
        writeSequenceRuntimeDiagnostics(bufferedDiagnosticsState, bufferedDiagnosticsStorage);
      }, 0) ?? null;
  }
  return nextState;
}

export function flushPersistedSequenceRuntimeDiagnostics() {
  if (pendingPersistenceTimer != null) {
    globalThis.clearTimeout?.(pendingPersistenceTimer);
    pendingPersistenceTimer = null;
  }
  if (bufferedDiagnosticsState && bufferedDiagnosticsStorage) {
    writeSequenceRuntimeDiagnostics(bufferedDiagnosticsState, bufferedDiagnosticsStorage);
  }
  return bufferedDiagnosticsState;
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
    getPersisted: () => {
      flushPersistedSequenceRuntimeDiagnostics();
      return loadPersistedSequenceRuntimeDiagnostics();
    },
    getRebuildReport: () => {
      const state =
        flushPersistedSequenceRuntimeDiagnostics() ??
        loadPersistedSequenceRuntimeDiagnostics()?.state;
      return summarizeSequenceRuntimeDiagnostics(state).rebuilds;
    },
    reset: () => {
      const currentState =
        flushPersistedSequenceRuntimeDiagnostics() ??
        loadPersistedSequenceRuntimeDiagnostics()?.state;
      const nextState = resetSequenceRuntimeDiagnostics(currentState);
      persistSequenceRuntimeDiagnostics(nextState);
      return summarizeSequenceRuntimeDiagnostics(nextState);
    },
  };
}

installSequenceRuntimeDiagnosticsGlobal();
