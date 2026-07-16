// MIDI restore diagnostics track WebMIDI restore/reconnect and live input
// rebinding across reloads, wakeups, and dev restarts. Enable with
// `localStorage.hexatone_debug_midi_restore = "true"` or
// `?debugMidiRestore=1`.

function roundMetric(value, digits = 3) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function readMidiRestoreDiagnosticsFlag() {
  if (typeof globalThis === "undefined") return false;
  try {
    if (globalThis.localStorage?.getItem?.("hexatone_debug_midi_restore") === "true") {
      return true;
    }
    const search = String(globalThis.location?.search ?? "");
    return new URLSearchParams(search).get("debugMidiRestore") === "1";
  } catch {
    return false;
  }
}

export const MIDI_RESTORE_DIAGNOSTICS_STORAGE_KEY = "hexatone_midi_restore_diagnostics";

export function isMidiRestoreDiagnosticsEnabled() {
  return readMidiRestoreDiagnosticsFlag();
}

export function createMidiRestoreDiagnostics(limit = 200) {
  return {
    limit: Math.max(1, Math.round(Number(limit) || 200)),
    entries: [],
    nextId: 1,
  };
}

export function resetMidiRestoreDiagnostics(state, limit = null) {
  const nextLimit = limit == null
    ? Math.max(1, Math.round(Number(state?.limit) || 200))
    : Math.max(1, Math.round(Number(limit) || 200));
  return createMidiRestoreDiagnostics(nextLimit);
}

export function pushMidiRestoreDiagnostic(state, entry = {}) {
  const diagnostics = state ?? createMidiRestoreDiagnostics();
  const normalizedEntry = {
    id: diagnostics.nextId,
    type: String(entry.type || "event"),
    atMs: roundMetric(entry.atMs, 3),
    detail: entry.detail == null ? null : String(entry.detail),
    status: entry.status == null ? null : String(entry.status),
    device: entry.device == null ? null : String(entry.device),
    midiAccess: entry.midiAccess == null ? null : String(entry.midiAccess),
    sysex: entry.sysex == null ? null : !!entry.sysex,
    tick: Number.isFinite(Number(entry.tick)) ? Number(entry.tick) : null,
    listenerHealth: entry.listenerHealth == null ? null : String(entry.listenerHealth),
    inputId: entry.inputId == null ? null : String(entry.inputId),
    inputName: entry.inputName == null ? null : String(entry.inputName),
    outputId: entry.outputId == null ? null : String(entry.outputId),
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

export function summarizeMidiRestoreDiagnostics(state) {
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  return {
    entryCount: entries.length,
    recent: entries.slice(-30),
  };
}

export function persistMidiRestoreDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (!storage?.setItem) return;
  storage.setItem(
    MIDI_RESTORE_DIAGNOSTICS_STORAGE_KEY,
    JSON.stringify({
      state,
      summary: summarizeMidiRestoreDiagnostics(state),
    }),
  );
}

export function clearPersistedMidiRestoreDiagnostics(storage = globalThis?.sessionStorage) {
  if (!storage?.removeItem) return;
  storage.removeItem(MIDI_RESTORE_DIAGNOSTICS_STORAGE_KEY);
}

export function loadPersistedMidiRestoreDiagnostics(storage = globalThis?.sessionStorage) {
  if (!storage?.getItem) return null;
  const raw = storage.getItem(MIDI_RESTORE_DIAGNOSTICS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function appendPersistedMidiRestoreDiagnostic(entry, storage = globalThis?.sessionStorage) {
  if (!isMidiRestoreDiagnosticsEnabled()) return null;
  const persisted = loadPersistedMidiRestoreDiagnostics(storage);
  const nextState = pushMidiRestoreDiagnostic(persisted?.state, {
    atMs: performance.now(),
    ...entry,
  });
  persistMidiRestoreDiagnostics(nextState, storage);
  return nextState;
}

function installMidiRestoreDiagnosticsGlobal() {
  if (typeof globalThis === "undefined") return;
  if (!isMidiRestoreDiagnosticsEnabled()) {
    clearPersistedMidiRestoreDiagnostics();
    delete globalThis.__hexatoneMidiRestoreDiagnostics;
    return;
  }
  const existing = globalThis.__hexatoneMidiRestoreDiagnostics ?? {};
  globalThis.__hexatoneMidiRestoreDiagnostics = {
    ...existing,
    enabled: true,
    record: (entry) => (
      appendPersistedMidiRestoreDiagnostic(entry)
    ),
    getPersisted: () => loadPersistedMidiRestoreDiagnostics(),
    reset: () => {
      const nextState = resetMidiRestoreDiagnostics(loadPersistedMidiRestoreDiagnostics()?.state);
      persistMidiRestoreDiagnostics(nextState);
      return summarizeMidiRestoreDiagnostics(nextState);
    },
  };
}

installMidiRestoreDiagnosticsGlobal();
