/**
 * src/hooks/use-midi-guardian.js
 *
 * Always-active MIDI safety layer — independent of whether a hexatone (Keys
 * instance) is currently mounted. Owns two responsibilities:
 *
 *   1. beforeunload flush — sends CC123 + CC120 on the routes listed below when
 *      the page is about to unload (refresh, close, navigate away). Fires
 *      synchronously in the browser's unload window, before React teardown.
 *
 *   2. Panic button — exposes a `panic()` function that sends CC123 + CC120
 *      on the same routes. Called by the All Notes Off button regardless of
 *      whether a Keys instance exists.
 *
 * midi/output-targets.js enumerates enabled mono, MTS, bulk and MPE routes.
 * Unload deliberately retains hard-panic behaviour as a best-effort fallback;
 * routine backend replacement instead releases only owned notes.
 *
 * CC123 (All Notes Off) — polite, lets release envelopes finish.
 * CC120 (All Sound Off) — hard cut, fallback for synths that ignore CC123.
 */

import { useEffect, useRef } from "preact/hooks";
import { midiOutputTargets } from "../midi/output-targets.js";

export function useMidiGuardian(midi, settings) {
  // Keep refs so the panic function is stable (never reconstructed) but always
  // reads the latest midi/settings without needing useCallback deps.
  const midiRef = useRef(midi);
  const settingsRef = useRef(settings);
  midiRef.current = midi;
  settingsRef.current = settings;

  // Stable function — created once, reads current values via refs.
  const panicRef = useRef(() => {
    const m = midiRef.current;
    const s = settingsRef.current;
    if (!m) return;

    for (const { portId, channel } of midiOutputTargets(s)) {
      const port = m.outputs.get(portId);
      if (!port) continue;
      for (const cc of [123, 120]) {
        try {
          port.send([0xb0 + channel, cc, 0]);
        } catch {
          // A disconnected route must not prevent recovery on the others.
        }
      }
    }
  });

  // beforeunload: use the same CC123 + CC120 panic before the page tears down.
  useEffect(() => {
    const handler = () => panicRef.current();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []); // empty deps — handler is stable via ref

  return { panic: () => panicRef.current() };
}
