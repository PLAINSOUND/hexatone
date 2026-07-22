// Timed transport diagnostics live under debug/ so the runtime can keep the
// tooling available without paying for it during normal playback. Enable with
// `localStorage.hexatone_debug_timed_transport = "true"` or
// `?debugTimedTransport=1`.

function roundMetric(value, digits = 3) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function mean(values = []) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
  return total / values.length;
}

function rms(values = []) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const total = values.reduce((sum, value) => {
    const numeric = Number(value || 0);
    return sum + (numeric * numeric);
  }, 0);
  return Math.sqrt(total / values.length);
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
export const TIMED_TRANSPORT_DIAGNOSTICS_PERSIST_INTERVAL_MS = 2000;

let bufferedDiagnosticsState = null;
let bufferedDiagnosticsStorage = null;
let pendingPersistenceTimer = null;

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
    commitDurationMs: roundMetric(entry.commitDurationMs),
    frameIntervalMs: roundMetric(entry.frameIntervalMs),
    measurementDurationMs: roundMetric(entry.measurementDurationMs),
    queueDepth: Number.isFinite(Number(entry.queueDepth)) ? Number(entry.queueDepth) : null,
    timeoutCount: Number.isFinite(Number(entry.timeoutCount)) ? Number(entry.timeoutCount) : null,
    activeNotes: Number.isFinite(Number(entry.activeNotes)) ? Number(entry.activeNotes) : null,
    noteCount: Number.isFinite(Number(entry.noteCount)) ? Number(entry.noteCount) : null,
    nextPlaybackIndex: Number.isFinite(Number(entry.nextPlaybackIndex)) ? Number(entry.nextPlaybackIndex) : null,
    snapshotCount: Number.isFinite(Number(entry.snapshotCount)) ? Number(entry.snapshotCount) : null,
    eventCount: Number.isFinite(Number(entry.eventCount)) ? Number(entry.eventCount) : null,
    cueCount: Number.isFinite(Number(entry.cueCount)) ? Number(entry.cueCount) : null,
    snapshotRowCount: Number.isFinite(Number(entry.snapshotRowCount)) ? Number(entry.snapshotRowCount) : null,
    eventRowCount: Number.isFinite(Number(entry.eventRowCount)) ? Number(entry.eventRowCount) : null,
    structuralRowCount: Number.isFinite(Number(entry.structuralRowCount)) ? Number(entry.structuralRowCount) : null,
    rowCount: Number.isFinite(Number(entry.rowCount)) ? Number(entry.rowCount) : null,
    visibleRowCount: Number.isFinite(Number(entry.visibleRowCount)) ? Number(entry.visibleRowCount) : null,
    mountedNodeCount: Number.isFinite(Number(entry.mountedNodeCount)) ? Number(entry.mountedNodeCount) : null,
    scrollTop: roundMetric(entry.scrollTop),
    runtimeInstanceId: Number.isFinite(Number(entry.runtimeInstanceId)) ? Number(entry.runtimeInstanceId) : null,
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
    .filter((entry) => entry?.latenessMs != null)
    .map((entry) => Number(entry?.latenessMs))
    .filter((value) => Number.isFinite(value));
  const meanLatenessMs = mean(latenessSamples);
  const rmsLatenessMs = rms(latenessSamples);
  const meanAbsoluteLatenessMs = mean(latenessSamples.map((value) => Math.abs(value)));
  const maxLatenessMs = latenessSamples.length > 0 ? Math.max(...latenessSamples) : null;
  const overrunCount = latenessSamples.filter((value) => value > 25).length;
  const fireEntries = entries.filter((entry) => (
    entry?.type === "fire"
    && entry?.clockSeconds != null
    && entry?.elapsedSeconds != null
    && Number.isFinite(Number(entry.clockSeconds))
    && Number.isFinite(Number(entry.elapsedSeconds))
  ));
  const intervalJitterSamples = [];
  for (let index = 1; index < fireEntries.length; index += 1) {
    const previous = fireEntries[index - 1];
    const current = fireEntries[index];
    const actualDeltaMs = (Number(current.clockSeconds) - Number(previous.clockSeconds)) * 1000;
    const expectedDeltaMs = (Number(current.elapsedSeconds) - Number(previous.elapsedSeconds)) * 1000;
    intervalJitterSamples.push(actualDeltaMs - expectedDeltaMs);
  }
  const meanIntervalJitterMs = mean(intervalJitterSamples);
  const rmsIntervalJitterMs = rms(intervalJitterSamples);
  const meanAbsoluteIntervalJitterMs = mean(intervalJitterSamples.map((value) => Math.abs(value)));
  const maxAbsoluteIntervalJitterMs = intervalJitterSamples.length > 0
    ? Math.max(...intervalJitterSamples.map((value) => Math.abs(value)))
    : null;
  const uiEntries = entries.filter((entry) => entry?.type === "ui-commit" || entry?.type === "ui-frame-sample");
  const commitDurationSamples = uiEntries
    .filter((entry) => entry?.commitDurationMs != null)
    .map((entry) => Number(entry?.commitDurationMs))
    .filter((value) => Number.isFinite(value));
  const frameIntervalSamples = uiEntries
    .filter((entry) => entry?.frameIntervalMs != null)
    .map((entry) => Number(entry?.frameIntervalMs))
    .filter((value) => Number.isFinite(value));
  const measurementDurationSamples = uiEntries
    .filter((entry) => entry?.measurementDurationMs != null)
    .map((entry) => Number(entry?.measurementDurationMs))
    .filter((value) => Number.isFinite(value));
  const maximumMetric = (key) => {
    const values = uiEntries
      .filter((entry) => entry?.[key] != null)
      .map((entry) => Number(entry[key]))
      .filter((value) => Number.isFinite(value));
    return values.length > 0 ? Math.max(...values) : null;
  };
  const runtimeRebuildCount = entries.filter((entry) => entry?.type === "runtime-rebuild").length;
  return {
    entryCount: entries.length,
    latenessSampleCount: latenessSamples.length,
    overrunCount,
    meanLatenessMs: roundMetric(meanLatenessMs),
    meanAbsoluteLatenessMs: roundMetric(meanAbsoluteLatenessMs),
    rmsLatenessMs: roundMetric(rmsLatenessMs),
    maxLatenessMs: roundMetric(maxLatenessMs),
    intervalJitterSampleCount: intervalJitterSamples.length,
    meanIntervalJitterMs: roundMetric(meanIntervalJitterMs),
    meanAbsoluteIntervalJitterMs: roundMetric(meanAbsoluteIntervalJitterMs),
    rmsIntervalJitterMs: roundMetric(rmsIntervalJitterMs),
    maxAbsoluteIntervalJitterMs: roundMetric(maxAbsoluteIntervalJitterMs),
    ui: {
      sampleCount: uiEntries.length,
      commitSampleCount: commitDurationSamples.length,
      frameSampleCount: frameIntervalSamples.length,
      longFrameCount: frameIntervalSamples.filter((value) => value >= 50).length,
      meanCommitDurationMs: roundMetric(mean(commitDurationSamples)),
      maxCommitDurationMs: roundMetric(commitDurationSamples.length > 0 ? Math.max(...commitDurationSamples) : null),
      meanFrameIntervalMs: roundMetric(mean(frameIntervalSamples)),
      maxFrameIntervalMs: roundMetric(frameIntervalSamples.length > 0 ? Math.max(...frameIntervalSamples) : null),
      meanMeasurementDurationMs: roundMetric(mean(measurementDurationSamples)),
      maxMeasurementDurationMs: roundMetric(measurementDurationSamples.length > 0 ? Math.max(...measurementDurationSamples) : null),
      maxSnapshotRowCount: maximumMetric("snapshotRowCount"),
      maxEventRowCount: maximumMetric("eventRowCount"),
      maxStructuralRowCount: maximumMetric("structuralRowCount"),
      maxRowCount: maximumMetric("rowCount"),
      maxVisibleRowCount: maximumMetric("visibleRowCount"),
      maxMountedNodeCount: maximumMetric("mountedNodeCount"),
      recent: uiEntries.slice(-20),
    },
    runtimeRebuildCount,
    recent: entries.slice(-20),
  };
}

