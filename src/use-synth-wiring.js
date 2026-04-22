import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { enableMidi } from "./settings/midi/midiin";
import { create_midi_synth } from "./midi_synth";
import create_mpe_synth from "./mpe_synth";
import { create_composite_synth } from "./composite_synth";
import { create_osc_synth } from "./osc_synth";
import { detectController, getControllerById } from "./controllers/registry.js";
import { saveAnchorFromLearn, loadAnchorSettingsUpdate } from "./input/controller-anchor.js";
import { WebMidi } from "webmidi";
import {
  computeNaturalAnchor,
  computeCenterPitchHz,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
  degree0ToRef,
} from "./tuning/center-anchor.js";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "./tuning/workspace.js";
import { resolveBulkDumpName } from "./tuning/mts-format.js";
import { REGISTRY_BY_KEY } from "./persistence/settings-registry.js";
import { localFloat } from "./persistence/storage-utils.js";
import { debugLog, warnLog } from "./debug/logging.js";

// Functional updaters for the loading counter. Using a counter (not a boolean)
// lets multiple async operations overlap without prematurely hiding the spinner.
const wait = (l) => l + 1;
const signal = (l) => l - 1;
const MIDI_ACCESS_SESSION_KEY = REGISTRY_BY_KEY.webmidi_access.key;
const OSC_VOLUME_KEYS = ["osc_volume_pluck", "osc_volume_buzz", "osc_volume_formant", "osc_volume_saw"];
const midiAccessRank = {
  none: 0,
  basic: 1,
  sysex: 2,
};

let sampleSynthModulePromise = null;

const loadSampleSynthModule = async () => {
  sampleSynthModulePromise ??= import("./sample_synth");
  return sampleSynthModulePromise;
};

const MIDI_PORT_RESET = {
  midiin_device: "OFF",
  midi_device: "OFF",
  direct_device: "OFF",
  mpe_device: "OFF",
  fluidsynth_device: "",
  fluidsynth_channel: -1,
};

export const deriveOscVolumes = (settings) => {
  if (Array.isArray(settings.osc_volumes) && settings.osc_volumes.length === 4) {
    return settings.osc_volumes;
  }
  return [
    localFloat(REGISTRY_BY_KEY.osc_volume_pluck.key, settings.osc_volume_pluck ?? 0.5),
    localFloat(REGISTRY_BY_KEY.osc_volume_buzz.key, settings.osc_volume_buzz ?? 0.5),
    localFloat(REGISTRY_BY_KEY.osc_volume_formant.key, settings.osc_volume_formant ?? 0.5),
    localFloat(REGISTRY_BY_KEY.osc_volume_saw.key, settings.osc_volume_saw ?? 0.5),
  ];
};

export const resolveInputController = (input, controllerOverrideId = "auto") => {
  if (controllerOverrideId && controllerOverrideId !== "auto") {
    return getControllerById(controllerOverrideId) ?? getControllerById("generic");
  }
  if (!input?.name) return getControllerById("generic");
  return detectController(input.name.toLowerCase()) ?? getControllerById("generic");
};

export const deriveTuningRuntime = (settings) => {
  if (!settings.scale || !Array.isArray(settings.scale) || settings.scale.length === 0) {
    return null;
  }

  const workspaceRuntime = normalizeWorkspaceForKeys(
    createScaleWorkspace({
      scale: settings.scale,
      reference_degree: settings.reference_degree,
      fundamental: settings.fundamental,
    }),
  );
  const { scale, equivInterval } = workspaceRuntime;
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
      pitchBendRange: settings.midi_wheel_semitones ?? 2,
    });
  }

  const fluidsynthOutputObj =
    midi && settings.fluidsynth_device ? midi.outputs.get(settings.fluidsynth_device) : null;
  const mtsPortIsFluidsynth =
    fluidsynthOutputObj && settings.midi_device === settings.fluidsynth_device;
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
      pitchBendRange: settings.midi_wheel_semitones ?? 2,
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
      pitchBendRange: settings.midi_wheel_semitones ?? 2,
    });
  }

  return {
    outputs,
    fluidsynthOutputObj,
    mtsPortIsFluidsynth,
  };
};

