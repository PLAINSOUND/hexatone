/**
 * src/hooks/use-synth-wiring.js
 *
 * Top-level wiring between React settings state and the live synth/keyboard
 * runtime graph.
 *
 * It resolves WebMIDI access, controller/output devices, tuning workspace
 * normalization, and rebuild/update boundaries for the long-lived instrument
 * runtime. It does not render UI; App consumes the configured runtime objects
 * and callbacks it returns.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { enableMidi } from "../midi/enable-webmidi";
import { create_midi_synth } from "../midi_synth";
import create_mpe_synth from "../mpe_synth";
import { createMonoSynth } from "../mono_synth/index.js";
import { create_composite_synth } from "../composite_synth";
import { create_osc_synth } from "../osc_synth";
import { detectController, getControllerById } from "../controllers/registry.js";
import {
  applyControllerPresetAnchor,
  buildControllerPresetAnchorUpdate,
  hasControllerPresetAnchor,
} from "../controllers/preset-anchors.js";
import {
  saveAnchorFromLearn,
  saveControllerPref,
  loadAnchorSettingsUpdate,
} from "../input/controller-anchor.js";
import { WebMidi } from "webmidi";
import {
  computeNaturalAnchor,
  computeCenterPitchHz,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
  degree0ToRef,
} from "../tuning/center-anchor.js";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "../tuning/workspace.js";
import { resolveBulkDumpName } from "../tuning/mts-format.js";
import { REGISTRY_BY_KEY } from "../persistence/settings-registry.js";
import { localBool, localFloat } from "../persistence/storage-utils.js";
import { debugLog, warnLog } from "../debug/logging.js";
import {
  adoptSampleOutput, clearOutputRef as detachOutputRef,
  clearOutputSynthRefs as detachOutputSynthRefs, clearSampleOutputs as detachSampleOutputs,
  pruneOutputMap as detachOutputMap, runOutputCleanup,
} from "../audio/output-lifecycle.js";
import { createOutputCandidateRequests } from "../audio/output-candidate.js";
import { completeOutputBuild } from "../audio/output-build.js";
import { createOutputPortIdentity } from "../audio/output-port-identity.js";
import { monoOutputConfig, sampleOutputConfig, mtsOutputConfig, oscOutputConfig,
  mpeOutputConfig } from "../audio/output-config.js";

// Backend teardown must not prevent graph replacement, unmount cleanup or MIDI
// permission reset. Helpers detach ownership and attempt all releases first.
const reportCleanupFailures = action => (...args) => {
  try { return action(...args); }
  catch (error) { warnLog("Output cleanup could not complete cleanly:", error); }
};
const clearOutputRef = reportCleanupFailures(detachOutputRef);
const clearOutputSynthRefs = reportCleanupFailures(detachOutputSynthRefs);
const clearSampleOutputs = reportCleanupFailures(detachSampleOutputs);
const pruneOutputMap = reportCleanupFailures(detachOutputMap);
const cleanUpOutputs = reportCleanupFailures(runOutputCleanup);

// Functional updaters for the loading counter. Using a counter (not a boolean)
// lets multiple async operations overlap without prematurely hiding the spinner.
const wait = (l) => l + 1;
const signal = (l) => l - 1;
const MIDI_ACCESS_SESSION_KEY = REGISTRY_BY_KEY.webmidi_access.key;
const midiAccessRank = {
  none: 0,
  basic: 1,
  sysex: 2,
};
let sampleSynthModulePromise = null;

const loadSampleSynthModule = async () => {
  sampleSynthModulePromise ??= import("../sample_synth");
  return sampleSynthModulePromise;
};

const MIDI_PORT_RESET = {
  midiin_device: "OFF",
  midi_device: "OFF",
  mts_bulk_device: "OFF",
  mpe_device: "OFF",
  mono_device: "OFF",
  fluidsynth_device: "",
  fluidsynth_channel: -1,
};

const snapshotWebMidiPorts = () => {
  if (!WebMidi?.enabled) return null;
  return WebMidi.interface ?? null;
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

export const deriveOscQuickRelease = (settings) =>
  Math.max(
    0,
    Math.min(
      1,
      localFloat(REGISTRY_BY_KEY.osc_quick_release.key, settings.osc_quick_release ?? 0.5),
    ),
  );

export const deriveOscQuickReleaseTime = (settings) =>
  Math.max(
    0.001,
    Math.min(
      2.5,
      localFloat(
        REGISTRY_BY_KEY.osc_quick_release_time.key,
        settings.osc_quick_release_time ?? 0.25,
      ),
    ),
  );

export const deriveOscQuickReleaseRasterOnly = (settings) =>
  localBool(
    REGISTRY_BY_KEY.osc_quick_release_raster_only.key,
    settings.osc_quick_release_raster_only ?? true,
  );

export const deriveOscSustainBuzzFormant = (settings) =>
  localBool(
    REGISTRY_BY_KEY.osc_sustain_buzz_formant.key,
    settings.osc_sustain_buzz_formant ?? false,
  );

export const deriveOscRetriggerBuzzFormant = (settings) =>
  localBool(
    REGISTRY_BY_KEY.osc_retrigger_buzz_formant.key,
    settings.osc_retrigger_buzz_formant ?? false,
  );

function readOscRuntimeControls(settings) {
  return {
    volumes: [...deriveOscVolumes(settings)],
    quickRelease: deriveOscQuickRelease(settings),
    quickReleaseTime: deriveOscQuickReleaseTime(settings),
    rasterOnly: deriveOscQuickReleaseRasterOnly(settings),
    sustain: deriveOscSustainBuzzFormant(settings),
    retrigger: deriveOscRetriggerBuzzFormant(settings),
  };
}

function applyOscRuntimeControls(synth, controls) {
  controls.volumes.forEach((value, index) => synth?.setLayerVolume?.(index, value));
  synth?.setQuickRelease?.(controls.quickRelease);
  synth?.setQuickReleaseTime?.(controls.quickReleaseTime);
  synth?.setQuickReleaseRasterOnly?.(controls.rasterOnly);
  synth?.setSustainBuzzFormant?.(controls.sustain);
  synth?.setRetriggerBuzzFormant?.(controls.retrigger);
}

export const resolveInputController = (input, controllerOverrideId = "auto") => {
  if (controllerOverrideId && controllerOverrideId !== "auto") {
    return getControllerById(controllerOverrideId) ?? getControllerById("generic");
  }
  if (!input?.name) return getControllerById("generic");
  return detectController(input.name.toLowerCase()) ?? getControllerById("generic");
};

export const resolveControllerPrefsTarget = (input, controllerOverrideId = "auto") => {
  if (controllerOverrideId && controllerOverrideId !== "auto") {
    return getControllerById(controllerOverrideId);
  }
  if (!input?.name) return getControllerById("generic");
  return detectController(input.name.toLowerCase()) ?? getControllerById("generic");
};

export const applyPresetControllerAnchor = (settings, controllerId, anchorUpdate = {}) => {
  return applyControllerPresetAnchor(settings, controllerId, anchorUpdate);
};

export const hasExplicitPresetControllerAnchor = (settings, controllerId) => {
  return hasControllerPresetAnchor(settings, controllerId);
};

export const buildPresetControllerAnchorUpdate = (controllerId, note, channel = 1) => {
  return buildControllerPresetAnchorUpdate(controllerId, note, channel);
};

const normalizeMidiPortName = (name = "") =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const midiPortNameSimilarity = (a = "", b = "") => {
  const left = normalizeMidiPortName(a);
  const right = normalizeMidiPortName(b);
  if (!left || !right) return 0;
  if (left === right) return 1000;
  if (left.includes(right) || right.includes(left)) return 900;

  const ignored = new Set(["midi", "port", "input", "output", "usb", "device"]);
  const leftTokens = new Set(left.split(/\s+/).filter((token) => token && !ignored.has(token)));
  const rightTokens = right.split(/\s+/).filter((token) => token && !ignored.has(token));
  return rightTokens.reduce((score, token) => score + (leftTokens.has(token) ? 1 : 0), 0);
};

const lumatonePortPriority = (port, selectedInput = null) => {
  const name = port?.name?.toLowerCase() ?? "";
  const inputName = selectedInput?.name?.toLowerCase() ?? "";
  const isMidiFunction = name.includes("midi function");
  const inputIsMidiFunction = inputName.includes("midi function");

  if (inputIsMidiFunction && isMidiFunction) return 0;
  if (isMidiFunction) return 1;
  if (name.includes("lumatone")) return 2;
  return 3;
};

export const resolveBidirectionalControllerOutputPort = (
  outputs,
  selectedInput,
  controller,
  overridePortId = null,
) => {
  if (!outputs) return null;
  if (overridePortId) {
    const overridePort = outputs.get(overridePortId) ?? null;
    if (overridePort) return overridePort;
  }
  if (!controller) return null;

  const rankedOutputs = Array.from(outputs.values()).map((output, index) => ({ output, index }));
  const detectedMatch =
    rankedOutputs
      .filter(({ output }) => controller.detect(output.name?.toLowerCase() ?? ""))
      .sort(
        (a, b) =>
          lumatonePortPriority(a.output, selectedInput) -
            lumatonePortPriority(b.output, selectedInput) ||
          midiPortNameSimilarity(b.output.name, selectedInput?.name) -
            midiPortNameSimilarity(a.output.name, selectedInput?.name) ||
          a.index - b.index,
      )[0]?.output ?? null;
  if (detectedMatch) return detectedMatch;

  const bestNameMatch =
    rankedOutputs
      .map(({ output, index }) => ({
        output,
        index,
        similarity: midiPortNameSimilarity(output.name, selectedInput?.name),
      }))
      .sort((a, b) => b.similarity - a.similarity || a.index - b.index)[0] ?? null;

  // If a manually selected controller geometry is routed through a generic USB
  // MIDI interface like UM-ONE, the output name may not identify the controller
  // at all. A strong same-name match to the selected input is a safe fallback.
  if (bestNameMatch && bestNameMatch.similarity >= 900) return bestNameMatch.output;
  return null;
};

export const resolveLumatoneOutputPort = (outputs, selectedInput, overridePortId = null) =>
  resolveBidirectionalControllerOutputPort(
    outputs,
    selectedInput,
    getControllerById("lumatone"),
    overridePortId,
  );

export const resolveReservedHakenOutputId = (midi, settings, activeInputControllerId = null) => {
  if (!midi || activeInputControllerId !== "hakenaudio") return null;
  if (!settings.midiin_device || settings.midiin_device === "OFF") return null;
  const rawIn = midi.inputs.get(settings.midiin_device);
  if (!rawIn) return null;
  const ctrl = resolveInputController(rawIn, settings.midiin_controller_override);
  if (!ctrl || ctrl.id !== "hakenaudio") return null;
  const rawOut = resolveBidirectionalControllerOutputPort(
    midi.outputs,
    rawIn,
    ctrl,
    settings.hakenaudio_out_port ?? null,
  );
  return rawOut?.id ?? null;
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
    settings.midi_mapping !== "MTS_BULK" &&
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
      isFluidsynthMirror: false,
      anchorNote: settings.midiin_anchor_note,
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
      allocationMode: "mts1",
      transportMode: "single_note_realtime",
      output: fluidsynthOutputObj,
      channel: settings.fluidsynth_channel,
      velocity: midiVelocity,
      deviceId: settings.device_id ?? 127,
      mapNumber: (settings.fluidsynth_channel + 1) & 0x7f,
      isFluidsynthMirror: true,
      anchorNote: settings.midiin_anchor_note,
      sysexType: settings.sysex_type,
      pitchBendRange: settings.midi_wheel_semitones ?? 2,
    });
  }

  if (
    settings.output_mts_bulk &&
    midi &&
    settings.mts_bulk_device &&
    settings.mts_bulk_device !== "OFF" &&
    settings.mts_bulk_channel >= 0 &&
    typeof midiVelocity === "number" &&
    tuningRuntime
  ) {
    const isStaticMode = settings.mts_bulk_mode === "static";
    const bulkAnchor = isStaticMode
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
      output: midi.outputs.get(settings.mts_bulk_device),
      channel: settings.mts_bulk_channel,
      velocity: midiVelocity,
      deviceId: settings.mts_bulk_device_id ?? 127,
      mapNumber: settings.mts_bulk_tuning_map_number ?? 0,
      mapName: resolveBulkDumpName(
        settings.mts_bulk_tuning_map_name,
        settings.short_description,
        settings.name,
      ),
      anchorNote: bulkAnchor,
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
  if (!event.shiftKey) return null;
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
 * @param {boolean}  options.deferSampleActivation - Delay browser sample synth construction
 *                                                   until after first gesture
 *
 * @returns {{ synth, midi, midiTick, loading, midiLearnActive, setMidiLearnActive,
 *             octaveTranspose, octaveDeferred,
 *             shiftOctave, toggleOctaveDeferred,
 *             onVolumeChange, onAnchorLearn }}
 */