function writeTimedTransportDiagnostics(state, storage) {
  if (!storage?.setItem) return;
  storage.setItem(
    TIMED_TRANSPORT_DIAGNOSTICS_STORAGE_KEY,
    JSON.stringify({
      state,
      summary: summarizeTimedTransportDiagnostics(state),
    }),
  );
}

function clearPendingTimedTransportPersistence() {
  if (pendingPersistenceTimer != null && typeof globalThis.clearTimeout === "function") {
    globalThis.clearTimeout(pendingPersistenceTimer);
  }
  pendingPersistenceTimer = null;
}

export function persistTimedTransportDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (bufferedDiagnosticsStorage === storage) {
    clearPendingTimedTransportPersistence();
    bufferedDiagnosticsState = null;
    bufferedDiagnosticsStorage = null;
  }
  writeTimedTransportDiagnostics(state, storage);
}

export function flushPersistedTimedTransportDiagnostics() {
  clearPendingTimedTransportPersistence();
  const state = bufferedDiagnosticsState;
  const storage = bufferedDiagnosticsStorage;
  bufferedDiagnosticsState = null;
  bufferedDiagnosticsStorage = null;
  if (state && storage) writeTimedTransportDiagnostics(state, storage);
  return state;
}

export function bufferTimedTransportDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (!storage?.setItem) return state;
  if (bufferedDiagnosticsStorage && bufferedDiagnosticsStorage !== storage) {
    flushPersistedTimedTransportDiagnostics();
  }
  bufferedDiagnosticsState = state;
  bufferedDiagnosticsStorage = storage;
  if (pendingPersistenceTimer == null && typeof globalThis.setTimeout === "function") {
    pendingPersistenceTimer = globalThis.setTimeout(() => {
      flushPersistedTimedTransportDiagnostics();
    }, TIMED_TRANSPORT_DIAGNOSTICS_PERSIST_INTERVAL_MS);
  }
  return state;
}

