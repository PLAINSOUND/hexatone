import { useState, useEffect, useMemo, useCallback, useRef } from "preact/hooks";

import Keyboard from "./keyboard";
import { presets } from "./settings/preset_values";
import { normalizeColors, normalizeStructural } from "./normalize-settings.js";
import { instruments } from "./sample_synth/instruments";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "./tuning/workspace.js";
import {
  createHarmonicFrame,
  deriveCurrentFundamentalForHistory,
  replayModulationHistoryForFrame,
  spellWorkspaceForFrame,
} from "./notation/notation-frame-runtime.js";
import { parseExactInterval } from "./tuning/interval.js";

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
  REGISTRY_BY_KEY,
} from "./persistence/settings-registry.js";
import {
  settingsImpactKey,
  settingsImpactSnapshot,
} from "./settings/settings-impact-registry.js";
import useImport from "./use-import.js";
import useSettingsChange from "./use-settings-change.js";
import sessionDefaults from "./session-defaults.js";
import { ExquisLEDs } from "./controllers/exquis-leds.js";
import { LumatoneLEDs } from "./controllers/lumatone-leds.js";
import {
  attachLinnstrumentLedDriver,
  activateLinnstrumentUserFirmware,
  deactivateLinnstrumentUserFirmware,
  detachLinnstrumentLedDriver,
} from "./controllers/linnstrument-user-firmware.js";
import { detectController, getControllerById } from "./controllers/registry.js";
import Settings from "./settings";
import Blurb from "./blurb";
import ManualSidebar from "./manual-sidebar.jsx";


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
      "mts_bulk_sysex_auto",
      REGISTRY_BY_KEY.webmidi_access.key,
    ];
    [...SCALE_KEYS_TO_CLEAR, ...extraKeysToClear].forEach((key) => sessionStorage.removeItem(key));
  }
}

export const Loading = () => <LoadingIcon />;

