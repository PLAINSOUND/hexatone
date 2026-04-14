import { h } from "preact";
import { useState, useEffect, useMemo, useCallback, useRef } from "preact/hooks";

import Keyboard from "./keyboard";
import { presets } from "./settings/preset_values";
import { normalizeColors, normalizeStructural } from "./normalize-settings.js";
import { instruments } from "./sample_synth/instruments";

import keyCodeToCoords from "./settings/keycodes";
import useSynthWiring from "./use-synth-wiring.js";
import { useMidiGuardian } from "./use-midi-guardian.js";
import {
  useQuery,
  ExtractInt,
  ExtractString,
  ExtractFloat,
  ExtractBool,
  ExtractJoinedString,
} from "./use-query";
import usePresets, { SCALE_KEYS_TO_CLEAR } from "./use-presets.js";
import {
  buildQuerySpec,
  buildRegistryDefaults,
  PRESET_SKIP_KEYS,
} from "./persistence/settings-registry.js";
import useImport from "./use-import.js";
import useSettingsChange from "./use-settings-change.js";
import sessionDefaults from "./session-defaults.js";
import { ExquisLEDs } from "./controllers/exquis-leds.js";
import { LumatoneLEDs } from "./controllers/lumatone-leds.js";
import { detectController, getControllerById } from "./controllers/registry.js";
import Settings from "./settings";
import Blurb from "./blurb";

import PropTypes from "prop-types";

import "normalize.css";
import "./hex-style.css";
import LoadingIcon from "./img/hex.svg?react";
import "./loader.css";

// On browser refresh (not initial load), clear scale/preset sessionStorage unless
// the user has opted into "Restore last preset on page reload".
if (performance.getEntriesByType("navigation")[0]?.type === "reload") {
  const shouldPersist = localStorage.getItem("hexatone_persist_on_reload") === "true";
  if (!shouldPersist) {
    // SCALE_KEYS_TO_CLEAR covers all scale/preset keys.
    // Additionally clear these session flags on reload to prevent unexpected
    // sysex traffic and stale preset-source state on startup.
    const extraKeysToClear = [
      "hexatone_preset_source",
      "hexatone_preset_name",
      "direct_sysex_auto",
    ];
    [...SCALE_KEYS_TO_CLEAR, ...extraKeysToClear].forEach((key) => sessionStorage.removeItem(key));
  }
}

export const Loading = () => <LoadingIcon />;

const ua = navigator.userAgent;
const isSafariOnly =
  /Safari/.test(ua) &&
  !/Chrome/.test(ua) &&
  !/Chromium/.test(ua) &&
  !/Firefox/.test(ua) &&
  !/FxiOS/.test(ua); // Firefox on iOS uses FxiOS token, not "Firefox"
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua)); // iPadOS 13+ desktop mode
const isMIDIWeb = /MIDIWeb/.test(ua);
// Banner messages rendered in JSX (not alert()) so links are clickable.
// showBanner: null = no banner, "ios" = iOS MIDI warning, "safari" = Safari warning.
const BANNER_KEY_VERSION = "v1";
const getBannerSessionKey = (bannerKey) =>
  `hexatone_banner_${bannerKey}_${BANNER_KEY_VERSION}_hidden_session`;
const getBannerDismissKey = (bannerKey) =>
  `hexatone_banner_${bannerKey}_${BANNER_KEY_VERSION}_dismissed`;

function getBannerCandidate() {
  return isIOS && !isMIDIWeb ? "ios" : isSafariOnly ? "safari" : null;
}

function getInitialBanner() {
  const candidate = getBannerCandidate();
  if (!candidate) return null;
  if (localStorage.getItem(getBannerDismissKey(candidate)) === "true") return null;
  if (sessionStorage.getItem(getBannerSessionKey(candidate)) === "true") return null;
  return candidate;
}

