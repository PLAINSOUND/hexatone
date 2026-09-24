/** Bounded, opt-in reload counters; synchronous checkpoints survive timer starvation.
 * No MIDI payloads, setting values, DOM snapshots or continuous stack collection.
 */
export const RELOAD_DIAGNOSTICS_KEY = "hexatone_reload_diagnostics";
export const RELOAD_DIAGNOSTICS_PREVIOUS_KEY = `${RELOAD_DIAGNOSTICS_KEY}_previous`;
let state;
const enabled = (() => {
  try {
    return localStorage.getItem("hexatone_debug_reload") === "true";
  } catch {
    return false;
  }
})();

export function recordReloadDiagnostic(kind, detail = null) {
  if (!enabled) return;
  try {
    if (!state) {
      const previous = sessionStorage.getItem(RELOAD_DIAGNOSTICS_KEY);
      if (previous) sessionStorage.setItem(RELOAD_DIAGNOSTICS_PREVIOUS_KEY, previous);
      state = { startedAt: new Date().toISOString(), total: 0, counts: {}, recent: [] };
    }
    state.total += 1;
    state.counts[kind] = (state.counts[kind] ?? 0) + 1;
    if (kind !== "app-render") {
      state.recent.push({ kind, atMs: Math.round(performance.now()), detail });
      if (state.recent.length > 12) state.recent.shift();
    }
    // Checkpoint early startup, then at bounded intervals without a timer.
    if (state.total <= 10 || state.total % 50 === 0) {
      sessionStorage.setItem(RELOAD_DIAGNOSTICS_KEY, JSON.stringify(state));
    }
  } catch {
    // Diagnostics must never interfere with the musical application.
  }
}
