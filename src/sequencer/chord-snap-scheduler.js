// Background preparation never changes a sounding formation. Playback reads
// ready decisions only; runtime-pitch-map locks its fallback for that formation.
import { chooseChordSteps, clampChordDrift, chordSearchWithinBudget } from "./chord-snap.js";

export const CHORD_QUEUE_LIMIT = 32;
export const CHORD_CACHE_LIMIT = 128;
export const CHORD_JOB_TIMEOUT_MS = 250;

export function chordPrefetchIndices(length, position) {
  const start = Math.max(0, Math.min(length - 1, Number(position) || 0));
  // Current, eight forward snapshots, then two backward. No whole-score scan.
  return [start, ...Array.from({ length: 8 }, (_, i) => start + i + 1), start - 1, start - 2]
    .filter(index => index >= 0 && index < length);
}

export function createChordSnapScheduler({
  createWorker = () => new Worker(new URL("./chord-snap-worker.js", import.meta.url), { type: "module" }),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let worker = null;
  let disabled = false;
  let disposed = false;
  let active = null;
  let nextId = 0;
  let context = null;
  let source = null;
  const queue = new Map();
  const cache = new Map();
  const keyFor = (pitches, runtime, drift, held) => JSON.stringify([
    runtime.scale, runtime.equivInterval ?? 1200, pitches, drift, held,
  ]);
  const stopWorker = () => {
    if (active) clearTimer(active.timer);
    active = null;
    worker?.terminate();
    worker = null;
  };
  const fail = () => {
    disabled = true;
    stopWorker();
    queue.clear();
  };
  const pump = () => {
    if (disposed || disabled || active || !queue.size) return;
    try {
      if (!worker) {
        worker = createWorker();
        const owner = worker;
        worker.onerror = () => { if (worker === owner) fail(); };
        worker.onmessageerror = () => { if (worker === owner) fail(); };
        worker.onmessage = ({ data }) => {
          if (worker !== owner || !active || data?.id !== active.id) return;
          const job = active;
          clearTimer(job.timer);
          active = null;
          if (Array.isArray(data.steps) && data.steps.length === job.pitches.length &&
              data.steps.every(Number.isInteger)) {
            if (cache.size >= CHORD_CACHE_LIMIT) cache.delete(cache.keys().next().value);
            cache.set(job.key, Object.freeze([...data.steps]));
          }
          // A malformed response is a failed worker, not an unbounded retry.
          else { fail(); return; }
          pump();
        };
      }
      const [key, job] = queue.entries().next().value;
      queue.delete(key);
      active = { ...job, key, id: ++nextId, timer: setTimer(fail, CHORD_JOB_TIMEOUT_MS) };
      worker.postMessage({ id: active.id, ...job });
    } catch { fail(); }
  };
  const prepare = (pitches, runtime, drift, held = [], urgent = false) => {
    drift = clampChordDrift(drift);
    if (disposed || disabled || !chordSearchWithinBudget(pitches.length, runtime.scale.length, drift)) return null;
    const key = keyFor(pitches, runtime, drift, held);
    if (cache.has(key)) {
      const result = cache.get(key);
      cache.delete(key);
      cache.set(key, result);
      return result;
    }
    if (active?.key === key) return null;
    if (urgent) queue.delete(key);
    if (!queue.has(key)) {
      const job = { pitches: [...pitches], runtime: { scale: [...runtime.scale], equivInterval: runtime.equivInterval ?? 1200 },
        drift, held: [...held] };
      if (urgent) {
        const pending = [...queue.entries()];
        queue.clear();
        queue.set(key, job);
        for (const [queuedKey, queuedJob] of pending.slice(0, CHORD_QUEUE_LIMIT - 1)) queue.set(queuedKey, queuedJob);
      } else {
        if (queue.size >= CHORD_QUEUE_LIMIT) return null;
        queue.set(key, job);
      }
    }
    pump();
    return cache.get(key) ?? null;
  };
  return {
    prepare,
    read(pitches, runtime, drift, held = []) {
      if (!chordSearchWithinBudget(pitches.length, runtime.scale.length, drift)) return null;
      return cache.get(keyFor(pitches, runtime, clampChordDrift(drift), held)) ?? null;
    },
    choose(pitches, runtime, drift, held) {
      // No cold search on the UI/audio scheduling path.
      return prepare(pitches, runtime, drift, held, true) ?? chooseChordSteps(pitches, runtime, 0);
    },
    setContext(key, nextSource = null) {
      if (key === context && nextSource === source) return;
      context = key;
      source = nextSource;
      stopWorker();
      queue.clear();
      cache.clear();
      // A changed tuning/option permits a fresh attempt after worker failure.
      disabled = false;
    },
    dispose() { disposed = true; stopWorker(); queue.clear(); cache.clear(); },
    stats() { return { cached: cache.size, queued: queue.size, active: !!active, disabled, disposed }; },
  };
}