const useSynthWiring = (
  settings,
  setSettings,
  { ready, userHasInteracted, keysRef, synthRef, deferSampleActivation = false },
) => {
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const [synth, setSynth] = useState(null);
  const [readySampleInstrument, setReadySampleInstrument] = useState(null);
  const [midi, setMidi] = useState(null);
  const [midiAccess, setMidiAccess] = useState("none");
  const [midiAccessError, setMidiAccessError] = useState(null);
  const [midiLearnActive, setMidiLearnActive] = useState(false);
  const [hakenPedalLearnActive, setHakenPedalLearnActive] = useState(false);
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
  const retiringSampleSynthsRef = useRef(new Set());
  const mpeSynthRef = useRef({ key: null, synth: null });
  const monoSynthRef = useRef({ key: null, synth: null });
  const mtsSynthsRef = useRef(new Map());
  const oscSynthRef = useRef({ key: null, synth: null });
  const midiRequestRef = useRef(null);
  const midiDisableRef = useRef(null);
  const midiPermissionGenerationRef = useRef(0);
  const midiPortsChangedListenerRef = useRef(null);
  const mountedRef = useRef(true);
  const sampleRequestsRef = useRef(null);
  if (!sampleRequestsRef.current) sampleRequestsRef.current = createOutputCandidateRequests();
  const midiRequestsRef = useRef(null);
  if (!midiRequestsRef.current) midiRequestsRef.current = createOutputCandidateRequests();
  const oscRequestsRef = useRef(null);
  if (!oscRequestsRef.current) oscRequestsRef.current = createOutputCandidateRequests();
  const oscRuntimeControlsRef = useRef(null);
  if (!oscRuntimeControlsRef.current) oscRuntimeControlsRef.current = readOscRuntimeControls(settings);
  const outputPortIdentityRef = useRef(null);
  if (!outputPortIdentityRef.current) outputPortIdentityRef.current = createOutputPortIdentity();

  const clearAllOutputSynthRefs = useCallback(() => {
    clearOutputSynthRefs({
      activeRefs: [sampleSynthRef, oscSynthRef, mpeSynthRef, monoSynthRef],
      mtsRef: mtsSynthsRef,
      retiringSamplesRef: retiringSampleSynthsRef,
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearAllOutputSynthRefs();
    };
  }, [clearAllOutputSynthRefs]);

  const clearMidiSelections = useCallback(() => {
    Object.entries(MIDI_PORT_RESET).forEach(([key, value]) => {
      sessionStorage.setItem(key, String(value));
    });
    setSettings((prev) => ({ ...prev, ...MIDI_PORT_RESET }));
  }, [setSettings]);

  // ── MIDI access ─────────────────────────────────────────────────────────────

  const ensureMidiAccess = useCallback(
    async ({ sysex = false } = {}) => {
      const generation = midiPermissionGenerationRef.current;
      const disabling = midiDisableRef.current;
      if (disabling) await disabling;
      if (generation !== midiPermissionGenerationRef.current) return false;
      const targetAccess = sysex ? "sysex" : "basic";
      if (!disabling && WebMidi.enabled && midiAccessRank[midiAccess] >= midiAccessRank[targetAccess]) return true;
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
          const enabledWebMidi = await enableMidi({ sysex });
          if (generation !== midiPermissionGenerationRef.current) return false;
          const midiAccessObj = enabledWebMidi?.interface ?? WebMidi.interface;
          if (!midiAccessObj) throw new Error("WebMidi did not expose its MIDI access interface.");
          debugLog("midi", sysex ? "Web MIDI API with sysex is ready!" : "Web MIDI API is ready!");
          midiPortsChangedListenerRef.current?.();
          const refreshMidiPorts = () => {
            setMidiTick((t) => t + 1);
          };
          const webMidiPortsListener = WebMidi.addListener("portschanged", refreshMidiPorts);
          // Firefox may add a native port in the closed state. WebMidi.js only
          // synthesizes `portschanged` for a narrower set of state/connection
          // combinations, so also observe the underlying MIDIAccess directly.
          // addEventListener coexists with WebMidi.js's own onstatechange hook.
          midiAccessObj.addEventListener?.("statechange", refreshMidiPorts);
          midiPortsChangedListenerRef.current = () => {
            webMidiPortsListener?.remove?.();
            midiAccessObj.removeEventListener?.("statechange", refreshMidiPorts);
          };
          setMidi(midiAccessObj);
          setMidiAccess(targetAccess);
          sessionStorage.setItem(MIDI_ACCESS_SESSION_KEY, targetAccess);
          return true;
        } catch (err) {
          if (generation !== midiPermissionGenerationRef.current) return false;
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
          if (generation === midiPermissionGenerationRef.current) midiRequestRef.current = null;
        }
      })();

      midiRequestRef.current = { target: targetAccess, promise: request };
      return request;
    },
    [midiAccess],
  );

  const disableMidiAccess = useCallback(
    async ({ reenableBasic = false, clearSelections = true } = {}) => {
      midiPermissionGenerationRef.current += 1;
      if (midiDisableRef.current) return midiDisableRef.current;
      const pendingAccess = midiRequestRef.current?.promise;
      // Stop output engines while their ports are still usable. All MIDI routes
      // are closing here, so queued attacks may safely be cancelled per port.
      cleanUpOutputs([...midi?.outputs.values() ?? []].map(output => () => output.clear?.()));
      clearOutputRef(mpeSynthRef, { disconnected: true });
      clearOutputRef(monoSynthRef, { disconnected: true });
      pruneOutputMap(mtsSynthsRef);
      cleanUpOutputs([() => keysRef.current?.disconnectMidiInput?.()]);
      if (clearSelections) clearMidiSelections();
      setMidi(null);
      setMidiAccess("none");
      setMidiAccessError(null);
      midiRequestRef.current = null;
      midiPortsChangedListenerRef.current?.();
      midiPortsChangedListenerRef.current = null;
      sessionStorage.setItem(MIDI_ACCESS_SESSION_KEY, "none");
      const closing = (async () => {
        try {
          // An earlier permission prompt may still be resolving. It must finish
          // before disable, and cannot publish its obsolete access state.
          if (pendingAccess) await pendingAccess;
          await WebMidi.disable?.();
        } catch (err) {
          warnLog("Web MIDI disable could not complete cleanly:", err);
        }
      })();
      midiDisableRef.current = closing;
      await closing;
      if (midiDisableRef.current === closing) midiDisableRef.current = null;
      if (reenableBasic) {
        return ensureMidiAccess({ sysex: false });
      }
      return true;
    },
    [clearMidiSelections, ensureMidiAccess, keysRef, midi],
  );

  useEffect(
    () => () => {
      midiPortsChangedListenerRef.current?.();
      midiPortsChangedListenerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (midi || midiDisableRef.current) return;
    const recoveredMidi = snapshotWebMidiPorts();
    if (!recoveredMidi) return;
    setMidi(recoveredMidi);
    setMidiTick((current) => current + 1);
    setMidiAccess((current) => {
      if (current !== "none") return current;
      return settings.webmidi_sysex_enabled ? "sysex" : "basic";
    });
  }, [midi, settings.webmidi_sysex_enabled]);

  useEffect(() => {
    if (midiAccess !== "none" || midi) return;
    if (!settings.webmidi_enabled) return;

    let cancelled = false;
    const wantsSysex = !!settings.webmidi_sysex_enabled;

    ensureMidiAccess({ sysex: wantsSysex }).then((ok) => {
      if (cancelled || ok) return;
      setSettings(
        (prev) => {
          if (!prev.webmidi_enabled && !prev.webmidi_sysex_enabled) return prev;
          return {
            ...prev,
            webmidi_enabled: false,
            webmidi_sysex_enabled: false,
          };
        },
        { updateUrl: false },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    ensureMidiAccess,
    midi,
    midiAccess,
    setSettings,
    settings.webmidi_enabled,
    settings.webmidi_sysex_enabled,
  ]);

  // ── Reconstruction boundary contract ────────────────────────────────────────
  //
  // This block documents which settings changes trigger which kind of update.
  // It is the single source of truth for reactivity decisions in this file.
  // Before adding a new setting to ANY dependency array below, classify it here.
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ OUTPUT GRAPH REBUILD                                                    │
  // │ Reuses unchanged engines and creates/removes changed engines in parallel.│
  // │ Existing logical notes reconcile their child voices into the new graph. │
  // │ Controlled by the main useEffect dependency array (lines below).        │
  // │                                                                         │
  // │  Tuning/pitch (all outputs depend on these):                            │
  // │    instrument          — sample buffers must be reloaded                │
  // │    fundamental         — root pitch changes all MTS calculations        │
  // │    reference_degree    — changes offset between scale degree 0 and ref  │
  // │    center_degree       — changes static bulk map anchor calculation     │
  // │    scale               — changes all per-note pitch values              │
  // │                                                                         │
  // │  MTS real-time output:                                                  │
  // │    output_mts          — enable/disable the real-time MTS engine        │
  // │    midi_device         — output port changes require new synth object   │
  // │    midi_channel        — channel is baked into the synth at creation    │
  // │    midi_mapping        — MTS1 vs MTS2 allocation mode                   │
  // │    midi_velocity       — velocity is baked into the output config       │
  // │    device_id           — MTS sysex device ID (broadcast vs addressed)   │
  // │    tuning_map_number   — MTS map slot to write                          │
  // │    sysex_type          — sysex type byte (126 vs 127)                   │
  // │    fluidsynth_device   — FluidSynth mirror port                         │
  // │    fluidsynth_channel  — FluidSynth mirror channel                      │
  // │                                                                         │
  // │  MTS bulk dump output:                                                  │
  // │    output_mts_bulk     — enable/disable the bulk dump engine            │
  // │    mts_bulk_device     — output port (new port = new synth object)      │
  // │    mts_bulk_mode       — dynamic vs static changes allocation strategy  │
  // │    mts_bulk_channel    — MIDI channel for note-on after bulk dump       │
  // │    mts_bulk_device_id  — device ID in bulk dump sysex header            │
  // │    mts_bulk_tuning_map_number — map slot in bulk dump header            │
  // │    mts_bulk_tuning_map_name   — map name string in bulk dump payload    │
  // │                                                                         │
  // │  MPE output:                                                            │
  // │    output_mpe          — enable/disable MPE engine                      │
  // │    mpe_device          — output port                                    │
  // │    midiin_mpe_manager_ch — MPE zone manager channel                     │
  // │    mpe_lo_ch           — first member channel                           │
  // │    mpe_hi_ch           — last member channel                            │
  // │    mpe_pitchbend_range — pitch bend range baked at MPE init             │
  // │    mpe_mode            — Ableton workaround vs standard MPE             │
  // │    midiin_anchor_note  — constructor anchor for MPE and legacy MTS       │
  // │                                                                         │
  // │  OSC output:                                                            │
  // │    output_osc          — enable/disable OSC WebSocket bridge            │
  // │    osc_bridge_url / osc_synth_names — connection and layer identity      │
  // │                                                                         │
  // │  MIDI state:                                                            │
  // │    midi                — MIDI access object (initial grant or revoke)   │
  // │    midiTick            — incremented on every device connect/disconnect │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ LIVE RUNTIME TRANSPORT / PERFORMANCE CONTROLS                           │
  // │ Imperative actions on the currently running live system.                │
  // │ These should preserve note continuity and avoid broad app reactivity    │
  // │ during continuous interaction.                                          │
  // │                                                                         │
  // │    sample volume/mute   → synthRef.current.setVolume()                  │
  // │    OSC layer faders     → oscSynth.setLayerVolume()                     │
  // │    auto-send map        → keysRef.current.mtsSendMap()                  │
  // │    OCT / sustain / mod  → handled in Keys live runtime                  │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ OUTPUT-RUNTIME ARCHITECTURE CONTROLS                                    │
  // │ These choose how tuning/output is realized, rather than acting like     │
  // │ simple transport knobs. Examples: MTS Dynamic vs Static, output family  │
  // │ toggles, output port selection, and direct-map transport parameters.    │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ CANVAS UPDATE PATH (may accompany an output rebuild)                    │
  // │ Imperative call to keysRef.current — bypasses React render.             │
  // │                                                                         │
  // │    fundamental         → keysRef.current.updateFundamental()            │
  // │                          Redraws note labels on the hex grid.           │
  // │    note_colors         → handled in hooks/use-settings-change.js        │
  // │    spectrum_colors     → handled in hooks/use-settings-change.js        │
  // │    fundamental_color   → handled in hooks/use-settings-change.js        │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ AUTO-SEND TRIGGER (no synth rebuild, no canvas redraw)                  │
  // │ RAF-debounced call to keysRef.current.mtsSendMap().                     │
  // │ Only fires when output_mts_bulk + mts_bulk_mode=static +                │
  // │ mts_bulk_sysex_auto.                                                    │
  // │                                                                         │
  // │    mts_bulk_sysex_auto       — turning auto-send on should send now     │
  // │    mts_bulk_device           — port change should resend                │
  // │    mts_bulk_device_id        — header param change should resend        │
  // │    mts_bulk_tuning_map_number — map slot change should resend           │
  // │    mts_bulk_tuning_map_name  — header param change should resend        │
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
  // │    wheel_scale_aware   — wheel snap mode (keys.js per-event)            │
  // │    midi_passthrough    — MIDI pass-through flag (keys.js)               │
  // │    lumatone_led_sync   — LED feedback toggle (keys.js)                  │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // ── Synth creation ───────────────────────────────────────────────────────────
  // Reconsiders the composite when relevant settings or MIDI state change.
  // output-config.js defines per-engine identity; unchanged children are reused.
  // Candidate requests own pending work, lifecycle helpers own cache teardown,
  // and completeOutputBuild guards publication. Runs only after app readiness.

  useEffect(() => {
    if (!ready) return;

    // Guard against stale async resolutions: if this effect re-runs (settings
    // changed again before the previous Promise.all resolved), the old chain
    // should not call setSynth. Without this, rapid toggles can leave the synth
    // in a stale configuration — e.g. toggling MPE on then sample off could end
    // up with a composite(sample+mpe) synth if the first Promise.all resolved last.
    let cancelled = false;
    const permissionGeneration = midiPermissionGenerationRef.current;
    const isCurrentBuild = () => !cancelled &&
      permissionGeneration === midiPermissionGenerationRef.current;

    const wantSample =
      !deferSampleActivation &&
      settings.output_sample &&
      settings.instrument &&
      settings.instrument !== "OFF" &&
      settings.fundamental;

    // Stored sequence notes are absolute pitches and remain playable before a
    // Hexatone scale is loaded. Synth constructors nevertheless expect a
    // tuning-shaped argument set, so use a neutral 1/1 surface for that case.
    // This does not enable MTS bulk output: deriveTuningRuntime still receives
    // the real settings below and remains null until a real scale is present.
    const hasPlaybackScale = Array.isArray(settings.scale) && settings.scale.length > 0;
    const playbackScale = hasPlaybackScale ? settings.scale : [0];
    const playbackReferenceDegree = hasPlaybackScale ? settings.reference_degree : 0;
    const playbackCenterDegree = hasPlaybackScale ? settings.center_degree : 0;
    const playbackEquivSteps = hasPlaybackScale
      ? (settings.equivSteps ?? settings.scale.length)
      : 1;
    const playbackEquivInterval = hasPlaybackScale ? (settings.equivInterval ?? 1200) : 1200;

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

    const monoOutput = settings.output_mono && midi?.outputs.get(settings.mono_device);
    if (
      !wantSample &&
      !wantMts &&
      !wantFluidsynth &&
      !wantDirect &&
      !wantMpe &&
      !wantOsc &&
      !monoOutput
    ) {
      clearAllOutputSynthRefs();
      const silentSynth = create_composite_synth([]);
      keysRef.current?.updateLiveOutputState?.(null, silentSynth);
      setSynth(silentSynth);
      return () => {
        cancelled = true;
      };
    }

    // Replacing a live sample engine is a background handoff: the old sound
    // remains playable while buffers load. Keep this decision local so stale
    // completions only decrement counters that their own build incremented.
    const showLoading = !(wantSample && sampleSynthRef.current.synth);
    if (showLoading) setLoading(wait);
    let loadingFinished = false;
    const finishLoading = () => {
      if (loadingFinished) return;
      loadingFinished = true;
      if (showLoading && mountedRef.current) setLoading(signal);
    };
    const promises = [];
    const playbackTuning = { referenceDegree: playbackReferenceDegree, scale: playbackScale,
      centerDegree: playbackCenterDegree, equivSteps: playbackEquivSteps,
      equivInterval: playbackEquivInterval };
    if (monoOutput) {
      const { key, args } = monoOutputConfig(settings, playbackTuning, monoOutput, outputPortIdentityRef.current);
      if (monoSynthRef.current.key !== key || monoSynthRef.current.output !== monoOutput) {
        clearOutputRef(monoSynthRef);
        monoSynthRef.current = {
          key,
          output: monoOutput,
          synth: createMonoSynth(args),
        };
      }
      promises.push(Promise.resolve(monoSynthRef.current.synth));
    } else if (monoSynthRef.current.synth) {
      clearOutputRef(monoSynthRef);
    }

    const sampleConfig = sampleOutputConfig(settings, playbackTuning);
    const sampleKey = sampleConfig.key;
    if (!wantSample) {
      clearSampleOutputs(sampleSynthRef, retiringSampleSynthsRef);
    }

    if (wantSample) {
      if (sampleSynthRef.current.key === sampleKey && sampleSynthRef.current.synth) {
        promises.push(Promise.resolve(sampleSynthRef.current.synth));
      } else {
        promises.push(
          sampleRequestsRef.current(
            JSON.stringify([sampleKey, userHasInteracted]),
            () => loadSampleSynthModule().then(({ create_sample_synth }) =>
                create_sample_synth(...sampleConfig.args),
              ),
            {
              isCurrent: isCurrentBuild,
              // While playback is running, keep the previous sample engine in
              // service until the replacement has fetched and decoded all of
              // its buffers. The output graph is swapped only after prepare()
              // resolves, so instrument selection never creates a silent gap.
              prepare: userHasInteracted ? candidate => candidate.prepare?.() : undefined,
              adopt: s => {
                adoptSampleOutput(sampleSynthRef, retiringSampleSynthsRef, sampleKey, s);
              },
            },
          ),
        );
      }
    }
    if (wantMts || wantFluidsynth || wantDirect) {
      const desiredMtsKeys = new Set();
      for (const outputMode of mtsOutputs) {
        if (!outputMode.output) continue;
        const { key: mtsKey, args } = mtsOutputConfig(settings, tuningRuntime, outputMode,
          outputPortIdentityRef.current, () => ({
            deviceId: settingsRef.current.mts_bulk_device_id ?? 127,
            mapNumber: settingsRef.current.mts_bulk_tuning_map_number ?? 0,
            name: resolveBulkDumpName(settingsRef.current.mts_bulk_tuning_map_name,
              settingsRef.current.short_description, settingsRef.current.name),
          }));
        desiredMtsKeys.add(mtsKey);
        const existing = mtsSynthsRef.current.get(mtsKey);
        if (existing) {
          promises.push(Promise.resolve(existing));
          continue;
        }
        promises.push(
          midiRequestsRef.current(JSON.stringify(["mts", mtsKey, permissionGeneration]), () => create_midi_synth(args), {
            isCurrent: () => isCurrentBuild() &&
              midi?.outputs.get(outputMode.output.id) === outputMode.output,
            adopt: s => mtsSynthsRef.current.set(mtsKey, s),
          }),
        );
      }
      pruneOutputMap(mtsSynthsRef, desiredMtsKeys);
    } else if (mtsSynthsRef.current.size > 0) {
      pruneOutputMap(mtsSynthsRef);
    }
    if (wantOsc) {
      const oscConfig = oscOutputConfig(settings, playbackTuning);
      const oscKey = oscConfig.key;
      if (oscSynthRef.current.key === oscKey && oscSynthRef.current.synth) {
        promises.push(Promise.resolve(oscSynthRef.current.synth));
      } else {
        clearOutputRef(oscSynthRef);
        promises.push(
          oscRequestsRef.current(oscKey, () => create_osc_synth(
            ...oscConfig.args(readOscRuntimeControls(settingsRef.current))), {
            isCurrent: isCurrentBuild,
            adopt: s => {
              applyOscRuntimeControls(s, oscRuntimeControlsRef.current);
              oscSynthRef.current = { key: oscKey, synth: s };
            },
          }),
        );
      }
    } else {
      clearOutputRef(oscSynthRef);
    }
    const activeInputControllerId = (() => {
      if (settings.midiin_controller_override && settings.midiin_controller_override !== "auto") {
        return settings.midiin_controller_override;
      }
      if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return null;
      const input = midi.inputs.get(settings.midiin_device);
      return resolveInputController(input, settings.midiin_controller_override)?.id ?? null;
    })();
    const reservedHakenOutputId = resolveReservedHakenOutputId(
      midi,
      settings,
      activeInputControllerId,
    );
    const hakenMpeActive = activeInputControllerId === "hakenaudio";
    const allowMpePlaybackOnSelectedPort = !(
      reservedHakenOutputId && settings.mpe_device === reservedHakenOutputId
    );
    const mpeOutput = midi?.outputs.get(settings.mpe_device);
    // An engine bound to an obsolete connection must not be reused just because
    // the replacement has the same device ID. Ordinary owned-voice release only.
    if (mpeSynthRef.current.synth && mpeSynthRef.current.output !== mpeOutput) {
      clearOutputRef(mpeSynthRef);
    }
    if (wantMpe && allowMpePlaybackOnSelectedPort && mpeOutput) {
      const { key: mpeKey, args } = mpeOutputConfig(settings, playbackTuning, mpeOutput,
        outputPortIdentityRef.current, hakenMpeActive);
      if (mpeSynthRef.current.key === mpeKey && mpeSynthRef.current.synth) {
        mpeSynthRef.current.synth.setMpePlusPitchBendEnabled?.(!!settings.mpe_plus_output);
        mpeSynthRef.current.synth.setAutoGenerateMpeYzEnabled?.(!!settings.mpe_auto_generate_yz);
        promises.push(Promise.resolve(mpeSynthRef.current.synth));
      } else {
        clearOutputRef(mpeSynthRef);
        promises.push(
          midiRequestsRef.current(JSON.stringify(["mpe", mpeKey, permissionGeneration]), () => create_mpe_synth(...args), {
            isCurrent: () => isCurrentBuild() && midi.outputs.get(settings.mpe_device) === mpeOutput,
            adopt: s => {
              s?.setMpePlusPitchBendEnabled?.(!!settingsRef.current.mpe_plus_output);
              s?.setAutoGenerateMpeYzEnabled?.(!!settingsRef.current.mpe_auto_generate_yz);
              mpeSynthRef.current = { key: mpeKey, synth: s, output: mpeOutput };
            },
          }),
        );
      }
    } else if (mpeSynthRef.current.synth) {
      clearOutputRef(mpeSynthRef);
    }

    void completeOutputBuild({
      pending: promises,
      isCurrent: isCurrentBuild,
      finish: finishLoading,
      onError: (error, phase) => warnLog(`Synth ${phase} failed:`, error),
      install: (validSynths) => {
        // Even an entirely failed build publishes an empty composite: logical
        // held notes detach obsolete children instead of retaining a dead graph.
        const s = create_composite_synth(validSynths, retiringSampleSynthsRef.current);
        if (s.setVolume) {
          const muted = localStorage.getItem("synth_muted") === "true";
          const volume = parseFloat(localStorage.getItem("synth_volume") ?? "1") || 1.0;
          s.setVolume(muted ? 0 : volume);
        }
        // Reconcile before publishing React state. No await may separate these
        // steps: another build must not interleave with this handoff.
        keysRef.current?.updateLiveOutputState?.(null, s);
        setSynth(s);
        if (wantSample && validSynths.includes(sampleSynthRef.current.synth)) {
          setReadySampleInstrument(settings.instrument);
        }
        // Do not await graph preparation here: browser audio activation may
        // require a fresh user gesture. Sample handoff preparation is owned by
        // its candidate; this preserves the existing restored-iOS activation.
        if (userHasInteracted && deferSampleActivation && s.prepare) {
          void Promise.resolve(s.prepare()).catch(error =>
            warnLog("Synth preparation failed:", error));
        }
      },
    });

    return () => {
      cancelled = true;
      finishLoading();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysRef is stable; settings covered field-by-field below
  }, [
    clearAllOutputSynthRefs,
    settings.instrument,
    // MIDI output runtimes derive anchors and tuning context from the current
    // fundamental and center degree, so those changes must rebuild the synth.
    settings.fundamental,
    settings.reference_degree,
    settings.center_degree,
    settings.scale,
    settings.equivSteps,
    settings.equivInterval,
    settings.name,
    settings.short_description,
    settings.midiin_anchor_note,
    settings.midiin_device,
    settings.midiin_controller_override,
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
    settings.output_mono,
    settings.mono_device,
    settings.mono_channel,
    settings.mono_bend_range,
    settings.output_mts_bulk,
    settings.output_osc,
    settings.osc_bridge_url,
    settings.osc_synth_names,
    settings.mts_bulk_device,
    settings.mts_bulk_mode,
    settings.mts_bulk_channel,
    settings.mts_bulk_device_id,
    settings.mts_bulk_tuning_map_number,
    settings.mts_bulk_tuning_map_name,
    settings.fluidsynth_device,
    settings.fluidsynth_channel,
    settings.sysex_type,
    settings.mpe_device,
    settings.midiin_mpe_manager_ch,
    settings.mpe_lo_ch,
    settings.mpe_hi_ch,
    settings.mpe_pitchbend_range,
    settings.mpe_pitchbend_range_manager,
    settings.mpe_mode,
    midi,
    midiTick,
    ready,
    deferSampleActivation,
    userHasInteracted,
    // keysRef and settings (whole object) intentionally omitted — keysRef is a stable ref,
    // and settings is covered field-by-field above.
  ]);

  // ── Imperative propagation ──────────────────────────────────────────────────
  useEffect(() => {
    monoSynthRef.current.synth?.setPortamento(
      !!settings.mono_portamento,
      settings.mono_portamento_time ?? 80,
    );
  }, [settings.mono_portamento, settings.mono_portamento_time]);

  useEffect(() => {
    monoSynthRef.current.synth?.setSlideCc(settings.mono_slide_cc ?? 74);
  }, [settings.mono_slide_cc]);

  useEffect(() => {
    mpeSynthRef.current.synth?.setMpePlusPitchBendEnabled?.(!!settings.mpe_plus_output);
  }, [settings.mpe_plus_output]);

  useEffect(() => {
    mpeSynthRef.current.synth?.setAutoGenerateMpeYzEnabled?.(!!settings.mpe_auto_generate_yz);
  }, [settings.mpe_auto_generate_yz]);

  useEffect(() => {
    oscRuntimeControlsRef.current = readOscRuntimeControls(settings);
    applyOscRuntimeControls(oscSynthRef.current.synth, oscRuntimeControlsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- control inputs listed individually; unrelated settings must not overwrite an uncommitted live drag
  }, [settings.osc_volumes, settings.osc_volume_pluck, settings.osc_volume_buzz,
    settings.osc_volume_formant, settings.osc_volume_saw, settings.osc_quick_release,
    settings.osc_quick_release_time, settings.osc_quick_release_raster_only,
    settings.osc_sustain_buzz_formant, settings.osc_retrigger_buzz_formant]);

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

  // In MTS bulk static mode, turning on auto-send or changing map parameters
  // should immediately send the current static snapshot without waiting for
  // another retune action. Defer to the next frame so any Keys reconstruction
  // from structural setting changes has already completed.
  useEffect(() => {
    if (
      !ready ||
      !settings.output_mts_bulk ||
      settings.mts_bulk_mode !== "static" ||
      !settings.mts_bulk_sysex_auto ||
      !settings.mts_bulk_device ||
      settings.mts_bulk_device === "OFF" ||
      !keysRef.current
    )
      return;

    const output = WebMidi.getOutputById(settings.mts_bulk_device);
    if (!output) return;

    let timer = setTimeout(() => {
      if (keysRef.current) keysRef.current.mtsSendMap(output);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysRef is a stable ref, intentionally omitted
  }, [
    ready,
    midi,
    settings.output_mts_bulk,
    settings.mts_bulk_mode,
    settings.mts_bulk_sysex_auto,
    settings.mts_bulk_device,
    settings.mts_bulk_device_id,
    settings.mts_bulk_tuning_map_number,
    settings.mts_bulk_tuning_map_name,
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
        settings.output_mts_bulk &&
        settings.mts_bulk_mode === "static" &&
        settings.mts_bulk_device &&
        settings.mts_bulk_device !== "OFF" &&
        keysRef.current?.mtsSendMap
      ) {
        const output = WebMidi.getOutputById(settings.mts_bulk_device);
        if (output) {
          setTimeout(() => {
            if (keysRef.current?.mtsSendMap) {
              keysRef.current.mtsSendMap(output, false, false);
            }
          }, 0);
        }
      }
    },
    [
      octaveDeferred,
      ready,
      settings.output_mts_bulk,
      settings.mts_bulk_mode,
      settings.mts_bulk_device,
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
  // midiTick is included because Web MIDI inputs can finish enumerating after
  // the first render/effect pass on reload; without a retry here, controller-
  // scoped settings can stay stale until the user manually toggles something.
  useEffect(() => {
    if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return;
    const input = Array.from(midi.inputs.values()).find((i) => i.id === settings.midiin_device);
    if (!input) return;
    const ctrl = resolveControllerPrefsTarget(input, settings.midiin_controller_override);
    if (!ctrl) return;
    setSettings(
      (s) => {
        const loadedControllerSettings = loadAnchorSettingsUpdate(ctrl, s);
        const nextAnchorSettings = hasExplicitPresetControllerAnchor(s, ctrl.id)
          ? applyPresetControllerAnchor(s, ctrl.id, loadedControllerSettings)
          : loadedControllerSettings;
        const changed = Object.entries(nextAnchorSettings).some(([key, value]) => s[key] !== value);
        return changed ? { ...s, ...nextAnchorSettings } : s;
      },
      { updateUrl: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSettings is a stable state setter; settingsRef is a stable ref
  }, [
    midi,
    midiTick,
    settings.midiin_device,
    settings.midiin_controller_override,
    settings.midiin_mpe_input,
    settings.midi_passthrough,
    settings.lumatone_anchor_note,
    settings.lumatone_anchor_channel,
    settings.exquis_anchor_note,
    settings.linnstrument_anchor_note,
    settings.linnstrument_anchor_channel,
    settings.haken_anchor_note,
  ]);

  // ── Volume / anchor learn ───────────────────────────────────────────────────

  const onVolumeChange = useCallback((volume, muted) => {
    if (synthRef.current && synthRef.current.setVolume) {
      synthRef.current.setVolume(muted ? 0 : volume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- synthRef is a stable ref
  }, []);

  const onOscLayerVolumeChange = useCallback((index, value) => {
    oscRuntimeControlsRef.current.volumes[index] = value;
    const oscSynth = oscSynthRef.current.synth;
    // Runtime transport control only: do not write app settings here.
    // The UI persists the chosen value on commit, but live drag must stay on
    // the imperative OSC path so held notes are not interrupted by reactivity.
    if (oscSynth?.setLayerVolume) oscSynth.setLayerVolume(index, value);
  }, []);

  const onOscQuickReleaseChange = useCallback((value) => {
    oscRuntimeControlsRef.current.quickRelease = value;
    const oscSynth = oscSynthRef.current.synth;
    if (oscSynth?.setQuickRelease) oscSynth.setQuickRelease(value);
  }, []);

  const onOscQuickReleaseTimeChange = useCallback((value) => {
    oscRuntimeControlsRef.current.quickReleaseTime = value;
    const oscSynth = oscSynthRef.current.synth;
    if (oscSynth?.setQuickReleaseTime) oscSynth.setQuickReleaseTime(value);
  }, []);

  const onOscQuickReleaseRasterOnlyChange = useCallback((value) => {
    oscRuntimeControlsRef.current.rasterOnly = value;
    const oscSynth = oscSynthRef.current.synth;
    if (oscSynth?.setQuickReleaseRasterOnly) oscSynth.setQuickReleaseRasterOnly(value);
  }, []);

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
        ? {
            ...saveAnchorFromLearn(ctrl, noteNum, ch, s),
            ...buildPresetControllerAnchorUpdate(ctrl.id, noteNum, ch),
          }
        : { midiin_anchor_note: noteNum, midiin_anchor_channel: ch };

      // midiin_anchor_channel drives the relative channel-offset formula in
      // noteToSteps() for all paths (sequential, unknown, passthrough).
      sessionStorage.setItem("midiin_anchor_note", String(update.midiin_anchor_note));
      sessionStorage.setItem("midiin_anchor_channel", String(update.midiin_anchor_channel));
      setSettings((s) => ({ ...s, ...update }), { updateUrl: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settingsRef is stable; setSettings is a stable state setter
    [midi],
  );

  const onHakenPedalLearn = useCallback(
    (ccNum) => {
      setHakenPedalLearnActive(false);
      const cc = Number.isFinite(ccNum) ? Math.max(0, Math.min(127, Math.trunc(ccNum))) : -1;
      const s = settingsRef.current;
      let ctrl = null;
      if (s.midiin_device && s.midiin_device !== "OFF" && midi) {
        const input = Array.from(midi.inputs.values()).find((m) => m.id === s.midiin_device);
        if (input) ctrl = resolveInputController(input, s.midiin_controller_override);
      }
      if (ctrl) {
        saveControllerPref(ctrl, "hakenaudio_glide_flip_cc", cc, s, {
          hakenaudio_glide_flip_cc: cc,
        });
      }
      setSettings((current) => ({ ...current, hakenaudio_glide_flip_cc: cc }));
    },
    [midi, setSettings],
  );

  // ── Lumatone raw MIDI ports ──────────────────────────────────────────────────
  // When the active MIDI input is a Lumatone, resolve its matching native
  // ports, then expose WebMidi.js wrappers for ACK listening and LED SysEx.
  const lumatoneRawPorts = useMemo(() => {
    if (midiAccess !== "sysex") return null;
    if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return null;
    const rawIn = midi.inputs.get(settings.midiin_device);
    if (!rawIn) return null;
    const ctrl = resolveInputController(rawIn, settings.midiin_controller_override);
    if (!ctrl || ctrl.id !== "lumatone") return null;
    // Manual override takes precedence; fall back to name-match auto-detect.
    const rawOut = resolveBidirectionalControllerOutputPort(
      midi.outputs,
      rawIn,
      ctrl,
      settings.lumatone_out_port ?? null,
    );
    if (!rawOut) return null;
    // Receive and transmit through the WebMidi.js wrappers. In particular,
    // sendSysex(manufacturer, payload) owns the normal F0/F7 framing just as it
    // does for Hexatone's MTS output, keeping application-level packets out of
    // the browser-dependent native/wrapper selection path. Browser Web MIDI
    // regressions may still affect the wrapper's underlying native transport.
    const webMidiIn = rawIn ? WebMidi.getInputById(rawIn.id) : null;
    const webMidiOut = WebMidi.getOutputById(rawOut.id);
    return { input: webMidiIn ?? rawIn, output: webMidiOut ?? rawOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    midi,
    midiTick,
    midiAccess,
    settings.midiin_device,
    settings.midiin_controller_override,
    settings.lumatone_out_port,
  ]); // midiTick forces re-run on device connect/disconnect

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
    const rawOut = resolveBidirectionalControllerOutputPort(
      midi.outputs,
      rawIn,
      ctrl,
      settings.exquis_out_port ?? null,
    );
    if (!rawOut) return null;
    return { input: rawIn, output: rawOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    midi,
    midiTick,
    midiAccess,
    settings.midiin_device,
    settings.midiin_controller_override,
    settings.exquis_out_port,
  ]); // midiTick forces re-run on device connect/disconnect

  // When the active MIDI input is a LinnStrument 128, resolve the matching raw
  // Web MIDI output port for NRPN configuration sends and CC LED updates.
  // No sysex required — regular Web MIDI access is sufficient.
  const linnstrumentRawPorts = useMemo(() => {
    if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return null;
    const rawIn = midi.inputs.get(settings.midiin_device);
    if (!rawIn) return null;
    const ctrl = resolveInputController(rawIn, settings.midiin_controller_override);
    if (!ctrl || ctrl.id !== "linnstrument") return null;
    const rawOut = resolveBidirectionalControllerOutputPort(
      midi.outputs,
      rawIn,
      ctrl,
      settings.linnstrument_out_port ?? null,
    );
    if (!rawOut) return null;
    return { input: rawIn, output: rawOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    midi,
    midiTick,
    settings.midiin_device,
    settings.midiin_controller_override,
    settings.linnstrument_out_port,
  ]); // midiTick forces re-run on device connect/disconnect

  const hakenRawPorts = useMemo(() => {
    if (!midi || !settings.midiin_device || settings.midiin_device === "OFF") return null;
    const rawIn = midi.inputs.get(settings.midiin_device);
    if (!rawIn) return null;
    const ctrl = resolveInputController(rawIn, settings.midiin_controller_override);
    if (!ctrl || ctrl.id !== "hakenaudio") return null;
    const rawOut = resolveBidirectionalControllerOutputPort(
      midi.outputs,
      rawIn,
      ctrl,
      settings.hakenaudio_out_port ?? null,
    );
    if (!rawOut) return null;
    return { input: rawIn, output: rawOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    midi,
    midiTick,
    settings.midiin_device,
    settings.midiin_controller_override,
    settings.hakenaudio_out_port,
  ]);

  return {
    synth,
    readySampleInstrument,
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
    hakenPedalLearnActive,
    setHakenPedalLearnActive,
    octaveTranspose,
    setOctaveTranspose,
    octaveDeferred,
    shiftOctave,
    resetOctave,
    toggleOctaveDeferred,
    onVolumeChange,
    onOscLayerVolumeChange,
    onOscQuickReleaseChange,
    onOscQuickReleaseTimeChange,
    onOscQuickReleaseRasterOnlyChange,
    onAnchorLearn,
    onHakenPedalLearn,
    lumatoneRawPorts,
    exquisRawPorts,
    linnstrumentRawPorts,
    hakenRawPorts,
  };
};

export default useSynthWiring;