function isTextEntryElement(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;

  const type = (el.getAttribute("type") || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(type);
}

const App = () => {
  const [ready, setReady] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [banner, setBanner] = useState(getInitialBanner);
  const [landscapeSafeSide, setLandscapeSafeSide] = useState("none");
  const [textEntryActive, setTextEntryActive] = useState(false);
  const [viewportKeyboardOpen, setViewportKeyboardOpen] = useState(false);
  const keysRef = useRef(null); // live Keys instance for imperative color updates
  const synthRef = useRef(null); // live synth instance for imperative volume/mute control
  const viewportBaselineRef = useRef(0);

  const hideBannerForSession = useCallback((bannerKey) => {
    sessionStorage.setItem(getBannerSessionKey(bannerKey), "true");
    setBanner(null);
  }, []);

  const dismissBanner = useCallback((bannerKey) => {
    localStorage.setItem(getBannerDismissKey(bannerKey), "true");
    sessionStorage.removeItem(getBannerSessionKey(bannerKey));
    setBanner(null);
  }, []);

  useEffect(() => {
    const readPxVar = (name) => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const parsed = parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const updateLandscapeSafeSide = () => {
      const isLandscape = window.matchMedia("(orientation: landscape)").matches;
      if (!isLandscape) {
        setLandscapeSafeSide("none");
        return;
      }

      const leftInset = readPxVar("--safe-area-left");
      const rightInset = readPxVar("--safe-area-right");
      if (leftInset > rightInset && leftInset > 0.5) {
        setLandscapeSafeSide("left");
      } else if (rightInset > leftInset && rightInset > 0.5) {
        setLandscapeSafeSide("right");
      } else {
        setLandscapeSafeSide("none");
      }
    };

    updateLandscapeSafeSide();
    window.addEventListener("resize", updateLandscapeSafeSide);
    window.addEventListener("orientationchange", updateLandscapeSafeSide);
    return () => {
      window.removeEventListener("resize", updateLandscapeSafeSide);
      window.removeEventListener("orientationchange", updateLandscapeSafeSide);
    };
  }, []);

  useEffect(() => {
    const syncTextEntryState = () => {
      setTextEntryActive(isTextEntryElement(document.activeElement));
    };

    syncTextEntryState();
    document.addEventListener("focusin", syncTextEntryState);
    document.addEventListener("focusout", syncTextEntryState);
    return () => {
      document.removeEventListener("focusin", syncTextEntryState);
      document.removeEventListener("focusout", syncTextEntryState);
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const resetBaseline = () => {
      viewportBaselineRef.current = viewport.height;
      setViewportKeyboardOpen(false);
    };

    const syncViewportKeyboardState = () => {
      const currentHeight = viewport.height;
      const baseline = viewportBaselineRef.current || currentHeight;
      const activeTextEntry = isTextEntryElement(document.activeElement);

      if (!activeTextEntry) {
        if (currentHeight > baseline) viewportBaselineRef.current = currentHeight;
        setViewportKeyboardOpen(false);
        return;
      }

      setViewportKeyboardOpen(baseline - currentHeight > 120);
    };

    resetBaseline();
    viewport.addEventListener("resize", syncViewportKeyboardState);
    window.addEventListener("orientationchange", resetBaseline);
    window.addEventListener("resize", syncViewportKeyboardState);
    return () => {
      viewport.removeEventListener("resize", syncViewportKeyboardState);
      window.removeEventListener("orientationchange", resetBaseline);
      window.removeEventListener("resize", syncViewportKeyboardState);
    };
  }, []);

  useEffect(() => {
    if (!textEntryActive && !viewportKeyboardOpen && keysRef.current) {
      keysRef.current.resizeHandler();
    }
  }, [textEntryActive, viewportKeyboardOpen]);

  const [settings, setSettings] = useQuery(
    buildQuerySpec({
      int: ExtractInt,
      float: ExtractFloat,
      bool: ExtractBool,
      string: ExtractString,
      joined: ExtractJoinedString,
    }),
    {
      // 1. Registry url/runtime defaults — blank-slate values for all keys.
      //    scale/note_names/note_colors are null so the table starts empty.
      ...buildRegistryDefaults(),
      // 2. Session defaults — restore device/output choices from sessionStorage.
      ...sessionDefaults,
      // 3. Preset-specific fields always start empty — populated only when a
      //    preset is explicitly loaded. null is handled gracefully everywhere.
      name: "",
      description: "",
      scale: null,
      note_names: null,
      note_colors: null,
    },
    PRESET_SKIP_KEYS,
  );

  const {
    activeSource,
    activePresetName,
    isPresetDirty,
    persistOnReload,
    setPersistOnReload,
    presetChanged,
    onLoadCustomPreset,
    onClearUserPresets,
    onRevertBuiltin,
    onRevertUser,
    onUserScaleEdit,
  } = usePresets(settings, setSettings, {
    synthRef,
    onUserInteraction: () => setUserHasInteracted(true),
  });

  const { onImport, importCount, bumpImportCount } = useImport(settings, setSettings, {
    onReady: () => setReady(true),
    onUserInteraction: () => setUserHasInteracted(true),
  });

  const {
    synth,
    midi,
    midiAccess,
    midiAccessError,
    ensureMidiAccess,
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
  } = useSynthWiring(settings, setSettings, {
    ready,
    userHasInteracted,
    keysRef,
    synthRef,
  });

  const { panic: guardianPanic } = useMidiGuardian(midi, settings);

  const [active, setActive] = useState(false);
  const [latch, setLatch] = useState(false);

  // Exquis LED App Mode status — set asynchronously after firmware version check.
  // null = pending / not connected; { ok: true } = active; { ok: false, reason } = failed.
  const [exquisLedStatus, setExquisLedStatus] = useState(null);
  const exquisLedsRef = useRef(null);
  const lumatoneLedsRef = useRef(null);

  // ── Snapshots ─────────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState([]);
  const [playingSnapshotId, setPlayingSnapshotId] = useState(null);
  const snapshotIdRef = useRef(0);
  const dragIdRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

  const onTakeSnapshot = useCallback(() => {
    const notes = keysRef.current?.getSnapshot();
    if (!notes?.length) return;
    const id = ++snapshotIdRef.current;
    setSnapshots((prev) => [...prev, { id, notes }]);
  }, []);

  const onPlaySnapshot = useCallback(
    (id) => {
      if (playingSnapshotId === id) {
        // Toggle off: stop the currently playing snapshot
        keysRef.current?.stopSnapshot();
        setPlayingSnapshotId(null);
      } else {
        const snap = snapshots.find((s) => s.id === id);
        if (!snap) return;
        keysRef.current?.playSnapshot(snap.notes);
        setPlayingSnapshotId(id);
      }
    },
    [playingSnapshotId, snapshots],
  );

  const onDeleteSnapshot = useCallback(
    (id) => {
      if (playingSnapshotId === id) {
        keysRef.current?.stopSnapshot();
        setPlayingSnapshotId(null);
      }
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    },
    [playingSnapshotId],
  );

  const onMoveSnapshot = useCallback((fromId, toId) => {
    setSnapshots((prev) => {
      const fromIdx = prev.findIndex((s) => s.id === fromId);
      const toIdx = prev.findIndex((s) => s.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  // Long-press sidebar button to toggle latch (sustain while playing)
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const onSidebarTouchStart = useCallback((e) => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (keysRef.current) keysRef.current.latchToggle();
    }, 400);
  }, []);

  const onSidebarTouchEnd = useCallback((e) => {
    clearTimeout(longPressTimer.current);
    if (longPressFired.current) {
      e.preventDefault();
    }
  }, []);

  const onSidebarTouchMove = useCallback(() => {
    clearTimeout(longPressTimer.current);
  }, []);
  useEffect(() => {
    // Enable the app — triggers synth creation and makes the keyboard visible.
    setReady(true);
  }, []);

  const { onChange, onAtomicChange } = useSettingsChange(settings, setSettings, {
    midi,
    setMidiLearnActive,
    keysRef,
    setLatch,
    bumpImportCount,
    onUserScaleEdit,
  });

  // Validate that all required settings are present and consistent.
  // This prevents Keys from being constructed with invalid state that would crash.
  const isValid = useMemo(() => {
    // Layout validation: hexSize must be >= 20, rotation must be a number
    const hasLayout =
      settings.rSteps &&
      settings.drSteps &&
      settings.hexSize &&
      settings.hexSize >= 20 &&
      typeof settings.rotation === "number";

    // Scale validation: must have a scale array with at least one element
    const hasScale =
      settings.scale &&
      Array.isArray(settings.scale) &&
      settings.scale.length > 0 &&
      settings.equivSteps;

    // Label validation: check requirements based on selected key_labels type.
    // Each label type has different data requirements:
    // - 'no_labels', 'equaves', 'enumerate', 'cents': need only scale
    // - 'scala_names': needs scale (to generate scala_names)
    // - 'note_names': needs note_names array with elements
    const labelType = settings.key_labels;
    const labelsValid =
      !labelType ||
      labelType === "no_labels" ||
      labelType === "equaves" ||
      labelType === "enumerate" ||
      labelType === "cents" ||
      (labelType === "scala_names" && hasScale) ||
      (labelType === "note_names" &&
        settings.note_names &&
        Array.isArray(settings.note_names) &&
        settings.note_names.length > 0);

    const normalizedColors = normalizeColors(settings);
    // Color validation: spectrum mode uses the central hue directly; when
    // spectrum is off, missing note_colors are auto-derived from that same hue.
    const colorsValid =
      !!normalizedColors.fundamental_color &&
      Array.isArray(normalizedColors.note_colors) &&
      normalizedColors.note_colors.length > 0;

    return hasLayout && hasScale && labelsValid && colorsValid;
  }, [settings]);

  // Stable string keys for array deps — memoized so stringify only runs when
  // the array content actually changes, not on every render.
  const scaleKey = useMemo(() => JSON.stringify(settings.scale), [settings.scale]);
  const noteNamesKey = useMemo(() => JSON.stringify(settings.note_names), [settings.note_names]);
  const noteColorsKey = useMemo(() => JSON.stringify(settings.note_colors), [settings.note_colors]);

  // Input runtime: derived from settings, passed to Keys as the authoritative
  // source of truth for all input mode decisions. Keys reads from inputRuntime
  // rather than from settings directly for any input-related branch.
  const connectedInput = useMemo(
    () =>
      midi && settings.midiin_device && settings.midiin_device !== "OFF"
        ? (Array.from(midi.inputs.values()).find((input) => input.id === settings.midiin_device) ??
          null)
        : null,
    [midi, settings.midiin_device],
  );
  const inputController = useMemo(() => {
    const overrideId = settings.midiin_controller_override || "auto";
    if (overrideId !== "auto") return getControllerById(overrideId);
    return connectedInput?.name ? detectController(connectedInput.name.toLowerCase()) : null;
  }, [connectedInput, settings.midiin_controller_override]);
  const forceScaleTarget =
    inputController?.id === "tonalplexus" && settings.tonalplexus_input_mode === "layout_205";
  const normalizedSeqAnchor = useMemo(
    () =>
      inputController?.normalizeInput?.(
        settings.midiin_anchor_channel ?? 1,
        settings.midiin_central_degree ?? 60,
        settings,
      ) ?? {
        channel: settings.midiin_anchor_channel ?? 1,
        note: settings.midiin_central_degree ?? 60,
      },
    [inputController, settings],
  );

  const inputRuntime = useMemo(
    () => ({
      target: forceScaleTarget ? "scale" : settings.midiin_mapping_target || "hex_layout",
      layoutMode: settings.midi_passthrough ? "sequential" : "controller_geometry",
      mpeInput: !!settings.midiin_mpe_input,
      seqAnchorNote: normalizedSeqAnchor.note,
      seqAnchorChannel: normalizedSeqAnchor.channel,
      stepsPerChannel: settings.midiin_steps_per_channel,
      stepsPerChannelDefault: settings.equivSteps,
      channelGroupSize: settings.midiin_channel_group_size ?? 1,
      legacyChannelMode: settings.midiin_channel_legacy,
      scaleTolerance: settings.midiin_scale_tolerance ?? 25,
      scaleFallback: settings.midiin_scale_fallback || "accept",
      pitchBendMode: settings.midiin_pitchbend_mode || "recency",
      pressureMode: settings.midiin_pressure_mode || "recency",
      // Wheel settings kept here for Keys to use alongside routing mode.
      // wheelRange and bendRange both read from midiin_bend_range — the UI
      // unified the old separate "Wheel Range (Scala)" field into Pitch Bend Interval.
      wheelToRecent: settings.wheel_to_recent,
      wheelRange: settings.midiin_bend_range ?? "64/63",
      wheelScaleAware: settings.wheel_scale_aware,
      wheelSemitones: settings.midi_wheel_semitones ?? 2,
      // Pitch bend range for incoming hardware controller bend messages.
      bendRange: settings.midiin_bend_range ?? "64/63",
      bendFlip: !!settings.midiin_bend_flip,
      // MPE pitch bend range (semitones) for Nearest Scale Degree mode.
      scaleBendRange: settings.midiin_scale_bend_range ?? 48,
    }),
    [
      settings.midiin_mapping_target,
      settings.midi_passthrough,
      settings.midiin_mpe_input,
      settings.midiin_steps_per_channel,
      settings.midiin_channel_group_size,
      settings.midiin_channel_legacy,
      settings.midiin_scale_tolerance,
      settings.midiin_scale_fallback,
      settings.midiin_pitchbend_mode,
      settings.midiin_pressure_mode,
      settings.wheel_to_recent,
      settings.wheel_scale_aware,
      settings.midi_wheel_semitones,
      settings.midiin_bend_range,
      settings.midiin_bend_flip,
      settings.midiin_scale_bend_range,
      settings,
      normalizedSeqAnchor,
      forceScaleTarget,
    ],
  );

  // Structural settings: everything except colors. Memoized so Keys is only
  // reconstructed when scale/layout/MIDI changes — not on every color-picker drag.
  const structuralSettings = useMemo(
    () => normalizeStructural(settings),
    [
      settings.rSteps,
      settings.drSteps,
      settings.hexSize,
      settings.rotation,
      scaleKey,
      settings.equivSteps,
      noteNamesKey,
      settings.key_labels,
      // fundamental handled imperatively via keysRef.current.updateFundamental
      settings.reference_degree,
      settings.center_degree,
      settings.midiin_device,
      settings.midiin_channel,
      settings.midiin_steps_per_channel,
      settings.midiin_anchor_channel,
      settings.controller_anchor_note,
      settings.midiin_channel_legacy,
      settings.midi_passthrough,
      settings.midiin_central_degree,
      settings.axis49_center_note,
      settings.wheel_to_recent,
      settings.midiin_mapping_target,
      settings.midiin_mpe_input,
      settings.midiin_pitchbend_mode,
      settings.midiin_pressure_mode,
      settings.lumatone_center_channel,
      settings.lumatone_center_note,
    ],
  );

  // Output toggles and synth/output routing should update the live Keys instance
  // imperatively, not trigger a full keyboard reconstruction.
  const liveOutputSettings = useMemo(
    () => ({
      instrument: settings.instrument,
      output_sample: settings.output_sample,
      output_mts: settings.output_mts,
      output_mpe: settings.output_mpe,
      output_direct: settings.output_direct,
      output_osc: settings.output_osc,
      midi_device: settings.midi_device,
      midi_channel: settings.midi_channel,
      midi_mapping: settings.midi_mapping,
      midi_velocity: settings.midi_velocity,
      sysex_auto: settings.sysex_auto,
      sysex_type: settings.sysex_type,
      device_id: settings.device_id,
      tuning_map_number: settings.tuning_map_number,
      direct_device: settings.direct_device,
      direct_mode: settings.direct_mode,
      direct_channel: settings.direct_channel,
      direct_sysex_auto: settings.direct_sysex_auto,
      direct_device_id: settings.direct_device_id,
      direct_tuning_map_number: settings.direct_tuning_map_number,
      direct_tuning_map_name: settings.direct_tuning_map_name,
      fluidsynth_device: settings.fluidsynth_device,
      fluidsynth_channel: settings.fluidsynth_channel,
      mpe_device: settings.mpe_device,
      mpe_manager_ch: settings.mpe_manager_ch,
      mpe_lo_ch: settings.mpe_lo_ch,
      mpe_hi_ch: settings.mpe_hi_ch,
      mpe_pitchbend_range: settings.mpe_pitchbend_range,
      mpe_mode: settings.mpe_mode,
    }),
    [
      settings.instrument,
      settings.output_sample,
      settings.output_mts,
      settings.output_mpe,
      settings.output_direct,
      settings.output_osc,
      settings.midi_device,
      settings.midi_channel,
      settings.midi_mapping,
      settings.midi_velocity,
      settings.sysex_auto,
      settings.sysex_type,
      settings.device_id,
      settings.tuning_map_number,
      settings.direct_device,
      settings.direct_mode,
      settings.direct_channel,
      settings.direct_sysex_auto,
      settings.direct_device_id,
      settings.direct_tuning_map_number,
      settings.direct_tuning_map_name,
      settings.fluidsynth_device,
      settings.fluidsynth_channel,
      settings.mpe_device,
      settings.mpe_manager_ch,
      settings.mpe_lo_ch,
      settings.mpe_hi_ch,
      settings.mpe_pitchbend_range,
      settings.mpe_mode,
    ],
  );

  // Reset latch (sustain UI state) when Keys is reconstructed.
  // The new Keys instance starts with sustain: false, so the UI must match.
  // Using a ref to skip the initial render (no reconstruction on first mount).
  const prevStructuralRef = useRef(null);
  useEffect(() => {
    if (prevStructuralRef.current !== null && prevStructuralRef.current !== structuralSettings) {
      setLatch(false);
    }
    prevStructuralRef.current = structuralSettings;
  }, [structuralSettings]);

  // Reset octave transpose display when structuralSettings change (preset load etc.)
  useEffect(() => {
    setOctaveTranspose(0);
  }, [structuralSettings]);

  // ── Exquis App Mode lifecycle ─────────────────────────────────────────────
  // Lives here (not in Keyboard) so App Mode is active even before a scale is
  // loaded (Keyboard only mounts when isValid — i.e. a scale is present).
  useEffect(() => {
    const wantAppMode = !!exquisRawPorts && inputRuntime?.target !== "scale";

    if (!wantAppMode) {
      if (exquisLedsRef.current) {
        exquisLedsRef.current.exit();
        exquisLedsRef.current = null;
        if (keysRef.current) keysRef.current.exquisLEDs = null;
      }
      return;
    }

    if (exquisLedsRef.current) return;

    const leds = new ExquisLEDs(
      exquisRawPorts.output,
      exquisRawPorts.input,
      (ok, reason) => {
        setExquisLedStatus(ok ? { ok: true } : { ok: false, reason });
        if (ok && keysRef.current?.settings?.exquis_led_sync) {
          keysRef.current.syncExquisLEDs();
        }
      },
      settings.exquis_led_luminosity ?? 15,
      settings.exquis_led_saturation ?? 1.3,
      settings.midiin_mpe_input ?? true,
    );
    exquisLedsRef.current = leds;
    if (keysRef.current) keysRef.current.exquisLEDs = leds;

    return () => {
      leds.exit();
      exquisLedsRef.current = null;
      if (keysRef.current) keysRef.current.exquisLEDs = null;
    };
  }, [exquisRawPorts, inputRuntime?.target]);

  // Sync MPE mode to Exquis whenever midiin_mpe_input changes.
  // ExquisLEDs.setMPEMode() defers the send until all pads are released.
  useEffect(() => {
    if (exquisLedsRef.current?.ready) {
      exquisLedsRef.current.setMPEMode(!!settings.midiin_mpe_input);
    }
  }, [settings.midiin_mpe_input]);

  // ── Lumatone LED lifecycle ─────────────────────────────────────────────────
  // Mirrors the Exquis pattern: LumatoneLEDs lives here in app.jsx, not inside
  // Keys, so it is constructed as soon as the Lumatone ports are resolved —
  // independently of Keys reconstruction. Keys receives a reference via
  // onKeysReady and lumatoneLedsRef, exactly like exquisLedsRef.
  //
  // We depend on the port IDs (stable strings) rather than lumatoneRawPorts
  // (a new object reference every render), so the effect only recreates the
  // LumatoneLEDs engine when the actual hardware ports change — not on every
  // settings update that happens to re-run the lumatoneRawPorts useMemo.
  const lumatoneInId = lumatoneRawPorts?.input?.id ?? null;
  const lumatoneOutId = lumatoneRawPorts?.output?.id ?? null;
  useEffect(() => {
    if (!lumatoneRawPorts) {
      if (lumatoneLedsRef.current) {
        lumatoneLedsRef.current.destroy();
        lumatoneLedsRef.current = null;
        if (keysRef.current) keysRef.current.lumatoneLEDs = null;
      }
      return;
    }

    const leds = new LumatoneLEDs(lumatoneRawPorts.output, lumatoneRawPorts.input);
    lumatoneLedsRef.current = leds;
    if (keysRef.current) keysRef.current.lumatoneLEDs = leds;

    return () => {
      leds.destroy();
      lumatoneLedsRef.current = null;
      if (keysRef.current) keysRef.current.lumatoneLEDs = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lumatoneInId, lumatoneOutId]);

  // Color settings: only the color fields. Changes here update the live Keys
  // instance imperatively (via updateColors) without reconstructing it.
  const colorSettings = useMemo(
    () => normalizeColors(settings),
    [noteColorsKey, settings.spectrum_colors, settings.fundamental_color],
  );

  const normalizedSettings = useMemo(
    () => ({
      ...structuralSettings,
      ...colorSettings,
    }),
    [structuralSettings, colorSettings],
  );

  // Imperative volume/mute — does not rebuild Keys

  // Null synth: visual-only, no audio. Used when no output is configured.
  const nullSynth = {
    makeHex: (coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: () => {},
      noteOff: () => {},
      retune: () => {},
    }),
  };

  return (
    <div
      className={[
        active ? "hide" : "show",
        textEntryActive || viewportKeyboardOpen ? "text-entry-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => setUserHasInteracted(true)}
    >
      {ready && isValid && (
        <Keyboard
          synth={synth || nullSynth}
          settings={normalizedSettings}
          liveOutputSettings={liveOutputSettings}
          inputRuntime={inputRuntime}
          structuralSettings={structuralSettings}
          onKeysReady={useCallback((keys) => {
            keysRef.current = keys;
            keys.lumatoneLEDs = lumatoneLedsRef.current;
            keys.exquisLEDs = exquisLedsRef.current;
            // Sync LEDs after reconstruction — geometry may have changed (rSteps,
            // drSteps, etc.) without triggering the color useEffect in keyboard/index.js.
            if (lumatoneLedsRef.current && keys.settings?.lumatone_led_sync) {
              keys.syncLumatoneLEDs();
            }
            if (exquisLedsRef.current?.ready && keys.settings?.exquis_led_sync) {
              keys.syncExquisLEDs();
            }
          }, [])}
          onLatchChange={useCallback((v) => setLatch(v), [])}
          onTakeSnapshot={onTakeSnapshot}
          active={active}
          midiLearnActive={midiLearnActive}
          onAnchorLearn={onAnchorLearn}
          lumatoneLedsRef={lumatoneLedsRef}
          exquisLedsRef={exquisLedsRef}
          onFirstInteraction={useCallback(() => {
            setUserHasInteracted(true);
            // Called from the first touch on the canvas — within the iOS gesture
            // window — so AudioContext.resume() and decodeAudioData will succeed.
            if (synthRef.current?.prepare) synthRef.current.prepare();
          }, [])}
        />
      )}

      {loading > 0 && <Loading />}
      {banner === "ios" && (
        <div id="ios-banner">
          <div className="ios-banner__message">
            WebMIDI on iOS is an experimental feature. Install the{" "}
            <a
              href="https://testflight.apple.com/join/f7YNhJ3j"
              target="_blank"
              rel="noopener noreferrer"
            >
              MIDIWeb browser
            </a>{" "}
            to use MIDI features in PLAINSOUND HEXATONE.
          </div>
          <div className="ios-banner__actions">
            <button onClick={() => hideBannerForSession("ios")}>Remind Me Later</button>
            <button onClick={() => dismissBanner("ios")}>Dismiss</button>
          </div>
        </div>
      )}
      {banner === "safari" && (
        <div id="ios-banner">
          <div className="ios-banner__message">
            Safari is not fully supported. For the best experience use Firefox or a Chromium-based
            browser such as Brave, Edge or Chrome.
          </div>
          <div className="ios-banner__actions">
            <button onClick={() => hideBannerForSession("safari")}>Remind Me Later</button>
            <button onClick={() => dismissBanner("safari")}>Dismiss</button>
          </div>
        </div>
      )}
      <button
        id="sidebar-button"
        className={[
          latch ? "latch-active" : "",
          landscapeSafeSide !== "none" ? `landscape-safe-${landscapeSafeSide}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setActive((s) => !s)}
        onTouchStart={onSidebarTouchStart}
        onTouchEnd={onSidebarTouchEnd}
        onTouchMove={onSidebarTouchMove}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div>&gt;</div>
      </button>
      <div id="bottom-bar">
        <div id="main-bottom-controls">
          <div id="octave-island">
            <button
              className="octave-btn"
              title="Octave down"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                shiftOctave(-1);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              ▼
            </button>
            <span
              className={`octave-display${!octaveDeferred ? " octave-defer-active" : ""}`}
              title={
                octaveDeferred ? "Transpose on next event" : "Transpose sounding notes immediately"
              }
              onClick={toggleOctaveDeferred}
              style={{ cursor: "pointer", pointerEvents: "auto" }}
            >
              {octaveTranspose === 0
                ? "OCT"
                : octaveTranspose > 0
                  ? `+${octaveTranspose}`
                  : `${octaveTranspose}`}
            </span>
            <button
              className="octave-btn"
              title="Octave up"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                shiftOctave(+1);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              ▲
            </button>
          </div>
          <button
            id="sustain-island"
            className={latch ? "latch-active" : ""}
            onClick={(e) => {
              e.stopPropagation();
              if (keysRef.current) keysRef.current.latchToggle();
            }}
            onPointerDown={(e) => {
              if (e.pointerType === "touch") e.preventDefault();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <b>SUSTAIN</b>
          </button>
          <button
            id="panic-button"
            title="Panic - kill all stuck notes"
            onClick={(e) => {
              e.stopPropagation();
              guardianPanic();
              if (keysRef.current) keysRef.current.panic();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <b>PANIC</b>
          </button>
        </div>
        <button
          id="snapshot-button"
          title="Capture current notes as a snapshot"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onTakeSnapshot();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          ◉
        </button>
        <button
          id="redraw-button"
          title="Redraw keyboard / Resume audio"
          onPointerDown={(e) => {
            e.preventDefault();
            if (keysRef.current) keysRef.current.resizeHandler();
          }}
          onClick={async (e) => {
            e.stopPropagation();
            if (keysRef.current) keysRef.current.resizeHandler();
            // Re-prepare the active synth within the user gesture so iOS can
            // resume or recreate the AudioContext after background dormancy.
            if (synthRef.current?.prepare) await synthRef.current.prepare();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          ↺
        </button>
      </div>

      {/* ── Snapshot list — fixed overlay, visible without opening the sidebar ── */}
      {snapshots.length > 0 && (
        <div id="snapshot-list" onContextMenu={(e) => e.preventDefault()}>
          {snapshots.map((snap, index) => {
            const isPlaying = snap.id === playingSnapshotId;
            const isDragOver = dragOverId === snap.id;
            return (
              <div
                key={snap.id}
                class={`snapshot-row${isPlaying ? " snapshot-playing" : ""}${isDragOver ? " snapshot-drag-over" : ""}`}
                draggable={true}
                onDragStart={(e) => {
                  dragIdRef.current = snap.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverId(snap.id);
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverId(null);
                  if (dragIdRef.current !== null && dragIdRef.current !== snap.id)
                    onMoveSnapshot(dragIdRef.current, snap.id);
                  dragIdRef.current = null;
                }}
                onDragEnd={() => {
                  setDragOverId(null);
                  dragIdRef.current = null;
                }}
              >
                <span class="snapshot-drag-handle" title="Drag to reorder">
                  ⠿
                </span>
                <button
                  class="snapshot-play-btn"
                  title={isPlaying ? "Stop" : "Play snapshot"}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlaySnapshot(snap.id);
                  }}
                >
                  {isPlaying ? "■" : "▶"} {index + 1}
                </button>
                <button
                  class="snapshot-del-btn"
                  title="Delete snapshot"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSnapshot(snap.id);
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <nav id="sidebar">
        <h1>PLAINSOUND HEXATONE</h1>
        <p>
          <em>
            TO PLAY choose a tuning, click or touch notes, attach a MIDI keyboard or an isomorphic
            controller like Lumatone or Exquis. Use internal sounds or retune MIDI synths. Edit the
            scale in the table or drag to retune. ESC toggles a hand-free latch sustain. ENTER takes
            snapshots across tunings.{" "}
            {!showManual && (
              <span
                style={{ cursor: "pointer", color: "#990000" }}
                onClick={() => setShowManual(true)}
              >
                … more
              </span>
            )}
          </em>
        </p>

        {showManual && (
          <fieldset
            style={{
              position: "relative",
              marginBottom: "0.5em",
              background: "#f0e9e9",
              border: "1px solid #c0aaaa",
            }}
          >
            <legend>
              <b>Manual</b>
            </legend>
            <button
              type="button"
              onClick={() => setShowManual(false)}
              title="Close"
              style={{
                position: "absolute",
                top: "-1.4em",
                right: "-0.8em",
                padding: "0.3em 0.4em",
                fontSize: "1em",
                lineHeight: 1,
                cursor: "pointer",
                background: "transparent",
                border: "none",
                color: "#990000",
              }}
            >
              ✕
            </button>

            <p>
              <em></em>
            </p>
          </fieldset>
        )}

        <Settings
          presetChanged={presetChanged}
          presets={presets}
          onChange={onChange}
          onAtomicChange={onAtomicChange}
          midiLearnActive={midiLearnActive}
          onVolumeChange={onVolumeChange}
          onImport={onImport}
          importCount={importCount}
          onLoadCustomPreset={onLoadCustomPreset}
          onClearUserPresets={onClearUserPresets}
          activeSource={activeSource}
          activePresetName={activePresetName}
          isPresetDirty={isPresetDirty}
          persistOnReload={persistOnReload}
          setPersistOnReload={setPersistOnReload}
          onRevertBuiltin={onRevertBuiltin}
          onRevertUser={onRevertUser}
          settings={settings}
          midi={midi}
          midiAccess={midiAccess}
          midiAccessError={midiAccessError}
          ensureMidiAccess={ensureMidiAccess}
          midiTick={midiTick}
          instruments={instruments}
          keysRef={keysRef}
          lumatoneRawPorts={lumatoneRawPorts}
          exquisRawPorts={exquisRawPorts}
          exquisLedStatus={exquisLedStatus}
          snapshots={snapshots}
          playingSnapshotId={playingSnapshotId}
          onPlaySnapshot={onPlaySnapshot}
          onDeleteSnapshot={onDeleteSnapshot}
        />
        <Blurb />
        <div id="sidebar-spacer"></div>
      </nav>
    </div>
  );
};

export default App;