export const resolveOctaveShortcutAction = (event, inputFocused = false) => {
  if (inputFocused) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.repeat) return null;

  switch (event.code) {
    case "ArrowUp":
      return { type: "shift", dir: 1 };
    case "ArrowDown":
      return { type: "shift", dir: -1 };
    case "ArrowLeft":
      return { type: "mode", deferred: true };
    case "ArrowRight":
      return { type: "mode", deferred: false };
    default:
      return null;
  }
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
const useSynthWiring = (settings, setSettings, { ready, userHasInteracted, keysRef, synthRef }) => {
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const [synth, setSynth] = useState(null);
  const [midi, setMidi] = useState(null);
  const [midiAccess, setMidiAccess] = useState("none");
  const [midiAccessError, setMidiAccessError] = useState(null);
  const [midiLearnActive, setMidiLearnActive] = useState(false);
  // Incremented on every MIDI onstatechange so dependent effects re-run when
  // devices connect or disconnect (e.g. FluidSynth starting after page load).
  const [midiTick, setMidiTick] = useState(0);
  // Counter so multiple overlapping async operations don't prematurely hide
  // the loading spinner (see wait / signal helpers above).
  const [loading, setLoading] = useState(0);
  const [octaveTranspose, setOctaveTranspose] = useState(0);
  const [octaveDeferred, setOctaveDeferred] = useState(
    () => sessionStorage.getItem("octave_deferred") !== "false",
  );
  const sampleSynthRef = useRef({ key: null, synth: null });
  const mpeSynthRef = useRef({ key: null, synth: null });
  const mtsSynthsRef = useRef(new Map());
  const oscSynthRef = useRef({ key: null, synth: null });
  const midiRequestRef = useRef(null);
  const midiRestoreAttemptedRef = useRef(false);

  const clearMidiSelections = useCallback(() => {
    Object.entries(MIDI_PORT_RESET).forEach(([key, value]) => {
      sessionStorage.setItem(key, String(value));
    });
    setSettings((prev) => ({ ...prev, ...MIDI_PORT_RESET }));
  }, [setSettings]);

  // ── MIDI access ─────────────────────────────────────────────────────────────

  const ensureMidiAccess = useCallback(
    async ({ sysex = false } = {}) => {
      const targetAccess = sysex ? "sysex" : "basic";
      if (midiAccessRank[midiAccess] >= midiAccessRank[targetAccess]) return true;
      if (!navigator.requestMIDIAccess) {
        setMidiAccessError("Web MIDI is not available in this browser.");
        return false;
      }
      if (midiRequestRef.current && midiRequestRef.current.target === targetAccess) {
        return midiRequestRef.current.promise;
      }

      const request = (async () => {
        setMidiAccessError(null);
        try {
          await enableMidi({ sysex });
          const midiAccessObj = await navigator.requestMIDIAccess({ sysex });
          debugLog("midi", sysex ? "Web MIDI API with sysex is ready!" : "Web MIDI API is ready!");
          midiAccessObj.onstatechange = () => setMidiTick((t) => t + 1);
          setMidi(midiAccessObj);
          setMidiAccess(targetAccess);
          sessionStorage.setItem(MIDI_ACCESS_SESSION_KEY, targetAccess);
          return true;
        } catch (err) {
          warnLog("Web MIDI could not initialise:", err);
          if (midiAccessRank[midiAccess] > midiAccessRank.none) {
            sessionStorage.setItem(MIDI_ACCESS_SESSION_KEY, midiAccess);
          } else {
            sessionStorage.removeItem(MIDI_ACCESS_SESSION_KEY);
          }
          setMidiAccessError(
            sysex ? "MIDI SysEx access was not granted." : "MIDI access was not granted.",
          );
          return false;
        } finally {
          midiRequestRef.current = null;
        }
      })();

      midiRequestRef.current = { target: targetAccess, promise: request };
      return request;
    },
    [midiAccess],
  );

  const disableMidiAccess = useCallback(
    async ({ reenableBasic = false, clearSelections = true } = {}) => {
      if (clearSelections) clearMidiSelections();
      setMidi(null);
      setMidiAccess("none");
      setMidiAccessError(null);
      midiRequestRef.current = null;
      sessionStorage.setItem(MIDI_ACCESS_SESSION_KEY, "none");
      try {
        if (typeof WebMidi.disable === "function") {
          await WebMidi.disable();
        }
      } catch (err) {
        warnLog("Web MIDI disable could not complete cleanly:", err);
      }
      if (midi) midi.onstatechange = null;
      if (reenableBasic) {
        return ensureMidiAccess({ sysex: false });
      }
      return true;
    },
    [clearMidiSelections, ensureMidiAccess, midi],
  );

  useEffect(() => {
    if (midiRestoreAttemptedRef.current) return;
    const wantsMidi = !!settings.webmidi_enabled;
    const wantsSysex = !!settings.webmidi_sysex_enabled;
    if (!wantsMidi) {
      midiRestoreAttemptedRef.current = true;
      return;
    }

    midiRestoreAttemptedRef.current = true;
    ensureMidiAccess({ sysex: wantsSysex }).then((ok) => {
      if (ok) return;
      clearMidiSelections();
    });
  }, [clearMidiSelections, ensureMidiAccess, settings.webmidi_enabled, settings.webmidi_sysex_enabled]);

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
    const wantDirect = mtsOutputs.some(
      (o) => o.transportMode === "bulk_dynamic_map" || o.transportMode === "bulk_static_map",
    );

    const wantMpe =
      settings.output_mpe &&
      midi &&
      settings.mpe_device !== "OFF" &&
      settings.mpe_lo_ch > 0 &&
      settings.mpe_hi_ch >= settings.mpe_lo_ch;

    // OSC → SuperCollider via local WebSocket bridge (node osc-bridge/index.js)
    const wantOsc = settings.output_osc && settings.fundamental;

    // FluidSynth mirror — must be computed before the early-return guard below,
    // otherwise the TDZ reference to wantFluidsynth in that condition would throw
    // a ReferenceError whenever wantSample is false and no MIDI is configured.
    const { fluidsynthOutputObj } = outputRuntime;
    const wantFluidsynth = mtsOutputs.some((o) => o.output === fluidsynthOutputObj);

    if (!wantSample && !wantMts && !wantFluidsynth && !wantDirect && !wantMpe && !wantOsc) {
      setSynth(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(wait);
    const promises = [];

    const sampleKey = wantSample
      ? JSON.stringify([
          settings.instrument,
          settings.fundamental,
          settings.reference_degree,
          settings.scale,
        ])
      : null;
    if (!wantSample && sampleSynthRef.current.synth) {
      sampleSynthRef.current.synth.releaseAll?.();
      sampleSynthRef.current = { key: null, synth: null };
    }

    if (wantSample) {
      if (sampleSynthRef.current.key === sampleKey && sampleSynthRef.current.synth) {
        promises.push(Promise.resolve(sampleSynthRef.current.synth));
      } else {
        promises.push(
          loadSampleSynthModule()
            .then(({ create_sample_synth }) =>
              create_sample_synth(
                settings.instrument,
                settings.fundamental,
                settings.reference_degree,
                settings.scale,
              ),
            )
            .then((s) => {
              if (!cancelled) sampleSynthRef.current = { key: sampleKey, synth: s };
              return s;
            }),
        );
      }
    }
    if (wantMts || wantFluidsynth || wantDirect) {
      const desiredMtsKeys = new Set();
      for (const outputMode of mtsOutputs) {
        if (!outputMode.output) continue;
        const mtsKey = JSON.stringify([
          outputMode.transportMode,
          outputMode.output?.id,
          outputMode.channel,
          outputMode.velocity,
          outputMode.deviceId,
          outputMode.mapNumber,
          outputMode.mapName,
          outputMode.anchorNote,
          outputMode.sysexType,
          settings.fundamental,
          settings.reference_degree,
          settings.center_degree,
          settings.scale,
          settings.midi_mapping,
        ]);
        desiredMtsKeys.add(mtsKey);
        const existing = mtsSynthsRef.current.get(mtsKey);
        if (existing) {
          promises.push(Promise.resolve(existing));
          continue;
        }
        const anchorNote =
          outputMode.transportMode === "bulk_dynamic_map" ||
          outputMode.transportMode === "bulk_static_map"
            ? outputMode.anchorNote
            : settings.midiin_central_degree;
        const midiMapping =
          outputMode.transportMode === "bulk_dynamic_map" ||
          outputMode.transportMode === "bulk_static_map"
            ? "DIRECT"
            : outputMode.allocationMode === "mts2"
              ? "MTS2"
              : "MTS1";

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
            getDynamicBulkConfig:
              outputMode.transportMode === "bulk_dynamic_map"
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
          }).then((s) => {
            if (!cancelled) mtsSynthsRef.current.set(mtsKey, s);
            return s;
          }),
        );
      }
      for (const [key, synth] of mtsSynthsRef.current) {
        if (!desiredMtsKeys.has(key)) {
          synth.releaseAll?.();
          mtsSynthsRef.current.delete(key);
        }
      }
    } else if (mtsSynthsRef.current.size > 0) {
      for (const synth of mtsSynthsRef.current.values()) synth.releaseAll?.();
      mtsSynthsRef.current.clear();
    }
    if (wantOsc) {
      const oscKey = JSON.stringify([
        settings.osc_bridge_url || "ws://localhost:8089",
        settings.osc_synth_names || ["pluck", "string", "formant", "tone"],
        settings.fundamental,
        settings.reference_degree,
        settings.scale,
      ]);
      if (oscSynthRef.current.key === oscKey && oscSynthRef.current.synth) {
        promises.push(Promise.resolve(oscSynthRef.current.synth));
      } else {
        promises.push(
          create_osc_synth(
            settings.osc_bridge_url || "ws://localhost:8089",
            settings.osc_synth_names || ["pluck", "string", "formant", "tone"],
            deriveOscVolumes(settingsRef.current),
            settings.fundamental,
            settings.reference_degree,
            settings.scale,
          ).then((s) => {
            if (!cancelled) oscSynthRef.current = { key: oscKey, synth: s };
            return s;
          }),
        );
      }
    } else {
      oscSynthRef.current = { key: null, synth: null };
    }
    if (wantMpe) {
      const mpeKey = JSON.stringify([
        settings.mpe_device,
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
        settings.mpe_pitchbend_range_manager ?? 2,
        settings.equivSteps,
        settings.equivInterval,
      ]);
      if (mpeSynthRef.current.key === mpeKey && mpeSynthRef.current.synth) {
        promises.push(Promise.resolve(mpeSynthRef.current.synth));
      } else {
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
            settings.mpe_pitchbend_range_manager ?? 2,
            settings.equivSteps,
            settings.equivInterval,
          ).then((s) => {
            if (!cancelled) mpeSynthRef.current = { key: mpeKey, synth: s };
            return s;
          }),
        );
      }
    } else if (mpeSynthRef.current.synth) {
      mpeSynthRef.current.synth.releaseAll?.();
      mpeSynthRef.current = { key: null, synth: null };
    }

    Promise.all(promises).then(async (synths) => {
      if (cancelled) {
        setLoading(signal);
        return;
      }
      // Filter out null/undefined synths (e.g., MIDI device unavailable)
      const validSynths = synths.filter((s) => s != null);
      if (validSynths.length === 0) {
        setSynth(null);
        setLoading(signal);
        return;
      }
      const s = validSynths.length === 1 ? validSynths[0] : create_composite_synth(validSynths);
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
      if (cancelled) {
        setLoading(signal);
        return;
      }
      // Push current controller state into the newly-built synth immediately,
      // without waiting for the next Keyboard render/effect cycle. This closes
      // a timing gap where a freshly swapped sample synth could briefly become
      // active with default wheel/mod state after an instrument change.
      keysRef.current?.updateLiveOutputState?.(null, s);
      setSynth(s);
      setLoading(signal);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysRef is stable; settings covered field-by-field below
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
    settings.midi_wheel_semitones,
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
    settings.mpe_pitchbend_range_manager,
    settings.mpe_mode,
    midi,
    midiTick,
    ready,
    // keysRef and settings (whole object) intentionally omitted — keysRef is a stable ref,
    // and settings is covered field-by-field above.
  ]);

  // ── Imperative propagation ──────────────────────────────────────────────────

  // Keep synthRef in sync so volume control and preset loading can reach the
  // live synth without depending on the React render cycle.
  // Also apply the persisted volume immediately so the synth starts at the
  // user's saved level rather than the default.
  useEffect(() => {
    synthRef.current = synth;
    if (synth?.setVolume) {
      const muted = localStorage.getItem("synth_muted") === "true";
      const volume = parseFloat(localStorage.getItem("synth_volume") ?? "1") || 1.0;
      synth.setVolume(muted ? 0 : volume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synth]); // synthRef is a stable ref, intentionally omitted

  // Reset octave to 0 whenever the synth is rebuilt (output routing changed).
  // A new synth means all notes were killed; keeping a transposed OCT state would
  // cause the next notes to play at the wrong pitch.
  const isFirstSynthRef = useRef(true);
  useEffect(() => {
    if (isFirstSynthRef.current) { isFirstSynthRef.current = false; return; }
    resetOctave();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetOctave is stable
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
    if (keysRef.current?.updateFundamental) keysRef.current.updateFundamental(settings.fundamental);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fundamental]); // keysRef is a stable ref, intentionally omitted

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
    )
      return;

    const output = WebMidi.getOutputById(settings.direct_device);
    if (!output) return;

    let raf = requestAnimationFrame(() => {
      if (keysRef.current) keysRef.current.mtsSendMap(output);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysRef is a stable ref, intentionally omitted
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

  const shiftOctave = useCallback(
    (dir) => {
      setOctaveTranspose((t) => {
        const next = t + dir;
        sessionStorage.setItem("octave_offset", String(next));
        return next;
      });
      if (keysRef.current?.shiftOctave) keysRef.current.shiftOctave(dir, octaveDeferred);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysRef is a stable ref; setOctaveTranspose is a stable state setter
    [octaveDeferred],
  );

  // Reset OCT display and keys.settings.octave_offset back to 0.
  // Calls keys.resetOctave() which zeroes the offset directly — no inverse-shift
  // arithmetic, no race with pending state batches. Safe to call even if keys is
  // in the middle of a rebuild because resetOctave on a stale instance is a no-op
  // (that instance is being torn down and the new one starts at 0).
  const resetOctave = useCallback(() => {
    keysRef.current?.resetOctave?.();
    setOctaveTranspose(0);
    sessionStorage.setItem("octave_offset", "0");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysRef is a stable ref; setOctaveTranspose is a stable state setter
  }, []);

  const setOctaveDeferredMode = useCallback(
    (next, e = null) => {
      e?.stopPropagation?.();
      if (next === octaveDeferred) return;
      setOctaveDeferred(next);
      sessionStorage.setItem("octave_deferred", next);
      if (
        !next &&
        ready &&
        settings.output_direct &&
        settings.direct_mode === "static" &&
        settings.direct_device &&
        settings.direct_device !== "OFF" &&
        keysRef.current?.mtsSendMap
      ) {
        const output = WebMidi.getOutputById(settings.direct_device);
        if (output) {
          requestAnimationFrame(() => {
            if (keysRef.current?.mtsSendMap) {
              keysRef.current.mtsSendMap(output, false, false);
            }
          });
        }
      }
    },
    [
      octaveDeferred,
      ready,
      settings.output_direct,
      settings.direct_mode,
      settings.direct_device,
      keysRef,
    ],
  );

  const toggleOctaveDeferred = (e) => {
    setOctaveDeferredMode(!octaveDeferred, e);
  };

  useEffect(() => {
    const inputIsFocused = () => {
      const tag = document.activeElement?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const handleOctaveKeys = (e) => {
      const action = resolveOctaveShortcutAction(e, inputIsFocused());
      if (!action) return;
      e.preventDefault();
      if (action.type === "shift") {
        shiftOctave(action.dir);
      } else if (action.type === "mode") {
        setOctaveDeferredMode(action.deferred);
      }
    };

    window.addEventListener("keydown", handleOctaveKeys, false);
    return () => window.removeEventListener("keydown", handleOctaveKeys, false);
  }, [shiftOctave, setOctaveDeferredMode]);

  // ── Per-controller prefs: single derived-state owner ────────────────────────
  // Fires whenever the resolved controller identity or controller mode changes.
  // For Exquis, controller mode is geometry-scoped (layout2d vs bypass), so
  // switching midi_passthrough must reapply the correct saved bucket.
  // loadControllerPrefs is idempotent: it reads saved values (or first-connect
  // fallbacks) so re-firing on the same device is safe.
  useEffect(() => {
    if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return;
    const input = Array.from(midi.inputs.values()).find((i) => i.id === settings.midiin_device);
    if (!input) return;
    const ctrl = resolveInputController(input, settings.midiin_controller_override);
    if (!ctrl) return;
    setSettings((s) => ({ ...s, ...loadAnchorSettingsUpdate(ctrl, settingsRef.current) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSettings is a stable state setter; settingsRef is a stable ref
  }, [
    midi,
    settings.midiin_device,
    settings.midiin_controller_override,
    settings.midiin_mpe_input,
    settings.midi_passthrough,
  ]);

  // ── Volume / anchor learn ───────────────────────────────────────────────────

  const onVolumeChange = useCallback((volume, muted) => {
    if (synthRef.current && synthRef.current.setVolume) {
      synthRef.current.setVolume(muted ? 0 : volume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- synthRef is a stable ref
  }, []);

  const onOscLayerVolumeChange = useCallback((index, value) => {
    const oscSynth = oscSynthRef.current.synth;
    if (oscSynth?.setLayerVolume) oscSynth.setLayerVolume(index, value);
    // Write into React settings so deriveOscVolumes() reads the live value on
    // every rebuild — whether triggered by toggle, port change, or preset load.
    // localStorage is written so values survive page reload (including fresh tabs).
    const key = OSC_VOLUME_KEYS[index];
    if (key != null) {
      setSettings((prev) => ({ ...prev, [key]: value }));
      localStorage.setItem(key, String(value));
    }
  }, [setSettings]);

  // Called by keys.js when the user presses a key during MIDI-learn mode.
  // Saves the anchor note + channel so the controller map (2D path) and the
  // step-arithmetic path (sequential/unknown) both resolve correctly.
  const onAnchorLearn = useCallback(
    (noteNum, channel) => {
      setMidiLearnActive(false);
      const ch = channel ?? 1;
      let ctrl = null;
      const s = settingsRef.current;
      if (s.midiin_device && s.midiin_device !== "OFF" && midi) {
        const input = Array.from(midi.inputs.values()).find((m) => m.id === s.midiin_device);
        if (input) ctrl = resolveInputController(input, s.midiin_controller_override);
      }

      // Persist anchor note per controller and build the settings update.
      // saveAnchorFromLearn handles both single-channel and channel-aware (Lumatone)
      // controllers in one place; returns the update object to merge into settings.
      const update = ctrl
        ? saveAnchorFromLearn(ctrl, noteNum, ch, s)
        : { midiin_central_degree: noteNum, midiin_anchor_channel: ch };

      // midiin_anchor_channel drives the relative channel-offset formula in
      // noteToSteps() for all paths (sequential, unknown, passthrough).
      // For the Lumatone 2D-map path, lumatone_center_channel is also updated.
      sessionStorage.setItem("midiin_central_degree", String(update.midiin_central_degree));
      sessionStorage.setItem("midiin_anchor_channel", String(update.midiin_anchor_channel));
      if (update.lumatone_center_channel != null) {
        sessionStorage.setItem("lumatone_center_channel", String(update.lumatone_center_channel));
        sessionStorage.setItem("lumatone_center_note", String(update.lumatone_center_note));
      }
      setSettings((s) => ({ ...s, ...update }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settingsRef is stable; setSettings is a stable state setter
    [midi],
  );

  // ── Lumatone raw MIDI ports ──────────────────────────────────────────────────
  // When the active MIDI input is a Lumatone, resolve the matching raw Web MIDI
  // input (for ACK sysex listening) and output (for LED sysex sends).
  // These are passed to Keys so it can drive the LED feedback engine.
  const lumatoneRawPorts = useMemo(() => {
    if (midiAccess !== "sysex") return null;
    if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return null;
    const rawIn = midi.inputs.get(settings.midiin_device);
    if (!rawIn) return null;
    const ctrl = resolveInputController(rawIn, settings.midiin_controller_override);
    if (!ctrl || ctrl.id !== "lumatone") return null;
    // Manual override takes precedence; fall back to name-match auto-detect.
    const rawOut = settings.lumatone_out_port
      ? midi.outputs.get(settings.lumatone_out_port)
      : Array.from(midi.outputs.values()).find((o) => ctrl.detect(o.name.toLowerCase()));
    if (!rawOut) return null;
    return { input: rawIn, output: rawOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midi, midiTick, midiAccess, settings.midiin_device, settings.midiin_controller_override, settings.lumatone_out_port]); // midiTick forces re-run on device connect/disconnect

  // When the active MIDI input is an Exquis, resolve both raw Web MIDI ports.
  // Output is needed for SysEx sends (LED colors, dev mode).
  // Input is needed to listen for Refresh (03h) from the device.
  const exquisRawPorts = useMemo(() => {
    if (midiAccess !== "sysex") return null;
    if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return null;
    const rawIn = midi.inputs.get(settings.midiin_device);
    if (!rawIn) return null;
    const ctrl = resolveInputController(rawIn, settings.midiin_controller_override);
    if (!ctrl || ctrl.id !== "exquis") return null;
    const rawOut = settings.exquis_out_port
      ? midi.outputs.get(settings.exquis_out_port)
      : Array.from(midi.outputs.values()).find((o) => ctrl.detect(o.name.toLowerCase()));
    if (!rawOut) return null;
    return { input: rawIn, output: rawOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midi, midiTick, midiAccess, settings.midiin_device, settings.midiin_controller_override, settings.exquis_out_port]); // midiTick forces re-run on device connect/disconnect

  // When the active MIDI input is a LinnStrument 128, resolve the matching raw
  // Web MIDI output port for NRPN configuration sends and CC LED updates.
  // No sysex required — regular Web MIDI access is sufficient.
  const linnstrumentRawPorts = useMemo(() => {
    if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return null;
    const rawIn = midi.inputs.get(settings.midiin_device);
    if (!rawIn) return null;
    const ctrl = resolveInputController(rawIn, settings.midiin_controller_override);
    if (!ctrl || ctrl.id !== "linnstrument") return null;
    const rawOut = settings.linnstrument_out_port
      ? midi.outputs.get(settings.linnstrument_out_port)
      : Array.from(midi.outputs.values()).find((o) => ctrl.detect(o.name.toLowerCase()));
    if (!rawOut) return null;
    return { input: rawIn, output: rawOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midi, midiTick, settings.midiin_device, settings.midiin_controller_override, settings.linnstrument_out_port]); // midiTick forces re-run on device connect/disconnect

  return {
    synth,
    midi,
    midiAccess,
    midiAccessError,
    ensureMidiAccess,
    enableWebMidi: ensureMidiAccess,
    disableWebMidi: disableMidiAccess,
    midiTick,
    loading,
    midiLearnActive,
    setMidiLearnActive,
    octaveTranspose,
    setOctaveTranspose,
    octaveDeferred,
    shiftOctave,
    resetOctave,
    toggleOctaveDeferred,
    onVolumeChange,
    onOscLayerVolumeChange,
    onAnchorLearn,
    lumatoneRawPorts,
    exquisRawPorts,
    linnstrumentRawPorts,
  };
};

export default useSynthWiring;
