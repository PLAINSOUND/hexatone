/**
 * Owned-output teardown shared by synth wiring and its backend caches.
 * Ordinary replacement releases owned voices, never calls a MIDI-wide panic.
 * Sample tails are retained by wiring during a sound switch; clearing the whole
 * graph explicitly silences those local, retired sample instances as before.
 * Cache-key decisions and asynchronous construction remain in use-synth-wiring.
 */
// Teardown is synchronous. Attempt every action before reporting failures; callers
// decide whether to propagate the aggregate or log it and continue recovery.
export function runOutputCleanup(actions) {
  const errors = [];
  for (const action of actions) {
    try { action(); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Output cleanup failed");
}

export function releaseSynthInstance(synth, options) {
  if (typeof synth?.shutdown === "function") {
    if (options === undefined) synth.shutdown();
    else synth.shutdown(options);
  }
  else if (typeof synth?.releaseAll === "function") synth.releaseAll();
}

// Detach ownership before invoking a backend: a second cleanup must not release
// the same instance again, including when its teardown throws.
export function clearOutputRef(ref, options) {
  const synth = ref.current.synth;
  ref.current = { key: null, synth: null };
  releaseSynthInstance(synth, options);
}

export function pruneOutputMap(ref, retainedKeys = new Set()) {
  const actions = [];
  for (const [key, synth] of ref.current) {
    if (retainedKeys.has(key)) continue;
    ref.current.delete(key);
    actions.push(() => releaseSynthInstance(synth));
  }
  runOutputCleanup(actions);
}

export function adoptSampleOutput(ref, retiredRef, key, synth) {
  const previous = ref.current.synth;
  if (previous && previous !== synth) retiredRef.current.add(previous);
  retiredRef.current.delete(synth);
  for (const retired of retiredRef.current) {
    if (retired.hasVoices?.() === false) retiredRef.current.delete(retired);
  }
  ref.current = { key, synth };
}

export function clearSampleOutputs(ref, retiredRef) {
  const retired = [...retiredRef.current];
  retiredRef.current.clear();
  runOutputCleanup([
    ...retired.map(synth => () => releaseSynthInstance(synth)),
    () => clearOutputRef(ref),
  ]);
}

// A stale composite may still reference a shut-down backend until a replacement
// finishes loading. Preserve the logical note, but never allocate a new output
// voice on that closed engine. Reconciliation will attach its live replacement.
export function silentOutputHex(coords, cents) {
  return {
    coords, cents, release: false,
    noteOn() {},
    noteOff() { this.release = true; },
    retune(value) { this.cents = value; },
  };
}

export function clearOutputSynthRefs({ activeRefs, mtsRef, retiringSamplesRef }) {
  const retired = [...retiringSamplesRef.current];
  retiringSamplesRef.current.clear();
  runOutputCleanup([
    ...retired.map(synth => () => synth.allSoundOff?.()),
    ...activeRefs.map(ref => () => clearOutputRef(ref)),
    () => pruneOutputMap(mtsRef),
  ]);
}
