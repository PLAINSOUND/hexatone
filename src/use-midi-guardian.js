/**
 * use-midi-guardian.js
 *
 * Always-active MIDI safety layer — independent of whether a hexatone (Keys
 * instance) is currently mounted. Owns two responsibilities:
 *
 *   1. beforeunload flush — sends CC123 on all configured output ports when
 *      the page is about to unload (refresh, close, navigate away). Fires
 *      synchronously in the browser's unload window, before React teardown.
 *
 *   2. Panic button — exposes a `panic()` function that sends CC123 + CC120
 *      on all output ports. Called by the All Notes Off button regardless of
 *      whether a Keys instance exists.
 *
 * CC123 (All Notes Off) — polite, lets release envelopes finish.
 * CC120 (All Sound Off) — hard cut, fallback for synths that ignore CC123.
 */

import { useEffect, useRef } from "preact/hooks";

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

    const send = (portId, channels) => {
      const port = m.outputs.get(portId);
      if (!port) return;
      for (const c of channels) {
        port.send([0xb0 + c, 123, 0]); // All Notes Off
        port.send([0xb0 + c, 120, 0]); // All Sound Off
      }
    };

    // MTS / single-note / direct output
    if (s.midi_device && s.midi_device !== "OFF") {
      send(s.midi_device, [s.midi_channel ?? 0]);
    }

    // FluidSynth mirror — skip if same port as midi_device (already covered)
    if (
      s.fluidsynth_device &&
      s.fluidsynth_device !== "OFF" &&
      s.fluidsynth_device !== s.midi_device
    ) {
      send(s.fluidsynth_device, [s.fluidsynth_channel ?? 0]);
    }

    // MPE output — all voice channels + manager
    if (s.output_mpe && s.mpe_device && s.mpe_device !== "OFF") {
      const channels = [];
      const manager = parseInt(s.mpe_manager_ch) - 1; // 0-indexed
      if (!isNaN(manager) && manager >= 0) channels.push(manager);
      for (let ch = s.mpe_lo_ch ?? 2; ch <= (s.mpe_hi_ch ?? 15); ch++) {
        channels.push(ch - 1); // 0-indexed
      }
      send(s.mpe_device, channels);
    }
  });

  // beforeunload: flush CC123 synchronously before the page tears down.
  useEffect(() => {
    const handler = () => panicRef.current();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []); // empty deps — handler is stable via ref

  return { panic: () => panicRef.current() };
}
