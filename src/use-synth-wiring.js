import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { enableMidi } from "./settings/midi/midiin";
import { create_sample_synth } from "./sample_synth";
import { create_midi_synth } from "./midi_synth";
import create_mpe_synth from "./mpe_synth";
import { create_composite_synth } from "./composite_synth";
import { create_osc_synth } from "./osc_synth";
import { detectController } from "./controllers/registry.js";
import { saveAnchorFromLearn, loadAnchorSettingsUpdate } from "./input/controller-anchor.js";
import { WebMidi } from "webmidi";
import { scalaToCents } from "./settings/scale/parse-scale.js";
import {
  computeNaturalAnchor,
  computeCenterPitchHz,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
  degree0ToRef,
  resolveBulkDumpName,
} from "./keyboard/mts-helpers.js";

// Functional updaters for the loading counter. Using a counter (not a boolean)
// lets multiple async operations overlap without prematurely hiding the spinner.
const wait   = (l) => l + 1;
const signal = (l) => l - 1;

export const deriveTuningRuntime = (settings) => {
  if (!settings.scale || !Array.isArray(settings.scale) || settings.scale.length === 0) {
    return null;
  }

  const scaleAsCents = settings.scale.map((value) => scalaToCents(String(value)));
  const equivInterval = scaleAsCents[scaleAsCents.length - 1];
  const scale = [0, ...scaleAsCents.slice(0, -1)];
  const degree0toRefAsArray = degree0ToRef(settings.reference_degree, scale);

  return {
    scale,
    equivInterval,
    degree0toRefAsArray,
    name: settings.name,
    fundamental: settings.fundamental,
  };
};

export const deriveOutputRuntime = (settings, midi, tuningRuntime) => {
  const outputs = [];
  const midiVelocity = settings.midi_velocity;

  if (
    settings.output_mts &&
    midi &&
    settings.midi_device !== "OFF" &&
    settings.midi_channel >= 0 &&
    settings.midi_mapping &&
    settings.midi_mapping !== "DIRECT" &&
    typeof midiVelocity === "number"
  ) {
    outputs.push({
      family: "mts",
      allocationMode: settings.midi_mapping === "MTS2" ? "mts2" : "mts1",
      transportMode: "single_note_realtime",
      output: midi.outputs.get(settings.midi_device),
      channel: settings.midi_channel,
      velocity: midiVelocity,
      deviceId: settings.device_id ?? 127,
      mapNumber: settings.tuning_map_number ?? 0,
      anchorNote: settings.midiin_central_degree,
      sysexType: settings.sysex_type,
    });
  }

  const fluidsynthOutputObj = midi && settings.fluidsynth_device
    ? midi.outputs.get(settings.fluidsynth_device) : null;
  const mtsPortIsFluidsynth = fluidsynthOutputObj &&
    settings.midi_device === settings.fluidsynth_device;
  if (
    settings.output_mts &&
    fluidsynthOutputObj &&
    !mtsPortIsFluidsynth &&
    settings.fluidsynth_channel >= 0 &&
    typeof midiVelocity === "number"
  ) {
    outputs.push({
      family: "mts",
      allocationMode: settings.midi_mapping === "MTS2" ? "mts2" : "mts1",
      transportMode: "single_note_realtime",
      output: fluidsynthOutputObj,
      channel: settings.fluidsynth_channel,
      velocity: midiVelocity,
      deviceId: settings.device_id ?? 127,
      mapNumber: settings.tuning_map_number ?? 0,
      anchorNote: settings.midiin_central_degree,
      sysexType: settings.sysex_type,
    });
  }

  if (
    settings.output_direct &&
    midi &&
    settings.direct_device &&
    settings.direct_device !== "OFF" &&
    settings.direct_channel >= 0 &&
    typeof midiVelocity === "number" &&
    tuningRuntime
  ) {
    const isStaticMode = settings.direct_mode === "static";
    const directAnchor = isStaticMode
      ? computeStaticMapDegree0(
        chooseStaticMapCenterMidi(
          computeCenterPitchHz(
            tuningRuntime.fundamental,
            tuningRuntime.degree0toRefAsArray[0],
            tuningRuntime.scale,
            tuningRuntime.equivInterval,
            settings.center_degree,
          ),
        ),
        settings.center_degree,
      )
      : computeNaturalAnchor(
        tuningRuntime.fundamental,
        tuningRuntime.degree0toRefAsArray[0],
        tuningRuntime.scale,
        tuningRuntime.equivInterval,
        settings.center_degree,
      );
    outputs.push({
      family: "mts",
      allocationMode: isStaticMode ? "static_map" : "mts1",
      transportMode: isStaticMode ? "bulk_static_map" : "bulk_dynamic_map",
      output: midi.outputs.get(settings.direct_device),
      channel: settings.direct_channel,
      velocity: midiVelocity,
      deviceId: settings.direct_device_id ?? 127,
      mapNumber: settings.direct_tuning_map_number ?? 0,
      mapName: resolveBulkDumpName(
        settings.direct_tuning_map_name,
        settings.short_description,
        settings.name,
      ),
      anchorNote: directAnchor,
      sysexType: 126,
    });
  }

  return {
    outputs,
    fluidsynthOutputObj,
    mtsPortIsFluidsynth,
  };
};