export function loadPersistedTimedTransportDiagnostics(storage = globalThis?.sessionStorage) {
  if (bufferedDiagnosticsStorage === storage && bufferedDiagnosticsState) {
    return {
      state: bufferedDiagnosticsState,
      summary: summarizeTimedTransportDiagnostics(bufferedDiagnosticsState),
    };
  }
  if (!storage?.getItem) return null;
  const raw = storage.getItem(TIMED_TRANSPORT_DIAGNOSTICS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPersistedTimedTransportDiagnostics(storage = globalThis?.sessionStorage) {
  if (!storage?.removeItem) return;
  if (bufferedDiagnosticsStorage === storage) {
    clearPendingTimedTransportPersistence();
    bufferedDiagnosticsState = null;
    bufferedDiagnosticsStorage = null;
  }
  storage.removeItem(TIMED_TRANSPORT_DIAGNOSTICS_STORAGE_KEY);
}

export function appendPersistedTimedTransportDiagnostic(entry, storage = globalThis?.sessionStorage) {
  if (!isTimedTransportDiagnosticsEnabled()) return null;
  const currentState = bufferedDiagnosticsStorage === storage && bufferedDiagnosticsState
    ? bufferedDiagnosticsState
    : loadPersistedTimedTransportDiagnostics(storage)?.state;
  const nextState = pushTimedTransportDiagnostic(currentState, entry);
  bufferTimedTransportDiagnostics(nextState, storage);
  return nextState;
}

function installTimedTransportDiagnosticsGlobal() {
  if (typeof globalThis === "undefined") return;
  if (!isTimedTransportDiagnosticsEnabled()) {
    clearPersistedTimedTransportDiagnostics();
    delete globalThis.__hexatoneTimedTransportDiagnostics;
    return;
  }
  globalThis.__hexatoneTimedTransportDiagnostics = {
    enabled: true,
    record: (entry) => appendPersistedTimedTransportDiagnostic(entry),
    getPersisted: () => {
      flushPersistedTimedTransportDiagnostics();
      return loadPersistedTimedTransportDiagnostics();
    },
    reset: () => {
      clearPersistedTimedTransportDiagnostics();
      return null;
    },
  };
}

installTimedTransportDiagnosticsGlobal();

if (isTimedTransportDiagnosticsEnabled() && typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("pagehide", flushPersistedTimedTransportDiagnostics);
}
