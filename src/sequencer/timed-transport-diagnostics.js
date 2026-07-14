// Timed transport diagnostics capture lightweight scheduling telemetry so
// intermittent playback overruns can be inspected after the fact.

function roundMetric(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
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
    queueDepth: Number.isFinite(Number(entry.queueDepth)) ? Number(entry.queueDepth) : null,
    activeNotes: Number.isFinite(Number(entry.activeNotes)) ? Number(entry.activeNotes) : null,
    noteCount: Number.isFinite(Number(entry.noteCount)) ? Number(entry.noteCount) : null,
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