/**
 * Manages all synth and MIDI lifecycle for the app:
 *   - Web MIDI initialisation and device-change tracking
 *   - Synth creation/teardown whenever settings or MIDI state changes
 *   - Octave-shift helpers
 *   - Volume control and anchor-note learning
 *   - Imperative propagation of fundamental changes to the live Keys canvas
 *
 * @param {object}   settings          - Current app settings
 * @param {function} setSettings       - Settings updater (used by onAnchorLearn)
 * @param {object}   options
 * @param {boolean}  options.ready             - True once the app is initialised
 * @param {boolean}  options.userHasInteracted - True after the first user gesture
 * @param {object}   options.keysRef           - Ref to the live Keys canvas instance
 * @param {object}   options.synthRef          - Ref kept in sync with the live synth
 *
 * @returns {{ synth, midi, midiTick, loading, midiLearnActive, setMidiLearnActive,
 *             octaveTranspose, octaveDeferred,
 *             shiftOctave, toggleOctaveDeferred,
 *             onVolumeChange, onAnchorLearn }}
 */
const useSynthWiring = (
  settings,
  setSettings,
  { ready, userHasInteracted, keysRef, synthRef, setAnchorLearnWarning },
) => {
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const [synth,           setSynth]           = useState(null);
  const [midi,            setMidi]            = useState(null);
  const [midiLearnActive, setMidiLearnActive] = useState(false);
  // Incremented on every MIDI onstatechange so dependent effects re-run when
  // devices connect or disconnect (e.g. FluidSynth starting after page load).
  const [midiTick,        setMidiTick]        = useState(0);
  // Counter so multiple overlapping async operations don't prematurely hide
  // the loading spinner (see wait / signal helpers above).
  const [loading,         setLoading]         = useState(0);
  const [octaveTranspose, setOctaveTranspose] = useState(0);
  const [octaveDeferred,  setOctaveDeferred]  = useState(
    () => sessionStorage.getItem("octave_deferred") === "true",
  );

  // ── MIDI access ─────────────────────────────────────────────────────────────

  useEffect(() => {
    // webmidi.js library init (used for device name helpers only)
    enableMidi().catch((err) =>
      console.warn("WebMidi could not initialise:", err),
    );

    if (navigator.requestMIDIAccess) {
      setLoading(wait);
      navigator.requestMIDIAccess({ sysex: true }).then((m) => {
        setLoading(signal);
        console.log("Web MIDI API with sysex for MTS messages is ready!");
        setMidi(m);
        // Re-render UI and re-run synth creation whenever MIDI devices change.
        m.onstatechange = () => setMidiTick((t) => t + 1);
      }, () => {
        // Must decrement loading even on failure — on iOS, requestMIDIAccess with
        // sysex:true is rejected (no sysex support without MIDIWeb). Without this
        // setLoading(signal) the counter stays at 1 and the spinner never clears.
        setLoading(signal);
        console.log("Web MIDI API could not initialise!");
      });
    }
  }, []);

  // ── Reconstruction boundary contract ────────────────────────────────────────
  //
  // This block documents which settings changes trigger which kind of update.
  // It is the single source of truth for reactivity decisions in this file.
  // Before adding a new setting to ANY dependency array below, classify it here.
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ FULL SYNTH REBUILD                                                      │
  // │ Tears down and recreates all active output engines via Promise.all.     │
  // │ Controlled by the main useEffect dependency array (lines below).        │
  // │                                                                         │
  // │  Tuning/pitch (all outputs depend on these):                            │
  // │    instrument          — sample buffers must be reloaded                │
  // │    fundamental         — root pitch changes all MTS calculations        │
  // │    reference_degree    — changes offset between scale degree 0 and ref  │
  // │    center_degree       — changes static bulk map anchor calculation      │
  // │    scale               — changes all per-note pitch values              │
  // │                                                                         │
  // │  MTS real-time output:                                                  │
  // │    output_mts          — enable/disable the real-time MTS engine        │
  // │    midi_device         — output port changes require new synth object   │
  // │    midi_channel        — channel is baked into the synth at creation    │
  // │    midi_mapping        — MTS1 vs MTS2 allocation mode                  │
  // │    midi_velocity       — velocity is baked into the output config       │
  // │    device_id           — MTS sysex device ID (broadcast vs addressed)   │
  // │    tuning_map_number   — MTS map slot to write                          │
  // │    sysex_type          — sysex type byte (126 vs 127)                   │
  // │    fluidsynth_device   — FluidSynth mirror port                         │
  // │    fluidsynth_channel  — FluidSynth mirror channel                      │
  // │                                                                         │
  // │  MTS bulk dump output:                                                  │
  // │    output_direct       — enable/disable the bulk dump engine            │
  // │    direct_device       — output port (new port = new synth object)      │
  // │    direct_mode         — dynamic vs static changes allocation strategy  │
  // │    direct_channel      — MIDI channel for note-on after bulk dump       │
  // │    direct_device_id    — device ID in bulk dump sysex header            │
  // │    direct_tuning_map_number — map slot in bulk dump header              │
  // │    direct_tuning_map_name   — map name string in bulk dump payload      │
  // │                                                                         │
  // │  MPE output:                                                            │
  // │    output_mpe          — enable/disable MPE engine                      │
  // │    mpe_device          — output port                                    │
  // │    mpe_manager_ch      — MPE zone manager channel                       │
  // │    mpe_lo_ch           — first member channel                           │
  // │    mpe_hi_ch           — last member channel                            │
  // │    mpe_pitchbend_range — pitch bend range baked at MPE init             │
  // │    mpe_mode            — Ableton workaround vs standard MPE             │
  // │                                                                         │
  // │  OSC output:                                                            │
  // │    output_osc          — enable/disable OSC WebSocket bridge            │
  // │                                                                         │
  // │  MIDI state:                                                            │
  // │    midi                — MIDI access object (initial grant or revoke)   │
  // │    midiTick            — incremented on every device connect/disconnect │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ CANVAS-ONLY UPDATE (no synth rebuild)                                   │
  // │ Imperative call to keysRef.current — bypasses React render.             │
  // │                                                                         │
  // │    fundamental         → keysRef.current.updateFundamental()            │
  // │                          Redraws note labels on the hex grid.           │
  // │    note_colors         → handled in use-settings-change.js              │
  // │    spectrum_colors     → handled in use-settings-change.js              │
  // │    fundamental_color   → handled in use-settings-change.js              │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ AUTO-SEND TRIGGER (no synth rebuild, no canvas redraw)                  │
  // │ RAF-debounced call to keysRef.current.mtsSendMap().                     │
  // │ Only fires when output_direct + direct_mode=static + direct_sysex_auto. │
  // │                                                                         │
  // │    direct_sysex_auto       — turning auto-send on should send now       │
  // │    direct_device           — port change should resend                  │
  // │    direct_device_id        — header param change should resend          │
  // │    direct_tuning_map_number — header param change should resend         │
  // │    direct_tuning_map_name  — header param change should resend          │
  // │    center_degree           — map anchor changed, resend                 │
  // │    reference_degree        — pitch context changed, resend              │
  // │    scale                   — pitch content changed, resend              │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ NO REBUILD NEEDED                                                       │
  // │ Used per-note at play time; not baked into synth construction.          │
  // │                                                                         │
  // │    key_labels          — canvas label mode (handled in keys.js)         │
  // │    retuning_mode       — transpose vs recalculate (keys.js per-note)    │
  // │    wheel_to_recent     — modwheel routing (keys.js per-event)           │
  // │    midi_wheel_range    — wheel pitch range (keys.js per-event)          │
  // │    wheel_scale_aware   — wheel snap mode (keys.js per-event)            │
  // │    midiin_central_degree — anchor for incoming MIDI (keys.js)           │
  // │    midiin_channel      — input filter (keys.js)                         │
  // │    midi_passthrough    — MIDI pass-through flag (keys.js)               │
  // │    lumatone_led_sync   — LED feedback toggle (keys.js)                  │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ── Synth creation ───────────────────────────────────────────────────────────
  // Reconstructs the composite synth whenever any relevant setting or MIDI
  // state changes. Runs only after the app is ready (setReady has fired).

  useEffect(() => {
    if (!ready) return;

    // Guard against stale async resolutions: if this effect re-runs (settings
    // changed again before the previous Promise.all resolved), the old chain
    // should not call setSynth. Without this, rapid toggles can leave the synth
    // in a stale configuration — e.g. toggling MPE on then sample off could end
    // up with a composite(sample+mpe) synth if the first Promise.all resolved last.
    let cancelled = false;

    const wantSample =
      settings.output_sample &&
      settings.instrument &&
      settings.instrument !== "OFF" &&
      settings.fundamental;

    const tuningRuntime = deriveTuningRuntime(settings);
    const outputRuntime = deriveOutputRuntime(settings, midi, tuningRuntime);
    const mtsOutputs = outputRuntime.outputs.filter((o) => o.family === "mts");
    const wantMts = mtsOutputs.some((o) => o.transportMode === "single_note_realtime");
    const wantDirect = mtsOutputs.some((o) =>
      o.transportMode === "bulk_dynamic_map" || o.transportMode === "bulk_static_map");

    const wantMpe =
      settings.output_mpe &&
      midi &&
      settings.mpe_device !== "OFF" &&
      settings.mpe_lo_ch > 0 &&
      settings.mpe_hi_ch >= settings.mpe_lo_ch;

    // OSC → SuperCollider via local WebSocket bridge (node osc-bridge/index.js)
    const wantOsc =
      settings.output_osc &&
      settings.fundamental;

    // FluidSynth mirror — must be computed before the early-return guard below,
    // otherwise the TDZ reference to wantFluidsynth in that condition would throw
    // a ReferenceError whenever wantSample is false and no MIDI is configured.
    const { fluidsynthOutputObj, mtsPortIsFluidsynth } = outputRuntime;
    const wantFluidsynth = mtsOutputs.some((o) => o.output === fluidsynthOutputObj);

    if (!wantSample && !wantMts && !wantFluidsynth && !wantDirect && !wantMpe && !wantOsc) {
      setSynth(null);
      return () => { cancelled = true; };
    }

    setLoading(wait);
    const promises = [];

    if (wantSample) {
      promises.push(
        create_sample_synth(
          settings.instrument,
          settings.fundamental,
          settings.reference_degree,
          settings.scale,
        ),
      );
    }
    if (wantMts || wantFluidsynth || wantDirect) {
      for (const outputMode of mtsOutputs) {
        if (!outputMode.output) continue;
        const anchorNote = outputMode.transportMode === "bulk_dynamic_map" ||
          outputMode.transportMode === "bulk_static_map"
          ? outputMode.anchorNote
          : settings.midiin_central_degree;
        const midiMapping =
          outputMode.transportMode === "bulk_dynamic_map" ||
          outputMode.transportMode === "bulk_static_map"
            ? "DIRECT"
            : outputMode.allocationMode === "mts2" ? "MTS2" : "MTS1";

        promises.push(
          create_midi_synth({
            outputMode: {
              ...outputMode,
              anchorNote,
              midiMapping,
            },
            tuningContext: {
              fundamental: tuningRuntime?.fundamental,
              degree0toRefAsArray: tuningRuntime?.degree0toRefAsArray,
              scale: tuningRuntime?.scale,
              equivInterval: tuningRuntime?.equivInterval,
              name: tuningRuntime?.name,
            },
            legacyInput: {
              midiin_device: settings.midiin_device,
              midiin_central_degree: anchorNote,
            },
            getDynamicBulkConfig: outputMode.transportMode === "bulk_dynamic_map"
              ? () => ({
                deviceId: settingsRef.current.direct_device_id ?? 127,
                mapNumber: settingsRef.current.direct_tuning_map_number ?? 0,
                name: resolveBulkDumpName(
                  settingsRef.current.direct_tuning_map_name,
                  settingsRef.current.short_description,
                  settingsRef.current.name,
                ),
              })
              : null,
          }),
        );
      }
    }
    if (wantOsc) {
      promises.push(
        create_osc_synth(
          settings.osc_bridge_url || "ws://localhost:8089",
          settings.osc_synth_names || ["pluck", "string", "formant", "tone"],
          settings.osc_volumes     || [0.5, 0.5, 0.5, 0.5],
          settings.fundamental,
          settings.reference_degree,
          settings.scale,
        ),
      );
    }
    if (wantMpe) {
      promises.push(
        create_mpe_synth(
          midi.outputs.get(settings.mpe_device),
          settings.mpe_manager_ch,
          settings.mpe_lo_ch,
          settings.mpe_hi_ch,
          settings.fundamental,
          settings.reference_degree,
          settings.center_degree,
          settings.midiin_central_degree,
          settings.scale,
          settings.mpe_mode,
          settings.mpe_pitchbend_range ?? 48,
          settings.mpe_manager_pitchbend_range ?? 2,
          settings.equivSteps,
          settings.equivInterval,
        ),
      );
    }

    Promise.all(promises).then(async (synths) => {
      if (cancelled) { setLoading(signal); return; }
      // Filter out null/undefined synths (e.g., MIDI device unavailable)
      const validSynths = synths.filter((s) => s != null);
      if (validSynths.length === 0) {
        setSynth(null);
        setLoading(signal);
        return;
      }
      const s =
        validSynths.length === 1
          ? validSynths[0]
          : create_composite_synth(validSynths);
      // Set the synth and clear the spinner immediately — do NOT await prepare()
      // here. On iOS, prepare() calls AudioContext.resume() + decodeAudioData,
      // both of which require a running AudioContext. The synth effect runs outside
      // the original gesture window (React defers effects), so resume() stalls and
      // decodeAudioData never resolves, leaving the loading counter permanently at 1.
      //
      // prepare() is called in two safe places instead:
      //  1. presetChanged() in use-presets.js — directly inside the gesture handler,
      //     before setSettings fires, so the AudioContext is within the gesture window.
      //  2. The userHasInteracted effect below — fires when the user next taps the canvas.
      //
      // Trade-off: on desktop, the first note after a preset change may briefly use the
      // old decoded buffers (a very short "peep") if the new instrument hasn't decoded
      // yet. Acceptable given that the iOS hang is the worse failure.
      if (cancelled) { setLoading(signal); return; }
      setSynth(s);
      setLoading(signal);
    });

    return () => { cancelled = true; };
  }, [
    settings.instrument,
    // MIDI output runtimes derive anchors and tuning context from the current
    // fundamental and center degree, so those changes must rebuild the synth.
    settings.fundamental,
    settings.reference_degree,
    settings.center_degree,
    settings.scale,
    settings.midi_device,
    settings.midi_channel,
    settings.midi_mapping,
    settings.midi_velocity,
    settings.device_id,
    settings.tuning_map_number,
    settings.output_sample,
    settings.output_mts,
    settings.output_mpe,
    settings.output_direct,
    settings.output_osc,
    settings.direct_device,
    settings.direct_mode,
    settings.direct_channel,
    settings.direct_device_id,
    settings.direct_tuning_map_number,
    settings.direct_tuning_map_name,
    settings.fluidsynth_device,
    settings.fluidsynth_channel,
    settings.sysex_type,
    settings.mpe_device,
    settings.mpe_manager_ch,
    settings.mpe_lo_ch,
    settings.mpe_hi_ch,
    settings.mpe_pitchbend_range,
    settings.mpe_mode,
    midi,
    midiTick,
  ]);

  // ── Imperative propagation ──────────────────────────────────────────────────

  // Keep synthRef in sync so volume control and preset loading can reach the
  // live synth without depending on the React render cycle.
  // Also apply the persisted volume immediately so the synth starts at the
  // user's saved level rather than the default.
  useEffect(() => {
    synthRef.current = synth;
    if (synth?.setVolume) {
      const muted  = localStorage.getItem('synth_muted') === 'true';
      const volume = parseFloat(localStorage.getItem('synth_volume') ?? '1') || 1.0;
      synth.setVolume(muted ? 0 : volume);
    }
  }, [synth]);

  // On first user interaction, prepare audio context (iOS/Safari requirement).
  useEffect(() => {
    if (userHasInteracted && synth && synth.prepare) {
      synth.prepare();
    }
  }, [userHasInteracted, synth]);

  // When fundamental changes (sidebar or preset), propagate to live Keys so
  // the canvas redraws note labels without a full reconstruction.
  useEffect(() => {
    if (keysRef.current?.updateFundamental)
      keysRef.current.updateFundamental(settings.fundamental);
  }, [settings.fundamental]);

  // In DIRECT static mode, turning on auto-send or changing map parameters
  // should immediately send the current static snapshot without waiting for
  // another retune action. Defer to the next frame so any Keys reconstruction
  // from structural setting changes has already completed.
  useEffect(() => {
    if (
      !ready ||
      !settings.output_direct ||
      settings.direct_mode !== "static" ||
      !settings.direct_sysex_auto ||
      !settings.direct_device ||
      settings.direct_device === "OFF" ||
      !keysRef.current
    ) return;

    const output = WebMidi.getOutputById(settings.direct_device);
    if (!output) return;

    let raf = requestAnimationFrame(() => {
      if (keysRef.current) keysRef.current.mtsSendMap(output);
    });
    return () => cancelAnimationFrame(raf);
  }, [
    ready,
    midi,
    settings.output_direct,
    settings.direct_mode,
    settings.direct_sysex_auto,
    settings.direct_device,
    settings.direct_device_id,
    settings.direct_tuning_map_number,
    settings.direct_tuning_map_name,
    settings.center_degree,
    settings.reference_degree,
    settings.scale,
  ]);

  // ── Octave shift ────────────────────────────────────────────────────────────

  const shiftOctave = (dir) => {
    setOctaveTranspose((t) => t + dir);
    if (keysRef.current?.shiftOctave)
      keysRef.current.shiftOctave(dir, octaveDeferred);
  };

  const toggleOctaveDeferred = (e) => {
    e.stopPropagation();
    const next = !octaveDeferred;
    setOctaveDeferred(next);
    sessionStorage.setItem("octave_deferred", next);
  };

  // ── Per-controller prefs: single derived-state owner ────────────────────────
  // Fires whenever (midi, midiin_device) resolves to a known controller —
  // on page refresh, dropdown selection, fresh start, or any future connect path.
  // loadControllerPrefs is idempotent: it reads saved values (or first-connect
  // fallbacks) so re-firing on the same device is safe.
  useEffect(() => {
    if (!midi || !settings.midiin_device || settings.midiin_device === 'OFF') return;
    const input = Array.from(midi.inputs.values()).find(i => i.id === settings.midiin_device);
    if (!input) return;
    const ctrl = detectController(input.name.toLowerCase());
    if (!ctrl) return;
    setSettings(s => ({ ...s, ...loadAnchorSettingsUpdate(ctrl) }));
  }, [midi, settings.midiin_device]);

  // ── Volume / anchor learn ───────────────────────────────────────────────────

  const onVolumeChange = useCallback((volume, muted) => {
    if (synthRef.current && synthRef.current.setVolume) {
      synthRef.current.setVolume(muted ? 0 : volume);
    }
  }, []);

  // Called by keys.js when the user presses a key during MIDI-learn mode.
  // Saves the anchor note + channel so the controller map (2D path) and the
  // step-arithmetic path (sequential/unknown) both resolve correctly.
  const onAnchorLearn = useCallback((noteNum, channel) => {
    setMidiLearnActive(false);
    const ch = channel ?? 1;
    const isSequential = settings.midi_passthrough;
    
    let ctrl = null;
    if (settings.midiin_device && settings.midiin_device !== "OFF" && midi) {
      const input = Array.from(midi.inputs.values()).find(
        (m) => m.id === settings.midiin_device,
      );
      if (input) ctrl = detectController(input.name.toLowerCase());
    }

    // Pass isSequential to get mode-appropriate validation and storage.
    // saveAnchorFromLearn returns { update, warning } where warning is non-null
    // if validation failed in 2D geometry mode.
    const result = ctrl
      ? saveAnchorFromLearn(ctrl, noteNum, ch, isSequential)
      : { update: { midiin_central_degree: noteNum, midiin_anchor_channel: ch }, warning: null };

    // Handle validation failure — show warning in the UI
    if (result.warning) {
      setAnchorLearnWarning(result.warning);
      return;
    }

    const { update } = result;

    // Persist to sessionStorage
    sessionStorage.setItem("midiin_central_degree", String(noteNum));
    sessionStorage.setItem("midiin_anchor_channel", String(ch));

    // Persist mode-appropriate anchors to localStorage
    if (isSequential && ctrl?.multiChannel) {
      // Sequential mode: store as sequential anchors
      localStorage.setItem(`${ctrl.id}_seq_anchor`, String(noteNum));
      localStorage.setItem(`${ctrl.id}_seq_anchor_channel`, String(ch));
    } else if (!isSequential && update.lumatone_center_note != null) {
      // 2D geometry mode: store as geometry anchors
      localStorage.setItem(`${ctrl.id}_anchor`, String(update.lumatone_center_note));
      localStorage.setItem(`${ctrl.id}_anchor_channel`, String(update.lumatone_center_channel));
    }

    setSettings((s) => ({ ...s, ...update }));
  }, [settings.midiin_device, settings.midi_passthrough, midi]);

  // ── Lumatone raw MIDI ports ──────────────────────────────────────────────────
  // When the active MIDI input is a Lumatone, resolve the matching raw Web MIDI
  // input (for ACK sysex listening) and output (for LED sysex sends).
  // These are passed to Keys so it can drive the LED feedback engine.
  const lumatoneRawPorts = useMemo(() => {
    if (!midi || !settings.midiin_device || settings.midiin_device === 'OFF') return null;
    const rawIn = midi.inputs.get(settings.midiin_device);
    if (!rawIn) return null;
    const ctrl = detectController(rawIn.name.toLowerCase());
    if (!ctrl || ctrl.id !== 'lumatone') return null;
    // The Lumatone exposes both input and output ports with the same device name.
    const rawOut = Array.from(midi.outputs.values()).find(
      (o) => ctrl.detect(o.name.toLowerCase()),
    );
    if (!rawOut) return null;
    return { input: rawIn, output: rawOut };
  }, [midi, midiTick, settings.midiin_device]);

  // When the active MIDI input is an Exquis, resolve both raw Web MIDI ports.
  // Output is needed for SysEx sends (LED colors, dev mode).
  // Input is needed to listen for Refresh (03h) from the device.
  const exquisRawPorts = useMemo(() => {
    if (!midi || !settings.midiin_device || settings.midiin_device === 'OFF') return null;
    const rawIn = midi.inputs.get(settings.midiin_device);
    if (!rawIn) return null;
    const ctrl = detectController(rawIn.name.toLowerCase());
    if (!ctrl || ctrl.id !== 'exquis') return null;
    const rawOut = Array.from(midi.outputs.values()).find(
      (o) => ctrl.detect(o.name.toLowerCase()),
    );
    if (!rawOut) return null;
    return { input: rawIn, output: rawOut };
  }, [midi, midiTick, settings.midiin_device]);

  return {
    synth,
    midi,
    midiTick,
    loading,
    midiLearnActive,
    setMidiLearnActive,
    octaveTranspose,
    setOctaveTranspose,
    octaveDeferred,
    shiftOctave,
    toggleOctaveDeferred,
    onVolumeChange,
    onAnchorLearn,
    lumatoneRawPorts,
    exquisRawPorts,
  };
};

export default useSynthWiring;