function formatSignedWholeCents(value) {
  if (!Number.isFinite(value)) return "0¢";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded)}¢`;
}

function routeTranspositionDeltaCents(entry) {
  const storedDelta = Number(entry?.transpositionDeltaCents);
  if (Number.isFinite(storedDelta)) return storedDelta;
  if (typeof entry?.transpositionRatioText !== "string") return null;
  const parsed = parseExactInterval(entry.transpositionRatioText.trim());
  return Number.isFinite(parsed?.cents) ? parsed.cents : null;
}

function formatEquaveOffset(offset) {
  if (!Number.isFinite(offset) || offset === 0) return "";
  return `[${offset > 0 ? "+" : ""}${offset}eq]`;
}

function modulationRouteEquaveOffset(entry, tuningWorkspace) {
  const transpositionDeltaCents = routeTranspositionDeltaCents(entry);
  const sourceSlot = tuningWorkspace?.lookup?.byDegree?.get(entry?.sourceDegree);
  const targetSlot = tuningWorkspace?.lookup?.byDegree?.get(entry?.targetDegree);
  const equaveCents = tuningWorkspace?.baseScale?.equaveCents ?? 1200;
  if (
    !Number.isFinite(transpositionDeltaCents) ||
    !Number.isFinite(sourceSlot?.cents) ||
    !Number.isFinite(targetSlot?.cents) ||
    !Number.isFinite(equaveCents) ||
    Math.abs(equaveCents) < 0.000001
  ) {
    return 0;
  }

  const reducedDeltaCents = sourceSlot.cents - targetSlot.cents;
  return Math.round((reducedDeltaCents - transpositionDeltaCents) / equaveCents);
}

export function modulationCurrentSummaryDisplay(summary) {
  if (!summary) return "";
  const centsText = formatSignedWholeCents(summary.cents);
  if (!summary.ratioText) return centsText;
  return `${summary.ratioText} (${centsText})`;
}

export function modulationRouteLabelPair(entry, degreeLabel, tuningWorkspace) {
  const sourceLabel = degreeLabel(entry?.sourceDegree);
  const fallbackTargetLabel = degreeLabel(entry?.targetDegree);
  const equaveOffset = modulationRouteEquaveOffset(entry, tuningWorkspace);

  return {
    sourceLabel,
    targetLabel: `${fallbackTargetLabel}${formatEquaveOffset(equaveOffset)}`,
  };
}

export function bindControllerLedRefs(keys, bindings = {}) {
  if (!keys) return;

  if (Object.prototype.hasOwnProperty.call(bindings, "lumatone")) {
    keys.lumatoneLEDs = bindings.lumatone;
    if (bindings.lumatone && keys.settings?.lumatone_led_sync) {
      keys.autoSyncLumatoneLEDs?.();
    }
  }

  if (Object.prototype.hasOwnProperty.call(bindings, "exquis")) {
    keys.exquisLEDs = bindings.exquis;
    if (bindings.exquis?.ready && keys.settings?.exquis_led_sync) {
      keys.syncExquisLEDs?.();
    }
  }

  if (Object.prototype.hasOwnProperty.call(bindings, "linnstrument")) {
    keys.linnstrumentLEDs = bindings.linnstrument;
  }
}

function readCssPxVar(name) {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getDefaultModulationPalettePos() {
  if (typeof window === "undefined") return { x: 18, y: 58 };
  const isLandscape =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(orientation: landscape)").matches
      : window.innerWidth > window.innerHeight;
  const isPhoneLandscape =
    window.innerHeight <= 500 && isLandscape;
  if (isPhoneLandscape) {
    const rightInset = readCssPxVar("--safe-area-right");
    const topInset = readCssPxVar("--safe-area-top");
    return {
      x: Math.max(16, window.innerWidth - rightInset - 236),
      y: Math.max(12, topInset + 14),
    };
  }
  return { x: 18, y: 58 };
}

function snapshotModulationState(state) {
  if (!state) return null;
  return {
    mode: state.mode ?? "idle",
    sourceDegree: state.sourceDegree ?? null,
    targetDegree: state.targetDegree ?? null,
    strategy: state.strategy ?? "retune_surface_to_source",
    geometryMode: state.geometryMode ?? "moveable_surface",
    history: Array.isArray(state.history) ? state.history.map((entry) => ({ ...entry })) : [],
    currentRoute: state.currentRoute ? { ...state.currentRoute } : null,
    historyIndex: state.historyIndex ?? 0,
    lastDecision: state.lastDecision ? { ...state.lastDecision } : null,
  };
}

function modulationHistoryKey(history = []) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .map((entry) => [
      entry?.sourceDegree ?? "",
      entry?.targetDegree ?? "",
      entry?.strategy ?? "",
      Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0,
      Number.isFinite(Number(entry?.transpositionDeltaCents))
        ? Number(entry.transpositionDeltaCents)
        : "",
      entry?.transpositionRatioText ?? "",
    ].join(":"))
    .join("|");
}

function presetModulationSnapshot(history = []) {
  return snapshotModulationState({
    mode: "idle",
    history,
    currentRoute: null,
    historyIndex: 0,
    homeFrame: null,
    currentFrame: null,
    oldFrame: null,
    pendingFrame: null,
    sourceHex: null,
    sourceCoordsKey: null,
    sourceDegree: null,
    targetDegree: null,
    strategy: "retune_surface_to_source",
    geometryMode: "moveable_surface",
    takeoverConsumed: false,
    lastDecision: {
      type: "preset_modulation_library_loaded",
    },
  });
}

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
  const [keysReadyRevision, setKeysReadyRevision] = useState(0);
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
    if (!showManual) return;
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.scrollTop = 0;
  }, [showManual]);

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

  const [modulationArmed, setModulationArmed] = useState(false);
  const [modulationMode, setModulationMode] = useState("idle");
  const [modulationState, setModulationState] = useState(null);
  const [deferredModulationHistory, setDeferredModulationHistory] = useState([]);
  const [presetModulationLibrary, setPresetModulationLibrary] = useState([]);

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
    currentModulationLibrary: modulationState?.history ?? presetModulationLibrary,
    setPresetModulationLibrary,
    onPresetModulationLibraryLoaded: (library) => {
      setPresetModulationLibrary(library);
      setModulationState(presetModulationSnapshot(library));
      setModulationMode("idle");
      setModulationArmed(false);
    },
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
    disableWebMidi,
    midiTick,
    loading,
    midiLearnActive,
    setMidiLearnActive,
    octaveTranspose,
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
  } = useSynthWiring(settings, setSettings, {
    ready,
    userHasInteracted,
    keysRef,
    synthRef,
  });

  const { panic: guardianPanic } = useMidiGuardian(midi, settings);

  const [active, setActive] = useState(false);
  const [latch, setLatch] = useState(false);
  const [modulationPalettePos, setModulationPalettePos] = useState(getDefaultModulationPalettePos);
  const [modulationPaletteCollapsed, setModulationPaletteCollapsed] = useState(false);

  // Exquis LED App Mode status — set asynchronously after firmware version check.
  // null = pending / not connected; { ok: true } = active; { ok: false, reason } = failed.
  const [exquisLedStatus, setExquisLedStatus] = useState(null);
  const exquisLedsRef = useRef(null);
  const lumatoneLedsRef = useRef(null);
  const linnstrumentLedsRef = useRef(null);

  // ── Snapshots ─────────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState([]);
  const [playingSnapshotId, setPlayingSnapshotId] = useState(null);
  const snapshotIdRef = useRef(0);
  const dragIdRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);
  const modulationPaletteDragRef = useRef(null);
  const modulationPaletteUserMovedRef = useRef(false);

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

  const suppressTouchClickUntilRef = useRef(0);
  const runTouchControlAction = useCallback((e, action) => {
    if (e.pointerType !== "touch") return false;
    e.preventDefault();
    e.stopPropagation();
    suppressTouchClickUntilRef.current = Date.now() + 700;
    action();
    return true;
  }, []);
  const skipSuppressedTouchClick = useCallback((e) => {
    if (Date.now() > suppressTouchClickUntilRef.current) return false;
    suppressTouchClickUntilRef.current = 0;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }, []);

  useEffect(() => {
    const onPointerMove = (e) => {
      if (!modulationPaletteDragRef.current) return;
      const { pointerId, offsetX, offsetY } = modulationPaletteDragRef.current;
      if (e.pointerId !== pointerId) return;
      modulationPaletteUserMovedRef.current = true;
      setModulationPalettePos({
        x: Math.max(8, e.clientX - offsetX),
        y: Math.max(8, e.clientY - offsetY),
      });
    };
    const onPointerUp = (e) => {
      if (!modulationPaletteDragRef.current) return;
      if (e.pointerId !== modulationPaletteDragRef.current.pointerId) return;
      modulationPaletteDragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const applyDefaultPosition = () => {
      if (!modulationPaletteUserMovedRef.current) {
        setModulationPalettePos(getDefaultModulationPalettePos());
      }
    };
    window.addEventListener("resize", applyDefaultPosition);
    window.addEventListener("orientationchange", applyDefaultPosition);
    applyDefaultPosition();
    return () => {
      window.removeEventListener("resize", applyDefaultPosition);
      window.removeEventListener("orientationchange", applyDefaultPosition);
    };
  }, []);

  // Long-press sidebar button to toggle latch (sustain while playing)
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const onSidebarTouchStart = useCallback((_e) => {
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
    // - 'no_labels', 'enumerate', 'cents': need only scale
    // - 'scala_names': needs scale (to generate scala_names)
    // - 'note_names': needs note_names array with elements
    const labelType = settings.key_labels;
    const labelsValid =
      !labelType ||
      labelType === "no_labels" ||
      labelType === "enumerate" ||
      labelType === "cents" ||
      (labelType === "scala_names" && hasScale) ||
      (labelType === "note_names" &&
        settings.note_names &&
        Array.isArray(settings.note_names) &&
        settings.note_names.length > 0) ||
      (labelType === "heji" && hasScale);

    const normalizedColors = normalizeColors(settings);
    // Color validation: spectrum mode uses the central hue directly; when
    // spectrum is off, missing note_colors are auto-derived from that same hue.
    const colorsValid =
      !!normalizedColors.fundamental_color &&
      Array.isArray(normalizedColors.note_colors) &&
      normalizedColors.note_colors.length > 0;

    return hasLayout && hasScale && labelsValid && colorsValid;
  }, [settings]);

  const tuningImpactKey = useMemo(() => settingsImpactKey(settings, "tuning"), [settings]);
  const structuralImpactKey = useMemo(() => settingsImpactKey(settings, "structural"), [settings]);
  const keysReconstructionImpactKey = useMemo(
    () => settingsImpactKey(settings, "keysReconstruction", { midiAccess, midiTick }),
    [settings, midiAccess, midiTick],
  );
  const musicalSurfaceResetImpactKey = useMemo(
    () => settingsImpactKey(settings, "musicalSurfaceReset"),
    [settings],
  );
  const colorImpactKey = useMemo(() => settingsImpactKey(settings, "colors"), [settings]);
  const inputRuntimeImpactKey = useMemo(() => settingsImpactKey(settings, "inputRuntime"), [settings]);
  const outputRuntimeImpactKey = useMemo(() => settingsImpactKey(settings, "outputRuntime"), [settings]);
  const tuningWorkspace = useMemo(
    () =>
      settings.scale && Array.isArray(settings.scale) && settings.scale.length > 0
        ? createScaleWorkspace({
            scale: settings.scale,
            reference_degree: settings.reference_degree,
            fundamental: settings.fundamental,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tuningImpactKey is the settings-impact registry key; unrelated settings must not rebuild the tuning workspace.
    [tuningImpactKey],
  );
  const tuningRuntime = useMemo(
    () => (tuningWorkspace ? normalizeWorkspaceForKeys(tuningWorkspace) : null),
    [tuningWorkspace],
  );
  const modulationDegreeLabel = useCallback(
    (degree) => {
      if (degree == null) return "";
      const slot = tuningWorkspace?.lookup?.byDegree?.get(degree);
      return slot?.sourceText || slot?.exactRole?.ratioText || String(degree);
    },
    [tuningWorkspace],
  );
  const modulationSummary = useMemo(() => {
    if (!modulationState) return "";
    const route =
      modulationState.mode === "awaiting_target"
        ? {
            sourceDegree: modulationState.sourceDegree ?? 0,
            targetDegree: null,
          }
        : modulationState.currentRoute ?? null;
    if (!route) return "";
    const { sourceLabel: sourceText, targetLabel } = modulationRouteLabelPair(
      route,
      modulationDegreeLabel,
      tuningWorkspace,
    );
    if (route.targetDegree == null) return `${sourceText} →`;
    if (route.targetDegree != null) {
      return `${sourceText} → ${targetLabel}`;
    }
    return "";
  }, [modulationDegreeLabel, modulationState, tuningWorkspace]);
  const modulationHistory = useMemo(() => modulationState?.history ?? [], [modulationState]);
  const activeModulationHistoryKey = useMemo(
    () => modulationHistoryKey(modulationHistory),
    [modulationHistory],
  );
  const deferredModulationHistoryRef = useRef(modulationHistory);
  deferredModulationHistoryRef.current = modulationHistory;
  useEffect(() => {
    let timeoutId = null;
    const syncWhenNotesAreClear = () => {
      if (keysRef.current && !keysRef.current.isSoundInteractionIdle?.()) {
        timeoutId = setTimeout(syncWhenNotesAreClear, 25);
        return;
      }
      const nextHistory = deferredModulationHistoryRef.current;
      setDeferredModulationHistory(
        Array.isArray(nextHistory) ? nextHistory.map((entry) => ({ ...entry })) : [],
      );
    };
    timeoutId = setTimeout(syncWhenNotesAreClear, 0);
    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [activeModulationHistoryKey]);
  const deferredModulationHistoryKey = useMemo(
    () => modulationHistoryKey(deferredModulationHistory),
    [deferredModulationHistory],
  );
  const activeDeferredModulationKey = useMemo(
    () => modulationHistoryKey(deferredModulationHistory.filter((entry) => {
      const count = Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0;
      return count !== 0;
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deferredModulationHistory is intentionally represented by deferredModulationHistoryKey.
    [deferredModulationHistoryKey],
  );
  const hasActiveDeferredModulation = activeDeferredModulationKey !== "";
  const activeModulationLibrary = useMemo(
    () => modulationState?.history ?? presetModulationLibrary,
    [modulationState, presetModulationLibrary],
  );
  const modulationPaletteVisible = modulationHistory.length > 0;
  const currentFundamentalSummary = useMemo(() => {
    if (!tuningWorkspace) return null;
    const derived = deriveCurrentFundamentalForHistory(tuningWorkspace, deferredModulationHistory, {
      fundamental: settings.fundamental,
    });
    return {
      ...derived,
      display: modulationCurrentSummaryDisplay(derived),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deferredModulationHistory is intentionally represented by deferredModulationHistoryKey so palette clicks do not synchronously re-render modulation-dependent table displays.
  }, [tuningWorkspace, activeDeferredModulationKey, settings.fundamental]);
  const modulationPaletteTitle = useMemo(() => {
    return modulationHistory.map((entry) => {
      const { sourceLabel, targetLabel } = modulationRouteLabelPair(
        entry,
        modulationDegreeLabel,
        tuningWorkspace,
      );
      return `${sourceLabel} ↔ ${targetLabel}`;
    });
  }, [modulationDegreeLabel, modulationHistory, tuningWorkspace]);
  const onStepModulationRoute = useCallback((routeIndex, delta) => {
    if (!keysRef.current?.stepModulationRoute) return;
    keysRef.current.stepModulationRoute(routeIndex, delta);
  }, []);
  const onClearModulationRoute = useCallback((routeIndex) => {
    if (!keysRef.current?.clearModulationRoute) return;
    keysRef.current.clearModulationRoute(routeIndex);
  }, []);
  const onResetModulationRoutes = useCallback(() => {
    if (!keysRef.current?.resetModulationRouteCounts) return;
    keysRef.current.resetModulationRouteCounts();
  }, []);

  // Input runtime: derived from settings, passed to Keys as the authoritative
  // source of truth for all input mode decisions. Keys reads from inputRuntime
  // rather than from settings directly for any input-related branch.
  const connectedInput =
    midi && settings.midiin_device && settings.midiin_device !== "OFF"
      ? (midi.inputs.get(settings.midiin_device) ??
        Array.from(midi.inputs.values()).find((input) => input.id === settings.midiin_device) ??
        null)
      : null;
  const inputController = useMemo(() => {
    const overrideId = settings.midiin_controller_override || "auto";
    if (overrideId !== "auto") return getControllerById(overrideId);
    return connectedInput?.name ? detectController(connectedInput.name.toLowerCase()) : null;
  }, [connectedInput, settings.midiin_controller_override]);
  const linnstrumentUserFirmwareEligible =
    inputController?.id === "linnstrument" &&
    (settings.midiin_mapping_target || "hex_layout") !== "scale" &&
    !settings.midi_passthrough &&
    !!settings.midiin_device &&
    settings.midiin_device !== "OFF";
  const linnstrumentBypassNonMpe =
    inputController?.id === "linnstrument" &&
    (settings.midiin_mapping_target || "hex_layout") !== "scale" &&
    !!settings.midi_passthrough &&
    !settings.midiin_mpe_input &&
    !!settings.midiin_device &&
    settings.midiin_device !== "OFF";
  const linnstrumentBypassChannelPerRow =
    linnstrumentBypassNonMpe && settings.linnstrument_channel_allocation === "channel_per_row";
  const linnstrumentBypassSingleChannel =
    linnstrumentBypassNonMpe &&
    (settings.linnstrument_channel_allocation || "single_channel") === "single_channel";
  const forceScaleTarget =
    inputController?.id === "tonalplexus" && settings.tonalplexus_input_mode === "layout_205";
  const inputNormalizationSettings = useMemo(
    () => ({
      tonalplexus_input_mode: settings.tonalplexus_input_mode,
      equivSteps: settings.equivSteps,
      scale: settings.scale,
      equivInterval: settings.equivInterval,
      center_degree: settings.center_degree,
    }),
    [
      settings.tonalplexus_input_mode,
      settings.equivSteps,
      settings.scale,
      settings.equivInterval,
      settings.center_degree,
    ],
  );
  const normalizedSeqAnchor = useMemo(
    () =>
      inputController?.normalizeInput?.(
        settings.midiin_anchor_channel ?? 1,
        settings.midiin_central_degree ?? 60,
        inputNormalizationSettings,
      ) ?? {
        channel: settings.midiin_anchor_channel ?? 1,
        note: settings.midiin_central_degree ?? 60,
      },
    [
      inputController,
      settings.midiin_anchor_channel,
      settings.midiin_central_degree,
      inputNormalizationSettings,
    ],
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
      wheelToRecent: linnstrumentBypassNonMpe ? false : settings.wheel_to_recent,
      wheelRange: settings.midiin_bend_range ?? "64/63",
      perChannelExpression: linnstrumentBypassChannelPerRow,
      wheelUsesInterval: linnstrumentBypassSingleChannel,
      wheelScaleAware: settings.wheel_scale_aware,
      wheelSemitones: settings.midi_wheel_semitones ?? 2,
      // Pitch bend range for incoming hardware controller bend messages.
      bendRange: settings.midiin_bend_range ?? "64/63",
      bendFlip: !!settings.midiin_bend_flip,
      // MPE pitch bend range (semitones) for Nearest Scale Degree mode.
      scaleBendRange: settings.midiin_scale_bend_range ?? 48,
    }),
    [
      forceScaleTarget,
      normalizedSeqAnchor,
      settings.midiin_mapping_target,
      settings.midi_passthrough,
      settings.midiin_mpe_input,
      settings.midiin_steps_per_channel,
      settings.equivSteps,
      settings.midiin_channel_group_size,
      settings.midiin_channel_legacy,
      settings.midiin_scale_tolerance,
      settings.midiin_scale_fallback,
      settings.midiin_pitchbend_mode,
      settings.midiin_pressure_mode,
      settings.wheel_to_recent,
      settings.midiin_bend_range,
      linnstrumentBypassChannelPerRow,
      linnstrumentBypassSingleChannel,
      settings.wheel_scale_aware,
      linnstrumentBypassNonMpe,
      settings.midi_wheel_semitones,
      settings.midiin_bend_flip,
      settings.midiin_scale_bend_range,
    ],
  );

  const liveInputSettings = useMemo(
    () => settingsImpactSnapshot(settings, "inputRuntime"),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inputRuntimeImpactKey is the settings-impact registry key.
    [inputRuntimeImpactKey],
  );

  // Structural settings: everything except colors. Memoized so Keys is only
  // reconstructed when scale/layout/MIDI changes — not on every color-picker drag.
  const structuralSettings = useMemo(
    () => normalizeStructural(settings, { tuningRuntime }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structuralImpactKey is the settings-impact registry key; input/output binding fields are intentionally excluded.
    [structuralImpactKey, tuningRuntime],
  );

  // Output-runtime architecture controls should update the live Keys instance
  // imperatively, not trigger a full keyboard reconstruction. These are
  // distinct from both structural tuning/workspace settings and fine-grained
  // runtime transport controls such as volume, sustain, OCT, or modulation.
  const liveOutputSettings = useMemo(
    () => settingsImpactSnapshot(settings, "outputRuntime"),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- outputRuntimeImpactKey is the settings-impact registry key.
    [outputRuntimeImpactKey],
  );

  // Reset latch/octave only when the musical surface changes. MIDI/WebMIDI
  // rebinding can reconstruct Keys, but should not reset transport state or
  // invalidate cached labels.
  // Using a ref to skip the initial render (no reset on first mount).
  const prevMusicalSurfaceRef = useRef(null);
  useEffect(() => {
    if (
      prevMusicalSurfaceRef.current !== null &&
      prevMusicalSurfaceRef.current !== musicalSurfaceResetImpactKey
    ) {
      setLatch(false);
      setModulationArmed(false);
      setModulationMode("idle");
      setModulationState(
        activeModulationLibrary.length > 0
          ? presetModulationSnapshot(activeModulationLibrary)
          : null,
      );
      if (typeof resetOctave === "function") resetOctave();
    }
    prevMusicalSurfaceRef.current = musicalSurfaceResetImpactKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicalSurfaceResetImpactKey]); // resetOctave and setLatch are stable

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
    bindControllerLedRefs(keysRef.current, { exquis: leds });

    return () => {
      leds.exit();
      exquisLedsRef.current = null;
      bindControllerLedRefs(keysRef.current, { exquis: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exquisRawPorts, inputRuntime?.target]); // exquis_led_* are constructor args, intentionally not re-triggering

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
    bindControllerLedRefs(keysRef.current, { lumatone: leds });

    return () => {
      leds.destroy();
      lumatoneLedsRef.current = null;
      bindControllerLedRefs(keysRef.current, { lumatone: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lumatoneInId, lumatoneOutId]);

  // ── LinnStrument 128 lifecycle ────────────────────────────────────────────
  // Mirrors the Lumatone/Exquis pattern.  LinnStrumentLEDs and the initial
  // NRPN config burst live here so they survive Keys reconstruction.
  //
  // Port ID stability: same technique as Lumatone — we depend on the stable
  // port ID strings rather than linnstrumentRawPorts (a new object each render)
  // so the effect only fires when the actual hardware port changes.
  const linnstrumentOutId = linnstrumentRawPorts?.output?.id ?? null;
  const linnstrumentOutput = linnstrumentRawPorts?.output ?? null;
  useEffect(() => {
    if (!linnstrumentRawPorts) {
      if (linnstrumentLedsRef.current) {
        // Port is already gone (device unplugged) — just drop the reference.
        linnstrumentLedsRef.current.exit();
        linnstrumentLedsRef.current = null;
        if (keysRef.current) keysRef.current.linnstrumentLEDs = null;
      }
      return;
    }

    // LED driver attachment lives with the UF module so LinnStrument-specific
    // lifecycle rules stay centralized.
    const leds = attachLinnstrumentLedDriver(
      linnstrumentRawPorts.output,
      keysRef.current,
    );
    linnstrumentLedsRef.current = leds;
    bindControllerLedRefs(keysRef.current, { linnstrument: leds });

    return () => {
      linnstrumentLedsRef.current = null;
      bindControllerLedRefs(keysRef.current, { linnstrument: null });
      detachLinnstrumentLedDriver(leds, keysRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linnstrumentOutId]);

  useEffect(() => {
    const output = linnstrumentOutput;
    if (!output) return;

    let activatedKeys = null;
    if (!linnstrumentUserFirmwareEligible) {
      deactivateLinnstrumentUserFirmware(output, keysRef.current ?? null);
      return;
    }

    const id = setTimeout(() => {
      activatedKeys = keysRef.current ?? null;
      activateLinnstrumentUserFirmware(output, activatedKeys);
    }, 50);

    return () => {
      clearTimeout(id);
      deactivateLinnstrumentUserFirmware(output, activatedKeys ?? keysRef.current ?? null);
    };
  }, [linnstrumentOutput, linnstrumentUserFirmwareEligible]);

  useEffect(() => {
    const output = linnstrumentOutput;
    if (!output || !linnstrumentUserFirmwareEligible || typeof window === "undefined") return;

    const deactivateOnUnload = () => {
      deactivateLinnstrumentUserFirmware(output, keysRef.current ?? null);
    };

    window.addEventListener("pagehide", deactivateOnUnload);
    window.addEventListener("beforeunload", deactivateOnUnload);

    return () => {
      window.removeEventListener("pagehide", deactivateOnUnload);
      window.removeEventListener("beforeunload", deactivateOnUnload);
    };
  }, [linnstrumentOutput, linnstrumentUserFirmwareEligible]);

  useEffect(() => {
    if (!linnstrumentUserFirmwareEligible || !settings.linnstrument_led_sync) return;
    const keys = keysRef.current;
    if (!keys?.syncLinnstrumentLEDs) return;
    keys.syncLinnstrumentLEDs();
  }, [
    linnstrumentUserFirmwareEligible,
    settings.linnstrument_led_sync,
    colorImpactKey,
    keysReadyRevision,
  ]);

  // Color settings: only the color fields. Changes here update the live Keys
  // instance imperatively (via updateColors) without reconstructing it.
  const colorSettings = useMemo(
    () => normalizeColors(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colorImpactKey is the settings-impact registry key.
    [colorImpactKey],
  );

  const activeHejiFrame = useMemo(() => {
    if (
      !hasActiveDeferredModulation ||
      !structuralSettings.heji ||
      structuralSettings.heji_supported === false ||
      !tuningWorkspace ||
      !structuralSettings.heji_anchor_label_effective
    ) {
      return null;
    }

    const baseFrame = createHarmonicFrame(tuningWorkspace, {
      anchorDegree: structuralSettings.reference_degree ?? 0,
      anchorLabel: structuralSettings.heji_anchor_label_effective,
      anchorRatioText: structuralSettings.heji_anchor_ratio_effective,
      anchorInterval: parseExactInterval(String(structuralSettings.heji_anchor_ratio_effective || "1/1")),
      referenceDegree: structuralSettings.reference_degree ?? 0,
      strategy: "anchor_substitution",
      generation: 0,
    });
    return replayModulationHistoryForFrame(
      tuningWorkspace,
      baseFrame,
      deferredModulationHistory,
      {
        suppressDeviation: true,
        temperedOnly: settings.heji_tempered_only === true,
        forceShowZeroDeviation: false,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deferredModulationHistory is intentionally represented by activeDeferredModulationKey so zero-count preset libraries do not invalidate HEJI spelling.
  }, [hasActiveDeferredModulation, structuralSettings, tuningWorkspace, activeDeferredModulationKey, settings.heji_tempered_only]);

  // Label settings: display-only fields extracted from structuralSettings.
  // Passed to Keyboard so it can call updateLabels imperatively whenever
  // structuralSettings recomputes due to label-related changes, without
  // those changes causing a Keys reconstruction.
  const labelSettings = useMemo(
    () => {
      const hejiShowCents = settings.heji_show_cents !== false;
      const hejiTemperedOnly = settings.heji_tempered_only === true;
      let liveHejiNames = structuralSettings.heji_names_keys ?? structuralSettings.heji_names;
      if (
        hasActiveDeferredModulation &&
        structuralSettings.heji &&
        structuralSettings.heji_supported !== false &&
        tuningWorkspace &&
        activeHejiFrame
      ) {
        liveHejiNames = spellWorkspaceForFrame(tuningWorkspace, activeHejiFrame, {
          suppressDeviation: !hejiShowCents && !hejiTemperedOnly,
          temperedOnly: hejiTemperedOnly,
          forceShowZeroDeviation: hejiTemperedOnly && hejiShowCents,
        }).labelsByDegree;
      }

      return {
        key_labels:       structuralSettings.key_labels,
        degree:           !!structuralSettings.degree,
        note:             !!structuralSettings.note,
        scala:            !!structuralSettings.scala,
        cents:            !!structuralSettings.cents,
        heji:             !!structuralSettings.heji,
        equaves:          !!structuralSettings.equaves,
        no_labels:        !!structuralSettings.no_labels,
        show_equaves:     !!structuralSettings.equaves,
        note_names:       structuralSettings.note_names,
        scala_names:      structuralSettings.scala_names,
        heji_names:       liveHejiNames,
        heji_anchor_label_eff:  structuralSettings.heji_anchor_label_effective,
        heji_anchor_ratio_eff:  structuralSettings.heji_anchor_ratio_effective,
        scale:            structuralSettings.scale,
        reference_degree: structuralSettings.reference_degree,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deferredModulationHistory is intentionally represented by activeDeferredModulationKey so zero-count preset libraries do not invalidate HEJI spelling.
    [structuralSettings, tuningWorkspace, activeHejiFrame, activeDeferredModulationKey, hasActiveDeferredModulation, settings.heji_show_cents, settings.heji_tempered_only],
  );

  const tableHejiNames = useMemo(() => {
    if (
      !structuralSettings.heji ||
      !hasActiveDeferredModulation ||
      structuralSettings.heji_supported === false ||
      !tuningWorkspace ||
      !activeHejiFrame
    ) {
      return structuralSettings.heji_names ?? labelSettings.heji_names;
    }

    return spellWorkspaceForFrame(tuningWorkspace, activeHejiFrame, {
      suppressDeviation: false,
      temperedOnly: settings.heji_tempered_only === true,
      forceShowZeroDeviation: settings.heji_tempered_only === true,
    }).labelsByDegree;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deferredModulationHistory is intentionally represented by activeDeferredModulationKey so zero-count preset libraries do not invalidate HEJI spelling.
  }, [structuralSettings, tuningWorkspace, activeHejiFrame, activeDeferredModulationKey, hasActiveDeferredModulation, settings.heji_tempered_only, labelSettings.heji_names]);

  const normalizedSettings = useMemo(
    () => ({
      ...structuralSettings,
      ...liveInputSettings,
      ...liveOutputSettings,
      ...labelSettings,
      ...colorSettings,
    }),
    [structuralSettings, liveInputSettings, liveOutputSettings, labelSettings, colorSettings],
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

  // Stable callbacks for Keyboard props — must be declared unconditionally
  // outside JSX so they don't violate the rules of hooks when the Keyboard
  // is conditionally rendered.
  const onKeysReady = useCallback(
    (keys) => {
      keysRef.current = keys;
      setKeysReadyRevision((revision) => revision + 1);
      if (linnstrumentUserFirmwareEligible && linnstrumentLedsRef.current) {
        linnstrumentLedsRef.current.userFirmwareActive = true;
      }
      bindControllerLedRefs(keys, {
        lumatone: lumatoneLedsRef.current,
        exquis: exquisLedsRef.current,
        linnstrument: linnstrumentLedsRef.current,
      });
    },
    [linnstrumentUserFirmwareEligible],
  );
  const onLatchChange = useCallback((v) => setLatch(v), []);
  const onModulationStateChange = useCallback((state) => {
    const snapshot = snapshotModulationState(state);
    if (snapshot?.lastDecision?.reason === "deconstruct") return;
    setModulationState(snapshot);
    setModulationMode(snapshot?.mode ?? "idle");
    setModulationArmed(snapshot?.mode === "awaiting_target");
  }, []);
  const onModulationArmChange = useCallback((v) => setModulationArmed(v), []);
  const onFirstInteraction = useCallback(() => {
    setUserHasInteracted(true);
    if (synthRef.current?.prepare) synthRef.current.prepare();
  }, []);
  const controlsHiddenForKeyboard = textEntryActive && viewportKeyboardOpen;

  return (
    <div
      className={[
        active ? "hide" : "show",
        controlsHiddenForKeyboard ? "text-entry-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => setUserHasInteracted(true)}
    >
      {ready && isValid && (
        <Keyboard
          synth={synth || nullSynth}
          settings={normalizedSettings}
          tuningRuntime={tuningRuntime}
          reconstructionKey={keysReconstructionImpactKey}
          liveInputSettings={liveInputSettings}
          liveOutputSettings={liveOutputSettings}
          colorSettings={colorSettings}
          inputRuntime={inputRuntime}
          labelSettings={labelSettings}
          initialModulationLibrary={activeModulationLibrary}
          onKeysReady={onKeysReady}
          onLatchChange={onLatchChange}
          onModulationArmChange={onModulationArmChange}
          onModulationStateChange={onModulationStateChange}
          onTakeSnapshot={onTakeSnapshot}
          active={active}
          midiLearnActive={midiLearnActive}
          onAnchorLearn={onAnchorLearn}
          lumatoneLedsRef={lumatoneLedsRef}
          exquisLedsRef={exquisLedsRef}
          linnstrumentLedsRef={linnstrumentLedsRef}
          onFirstInteraction={onFirstInteraction}
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
                runTouchControlAction(e, () => shiftOctave(-1));
              }}
              onClick={(e) => {
                if (skipSuppressedTouchClick(e)) return;
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
              onClick={(e) => {
                if (skipSuppressedTouchClick(e)) return;
                toggleOctaveDeferred();
              }}
              onPointerDown={(e) => {
                runTouchControlAction(e, toggleOctaveDeferred);
              }}
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
                runTouchControlAction(e, () => shiftOctave(+1));
              }}
              onClick={(e) => {
                if (skipSuppressedTouchClick(e)) return;
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
              if (skipSuppressedTouchClick(e)) return;
              e.stopPropagation();
              if (keysRef.current) keysRef.current.latchToggle();
            }}
            onPointerDown={(e) => {
              runTouchControlAction(e, () => {
                if (keysRef.current) keysRef.current.latchToggle();
              });
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <b>SUSTAIN</b>
          </button>
          <button
            id="modulation-island"
            className={[
              modulationArmed ? "modulation-active" : "",
              modulationMode === "pending_settlement" ? "modulation-pending" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={
              modulationMode === "pending_settlement"
                ? `Modulation pending settlement${modulationSummary ? `: ${modulationSummary}` : ""}`
                : modulationSummary
                  ? `Arm modulation target selection (Backquote): ${modulationSummary}`
                  : "Arm modulation target selection (Backquote)"
            }
            onClick={(e) => {
              if (skipSuppressedTouchClick(e)) return;
              e.stopPropagation();
              if (!keysRef.current?.toggleModulationArm) return;
              if (modulationMode === "idle") setModulationArmed(true);
              keysRef.current.toggleModulationArm();
            }}
            onPointerDown={(e) => {
              runTouchControlAction(e, () => {
                if (!keysRef.current?.toggleModulationArm) return;
                if (modulationMode === "idle") setModulationArmed(true);
                keysRef.current.toggleModulationArm();
              });
            }}
            onContextMenu={(e) => e.preventDefault()}
            >
            <b>MOD</b>
            {modulationSummary ? <span className="modulation-route">{modulationSummary}</span> : null}
          </button>
          <button
            id="panic-button"
            title="Panic - kill all stuck notes"
            onClick={(e) => {
              if (skipSuppressedTouchClick(e)) return;
              e.stopPropagation();
              guardianPanic();
              if (keysRef.current) keysRef.current.panic();
              resetOctave();
            }}
            onPointerDown={(e) => {
              runTouchControlAction(e, () => {
                guardianPanic();
                if (keysRef.current) keysRef.current.panic();
                resetOctave();
              });
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
            runTouchControlAction(e, onTakeSnapshot);
          }}
          onClick={(e) => {
            if (skipSuppressedTouchClick(e)) return;
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
            runTouchControlAction(e, () => {
              if (keysRef.current) keysRef.current.resizeHandler();
            });
          }}
          onClick={async (e) => {
            if (skipSuppressedTouchClick(e)) return;
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

      {modulationPaletteVisible && (
        <div
          id="modulation-palette"
          style={{
            left: `${modulationPalettePos.x}px`,
            top: `${modulationPalettePos.y}px`,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="modulation-palette-header"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.parentElement?.getBoundingClientRect();
              modulationPaletteDragRef.current = {
                pointerId: e.pointerId,
                offsetX: rect ? e.clientX - rect.left : 0,
                offsetY: rect ? e.clientY - rect.top : 0,
              };
            }}
          >
            <span className="modulation-palette-handle" title="Drag modulation history">
              ⠿
            </span>
            <strong>MODULATION HISTORY</strong>
            <button
              className="modulation-palette-toggle"
              title={modulationPaletteCollapsed ? "Expand modulation history" : "Collapse modulation history"}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                setModulationPaletteCollapsed((value) => !value);
              }}
            >
              <span
                className={`disclosure-toggle-glyph disclosure-toggle-glyph--${modulationPaletteCollapsed ? "collapsed" : "expanded"}`}
                aria-hidden="true"
              />
            </button>
          </div>
          {currentFundamentalSummary && (
            <div
              className="modulation-palette-summary"
              title="Current degree-0 fundamental after all active modulation steps"
            >
              <span className="modulation-palette-summary-label">
                Current:
              </span>
              <span className="modulation-palette-summary-value">
                {currentFundamentalSummary.display}
              </span>
              {Math.abs(currentFundamentalSummary.cents ?? 0) > 0.000001 ? (
                <button
                  className="modulation-palette-close modulation-palette-summary-reset"
                  title="Reset all modulation counts to zero"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onResetModulationRoutes();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  ⟳
                </button>
              ) : <span
                        className="modulation-palette-close modulation-palette-summary-placeholder"
                        aria-hidden="true"
                      >
                        ⟳
                      </span>}
            </div>
          )}
          {!modulationPaletteCollapsed &&
            modulationHistory.map((entry, index) => {
              const count = Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0;
              const { sourceLabel, targetLabel } = modulationRouteLabelPair(
                entry,
                modulationDegreeLabel,
                tuningWorkspace,
              );
              const routeLabel = `${sourceLabel} ↔ ${targetLabel}`;
              const canClearRoute = modulationMode === "idle" && count === 0;
              return (
                <div
                  key={`${entry.sourceDegree}:${entry.targetDegree}:${index}`}
                  className={`modulation-palette-row${count !== 0 ? " modulation-palette-row-active" : ""}`}
                  title={modulationPaletteTitle[index] || routeLabel}
                >
                  
                  <span className="modulation-palette-route">
                    {sourceLabel}
                    <span className="modulation-palette-route-arrow" aria-hidden="true" />
                    {targetLabel}
                  </span>
                  <button
                    className="modulation-palette-step modulation-palette-step--left"
                    aria-label="Step modulation backward"
                    disabled={modulationMode !== "idle"}
                    title="Step modulation backward"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStepModulationRoute(index, -1);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  />
                  <span className="modulation-palette-count">
                    {count > 0 ? `+${count}` : `${count}`}
                  </span>
                  <button
                    className="modulation-palette-step modulation-palette-step--right"
                    aria-label="Step modulation forward"
                    disabled={modulationMode !== "idle"}
                    title="Step modulation forward"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStepModulationRoute(index, 1);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  />
                  <span className="modulation-palette-close-slot">
                    {canClearRoute ? (
                      <button
                        className="modulation-palette-close"
                        title="Remove modulation history row"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onClearModulationRoute(index);
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        ×
                      </button>
                    ) : (
                      <span
                        className="modulation-palette-close modulation-palette-close-placeholder"
                        aria-hidden="true"
                      >
                        ×
                      </span>
                    )}
                  </span>
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

        {showManual ? (
          <ManualSidebar onClose={() => setShowManual(false)} />
        ) : (
          <>
            <Settings
              presetChanged={presetChanged}
              presets={presets}
              onChange={onChange}
              onAtomicChange={onAtomicChange}
              midiLearnActive={midiLearnActive}
              onVolumeChange={onVolumeChange}
              onOscLayerVolumeChange={onOscLayerVolumeChange}
              onImport={onImport}
              importCount={importCount}
              onLoadCustomPreset={onLoadCustomPreset}
              onClearUserPresets={onClearUserPresets}
              activeSource={activeSource}
              activePresetName={activePresetName}
              isPresetDirty={isPresetDirty}
              currentModulationLibrary={modulationState?.history ?? presetModulationLibrary}
              persistOnReload={persistOnReload}
              setPersistOnReload={setPersistOnReload}
              onRevertBuiltin={onRevertBuiltin}
              onRevertUser={onRevertUser}
              settings={settings}
              heji_names={labelSettings.heji_names}
              heji_names_table={tableHejiNames}
              modulation_transposition_cents={currentFundamentalSummary?.cents ?? 0}
              modulation_display_active={Math.abs(currentFundamentalSummary?.cents ?? 0) > 0.000001}
              heji_anchor_label_eff={structuralSettings.heji_anchor_label_effective}
              heji_anchor_ratio_eff={structuralSettings.heji_anchor_ratio_effective}
              heji_supported={structuralSettings.heji_supported}
              heji_warning={structuralSettings.heji_warning}
              midi={midi}
              midiAccess={midiAccess}
              midiAccessError={midiAccessError}
              enableWebMidi={ensureMidiAccess}
              disableWebMidi={disableWebMidi}
              midiTick={midiTick}
              instruments={instruments}
              keysRef={keysRef}
              lumatoneRawPorts={lumatoneRawPorts}
              exquisRawPorts={exquisRawPorts}
              linnstrumentRawPorts={linnstrumentRawPorts}
              exquisLedStatus={exquisLedStatus}
              snapshots={snapshots}
              playingSnapshotId={playingSnapshotId}
              onPlaySnapshot={onPlaySnapshot}
              onDeleteSnapshot={onDeleteSnapshot}
            />
            <Blurb />
          </>
        )}
        <div id="sidebar-spacer"></div>
      </nav>
    </div>
  );
};

export default App;
