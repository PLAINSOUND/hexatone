/**
 * Owned-output teardown shared by synth wiring and its backend caches.
 * Ordinary replacement releases owned voices, never calls a MIDI-wide panic.
 * Sample tails are retained by wiring during a sound switch; clearing the whole
 * graph explicitly silences those local, retired sample instances as before.
 * Cache-key decisions and asynchronous construction remain in use-synth-wiring.
 */
export function releaseSynthInstance(synth) {
  if (typeof synth?.shutdown === "function") synth.shutdown();
  else if (typeof synth?.releaseAll === "function") synth.releaseAll();
}

export function clearOutputSynthRefs({ activeRefs, mtsRef, retiringSamplesRef }) {
  for (const synth of retiringSamplesRef.current) synth.allSoundOff?.();
  retiringSamplesRef.current.clear();
  for (const ref of activeRefs) {
    releaseSynthInstance(ref.current.synth);
    ref.current = { key: null, synth: null };
  }
  for (const synth of mtsRef.current.values()) releaseSynthInstance(synth);
  mtsRef.current.clear();
}
