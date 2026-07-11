import { Suspense, lazy } from "preact/compat";
import { useState, useEffect, useMemo, useCallback, useRef } from "preact/hooks";

import Keyboard from "./keyboard";
import { primeSharedSampleAudio } from "./sample_synth";
import { presets } from "./settings/presets/preset_values";
import { normalizeColors, normalizeStructural } from "./normalize-settings.js";
import { instruments } from "./sample_synth/instruments";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "./tuning/workspace.js";
import {
  createHarmonicFrame,
  deriveActiveHejiFrame,
  deriveCurrentFundamentalForHistory,
  deriveCurrentFundamentalSummary,
  deriveDegreeColorsForFrame,
  deriveHejiLabelsForFrame,
  deriveModulationPaletteTitles,
  deriveModulationSummaryText,
  hasActiveModulationHistory,
  modulationHistoryKey,
  modulationEntryDisplayText,
  modulationRouteLabelPair,
  presetModulationSnapshot,
  replayModulationHistoryForFrame,
  snapshotModulationState,
  spellWorkspaceForFrame,
} from "./tuning/modulation-frame-runtime.js";
import { parseExactInterval } from "./tuning/interval.js";

import useSynthWiring from "./use-synth-wiring.js";
import { useMidiGuardian } from "./use-midi-guardian.js";
import useDeferredModulationHistory from "./use-deferred-modulation-history.js";
import {
  useQuery,
  ExtractInt,
  ExtractString,
  ExtractFloat,
  ExtractBool,
  ExtractJoinedString,
} from "./use-query";
import usePresets, {
  SCALE_KEYS_TO_CLEAR,
} from "./use-presets.js";
import {
  buildQuerySpec,
  buildRegistryDefaults,
  PRESET_SKIP_KEYS,
} from "./persistence/settings-registry.js";
import {
  settingsImpactKey,
  settingsImpactSnapshot,
} from "./settings/settings-impact-registry.js";
import useImport from "./use-import.js";
import useSettingsChange from "./use-settings-change.js";
import sessionDefaults from "./session-defaults.js";
import { detectController, getControllerById } from "./controllers/registry.js";
import Credits from "./credits";
import LoadingIcon from "./loading-icon.jsx";
import Sequencer from "./sequencer/sequencer.jsx";
import {
  shiftStructuralMarkersAfterSnapshotDeletion,
  shiftStructuralMarkersAfterSnapshotInsertion,
} from "./sequencer/structure-editing.js";
import {
  deriveImplicitRepeatStartPosition,
  deriveImplicitRepeatStartPositionsForDanglingEnds,
  normalizeBarMarker,
  normalizeBarMarkers,
  normalizeTempoMarkers,
} from "./sequencer/transport.js";
import {
  SEQUENCE_WORKSPACE_STORAGE_KEY,
  loadSequenceWorkspaceFromSession,
  saveSequenceWorkspaceToSession,
} from "./sequencer/session-persistence.js";
import { buildSnapshotDescription } from "./sequencer/labels.js";
import {
  deriveSequenceCueGroups,
  sequenceNotesAtCueIndex,
} from "./sequencer/trigger-groups.js";
import { remapSequenceSnapshotsToRuntime } from "./sequencer/runtime-pitch-map.js";
import {
  advanceCueIndexWithRepeats,
  deriveRepeatSections,
} from "./sequencer/repeat-playback-runtime.js";

const Settings = lazy(() => import("./settings/index.jsx"));
const ManualSidebar = lazy(() => import("./manual-sidebar.jsx"));
const loadExquisLEDs = (() => {
  let promise = null;
  return () => (promise ??= import("./controllers/exquis-leds.js"));
})();
const loadLumatoneLEDs = (() => {
  let promise = null;
  return () => (promise ??= import("./controllers/lumatone-leds.js"));
})();
const loadLinnstrumentUserFirmware = (() => {
  let promise = null;
  return () => (promise ??= import("./controllers/linnstrument-user-firmware.js"));
})();
const loadHakenController = (() => {
  let promise = null;
  return () => (promise ??= import("./controllers/hakenaudio.js"));
})();

export function applyReloadPersistencePolicy({
  navigationType = performance.getEntriesByType("navigation")[0]?.type,
  shouldPersist = localStorage.getItem("hexatone_persist_on_reload") === "true",
} = {}) {
  if (navigationType !== "reload" || shouldPersist) return;

  // SCALE_KEYS_TO_CLEAR covers all scale/preset keys.
  // Additionally clear these session flags on reload to prevent unexpected
  // sysex traffic and stale preset-source state on startup.
  const extraKeysToClear = [
    "hexatone_preset_source",
    "hexatone_preset_name",
    SEQUENCE_WORKSPACE_STORAGE_KEY,
    "direct_sysex_auto",
    "mts_bulk_sysex_auto",
    "webmidi_access",
  ];
  [...SCALE_KEYS_TO_CLEAR, ...extraKeysToClear].forEach((key) => sessionStorage.removeItem(key));

  if (window.location.search.length > 0) {
    const url = new URL(window.location.toString());
    url.search = "";
    history.replaceState({}, "Hexatone WebApp", url);
  }
}

// On browser refresh (not initial load), clear scale/preset sessionStorage unless
// the user has opted into "Restore last preset on page reload".
applyReloadPersistencePolicy();

export const Loading = () => <LoadingIcon />;

function SidebarLoadingFallback() {
  return (
    <div className="app-shell__sidebar-loading">
      <LoadingIcon />
    </div>
  );
}

function buildLumatoneAutoSyncKey({
  lumatoneInId,
  lumatoneOutId,
  name,
  referenceDegree,
  fundamental,
  noteColors,
  keyLabels,
  scale,
  equivInterval,
  centerDegree,
  rSteps,
  drSteps,
  anchorNote,
  anchorChannel,
}) {
  return [
    lumatoneInId ?? "no-in",
    lumatoneOutId ?? "no-out",
    name ?? "",
    referenceDegree ?? "",
    fundamental ?? "",
    noteColors ?? "",
    keyLabels ?? "",
    scale ?? "",
    equivInterval ?? "",
    centerDegree ?? "",
    rSteps ?? "",
    drSteps ?? "",
    anchorNote ?? "",
    anchorChannel ?? "",
  ].join("|");
}

function modulo(value, modulus) {
  if (!modulus) return value;
  return ((value % modulus) + modulus) % modulus;
}

function formatCommittedCents(cents) {
  return Number.isFinite(cents) ? Number(cents).toFixed(6) : "";
}

function formatCommittedRatio(ratio) {
  if (!ratio?.toFraction) return null;
  const text = ratio.toFraction();
  return text.includes("/") ? text : `${text}/1`;
}

function modulationSnapshotKey(snapshot) {
  if (!snapshot) return "";
  const currentRoute = snapshot.currentRoute;
  const lastDecision = snapshot.lastDecision;
  return [
    snapshot.mode ?? "",
    snapshot.sourceDegree ?? "",
    snapshot.targetDegree ?? "",
    snapshot.strategy ?? "",
    snapshot.geometryMode ?? "",
    snapshot.historyIndex ?? 0,
    modulationHistoryKey(snapshot.history ?? []),
    currentRoute
      ? [
        currentRoute.sourceDegree ?? "",
        currentRoute.targetDegree ?? "",
        currentRoute.count ?? 0,
        currentRoute.transpositionDeltaCents ?? "",
      ].join(":")
      : "",
    lastDecision
      ? [
        lastDecision.type ?? "",
        lastDecision.reason ?? "",
        lastDecision.articulation ?? "",
      ].join(":")
      : "",
  ].join("|");
}

function committedScaleTextForSlot(slot, frame, workspace) {
  const equaveRatio = workspace?.baseScale?.equaveInterval?.ratio ?? null;
  const equaveCents = workspace?.baseScale?.equaveCents ?? 1200;
  const slotRatio = slot?.committedIdentity?.ratio ?? null;
  const slotCents = slot?.committedIdentity?.cents ?? slot?.cents ?? null;
  const anchorRatio = frame?.anchorInterval?.ratio ?? null;
  const anchorCents = frame?.anchorInterval?.cents ?? 0;
  const normalizedCents = modulo((slot?.cents ?? 0) - anchorCents, equaveCents);

  if (
    slotRatio &&
    anchorRatio &&
    equaveRatio &&
    Number.isFinite(slotCents) &&
    Number.isFinite(anchorCents) &&
    Number.isFinite(equaveCents) &&
    Math.abs(equaveCents) > 0.000001
  ) {
    let ratio = slotRatio.div(anchorRatio);
    const rawDeltaCents = slotCents - anchorCents;
    const equavePower = Math.round((normalizedCents - rawDeltaCents) / equaveCents);
    ratio = equavePower >= 0
      ? ratio.mul(equaveRatio.pow(equavePower))
      : ratio.div(equaveRatio.pow(Math.abs(equavePower)));
    return formatCommittedRatio(ratio);
  }

  return formatCommittedCents(normalizedCents);
}

export function commitModulationHistoryToPreset(settings, tuningWorkspace, history = [], options = {}) {
  const activeHistory = Array.isArray(history)
    ? history.filter((entry) => {
        const count = Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0;
        return count !== 0;
      })
    : [];
  if (!tuningWorkspace || activeHistory.length === 0) return null;

  const baseFrame = createHarmonicFrame(tuningWorkspace, {
    anchorDegree: settings.reference_degree ?? 0,
    anchorLabel: options.hejiAnchorLabel ?? "A",
    anchorRatioText: options.hejiAnchorRatio ?? "1/1",
    anchorInterval: parseExactInterval(String(options.hejiAnchorRatio || "1/1")),
    referenceDegree: settings.reference_degree ?? 0,
    strategy: "anchor_substitution",
    generation: 0,
  });
  const frame = replayModulationHistoryForFrame(tuningWorkspace, baseFrame, activeHistory, {
    suppressDeviation: true,
    temperedOnly: options.hejiTemperedOnly === true,
    forceShowZeroDeviation: false,
  });
  const spelled = spellWorkspaceForFrame(tuningWorkspace, frame, {
    suppressDeviation: true,
    temperedOnly: options.hejiTemperedOnly === true,
    forceShowZeroDeviation: false,
  });
  const derivedColors = deriveDegreeColorsForFrame(tuningWorkspace, frame, {
    baseColors: Array.isArray(settings.note_colors) ? settings.note_colors : [],
  });
  const currentFundamental = deriveCurrentFundamentalForHistory(tuningWorkspace, activeHistory, {
    fundamental: settings.fundamental,
  });
  const equaveCents = tuningWorkspace.baseScale.equaveCents ?? 1200;
  const anchorCents =
    frame?.anchorInterval?.cents ??
    tuningWorkspace.lookup?.byDegree?.get(frame?.anchorDegree)?.cents ??
    0;

  const labelsByDegree = settings.key_labels === "heji"
    ? spelled.labelsByDegree
    : (Array.isArray(settings.note_names) ? settings.note_names : []);

  const orderedSlots = (tuningWorkspace.slots ?? [])
    .map((slot) => ({
      slot,
      degree: slot.degree,
      centsFromAnchor: modulo((slot.cents ?? 0) - anchorCents, equaveCents),
      scaleText: committedScaleTextForSlot(slot, frame, tuningWorkspace),
      label: labelsByDegree?.[slot.degree] ?? "",
      color: derivedColors?.[slot.degree] ?? settings.note_colors?.[slot.degree] ?? null,
    }))
    .sort((a, b) => {
      if (a.centsFromAnchor !== b.centsFromAnchor) return a.centsFromAnchor - b.centsFromAnchor;
      if (a.degree === frame.anchorDegree) return -1;
      if (b.degree === frame.anchorDegree) return 1;
      return a.degree - b.degree;
    });

  return {
    ...settings,
    scale: [
      ...orderedSlots.slice(1).map((entry) => entry.scaleText),
      tuningWorkspace.baseScale.equaveText,
    ],
    equivSteps: orderedSlots.length,
    equivInterval: tuningWorkspace.baseScale.equaveCents,
    fundamental: currentFundamental.fundamentalHz ?? settings.fundamental,
    reference_degree: 0,
    note_names: orderedSlots.map((entry) => entry.label ?? ""),
    note_colors: orderedSlots.map((entry) => entry.color ?? ""),
    heji_anchor_label: frame?.heji?.anchorLabel ?? settings.heji_anchor_label ?? "",
    heji_anchor_ratio: "1/1",
  };
}

export function bindControllerLedRefs(keys, bindings = {}, options = {}) {
  if (!keys) return;
  const { eagerSync = true } = options;

  if (Object.prototype.hasOwnProperty.call(bindings, "lumatone")) {
    keys.lumatoneLEDs = bindings.lumatone;
    if (eagerSync && bindings.lumatone && keys.settings?.lumatone_led_sync) {
      keys.autoSyncLumatoneLEDs?.();
    }
  }

  if (Object.prototype.hasOwnProperty.call(bindings, "exquis")) {
    keys.exquisLEDs = bindings.exquis;
    if (eagerSync && bindings.exquis?.ready && keys.settings?.exquis_led_sync) {
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
      x: Math.max(16, window.innerWidth - rightInset - 258),
      y: Math.max(12, topInset + 14),
    };
  }
  if (window.innerWidth >= 480) {
    const sidebar = document.getElementById("sidebar");
    const sidebarRect = sidebar?.getBoundingClientRect();
    const sidebarVisibleRight =
      sidebarRect && sidebarRect.right > 80 ? sidebarRect.right : 0;
    if (sidebarVisibleRight > 0) {
      const gap = 16;
      const fallbackX = 18;
      const estimatedPaletteWidth = 340;
      const maxX = Math.max(fallbackX, window.innerWidth - estimatedPaletteWidth - gap);
      const preferredX = Math.round(sidebarVisibleRight + gap);
      return {
        x: preferredX <= maxX ? preferredX : fallbackX,
        y: 58,
      };
    }
  }
  return { x: 18, y: 58 };
}

function getDefaultSnapshotPalettePos() {
  if (typeof window === "undefined") return { x: 18, y: 220 };
  const modulationPalette = document.getElementById("modulation-palette");
  const modulationRect = modulationPalette?.getBoundingClientRect();
  if (modulationRect && modulationRect.width > 0 && modulationRect.height > 0) {
    return {
      x: Math.round(modulationRect.left),
      y: Math.round(modulationRect.bottom + 22),
    };
  }
  const modulationDefault = getDefaultModulationPalettePos();
  return {
    x: modulationDefault.x,
    y: modulationDefault.y + 176,
  };
}

export {
  modulationCurrentSummaryDisplay,
  modulationRouteLabelPair,
} from "./tuning/modulation-frame-runtime.js";

const ua = navigator.userAgent;
const isFirefoxIOS = /FxiOS/.test(ua);
const isChromiumToken = /Chrome|Chromium|CriOS|EdgiOS|EdgA|Edg\/|OPiOS/.test(ua);
const isSafariOnly =
  /Safari/.test(ua) &&
  !isChromiumToken &&
  !/Firefox/.test(ua) &&
  !isFirefoxIOS; // Firefox on iOS uses FxiOS token, not "Firefox"
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua)); // iPadOS 13+ desktop mode
const isMIDIWeb = /MIDIWeb/.test(ua);
// Banner messages rendered in JSX (not alert()) so links are clickable.
// showBanner: null = no banner, "ios" = iOS MIDI warning, "safari" = Safari warning.
const BANNER_KEY_VERSION = "v1";
const ROTATION_DEBUG_STORAGE_KEY = "hexatone_rotation_debug";
const getBannerSessionKey = (bannerKey) =>
  `hexatone_banner_${bannerKey}_${BANNER_KEY_VERSION}_hidden_session`;
const getBannerDismissKey = (bannerKey) =>
  `hexatone_banner_${bannerKey}_${BANNER_KEY_VERSION}_dismissed`;
const getRotationDebugDefault = () =>
  isIOS &&
  typeof localStorage !== "undefined" &&
  localStorage.getItem(ROTATION_DEBUG_STORAGE_KEY) === "true";

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
  const [workspaceTab, setWorkspaceTab] = useState("hexatone");
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [showRotationDebug, setShowRotationDebug] = useState(getRotationDebugDefault);
  const [rotationDebugEvents, setRotationDebugEvents] = useState([]);
  const [, setRotationSettleRevision] = useState(0);
  const [banner, setBanner] = useState(getInitialBanner);
  const [landscapeSafeSide, setLandscapeSafeSide] = useState("none");
  const [textEntryActive, setTextEntryActive] = useState(false);
  const [viewportKeyboardOpen, setViewportKeyboardOpen] = useState(false);
  const keysRef = useRef(null); // live Keys instance for imperative color updates
  const [keysReadyRevision, setKeysReadyRevision] = useState(0);
  const synthRef = useRef(null); // live synth instance for imperative volume/mute control
  const viewportBaselineRef = useRef(0);
  const audioNeedsHardRefreshRef = useRef(false);
  const audioWakePromiseRef = useRef(null);
  const primeAudioFromUserInteraction = useCallback(async () => {
    const needsInitialPrepare = !userHasInteracted;
    const needsHardRefresh = audioNeedsHardRefreshRef.current;
    if (!needsInitialPrepare && !needsHardRefresh) return;
    if (audioWakePromiseRef.current) {
      await audioWakePromiseRef.current;
      return;
    }
    if (!userHasInteracted) {
      setUserHasInteracted(true);
    }
    const wakePromise = (async () => {
      if (isIOS) {
        await primeSharedSampleAudio();
      }
      if (typeof synthRef.current?.ensureAwake === "function") {
        await synthRef.current.ensureAwake();
      } else if (typeof synthRef.current?.prepare === "function") {
        await synthRef.current.prepare();
      }
      audioNeedsHardRefreshRef.current = false;
    })().finally(() => {
      audioWakePromiseRef.current = null;
    });
    audioWakePromiseRef.current = wakePromise;
    await wakePromise;
  }, [userHasInteracted]);

  useEffect(() => {
    if (!isIOS || typeof document === "undefined" || typeof window === "undefined") return undefined;

    const markAudioStale = () => {
      audioNeedsHardRefreshRef.current = true;
    };
    const revealSidebarOnReturn = () => {
      setActive(false);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markAudioStale();
        return;
      }
      if (document.visibilityState === "visible") {
        revealSidebarOnReturn();
      }
    };
    const onPageShow = (event) => {
      // pageshow also fires on an ordinary initial load / reload. Only treat
      // it as a stale-audio resume path when the page is being restored from
      // the back-forward cache. Normal reload startup should not force the
      // destructive rebuild path on the first manual refresh.
      if (event?.persisted) {
        markAudioStale();
      }
      revealSidebarOnReturn();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", markAudioStale);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", markAudioStale);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const noteRotationEvent = useCallback((source) => {
    if (!isIOS) return;
    setRotationSettleRevision((revision) => revision + 1);
    if (!showRotationDebug) return;
    const viewport = window.visualViewport;
    const canvas = keysRef.current?.state?.canvas ?? null;
    const event = {
      at: new Date().toLocaleTimeString("en-GB", { hour12: false }) + `.${String(Date.now() % 1000).padStart(3, "0")}`,
      source,
      inner: `${window.innerWidth}x${window.innerHeight}`,
      viewport: viewport
        ? `${Math.round(viewport.width)}x${Math.round(viewport.height)} @ ${Math.round(viewport.offsetLeft)},${Math.round(viewport.offsetTop)}`
        : "none",
      canvas: canvas ? `${canvas.width}x${canvas.height}` : "none",
      orientation: window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait",
      sidebarMode: window.matchMedia("(max-width: 480px)").matches ? "phone" : "desktop",
      shortLandscape: window.matchMedia("(max-height: 500px) and (orientation: landscape)").matches ? "short" : "normal",
    };
    setRotationDebugEvents((events) => [...events.slice(-11), event]);
  }, [showRotationDebug]);

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

  useEffect(() => {
    if (!isIOS) return undefined;
    const onOrientationChange = () => noteRotationEvent("orientationchange");
    const onWindowResize = () => noteRotationEvent("window.resize");
    const onViewportResize = () => noteRotationEvent("visualViewport.resize");

    noteRotationEvent("mount");
    window.addEventListener("orientationchange", onOrientationChange);
    window.addEventListener("resize", onWindowResize);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      window.removeEventListener("orientationchange", onOrientationChange);
      window.removeEventListener("resize", onWindowResize);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
    };
  }, [noteRotationEvent]);

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
    [],
    PRESET_SKIP_KEYS,
  );

  const [modulationArmed, setModulationArmed] = useState(false);
  const [modulationMode, setModulationMode] = useState("idle");
  const [modulationState, setModulationState] = useState(null);
  const [presetModulationLibrary, setPresetModulationLibrary] = useState([]);
  const [presetRuntimeResetRevision, setPresetRuntimeResetRevision] = useState(0);

  const { onImport, importCount, bumpImportCount } = useImport(settings, setSettings, {
    onReady: () => setReady(true),
    onUserInteraction: primeAudioFromUserInteraction,
  });

  const {
    activeSource,
    activePresetName,
    restoredOnMount,
    pendingRestoredPreset,
    isPresetDirty,
    persistOnReload,
    setPersistOnReload,
    activatePendingPreset,
    presetChanged,
    onLoadCustomPreset,
    onClearUserPresets,
    onRevertBuiltin,
    onRevertUser,
    onUserScaleEdit,
  } = usePresets(settings, setSettings, {
    synthRef,
    onUserInteraction: primeAudioFromUserInteraction,
    bumpImportCount,
    bumpPresetRuntimeReset: () =>
      setPresetRuntimeResetRevision((revision) => revision + 1),
    currentModulationLibrary: modulationState?.history ?? presetModulationLibrary,
    setPresetModulationLibrary,
    onPresetModulationLibraryLoaded: (library) => {
      setPresetModulationLibrary(library);
      setModulationState(presetModulationSnapshot(library));
      setModulationMode("idle");
      setModulationArmed(false);
    },
  });
  const deferRestoredSampleActivation = isIOS && restoredOnMount && !userHasInteracted;

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
    hakenPedalLearnActive,
    setHakenPedalLearnActive,
    octaveTranspose,
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
  } = useSynthWiring(settings, setSettings, {
    ready,
    userHasInteracted,
    keysRef,
    synthRef,
    deferSampleActivation: deferRestoredSampleActivation,
  });

  const { panic: guardianPanic } = useMidiGuardian(midi, settings);

  const [active, setActive] = useState(false);
  const [latch, setLatch] = useState(false);
  const [modulationPalettePos, setModulationPalettePos] = useState(getDefaultModulationPalettePos);
  const [modulationPaletteCollapsed, setModulationPaletteCollapsed] = useState(false);
  const [snapshotPalettePos, setSnapshotPalettePos] = useState(getDefaultSnapshotPalettePos);
  const [snapshotPaletteCollapsed, setSnapshotPaletteCollapsed] = useState(false);

  // Exquis LED App Mode status — set asynchronously after firmware version check.
  // null = pending / not connected; { ok: true } = active; { ok: false, reason } = failed.
  const [exquisLedStatus, setExquisLedStatus] = useState(null);
  const exquisLedsRef = useRef(null);
  const lumatoneLedsRef = useRef(null);
  const lumatoneAutoSyncKeyRef = useRef("");
  const linnstrumentLedsRef = useRef(null);

  // ── Snapshots ─────────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState([]);
  const [playingSnapshotId, setPlayingSnapshotId] = useState(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);
  const [selectedSnapshotMarker, setSelectedSnapshotMarker] = useState(null);
  const [snapshotLabelMode, setSnapshotLabelMode] = useState("proportion");
  const [activeSequenceName, setActiveSequenceName] = useState("");
  const [activeSequenceSavedName, setActiveSequenceSavedName] = useState("");
  const [activeSequenceDescription, setActiveSequenceDescription] = useState("");
  const [sequenceLegato, setSequenceLegato] = useState(true);
  const [snapSequenceToCurrentTuning, setSnapSequenceToCurrentTuning] = useState(false);
  const [sequenceAutoCreateBars, setSequenceAutoCreateBars] = useState(true);
  const [sequenceBars, setSequenceBars] = useState(() => normalizeBarMarkers([{ id: 1, position: 1 }]));
  const [sequenceTempi, setSequenceTempi] = useState(() => normalizeTempoMarkers([{ id: 1, position: 1, bpm: 60, beatLength: 1 }]));
  const [sequenceRepeats, setSequenceRepeats] = useState([]);
  const [sequencePlayhead, setSequencePlayhead] = useState({
    barIndex: 0,
    stepIndex: -1,
    markerIndex: null,
    stopped: true,
  });
  const sequenceRepeatPlaybackStateRef = useRef({});
  const previousSnapSequenceToCurrentTuningRef = useRef(false);
  const snapshotIdRef = useRef(0);
  const sequenceBarIdRef = useRef(1);
  const dragIdRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);
  const modulationPaletteRef = useRef(null);
  const modulationPaletteDragRef = useRef(null);
  const modulationPaletteUserMovedRef = useRef(false);
  const snapshotPaletteRef = useRef(null);
  const snapshotPaletteDragRef = useRef(null);
  const snapshotPaletteUserMovedRef = useRef(false);

  const appendSequenceSnapshot = useCallback((notes = []) => {
    const id = ++snapshotIdRef.current;
    const snapshotNotes = Array.isArray(notes) ? notes : [];
    setSnapshots((prev) => {
      const nextSnapshots = [
        ...prev,
        {
          id,
          length: 1,
          description: buildSnapshotDescription(snapshotNotes, snapshotLabelMode),
          descriptionManual: false,
          notes: snapshotNotes,
        },
      ];
      if (sequenceAutoCreateBars) {
        const nextPosition = nextSnapshots.length;
        setSequenceBars((prevBars) => {
          if (prevBars.some((bar) => Math.abs(Number(bar.position) - nextPosition) < 1e-9)) return prevBars;
          const nextId = sequenceBarIdRef.current + 1;
          sequenceBarIdRef.current = nextId;
          return [...prevBars, normalizeBarMarker({ id: nextId, position: nextPosition })];
        });
      }
      return nextSnapshots;
    });
    setSelectedSnapshotId(id);
    setSelectedSnapshotMarker(null);
  }, [sequenceAutoCreateBars, snapshotLabelMode]);

  const onTakeSnapshot = useCallback(() => {
    const notes = keysRef.current?.getSnapshot();
    if (!notes?.length) return;
    appendSequenceSnapshot(notes);
  }, [appendSequenceSnapshot]);

  const onAddEmptySnapshot = useCallback(() => {
    appendSequenceSnapshot([]);
  }, [appendSequenceSnapshot]);

  const onLoadSequence = useCallback((sequence) => {
    const nextSnapshots = Array.isArray(sequence?.snapshots)
      ? JSON.parse(JSON.stringify(sequence.snapshots))
      : [];
    const loadedBars = Array.isArray(sequence?.bars)
      ? JSON.parse(JSON.stringify(sequence.bars))
      : [];
    const loadedTempi = Array.isArray(sequence?.tempi)
      ? JSON.parse(JSON.stringify(sequence.tempi))
      : [];
    const loadedRepeats = Array.isArray(sequence?.repeats)
      ? JSON.parse(JSON.stringify(sequence.repeats))
      : [];
    const nextBars = normalizeBarMarkers(loadedBars);
    const nextTempi = normalizeTempoMarkers(loadedTempi);
    keysRef.current?.stopSnapshot();
    setPlayingSnapshotId(null);
    setSnapshots(nextSnapshots);
    setSequenceBars(nextBars);
    setSequenceTempi(nextTempi);
    setSequenceRepeats(loadedRepeats);
    snapshotIdRef.current = nextSnapshots.reduce(
      (max, snapshot) => Math.max(max, Number.isFinite(Number(snapshot?.id)) ? Number(snapshot.id) : 0),
      0,
    );
    sequenceBarIdRef.current = nextBars.reduce(
      (max, bar) => Math.max(max, Number.isFinite(Number(bar?.id)) ? Number(bar.id) : 0),
      0,
    );
    setSnapshotLabelMode(String(sequence?.snapshotLabelMode ?? "proportion"));
    setSequenceAutoCreateBars(sequence?.autoCreateBars !== false);
    setSelectedSnapshotId(null);
    setSelectedSnapshotMarker(null);
    setActiveSequenceName(String(sequence?.name ?? "").trim());
    setActiveSequenceSavedName(String(sequence?.name ?? "").trim());
    setActiveSequenceDescription(String(sequence?.description ?? ""));
    setSequencePlayhead({
      barIndex: 0,
      stepIndex: -1,
      markerIndex: null,
      stopped: true,
    });
  }, []);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem("hexatone_persist_on_reload") !== "true") return;
    const restoredSequence = loadSequenceWorkspaceFromSession();
    if (!restoredSequence) return;

    const nextSnapshots = restoredSequence.snapshots;
    const nextBars = restoredSequence.bars;
    const nextTempi = restoredSequence.tempi;
    const nextRepeats = restoredSequence.repeats;

    setSnapshots(nextSnapshots);
    setSequenceBars(nextBars);
    setSequenceTempi(nextTempi);
    setSequenceRepeats(nextRepeats);
    setSnapshotLabelMode(restoredSequence.snapshotLabelMode);
    setActiveSequenceName(restoredSequence.activeSequenceName);
    setActiveSequenceSavedName(restoredSequence.activeSequenceSavedName);
    setActiveSequenceDescription(restoredSequence.activeSequenceDescription);
    setSequenceLegato(restoredSequence.sequenceLegato);
    setSnapSequenceToCurrentTuning(restoredSequence.snapSequenceToCurrentTuning);
    setSequenceAutoCreateBars(restoredSequence.sequenceAutoCreateBars);
    setSelectedSnapshotId(null);
    setSelectedSnapshotMarker(null);
    setPlayingSnapshotId(null);
    setSequencePlayhead({
      barIndex: 0,
      stepIndex: -1,
      markerIndex: null,
      stopped: true,
    });
    snapshotIdRef.current = nextSnapshots.reduce(
      (max, snapshot) => Math.max(max, Number.isFinite(Number(snapshot?.id)) ? Number(snapshot.id) : 0),
      0,
    );
    sequenceBarIdRef.current = nextBars.reduce(
      (max, bar) => Math.max(max, Number.isFinite(Number(bar?.id)) ? Number(bar.id) : 0),
      0,
    );
  }, []);

  useEffect(() => {
    saveSequenceWorkspaceToSession({
      snapshots,
      bars: sequenceBars,
      tempi: sequenceTempi,
      repeats: sequenceRepeats,
      snapshotLabelMode,
      activeSequenceName,
      activeSequenceSavedName,
      activeSequenceDescription,
      sequenceLegato,
      snapSequenceToCurrentTuning,
      sequenceAutoCreateBars,
    });
  }, [
    activeSequenceDescription,
    activeSequenceName,
    activeSequenceSavedName,
    sequenceAutoCreateBars,
    sequenceBars,
    sequenceLegato,
    sequenceRepeats,
    sequenceTempi,
    snapSequenceToCurrentTuning,
    snapshotLabelMode,
    snapshots,
  ]);

  const sequenceCueGroups = useMemo(
    () => deriveSequenceCueGroups(snapshots, sequenceBars, sequenceTempi, sequenceRepeats),
    [sequenceBars, sequenceRepeats, sequenceTempi, snapshots],
  );
  const sequenceRepeatSections = useMemo(
    () => deriveRepeatSections(sequenceCueGroups, sequenceRepeats),
    [sequenceCueGroups, sequenceRepeats],
  );
  const currentSequenceSnapRuntime = (() => {
    const keys = keysRef.current;
    const frame = keys?._activeFrame?.();
    const liveRuntime = keys?._effectiveScaleRuntimeForFrame?.(frame);
    return Array.isArray(liveRuntime?.scale) && liveRuntime.scale.length > 0
      ? liveRuntime
      : null;
  })();
  const sequenceDisplaySnapshots = useMemo(() => {
    if (!snapSequenceToCurrentTuning || !currentSequenceSnapRuntime) return snapshots;
    const keys = keysRef.current;
    return remapSequenceSnapshotsToRuntime(snapshots, currentSequenceSnapRuntime, {
      noteNames: Array.isArray(keys?.settings?.note_names) ? keys.settings.note_names : [],
      hejiNames: Array.isArray(keys?.settings?.heji_names) ? keys.settings.heji_names : [],
    });
  }, [currentSequenceSnapRuntime, snapSequenceToCurrentTuning, snapshots]);
  const sortedSequenceBars = useMemo(
    () => [...sequenceBars].sort((a, b) => (
      Number(a.position) - Number(b.position) ||
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
    )),
    [sequenceBars],
  );

  const barIndexForTime = useCallback((absoluteTime) => {
    const time = Number(absoluteTime);
    if (!Number.isFinite(time) || sortedSequenceBars.length === 0) return 0;
    let index = 0;
    for (let i = 0; i < sortedSequenceBars.length; i += 1) {
      if (Number(sortedSequenceBars[i].position) <= time) index = i;
      else break;
    }
    return index;
  }, [sortedSequenceBars]);

  const barTimeForIndex = useCallback((barIndex) => {
    if (!sortedSequenceBars.length) return 1;
    const safeIndex = Math.max(0, Math.min(sortedSequenceBars.length - 1, Number(barIndex) || 0));
    return Number(sortedSequenceBars[safeIndex]?.position) || 1;
  }, [sortedSequenceBars]);

  const snapshotIndexNearBar = useCallback((barIndex, direction) => {
    const anchorTime = barTimeForIndex(barIndex);
    const cueGroup = direction > 0
      ? sequenceCueGroups.find((group) => group.time >= anchorTime)
      : sequenceCueGroups.findLast((group) => group.time < anchorTime);
    if (cueGroup) return cueGroup.snapshotIndex;
    if (direction > 0) {
      const nextIndex = snapshots.findIndex((_, index) => index + 1 >= anchorTime);
      return nextIndex >= 0 ? nextIndex : snapshots.length;
    }
    return snapshots.findLastIndex((_, index) => index + 1 < anchorTime);
  }, [barTimeForIndex, sequenceCueGroups, snapshots]);

  const cueIndexNearBar = useCallback((barIndex, direction) => {
    const anchorTime = barTimeForIndex(barIndex);
    return direction > 0
      ? sequenceCueGroups.findIndex((group) => group.time >= anchorTime)
      : sequenceCueGroups.findLastIndex((group) => group.time < anchorTime);
  }, [barTimeForIndex, sequenceCueGroups]);

  const applySequencePlayback = useCallback((stepIndex, markerIndex = null, notes = [], options = {}) => {
    const hardRestart = options?.hardRestart === true;
    const safeStepIndex = Math.max(0, Math.min(snapshots.length - 1, stepIndex));
    const snapshot = snapshots[safeStepIndex];
    if (!snapshot) return;
    const safeMarkerIndex = markerIndex == null || sequenceCueGroups.length === 0
      ? null
      : Math.max(0, Math.min(sequenceCueGroups.length - 1, markerIndex));
    const cueGroup = safeMarkerIndex == null ? null : sequenceCueGroups[safeMarkerIndex];
    const normalizedNotes = Array.isArray(notes) ? notes : [];
    const useLegato = sequenceLegato && safeMarkerIndex != null;
    const playheadTime = cueGroup?.time ?? (safeStepIndex + 1);
    const barIndex = barIndexForTime(playheadTime);

    if (hardRestart) keysRef.current?.stopSnapshot();
    if (normalizedNotes.length > 0) {
      keysRef.current?.playSnapshot(normalizedNotes, { legato: hardRestart ? false : useLegato });
    } else {
      keysRef.current?.stopSnapshot();
    }
    setPlayingSnapshotId(normalizedNotes.length > 0 ? snapshot.id : null);
    setSelectedSnapshotId(cueGroup?.snapshotIndex != null
      ? (snapshots[cueGroup.snapshotIndex]?.id ?? snapshot.id)
      : snapshot.id);
    setSelectedSnapshotMarker(
      safeMarkerIndex == null
        ? null
        : cueGroup == null
          ? null
          : {
            snapshotId: snapshots[cueGroup.snapshotIndex]?.id ?? snapshot.id,
            time: cueGroup.time - (cueGroup.snapshotIndex + 1),
          },
    );
    setSequencePlayhead({
      barIndex,
      stepIndex: safeStepIndex,
      markerIndex: safeMarkerIndex,
      stopped: normalizedNotes.length === 0,
    });
  }, [barIndexForTime, sequenceCueGroups, sequenceLegato, snapshots]);

  const playSequencePosition = useCallback((stepIndex, markerIndex = null, options = {}) => {
    const hardRestart = options?.hardRestart === true;
    if (stepIndex == null || stepIndex < 0 || snapshots.length === 0) {
      keysRef.current?.stopSnapshot();
      sequenceRepeatPlaybackStateRef.current = {};
      setPlayingSnapshotId(null);
      setSelectedSnapshotId(null);
      setSelectedSnapshotMarker(null);
      setSequencePlayhead({
        barIndex: 0,
        stepIndex: -1,
        markerIndex: null,
        stopped: true,
      });
      return;
    }

    if (stepIndex >= snapshots.length) {
      const safeMarkerIndex = markerIndex == null || sequenceCueGroups.length === 0
        ? null
        : Math.max(0, Math.min(sequenceCueGroups.length - 1, markerIndex));
      keysRef.current?.stopSnapshot();
      sequenceRepeatPlaybackStateRef.current = {};
      setPlayingSnapshotId(null);
      setSelectedSnapshotId(null);
      setSelectedSnapshotMarker(null);
      setSequencePlayhead({
        barIndex: 0,
        stepIndex: snapshots.length,
        markerIndex: safeMarkerIndex,
        stopped: true,
      });
      return;
    }

    const safeStepIndex = Math.max(0, Math.min(snapshots.length - 1, stepIndex));
    const snapshot = snapshots[safeStepIndex];
    const displaySnapshot = sequenceDisplaySnapshots[safeStepIndex] ?? snapshot;
    if (!snapshot) return;
    const safeMarkerIndex = markerIndex == null || sequenceCueGroups.length === 0
      ? null
      : Math.max(0, Math.min(sequenceCueGroups.length - 1, markerIndex));
    const notes = safeMarkerIndex == null
      ? (displaySnapshot?.notes ?? [])
      : sequenceNotesAtCueIndex(sequenceDisplaySnapshots, safeMarkerIndex);
    applySequencePlayback(safeStepIndex, safeMarkerIndex, notes, { hardRestart });
  }, [applySequencePlayback, sequenceCueGroups, sequenceDisplaySnapshots, snapshots]);

  useEffect(() => {
    const previous = previousSnapSequenceToCurrentTuningRef.current;
    previousSnapSequenceToCurrentTuningRef.current = snapSequenceToCurrentTuning;
    if (previous === snapSequenceToCurrentTuning) return;
    if (sequencePlayhead?.stopped) return;
    if (!Number.isFinite(sequencePlayhead?.stepIndex) || sequencePlayhead.stepIndex < 0) return;
    playSequencePosition(sequencePlayhead.stepIndex, sequencePlayhead.markerIndex);
  }, [playSequencePosition, sequencePlayhead, snapSequenceToCurrentTuning]);

  const onSelectSequencerSnapshot = useCallback((id) => {
    sequenceRepeatPlaybackStateRef.current = {};
    setSelectedSnapshotId(id);
    setSelectedSnapshotMarker((current) => (current?.snapshotId === id ? current : null));
  }, []);

  const onSelectSequencerMarker = useCallback((snapshotId, time) => {
    sequenceRepeatPlaybackStateRef.current = {};
    setSelectedSnapshotId(snapshotId);
    setSelectedSnapshotMarker({ snapshotId, time });
  }, []);

  const onPlaySnapshot = useCallback(
    (id) => {
      sequenceRepeatPlaybackStateRef.current = {};
      const stepIndex = snapshots.findIndex((s) => s.id === id);
      const snap = snapshots[stepIndex];
      if (!snap) return;
      playSequencePosition(stepIndex, null);
    },
    [playSequencePosition, snapshots],
  );

  const onStopSnapshot = useCallback(
    (id = null) => {
      if (id != null && playingSnapshotId !== id) return;
      keysRef.current?.stopSnapshot();
      sequenceRepeatPlaybackStateRef.current = {};
      setPlayingSnapshotId(null);
      setSequencePlayhead((prev) => ({ ...prev, stopped: true }));
    },
    [playingSnapshotId],
  );

  const onSelectSequenceBar = useCallback((barIndex) => {
    keysRef.current?.stopSnapshot();
    sequenceRepeatPlaybackStateRef.current = {};
    setPlayingSnapshotId(null);
    setSelectedSnapshotId(null);
    setSelectedSnapshotMarker(null);
    setSequencePlayhead({
      barIndex,
      stepIndex: -1,
      markerIndex: null,
      stopped: true,
    });
  }, []);

  const onAddSequenceBar = useCallback((position = null, numerator = 4, denominator = 4) => {
    const id = ++sequenceBarIdRef.current;
    setSequenceBars((prev) => {
      const explicitPosition = Number(position);
      const nextPosition = Number.isFinite(explicitPosition)
        ? Math.max(1, Math.round(explicitPosition))
        : prev.length > 0
          ? Math.max(...prev.map((bar) => Number(bar.position) || 1)) + 1
          : 1;
      const nextNumerator = Math.max(0, Math.round(Number(numerator) || 0));
      const nextDenominator = Math.max(1, Math.round(Number(denominator) || 1));
      const existingBar = prev.find((bar) => Math.abs(Number(bar.position) - nextPosition) < 1e-9);
      if (existingBar) {
        const shouldReplace = window.confirm("There already is a bar at the specified position. Replace?");
        if (!shouldReplace) {
          sequenceBarIdRef.current -= 1;
          return prev;
        }
        return [...prev.filter((bar) => bar.id !== existingBar.id), normalizeBarMarker({
          id,
          position: nextPosition,
          numerator: nextNumerator,
          denominator: nextDenominator,
        })];
      }
      return [...prev, normalizeBarMarker({
        id,
        position: nextPosition,
        numerator: nextNumerator,
        denominator: nextDenominator,
      })];
    });
  }, []);

  const onAddBarsBeforeSnapshots = useCallback(() => {
    setSequenceBars((prev) => {
      const existingPositions = new Set(
        prev
          .map((bar) => Number(bar.position))
          .filter((position) => Number.isFinite(position))
          .map((position) => position.toFixed(3)),
      );

      const additions = [];
      let nextId = sequenceBarIdRef.current;
      for (let i = 0; i < snapshots.length; i += 1) {
        const position = i + 1;
        const key = position.toFixed(3);
        if (existingPositions.has(key)) continue;
        nextId += 1;
        additions.push(normalizeBarMarker({ id: nextId, position }));
        existingPositions.add(key);
      }

      if (additions.length === 0) return prev;
      sequenceBarIdRef.current = nextId;
      return [...prev, ...additions];
    });
  }, [snapshots.length]);

  const onDeleteSequenceBar = useCallback((id) => {
    setSequenceBars((prev) => prev.filter((bar) => bar.id !== id));
  }, []);

  const onAddSequenceTempo = useCallback((position = null, bpm = 60) => {
    setSequenceTempi((prev) => {
      const id = prev.reduce((max, tempo) => Math.max(max, Number(tempo?.id) || 0), 0) + 1;
      return [...prev, { id, position, bpm, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }];
    });
  }, []);

  const onDeleteSequenceTempo = useCallback((id) => {
    setSequenceTempi((prev) => prev.filter((tempo) => tempo.id !== id));
  }, []);

  const onAddSequenceRepeat = useCallback((position = null, kind = "start") => {
    setSequenceRepeats((prev) => {
      let nextId = prev.reduce((max, marker) => Math.max(max, Number(marker?.id) || 0), 0) + 1;
      const normalizedKind = kind === "end" ? "end" : "start";
      const normalizedPosition = Number.isFinite(Number(position))
        ? Math.round(Number(position) * 1000000) / 1000000
        : 1;

      if (normalizedKind === "end" && normalizedPosition <= 1) {
        return prev;
      }

      const additions = [];
      if (normalizedKind === "end") {
        const implicitStartPosition = deriveImplicitRepeatStartPosition(prev, normalizedPosition);
        if (implicitStartPosition != null) {
          additions.push({
            id: nextId,
            position: implicitStartPosition,
            kind: "start",
            repeatCount: null,
          });
          nextId += 1;
        }
      }

      additions.push({
        id: nextId,
        position: normalizedPosition,
        kind: normalizedKind,
        repeatCount: normalizedKind === "end" ? 2 : null,
      });
      nextId += 1;

      if (normalizedKind === "end") {
        const completed = [...prev, ...additions];
        const supplementalStartPositions = deriveImplicitRepeatStartPositionsForDanglingEnds(completed);
        supplementalStartPositions.forEach((startPosition) => {
          if (
            additions.some((marker) => marker.kind === "start" && Math.abs(Number(marker.position) - Number(startPosition)) < 1e-9)
          ) {
            return;
          }
          additions.push({
            id: nextId,
            position: startPosition,
            kind: "start",
            repeatCount: null,
          });
          nextId += 1;
        });
      }

      return [...prev, ...additions];
    });
  }, []);

  const onDeleteSequenceRepeat = useCallback((id) => {
    setSequenceRepeats((prev) => prev.filter((marker) => marker.id !== id));
  }, []);

  const onUpdateSequenceRepeat = useCallback((id, updates) => {
    setSequenceRepeats((prev) => prev.map((marker) => {
      if (marker.id !== id) return marker;
      const nextMarker = { ...marker, ...updates };
      if (
        nextMarker.kind === "end"
        && updates != null
        && Object.hasOwn(updates, "position")
        && Number(nextMarker.position) <= 1
      ) {
        return marker;
      }
      return nextMarker;
    }));
  }, []);

  const onUpdateSequenceTempo = useCallback((id, updates) => {
    setSequenceTempi((prev) => prev.map((tempo) => (
      tempo.id === id ? { ...tempo, ...updates } : tempo
    )));
  }, []);

  const onUpdateSequenceBar = useCallback((id, updates) => {
    setSequenceBars((prev) => {
      const currentBar = prev.find((bar) => bar.id === id);
      const isRootBar = currentBar != null && Math.abs(Number(currentBar.position) - 1) < 1e-9;
      const rawNextPosition = Number(updates?.position);
      const nextPosition = Number.isFinite(rawNextPosition)
        ? Math.max(1, Math.round(rawNextPosition))
        : NaN;
      const normalizedUpdates = Number.isFinite(nextPosition)
        ? { ...updates, position: nextPosition }
        : updates;
      if (Number.isFinite(nextPosition) && isRootBar) {
        const existingBar = prev.find((bar) => bar.id !== id && Math.abs(Number(bar.position) - nextPosition) < 1e-9);
        if (existingBar) {
          const shouldReplace = window.confirm("There already is a bar at the specified position. Replace?");
          if (!shouldReplace) return prev;
          const nextId = sequenceBarIdRef.current + 1;
          sequenceBarIdRef.current = nextId;
          return [
            ...prev.filter((bar) => bar.id !== existingBar.id),
            normalizeBarMarker({ ...currentBar, ...normalizedUpdates, id: nextId, position: nextPosition }),
          ];
        }
        const nextId = sequenceBarIdRef.current + 1;
        sequenceBarIdRef.current = nextId;
        return [...prev, normalizeBarMarker({ ...currentBar, ...normalizedUpdates, id: nextId, position: nextPosition })];
      }
      if (Number.isFinite(nextPosition)) {
        const existingBar = prev.find((bar) => bar.id !== id && Math.abs(Number(bar.position) - nextPosition) < 1e-9);
        if (existingBar) {
          const shouldReplace = window.confirm("There already is a bar at the specified position. Replace?");
          if (!shouldReplace) return prev;
          return prev
            .filter((bar) => bar.id !== existingBar.id)
            .map((bar) => (bar.id === id ? { ...bar, ...normalizedUpdates } : bar));
        }
      }
      return prev.map((bar) => (
        bar.id === id ? { ...bar, ...normalizedUpdates } : bar
      ));
    });
  }, []);

  const onMoveSequenceBar = useCallback((fromId, position) => {
    const rawPosition = Number(position);
    const nextPosition = Number.isFinite(rawPosition)
      ? Math.max(1, Math.round(rawPosition))
      : NaN;
    if (!Number.isFinite(nextPosition)) return;
    setSequenceBars((prev) => {
      const currentBar = prev.find((bar) => bar.id === fromId);
      const isRootBar = currentBar != null && Math.abs(Number(currentBar.position) - 1) < 1e-9;
      if (isRootBar) {
        const existingBar = prev.find((bar) => bar.id !== fromId && Math.abs(Number(bar.position) - nextPosition) < 1e-9);
        if (existingBar) {
          const shouldReplace = window.confirm("There already is a bar at the specified position. Replace?");
          if (!shouldReplace) return prev;
          const nextId = sequenceBarIdRef.current + 1;
          sequenceBarIdRef.current = nextId;
          return [
            ...prev.filter((bar) => bar.id !== existingBar.id),
            normalizeBarMarker({ ...currentBar, id: nextId, position: nextPosition }),
          ];
        }
        const nextId = sequenceBarIdRef.current + 1;
        sequenceBarIdRef.current = nextId;
        return [...prev, normalizeBarMarker({ ...currentBar, id: nextId, position: nextPosition })];
      }
      const existingBar = prev.find((bar) => bar.id !== fromId && Math.abs(Number(bar.position) - nextPosition) < 1e-9);
      if (existingBar) {
        const shouldReplace = window.confirm("There already is a bar at the specified position. Replace?");
        if (!shouldReplace) return prev;
        return prev
          .filter((bar) => bar.id !== existingBar.id)
          .map((bar) => (bar.id === fromId ? { ...bar, position: nextPosition } : bar));
      }
      return prev.map((bar) => (
        bar.id === fromId ? { ...bar, position: nextPosition } : bar
      ));
    });
  }, []);

  const onStepSequence = useCallback((direction) => {
    sequenceRepeatPlaybackStateRef.current = {};
    if (!snapshots.length) return;
    const current = Number.isFinite(sequencePlayhead.stepIndex) ? sequencePlayhead.stepIndex : -1;
    if (current < 0) {
      const target = snapshotIndexNearBar(sequencePlayhead.barIndex, direction);
      if (target < 0) {
        playSequencePosition(-1, null);
        return;
      }
      if (target >= snapshots.length) {
        playSequencePosition(snapshots.length, null);
        return;
      }
      playSequencePosition(target, null);
      return;
    }
    const next = Math.max(-1, Math.min(snapshots.length, current + direction));
    playSequencePosition(next, null);
  }, [playSequencePosition, sequencePlayhead.barIndex, sequencePlayhead.stepIndex, snapshotIndexNearBar, snapshots.length]);

  const onStepSequenceMarker = useCallback((direction) => {
    if (!snapshots.length) return;
    const cueCount = sequenceCueGroups.length;
    if (cueCount === 0) {
      const currentStep = Number.isFinite(sequencePlayhead.stepIndex) ? sequencePlayhead.stepIndex : -1;
      if (currentStep < 0) {
        const target = snapshotIndexNearBar(sequencePlayhead.barIndex, direction);
        if (target < 0) {
          playSequencePosition(-1, null);
          return;
        }
        if (target >= snapshots.length) {
          playSequencePosition(snapshots.length, null);
          return;
        }
        playSequencePosition(target, null);
        return;
      }
      const nextStep = Math.max(-1, Math.min(snapshots.length, currentStep + direction));
      playSequencePosition(nextStep, null);
      return;
    }

    const atOff = !Number.isFinite(sequencePlayhead.stepIndex) || sequencePlayhead.stepIndex < 0;
    const atEnd = Number.isFinite(sequencePlayhead.stepIndex) && sequencePlayhead.stepIndex >= snapshots.length;
    const currentCue = Number.isFinite(sequencePlayhead.markerIndex) ? sequencePlayhead.markerIndex : null;

    let nextCue = currentCue;
    if (atOff) {
      nextCue = cueIndexNearBar(sequencePlayhead.barIndex, direction);
      if (nextCue < 0) {
        if (direction < 0) {
          playSequencePosition(-1, null);
          return;
        }
        playSequencePosition(snapshots.length, cueCount - 1);
        return;
      }
    } else if (atEnd) {
      if (direction >= 0) return;
      nextCue = currentCue == null ? cueCount - 1 : Math.max(0, currentCue - 1);
    } else if (currentCue == null) {
      const currentTime = Number(sequencePlayhead.stepIndex) + 1;
      nextCue = direction > 0
        ? sequenceCueGroups.findIndex((group) => group.time > currentTime)
        : sequenceCueGroups.findLastIndex((group) => group.time < currentTime);
      if (nextCue < 0) {
        playSequencePosition(direction > 0 ? snapshots.length : -1, null);
        return;
      }
    } else {
      if (direction > 0) {
        const repeatAdvance = advanceCueIndexWithRepeats({
          currentCueIndex: currentCue,
          cueCount,
          cueGroups: sequenceCueGroups,
          repeatSections: sequenceRepeatSections,
          repeatPlaybackState: sequenceRepeatPlaybackStateRef.current,
        });
        sequenceRepeatPlaybackStateRef.current = repeatAdvance.nextRepeatPlaybackState;
        nextCue = repeatAdvance.nextCueIndex;
        if (nextCue >= cueCount) {
          playSequencePosition(snapshots.length, cueCount - 1);
          return;
        }
        const nextCueGroup = sequenceCueGroups[nextCue];
        if (!nextCueGroup) return;
        playSequencePosition(nextCueGroup.snapshotIndex, nextCue, {
          hardRestart: repeatAdvance.didLoop,
        });
        return;
      }
      sequenceRepeatPlaybackStateRef.current = {};
      nextCue = Math.max(-1, Math.min(cueCount, currentCue + direction));
      if (nextCue < 0) {
        playSequencePosition(-1, null);
        return;
      }
    }

    const cueGroup = sequenceCueGroups[nextCue];
    if (!cueGroup) return;
    playSequencePosition(cueGroup.snapshotIndex, nextCue);
  }, [
    sequenceRepeatSections,
    cueIndexNearBar,
    playSequencePosition,
    sequenceCueGroups,
    sequencePlayhead.barIndex,
    sequencePlayhead.markerIndex,
    sequencePlayhead.stepIndex,
    snapshotIndexNearBar,
    snapshots.length,
  ]);

  const onJumpSequenceSnapshot = useCallback((targetIndex) => {
    sequenceRepeatPlaybackStateRef.current = {};
    const nextIndex = Number(targetIndex);
    if (!Number.isFinite(nextIndex)) return;
    playSequencePosition(nextIndex, null);
  }, [playSequencePosition]);

  const onJumpSequenceCue = useCallback((targetCueIndex) => {
    sequenceRepeatPlaybackStateRef.current = {};
    const nextCueIndex = Number(targetCueIndex);
    if (!Number.isFinite(nextCueIndex) || sequenceCueGroups.length === 0) return;
    const safeCueIndex = Math.max(0, Math.min(sequenceCueGroups.length - 1, nextCueIndex));
    const cueGroup = sequenceCueGroups[safeCueIndex];
    if (!cueGroup) return;
    playSequencePosition(cueGroup.snapshotIndex, safeCueIndex);
  }, [playSequencePosition, sequenceCueGroups]);

  const onPlaySequence = useCallback(() => {
    if (!snapshots.length) return;
    if ((sequencePlayhead.stepIndex ?? -1) < 0 || (sequencePlayhead.stepIndex ?? -1) >= snapshots.length) {
      sequenceRepeatPlaybackStateRef.current = {};
      playSequencePosition(sequencePlayhead.stepIndex ?? -1, null);
      return;
    }
    playSequencePosition(sequencePlayhead.stepIndex ?? 0, sequencePlayhead.markerIndex);
  }, [playSequencePosition, sequencePlayhead.markerIndex, sequencePlayhead.stepIndex, snapshots.length]);

  const onResetSequencePlayhead = useCallback(() => {
    sequenceRepeatPlaybackStateRef.current = {};
    playSequencePosition(-1, null);
  }, [playSequencePosition]);

  const onJumpSequenceEnd = useCallback(() => {
    const lastCueIndex = sequenceCueGroups.length > 0 ? sequenceCueGroups.length - 1 : null;
    const lastBarIndex = sortedSequenceBars.length > 0 ? sortedSequenceBars.length - 1 : 0;
    keysRef.current?.stopSnapshot();
    sequenceRepeatPlaybackStateRef.current = {};
    setPlayingSnapshotId(null);
    setSelectedSnapshotId(null);
    setSelectedSnapshotMarker(null);
    setSequencePlayhead({
      barIndex: lastBarIndex,
      stepIndex: snapshots.length,
      markerIndex: lastCueIndex,
      stopped: true,
    });
  }, [sequenceCueGroups.length, snapshots.length, sortedSequenceBars.length]);

  const getTimedTransportClockSeconds = useCallback(() => {
    const synthClock = keysRef.current?.synth?.currentTime?.();
    if (Number.isFinite(synthClock)) return synthClock;
    return performance.now() / 1000;
  }, []);

  const onPlaySequenceCue = useCallback((cueIndex) => {
    sequenceRepeatPlaybackStateRef.current = {};
    const index = Number(cueIndex);
    if (!Number.isFinite(index) || index < 0 || index >= sequenceCueGroups.length) return;
    const cueGroup = sequenceCueGroups[index];
    if (!cueGroup) return;
    playSequencePosition(cueGroup.snapshotIndex, index);
  }, [playSequencePosition, sequenceCueGroups]);

  const onPlayTimedSequenceCue = useCallback((cueIndex, timedCueTrigger, options = {}) => {
    const index = Number(cueIndex);
    if (!Number.isFinite(index) || index < 0 || index >= sequenceCueGroups.length) return;
    const cueGroup = sequenceCueGroups[index];
    if (!cueGroup) return;
    const notes = Array.isArray(timedCueTrigger?.notes)
      ? timedCueTrigger.notes
      : sequenceNotesAtCueIndex(sequenceDisplaySnapshots, index);
    applySequencePlayback(cueGroup.snapshotIndex, index, notes, {
      hardRestart: options?.hardRestart === true || timedCueTrigger?.repeatJump != null,
    });
  }, [applySequencePlayback, sequenceCueGroups, sequenceDisplaySnapshots]);

  const onDeleteSnapshot = useCallback(
    (id) => {
      if (playingSnapshotId === id) {
        keysRef.current?.stopSnapshot();
        setPlayingSnapshotId(null);
      }
      const deletedSnapshotIndex = snapshots.findIndex((snapshot) => snapshot.id === id);
      const nextSnapshots = snapshots.filter((snapshot) => snapshot.id !== id);
      if (deletedSnapshotIndex >= 0) {
        const deletionPosition = deletedSnapshotIndex + 1;
        const shifted = shiftStructuralMarkersAfterSnapshotDeletion({
          bars: sequenceBars,
          tempi: sequenceTempi,
          repeats: sequenceRepeats,
          deletionPosition,
        });
        setSequenceBars(shifted.bars);
        setSequenceTempi(shifted.tempi);
        setSequenceRepeats(shifted.repeats);
      }
      setSnapshots(nextSnapshots);
      setSelectedSnapshotId((current) => (current === id ? (nextSnapshots[0]?.id ?? null) : current));
      setSelectedSnapshotMarker((current) => (current?.snapshotId === id ? null : current));
    },
    [playingSnapshotId, sequenceBars, sequenceRepeats, sequenceTempi, snapshots],
  );

  const onDeleteAllSnapshots = useCallback(() => {
    keysRef.current?.stopSnapshot();
    setPlayingSnapshotId(null);
    setSnapshots([]);
    setSelectedSnapshotId(null);
    setSelectedSnapshotMarker(null);
    setSequenceBars([]);
    setSequenceTempi([]);
    setSequenceRepeats([]);
    snapshotIdRef.current = 0;
    sequenceBarIdRef.current = 0;
    setActiveSequenceName("");
    setActiveSequenceSavedName("");
    setActiveSequenceDescription("");
    playSequencePosition(-1, null);
  }, [playSequencePosition]);

  const onClearSequence = useCallback(() => {
    keysRef.current?.stopSnapshot();
    setPlayingSnapshotId(null);
    setSnapshots([]);
    setSelectedSnapshotId(null);
    setSelectedSnapshotMarker(null);
    setSequenceBars([]);
    setSequenceTempi([]);
    setSequenceRepeats([]);
    snapshotIdRef.current = 0;
    sequenceBarIdRef.current = 0;
    setActiveSequenceName("");
    setActiveSequenceSavedName("");
    setActiveSequenceDescription("");
    playSequencePosition(-1, null);
  }, [playSequencePosition]);

  const onSequenceNameChange = useCallback((value) => {
    const nextName = String(value ?? "");
    const trimmed = nextName.trim();
    setActiveSequenceName(nextName);
    setActiveSequenceSavedName((current) => (current && current === trimmed ? current : ""));
  }, []);

  const onSequenceSaved = useCallback((name) => {
    const nextName = String(name ?? "").trim();
    setActiveSequenceName(nextName);
    setActiveSequenceSavedName(nextName);
  }, []);

  const onMoveSnapshot = useCallback((fromId, toId, side = "before") => {
    setSnapshots((prev) => {
      const fromIdx = prev.findIndex((s) => s.id === fromId);
      const toIdx = prev.findIndex((s) => s.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      const adjustedToIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
      const insertIdx = side === "after" ? adjustedToIdx + 1 : adjustedToIdx;
      next.splice(insertIdx, 0, moved);
      return next;
    });
  }, []);

  const onDuplicateSnapshot = useCallback((fromId, toId, side = "before") => {
    setSnapshots((prev) => {
      const fromIdx = prev.findIndex((s) => s.id === fromId);
      const toIdx = prev.findIndex((s) => s.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const source = prev[fromIdx];
      if (!source) return prev;
      const duplicate = {
        ...JSON.parse(JSON.stringify(source)),
        id: ++snapshotIdRef.current,
      };
      const next = [...prev];
      const insertIdx = side === "after" ? toIdx + 1 : toIdx;
      next.splice(insertIdx, 0, duplicate);
      const insertionPosition = insertIdx + 1;
      const shifted = shiftStructuralMarkersAfterSnapshotInsertion({
        bars: sequenceBars,
        tempi: sequenceTempi,
        repeats: sequenceRepeats,
        insertionPosition,
      });
      setSequenceBars(shifted.bars);
      setSequenceTempi(shifted.tempi);
      setSequenceRepeats(shifted.repeats);
      return next;
    });
  }, [sequenceBars, sequenceRepeats, sequenceTempi]);

  const onUpdateSnapshot = useCallback((id, updates) => {
    setSnapshots((prev) => prev.map((snapshot) => {
      if (snapshot.id !== id) return snapshot;
      return {
        ...snapshot,
        ...updates,
        ...(Object.prototype.hasOwnProperty.call(updates, "description")
          ? { descriptionManual: true }
          : {}),
      };
    }));
  }, []);

  const onResetSnapshotDescription = useCallback((id) => {
    setSnapshots((prev) => prev.map((snapshot) => {
      if (snapshot.id !== id) return snapshot;
      return {
        ...snapshot,
        description: buildSnapshotDescription(snapshot.notes, snapshotLabelMode),
        descriptionManual: false,
      };
    }));
  }, [snapshotLabelMode]);

  useEffect(() => {
    setSnapshots((prev) => prev.map((snapshot) => {
      if (snapshot.descriptionManual) return snapshot;
      const description = buildSnapshotDescription(snapshot.notes, snapshotLabelMode);
      return snapshot.description === description
        ? snapshot
        : { ...snapshot, description };
    }));
  }, [snapshotLabelMode]);

  useEffect(() => {
    setSequencePlayhead((prev) => {
      if (snapshots.length === 0) {
        return prev.stepIndex === -1 && prev.markerIndex == null && prev.stopped
          ? prev
          : { ...prev, stepIndex: -1, markerIndex: null, stopped: true };
      }
      const previousStep = Number.isFinite(prev.stepIndex) ? prev.stepIndex : -1;
      if (previousStep < 0) {
        return prev.markerIndex == null ? prev : { ...prev, markerIndex: null };
      }
      if (previousStep >= snapshots.length) {
        const markerIndex = prev.markerIndex == null || sequenceCueGroups.length === 0
          ? null
          : Math.max(0, Math.min(sequenceCueGroups.length - 1, prev.markerIndex));
        return prev.stepIndex === snapshots.length && markerIndex === prev.markerIndex
          ? prev
          : { ...prev, stepIndex: snapshots.length, markerIndex };
      }
      const stepIndex = Math.max(0, Math.min(snapshots.length - 1, previousStep));
      const markerIndex = prev.markerIndex == null || sequenceCueGroups.length === 0
        ? null
        : Math.max(0, Math.min(sequenceCueGroups.length - 1, prev.markerIndex));
      return stepIndex === prev.stepIndex && markerIndex === prev.markerIndex
        ? prev
        : { ...prev, stepIndex, markerIndex };
    });
  }, [sequenceCueGroups, snapshots]);

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
  const refreshKeyboardAndAudio = useCallback(async () => {
    if (keysRef.current) {
      keysRef.current.resizeHandler();
      keysRef.current.scheduleImmediateGridRedraw();
    }
    if (pendingRestoredPreset) {
      await activatePendingPreset();
      if (keysRef.current) keysRef.current.scheduleImmediateGridRedraw();
      return;
    }
    if (!userHasInteracted) {
      await primeAudioFromUserInteraction();
      if (keysRef.current) keysRef.current.scheduleImmediateGridRedraw();
      return;
    }
    if (synthRef.current?.ensureAwake) await synthRef.current.ensureAwake();
    if (synthRef.current?.prepare) await synthRef.current.prepare();
    if (keysRef.current) keysRef.current.scheduleImmediateGridRedraw();
  }, [activatePendingPreset, pendingRestoredPreset, primeAudioFromUserInteraction, userHasInteracted]);

  const clampModulationPalettePos = useCallback((position) => {
    if (typeof window === "undefined") return position;
    const paletteEl = modulationPaletteRef.current;
    const rect = paletteEl?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = rect?.width ?? 260;
    const headerHeight =
      paletteEl?.querySelector(".modulation-palette-header")?.getBoundingClientRect().height
      ?? 34;
    const minVisibleWidth = Math.min(120, Math.max(80, width * 0.45));
    const minX = Math.round(8 - width + minVisibleWidth);
    const maxX = Math.round(viewportWidth - minVisibleWidth - 8);
    const minY = 8;
    const maxY = Math.round(viewportHeight - headerHeight - 8);
    return {
      x: Math.min(Math.max(position.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(position.y, minY), Math.max(minY, maxY)),
    };
  }, []);

  const clampSnapshotPalettePos = useCallback((position) => {
    if (typeof window === "undefined") return position;
    const paletteEl = snapshotPaletteRef.current;
    const rect = paletteEl?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = rect?.width ?? 220;
    const headerHeight =
      paletteEl?.querySelector(".snapshot-palette-header")?.getBoundingClientRect().height
      ?? 34;
    const minVisibleWidth = Math.min(120, Math.max(84, width * 0.5));
    const minX = Math.round(8 - width + minVisibleWidth);
    const maxX = Math.round(viewportWidth - minVisibleWidth - 8);
    const minY = 8;
    const maxY = Math.round(viewportHeight - headerHeight - 8);
    return {
      x: Math.min(Math.max(position.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(position.y, minY), Math.max(minY, maxY)),
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e) => {
      if (!modulationPaletteDragRef.current) return;
      const { pointerId, offsetX, offsetY } = modulationPaletteDragRef.current;
      if (e.pointerId !== pointerId) return;
      modulationPaletteUserMovedRef.current = true;
      setModulationPalettePos(clampModulationPalettePos({
        x: Math.max(8, e.clientX - offsetX),
        y: Math.max(8, e.clientY - offsetY),
      }));
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
  }, [clampModulationPalettePos]);

  useEffect(() => {
    const onPointerMove = (e) => {
      if (!snapshotPaletteDragRef.current) return;
      const { pointerId, offsetX, offsetY } = snapshotPaletteDragRef.current;
      if (e.pointerId !== pointerId) return;
      snapshotPaletteUserMovedRef.current = true;
      setSnapshotPalettePos(clampSnapshotPalettePos({
        x: Math.max(8, e.clientX - offsetX),
        y: Math.max(8, e.clientY - offsetY),
      }));
    };
    const onPointerUp = (e) => {
      if (!snapshotPaletteDragRef.current) return;
      if (e.pointerId !== snapshotPaletteDragRef.current.pointerId) return;
      snapshotPaletteDragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [clampSnapshotPalettePos]);

  useEffect(() => {
    const applyDefaultPosition = () => {
      if (!modulationPaletteUserMovedRef.current) {
        setModulationPalettePos(clampModulationPalettePos(getDefaultModulationPalettePos()));
        return;
      }
      setModulationPalettePos((current) => clampModulationPalettePos(current));
    };
    window.addEventListener("resize", applyDefaultPosition);
    window.addEventListener("orientationchange", applyDefaultPosition);
    window.visualViewport?.addEventListener("resize", applyDefaultPosition);
    applyDefaultPosition();
    return () => {
      window.removeEventListener("resize", applyDefaultPosition);
      window.removeEventListener("orientationchange", applyDefaultPosition);
      window.visualViewport?.removeEventListener("resize", applyDefaultPosition);
    };
  }, [clampModulationPalettePos]);

  useEffect(() => {
    const applyDefaultPosition = () => {
      if (!snapshotPaletteUserMovedRef.current) {
        setSnapshotPalettePos(clampSnapshotPalettePos(getDefaultSnapshotPalettePos()));
        return;
      }
      setSnapshotPalettePos((current) => clampSnapshotPalettePos(current));
    };
    window.addEventListener("resize", applyDefaultPosition);
    window.addEventListener("orientationchange", applyDefaultPosition);
    window.visualViewport?.addEventListener("resize", applyDefaultPosition);
    applyDefaultPosition();
    return () => {
      window.removeEventListener("resize", applyDefaultPosition);
      window.removeEventListener("orientationchange", applyDefaultPosition);
      window.visualViewport?.removeEventListener("resize", applyDefaultPosition);
    };
  }, [
    clampSnapshotPalettePos,
    modulationPaletteCollapsed,
    modulationState?.history?.length,
    snapshots.length,
    workspaceTab,
  ]);

  // Long-press sidebar button to toggle latch (sustain while playing)
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const onSidebarTouchStart = useCallback((_e) => {
    primeAudioFromUserInteraction();
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (keysRef.current) keysRef.current.latchToggle();
    }, 400);
  }, [primeAudioFromUserInteraction]);

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
    if (!keysRef.current || textEntryActive || viewportKeyboardOpen) return undefined;
    const timer = setTimeout(() => {
      keysRef.current?.scheduleImmediateGridRedraw?.();
    }, 320);
    return () => {
      clearTimeout(timer);
    };
  }, [active, showManual, textEntryActive, viewportKeyboardOpen]);

  useEffect(() => {
    // Enable the app — triggers synth creation and makes the keyboard visible.
    setReady(true);
  }, []);

  const { onChange, onAtomicChange } = useSettingsChange(settings, setSettings, {
    midi,
    setMidiLearnActive,
    setHakenPedalLearnActive,
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
    () =>
      settingsImpactKey(settings, "keysReconstruction", {
        midiAccess,
        midiTick,
        presetRuntimeResetRevision,
      }),
    [settings, midiAccess, midiTick, presetRuntimeResetRevision],
  );
  const musicalSurfaceResetImpactKey = useMemo(
    () => settingsImpactKey(settings, "musicalSurfaceReset", { presetRuntimeResetRevision }),
    [settings, presetRuntimeResetRevision],
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
    return deriveModulationSummaryText(
      modulationState,
      modulationDegreeLabel,
      tuningWorkspace,
    );
  }, [modulationDegreeLabel, modulationState, tuningWorkspace]);
  const {
    modulationHistory,
    deferredModulationHistory,
    activeDeferredModulationKey,
    hasActiveDeferredModulation,
  } = useDeferredModulationHistory(modulationState, keysRef);
  const activeModulationLibrary = useMemo(
    () => modulationState?.history ?? presetModulationLibrary,
    [modulationState, presetModulationLibrary],
  );
  const hasCommittableModulation = useMemo(
    () => hasActiveModulationHistory(activeModulationLibrary),
    [activeModulationLibrary],
  );
  const modulationPaletteVisible = modulationHistory.length > 0;
  const currentFundamentalSummary = useMemo(() => {
    return deriveCurrentFundamentalSummary(tuningWorkspace, deferredModulationHistory, {
      fundamental: settings.fundamental,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deferredModulationHistory is intentionally represented by deferredModulationHistoryKey so palette clicks do not synchronously re-render modulation-dependent table displays.
  }, [tuningWorkspace, activeDeferredModulationKey, settings.fundamental]);
  const modulationPaletteTitle = useMemo(() => {
    return deriveModulationPaletteTitles(modulationHistory, modulationDegreeLabel, tuningWorkspace);
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
        settings.midiin_anchor_note ?? 60,
        inputNormalizationSettings,
      ) ?? {
        channel: settings.midiin_anchor_channel ?? 1,
        note: settings.midiin_anchor_note ?? 60,
      },
    [
      inputController,
      settings.midiin_anchor_channel,
      settings.midiin_anchor_note,
      inputNormalizationSettings,
    ],
  );

  const inputRuntime = useMemo(
    () => ({
      target: forceScaleTarget ? "scale" : settings.midiin_mapping_target || "hex_layout",
      layoutMode:
        inputController?.id === "hakenaudio"
          ? "controller_geometry"
          : (settings.midi_passthrough ? "sequential" : "controller_geometry"),
      mpeInput: inputController?.id === "hakenaudio" ? true : !!settings.midiin_mpe_input,
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
      wheelRange: settings.midiin_bend_range ?? "28/27",
      perChannelExpression: linnstrumentBypassChannelPerRow,
      wheelUsesInterval: linnstrumentBypassSingleChannel,
      wheelScaleAware: settings.wheel_scale_aware,
      wheelSemitones: settings.midi_wheel_semitones ?? 2,
      // Pitch bend range for incoming hardware controller bend messages.
      bendRange: settings.midiin_bend_range ?? "28/27",
      bendFlip: !!settings.midiin_bend_flip,
      // Haken Continuum MPE+ uses a 96-semitone pitch-bend range.
      scaleBendRange:
        inputController?.id === "hakenaudio"
          ? 96
          : (settings.midiin_scale_bend_range ?? 48),
      hakenXGlideShaping: settings.hakenaudio_x_glide_shaping ?? 100,
      hakenXGlideMode: settings.hakenaudio_x_glide_mode ?? "pitch_bending",
      hakenPressureVelocity: settings.hakenaudio_pressure_velocity ?? 64,
      hakenNoteOffDelay: settings.hakenaudio_note_off_delay ?? 20,
      hakenRasterThrottleMs: settings.hakenaudio_raster_throttle_ms ?? 10,
      hakenRasterStability: settings.hakenaudio_raster_stability ?? 25,
      hakenRasterFilterMode: settings.hakenaudio_raster_filter_mode ?? "all",
      hakenRasterFilter: settings.hakenaudio_raster_filter ?? "",
    }),
    [
      forceScaleTarget,
      inputController,
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
      settings.hakenaudio_x_glide_shaping,
      settings.hakenaudio_x_glide_mode,
      settings.hakenaudio_pressure_velocity,
      settings.hakenaudio_note_off_delay,
      settings.hakenaudio_raster_throttle_ms,
      settings.hakenaudio_raster_stability,
      settings.hakenaudio_raster_filter_mode,
      settings.hakenaudio_raster_filter,
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
  const onCommitCurrentModulation = useCallback(() => {
    if (!hasCommittableModulation || !tuningWorkspace) return null;
    if (keysRef.current?.panic) keysRef.current.panic();
    return commitModulationHistoryToPreset(
      settings,
      tuningWorkspace,
      activeModulationLibrary,
      {
        hejiAnchorLabel: structuralSettings.heji_anchor_label_effective,
        hejiAnchorRatio: structuralSettings.heji_anchor_ratio_effective,
        hejiTemperedOnly: settings.heji_tempered_only === true,
      },
    );
  }, [
    hasCommittableModulation,
    tuningWorkspace,
    settings,
    activeModulationLibrary,
    structuralSettings.heji_anchor_label_effective,
    structuralSettings.heji_anchor_ratio_effective,
  ]);

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
    const wantAppMode =
      !!exquisRawPorts &&
      inputRuntime?.target !== "scale" &&
      !settings.midi_passthrough;

    if (!wantAppMode) {
      if (exquisLedsRef.current) {
        exquisLedsRef.current.exit();
        exquisLedsRef.current = null;
        if (keysRef.current) keysRef.current.exquisLEDs = null;
      }
      return;
    }

    if (exquisLedsRef.current) return;

    let disposed = false;

    loadExquisLEDs().then(({ ExquisLEDs }) => {
      if (disposed || exquisLedsRef.current) return;
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
      if (disposed) {
        leds.exit();
        return;
      }
      exquisLedsRef.current = leds;
      bindControllerLedRefs(keysRef.current, { exquis: leds });
    });

    return () => {
      disposed = true;
      const leds = exquisLedsRef.current;
      if (leds) leds.exit();
      exquisLedsRef.current = null;
      bindControllerLedRefs(keysRef.current, { exquis: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exquisRawPorts, inputRuntime?.target, settings.midi_passthrough]); // exquis_led_* are constructor args, intentionally not re-triggering

  // Sync MPE mode to Exquis whenever midiin_mpe_input changes.
  // ExquisLEDs.setMPEMode() defers the send until all pads are released.
  useEffect(() => {
    if (exquisLedsRef.current?.ready) {
      exquisLedsRef.current.setMPEMode(!!settings.midiin_mpe_input);
    }
  }, [settings.midiin_mpe_input]);

  useEffect(() => {
    if (
      !exquisRawPorts ||
      inputRuntime?.target === "scale" ||
      settings.midi_passthrough ||
      typeof document === "undefined"
    ) return;

    const recoverExquisAppMode = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      exquisLedsRef.current?.recoverIfHeartbeatStale?.();
    };

    document.addEventListener("visibilitychange", recoverExquisAppMode);
    window.addEventListener("pageshow", recoverExquisAppMode);

    return () => {
      document.removeEventListener("visibilitychange", recoverExquisAppMode);
      window.removeEventListener("pageshow", recoverExquisAppMode);
    };
  }, [exquisRawPorts, inputRuntime?.target, settings.midi_passthrough]);

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

    let disposed = false;

    loadLumatoneLEDs().then(({ LumatoneLEDs }) => {
      if (disposed) return;
      const leds = new LumatoneLEDs(lumatoneRawPorts.output, lumatoneRawPorts.input);
      if (disposed) {
        leds.destroy();
        return;
      }
      lumatoneLedsRef.current = leds;
      bindControllerLedRefs(keysRef.current, { lumatone: leds }, { eagerSync: false });
    });

    return () => {
      disposed = true;
      const leds = lumatoneLedsRef.current;
      if (leds) leds.destroy();
      lumatoneLedsRef.current = null;
      bindControllerLedRefs(keysRef.current, { lumatone: null }, { eagerSync: false });
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

    let disposed = false;
    let detach = null;

    // LED driver attachment lives with the UF module so LinnStrument-specific
    // lifecycle rules stay centralized.
    loadLinnstrumentUserFirmware().then((module) => {
      if (disposed) return;
      const leds = module.attachLinnstrumentLedDriver(
        linnstrumentRawPorts.output,
        keysRef.current,
      );
      if (disposed) {
        module.detachLinnstrumentLedDriver(leds, keysRef.current);
        return;
      }
      detach = () => module.detachLinnstrumentLedDriver(leds, keysRef.current);
      linnstrumentLedsRef.current = leds;
      if (linnstrumentUserFirmwareEligible && keysRef.current) {
        leds.userFirmwareActive = true;
      }
      bindControllerLedRefs(keysRef.current, { linnstrument: leds });
    });

    return () => {
      disposed = true;
      linnstrumentLedsRef.current = null;
      bindControllerLedRefs(keysRef.current, { linnstrument: null });
      if (detach) detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linnstrumentOutId, linnstrumentUserFirmwareEligible]);

  useEffect(() => {
    const output = linnstrumentOutput;
    if (!output) return;

    let activatedKeys = null;
    let deactivate = null;
    let disposed = false;
    if (!linnstrumentUserFirmwareEligible) {
      loadLinnstrumentUserFirmware().then((module) => {
        if (disposed) return;
        module.deactivateLinnstrumentUserFirmware(output, keysRef.current ?? null);
      });
      return;
    }

    const id = setTimeout(() => {
      loadLinnstrumentUserFirmware().then((module) => {
        if (disposed) return;
        activatedKeys = keysRef.current ?? null;
        deactivate = module.deactivateLinnstrumentUserFirmware;
        module.activateLinnstrumentUserFirmware(output, activatedKeys);
      });
    }, 50);

    return () => {
      disposed = true;
      clearTimeout(id);
      if (deactivate) {
        deactivate(output, activatedKeys ?? keysRef.current ?? null);
      }
    };
  }, [linnstrumentOutput, linnstrumentUserFirmwareEligible]);

  useEffect(() => {
    const output = linnstrumentOutput;
    if (!output || !linnstrumentUserFirmwareEligible || typeof window === "undefined") return;

    const deactivateOnUnload = () => {
      loadLinnstrumentUserFirmware().then((module) => {
        module.deactivateLinnstrumentUserFirmware(output, keysRef.current ?? null);
      });
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

  const hakenOutId = hakenRawPorts?.output?.id ?? null;
  const hakenOutput = hakenRawPorts?.output ?? null;
  useEffect(() => {
    if (!hakenOutput) return;
    const managerChannel = Math.max(
      1,
      Math.min(16, parseInt(settings.midiin_mpe_manager_ch ?? 1, 10) || 1),
    );
    loadHakenController().then(({ sendHakenMpeConfig }) => {
      sendHakenMpeConfig(hakenOutput, managerChannel, {
        bendRange: 96,
      });
    });
  }, [
    hakenOutId,
    hakenOutput,
    settings.midiin_mpe_manager_ch,
  ]);

  // Color settings: only the color fields. Changes here update the live Keys
  // instance imperatively (via updateColors) without reconstructing it.
  const colorSettings = useMemo(
    () => normalizeColors(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colorImpactKey is the settings-impact registry key.
    [colorImpactKey],
  );

  const hasActiveKeyboardModulation = useMemo(
    () => hasActiveModulationHistory(modulationHistory),
    [modulationHistory],
  );

  const keyboardHejiFrame = useMemo(() => {
    return deriveActiveHejiFrame(
      tuningWorkspace,
      modulationHistory,
      {
        hejiEnabled: structuralSettings.heji,
        hejiSupported: structuralSettings.heji_supported,
        anchorLabel: structuralSettings.heji_anchor_label_effective,
        anchorRatioText: structuralSettings.heji_anchor_ratio_effective,
        referenceDegree: structuralSettings.reference_degree ?? 0,
        temperedOnly: settings.heji_tempered_only === true,
      },
    );
  }, [modulationHistory, structuralSettings, tuningWorkspace, settings.heji_tempered_only]);

  const activeHejiFrame = useMemo(() => {
    return deriveActiveHejiFrame(
      tuningWorkspace,
      deferredModulationHistory,
      {
        hejiEnabled: structuralSettings.heji,
        hejiSupported: structuralSettings.heji_supported,
        anchorLabel: structuralSettings.heji_anchor_label_effective,
        anchorRatioText: structuralSettings.heji_anchor_ratio_effective,
        referenceDegree: structuralSettings.reference_degree ?? 0,
        temperedOnly: settings.heji_tempered_only === true,
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
        hasActiveKeyboardModulation &&
        structuralSettings.heji &&
        structuralSettings.heji_supported !== false &&
        tuningWorkspace &&
        keyboardHejiFrame
      ) {
        liveHejiNames = deriveHejiLabelsForFrame(tuningWorkspace, keyboardHejiFrame, {
          suppressDeviation: !hejiShowCents && !hejiTemperedOnly,
          temperedOnly: hejiTemperedOnly,
          forceShowZeroDeviation: hejiTemperedOnly && hejiShowCents,
        });
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
    [structuralSettings, tuningWorkspace, keyboardHejiFrame, hasActiveKeyboardModulation, settings.heji_show_cents, settings.heji_tempered_only],
  );

  const tableHejiNames = useMemo(() => {
    if (
      !structuralSettings.heji ||
      !hasActiveDeferredModulation ||
      structuralSettings.heji_supported === false ||
      !tuningWorkspace ||
      !activeHejiFrame
    ) {
      return structuralSettings.heji_names ?? [];
    }

    return deriveHejiLabelsForFrame(tuningWorkspace, activeHejiFrame, {
      suppressDeviation: false,
      temperedOnly: settings.heji_tempered_only === true,
      forceShowZeroDeviation: settings.heji_tempered_only === true,
    });
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
      }, { eagerSync: false });
      if (settings.lumatone_led_sync && lumatoneLedsRef.current) {
        const syncKey = buildLumatoneAutoSyncKey({
          lumatoneInId,
          lumatoneOutId,
          name: settings.name,
          referenceDegree: settings.reference_degree,
          fundamental: settings.fundamental,
          noteColors: settings.note_colors,
          keyLabels: settings.key_labels,
          scale: settings.scale,
          equivInterval: settings.equivInterval,
          centerDegree: settings.center_degree,
          rSteps: settings.rSteps,
          drSteps: settings.drSteps,
          anchorNote: settings.midiin_anchor_note,
          anchorChannel: settings.midiin_anchor_channel,
        });
        lumatoneAutoSyncKeyRef.current = syncKey;
        setTimeout(() => {
          if (keysRef.current !== keys) return;
          if (lumatoneLedsRef.current == null) return;
          keys.autoSyncLumatoneLEDs?.();
        }, 0);
      }
    },
    [
      linnstrumentUserFirmwareEligible,
      lumatoneInId,
      lumatoneOutId,
      settings.lumatone_led_sync,
      settings.name,
      settings.reference_degree,
      settings.fundamental,
      settings.note_colors,
      settings.key_labels,
      settings.scale,
      settings.equivInterval,
      settings.center_degree,
      settings.rSteps,
      settings.drSteps,
      settings.midiin_anchor_note,
      settings.midiin_anchor_channel,
    ],
  );
  const onLatchChange = useCallback((v) => setLatch(v), []);
  const modulationSnapshotKeyRef = useRef("");
  const onModulationStateChange = useCallback((state) => {
    const snapshot = snapshotModulationState(state);
    if (snapshot?.lastDecision?.reason === "deconstruct") return;
    const nextKey = modulationSnapshotKey(snapshot);
    if (nextKey === modulationSnapshotKeyRef.current) return;
    modulationSnapshotKeyRef.current = nextKey;
    setModulationState(snapshot);
    setModulationMode(snapshot?.mode ?? "idle");
    setModulationArmed(snapshot?.mode === "awaiting_target");
  }, []);
  const onModulationArmChange = useCallback((v) => setModulationArmed(v), []);
  const onFirstInteraction = primeAudioFromUserInteraction;
  const controlsHiddenForKeyboard = textEntryActive && viewportKeyboardOpen;
  const enableLumatoneAutoSyncNow = useCallback(() => {
    const keys = keysRef.current;
    const leds = lumatoneLedsRef.current;
    if (!keys || !leds) return;
    lumatoneAutoSyncKeyRef.current = buildLumatoneAutoSyncKey({
      lumatoneInId,
      lumatoneOutId,
      name: settings.name,
      referenceDegree: settings.reference_degree,
      fundamental: settings.fundamental,
      noteColors: settings.note_colors,
      keyLabels: settings.key_labels,
      scale: settings.scale,
      equivInterval: settings.equivInterval,
      centerDegree: settings.center_degree,
      rSteps: settings.rSteps,
      drSteps: settings.drSteps,
      anchorNote: settings.midiin_anchor_note,
      anchorChannel: settings.midiin_anchor_channel,
    });
    keys.autoSyncLumatoneLEDs?.();
  }, [
    lumatoneInId,
    lumatoneOutId,
    settings.fundamental,
    settings.note_colors,
    settings.key_labels,
    settings.name,
    settings.reference_degree,
    settings.scale,
    settings.equivInterval,
    settings.center_degree,
    settings.rSteps,
    settings.drSteps,
    settings.midiin_anchor_note,
    settings.midiin_anchor_channel,
  ]);

  useEffect(() => {
    if (pendingRestoredPreset) return;
    const keys = keysRef.current;
    const leds = lumatoneLedsRef.current;
    if (!settings.lumatone_led_sync) {
      lumatoneAutoSyncKeyRef.current = "";
      return;
    }
    if (!keys || !leds) return;
    const syncKey = buildLumatoneAutoSyncKey({
      lumatoneInId,
      lumatoneOutId,
      name: settings.name,
      referenceDegree: settings.reference_degree,
      fundamental: settings.fundamental,
      noteColors: settings.note_colors,
      keyLabels: settings.key_labels,
      scale: settings.scale,
      equivInterval: settings.equivInterval,
      centerDegree: settings.center_degree,
      rSteps: settings.rSteps,
      drSteps: settings.drSteps,
      anchorNote: settings.midiin_anchor_note,
      anchorChannel: settings.midiin_anchor_channel,
    });
    if (syncKey === lumatoneAutoSyncKeyRef.current) return;
    lumatoneAutoSyncKeyRef.current = syncKey;
    const timer = setTimeout(() => {
      if (keysRef.current !== keys) return;
      if (lumatoneLedsRef.current !== leds) return;
      keys.autoSyncLumatoneLEDs?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [
    keysReadyRevision,
    lumatoneInId,
    lumatoneOutId,
    pendingRestoredPreset,
    settings.fundamental,
    settings.note_colors,
    settings.key_labels,
    settings.lumatone_led_sync,
    settings.name,
    settings.reference_degree,
    settings.scale,
    settings.equivInterval,
    settings.center_degree,
    settings.rSteps,
    settings.drSteps,
    settings.midiin_anchor_note,
    settings.midiin_anchor_channel,
  ]);

  return (
    <div
      className={[
        active ? "hide" : "show",
        controlsHiddenForKeyboard ? "text-entry-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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
          hakenPedalLearnActive={hakenPedalLearnActive}
          onHakenPedalLearn={onHakenPedalLearn}
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
            to use MIDI features in PLAINSOUND HEXATONE. After returning from the
            lock screen or another app, use the onscreen refresh button to resume audio
            if playback is silent.
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
      {showRotationDebug && (
        <div className="app-shell__rotation-debug">
          <div className="app-shell__rotation-debug-header">
            <strong>Rotation Debug</strong>
            <div className="app-shell__rotation-debug-actions">
              <button type="button" onClick={() => setRotationDebugEvents([])}>
                Clear
              </button>
              <button type="button" onClick={() => setShowRotationDebug(false)}>
                Hide
              </button>
            </div>
          </div>
          {rotationDebugEvents.map((event, index) => (
            <div
              key={`${event.at}-${event.source}-${index}`}
              className={`app-shell__rotation-debug-entry${index === 0 ? " app-shell__rotation-debug-entry--first" : ""}`}
            >
              <div>
                {event.at} {event.source}
              </div>
              <div>inner {event.inner}</div>
              <div>viewport {event.viewport}</div>
              <div>canvas {event.canvas}</div>
              <div>
                {event.orientation} / {event.sidebarMode} / {event.shortLandscape}
              </div>
            </div>
          ))}
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
        onClick={() => {
          primeAudioFromUserInteraction();
          setActive((s) => !s);
        }}
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
              className={`octave-display app-shell__octave-toggle${!octaveDeferred ? " octave-defer-active" : ""}`}
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
                  ? `Arm modulation target selection (Shift+Backquote): ${modulationSummary}`
                  : "Arm modulation target selection (Shift+Backquote)"
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
              void refreshKeyboardAndAudio();
            });
          }}
          onClick={async (e) => {
            if (skipSuppressedTouchClick(e)) return;
            e.stopPropagation();
            await refreshKeyboardAndAudio();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span class="refresh-glyph" aria-hidden="true">⟳</span>
        </button>
      </div>

      {/* ── Snapshot palette — floating overlay, visible without opening the sidebar ── */}
      {workspaceTab !== "sequencer" && snapshots.length > 0 && (
        <div
          id="snapshot-palette"
          ref={snapshotPaletteRef}
          style={{
            left: `${snapshotPalettePos.x}px`,
            top: `${snapshotPalettePos.y}px`,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="modulation-palette-header snapshot-palette-header"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.parentElement?.getBoundingClientRect();
              snapshotPaletteDragRef.current = {
                pointerId: e.pointerId,
                offsetX: rect ? e.clientX - rect.left : 0,
                offsetY: rect ? e.clientY - rect.top : 0,
              };
            }}
          >
            <span className="modulation-palette-handle" title="Drag snapshots">
              ⠿
            </span>
            <strong>SNAPSHOTS</strong>
            <button
              className="modulation-palette-toggle"
              title={snapshotPaletteCollapsed ? "Expand snapshots" : "Collapse snapshots"}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSnapshotPaletteCollapsed((value) => !value);
              }}
            >
              <span
                className={`disclosure-toggle-glyph disclosure-toggle-glyph--${snapshotPaletteCollapsed ? "collapsed" : "expanded"}`}
                aria-hidden="true"
              />
            </button>
          </div>
          {!snapshotPaletteCollapsed && (
            <div className="snapshot-palette-body">
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
                      if (dragIdRef.current !== null && dragIdRef.current !== snap.id) {
                        onMoveSnapshot(dragIdRef.current, snap.id);
                      }
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
                    <span class="snapshot-list-index" title={`Snapshot ${index + 1}`}>
                      {index + 1}
                    </span>
                    <button
                      class="snapshot-play-btn"
                      title="Play snapshot"
                      aria-label={`Play snapshot ${index + 1}`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlaySnapshot(snap.id);
                      }}
                    >
                      <span
                        className="snapshot-play-glyph snapshot-play-glyph--play"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      class="snapshot-play-btn snapshot-stop-btn"
                      title="Stop snapshot"
                      aria-label={`Stop snapshot ${index + 1}`}
                      disabled={!isPlaying}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onStopSnapshot(snap.id);
                      }}
                    >
                      <span class="snapshot-stop-glyph" aria-hidden="true">■</span>
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
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {modulationPaletteVisible && workspaceTab !== "sequencer" && (
        <div
          id="modulation-palette"
          ref={modulationPaletteRef}
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
                1/1 Shift:
              </span>
              <span className="modulation-palette-summary-value">
                {currentFundamentalSummary.display}
              </span>
              <span className="modulation-palette-summary-placeholder" aria-hidden="true" />
              <span className="modulation-palette-summary-placeholder" aria-hidden="true" />
              <span className="modulation-palette-summary-placeholder" aria-hidden="true" />
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
                  <span class="refresh-glyph" aria-hidden="true">⟳</span>
                </button>
              ) : null}
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
                  <span className="modulation-palette-modulation">
                    {modulationEntryDisplayText(entry, tuningWorkspace)}
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
                    ) : null}
                  </span>
                </div>
              );
            })}
        </div>
      )}

      <nav id="sidebar">
        <div class="workspace-tabs" role="tablist" aria-label="Workspace">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceTab === "hexatone"}
            class={`workspace-tab${workspaceTab === "hexatone" ? " workspace-tab--active" : ""}`}
            onClick={() => setWorkspaceTab("hexatone")}
          >
            HEXATONE
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceTab === "sequencer"}
            class={`workspace-tab${workspaceTab === "sequencer" ? " workspace-tab--active" : ""}`}
            onClick={() => {
              setShowManual(false);
              setWorkspaceTab("sequencer");
            }}
          >
            SEQUENCER
          </button>
        </div>
        <div class="workspace-tabs-deadzone" aria-hidden="true" />
        <h1>{workspaceTab === "sequencer" ? "PLAINSOUND SEQUENCER" : "PLAINSOUND HEXATONE"}</h1>
        {workspaceTab === "sequencer" ? (
          <p class="sidebar-intro">
            <em>
              BUILD step sequences from snapshots and trigger them event by event. CAPTURE chords and momentary expression data (velocity, pressure, timbre) while playing or sustaining. Layer new notes over captured sounds. EDIT start and stop times within a chord to make a melody or arpeggiation. Specify articulation and connections from note to note, chord by chord. Create bars and optional tempo automations.{" "}
              {!showManual && (
                <span className="app-shell__intro-more" onClick={() => setShowManual(true)}>
                  … more
                </span>
              )}
            </em>
          </p>
        ) : (
          <p class="sidebar-intro">
            <em>
              TO PLAY choose a tuning, click or touch notes, attach a MIDI keyboard or an isomorphic
              controller like Lumatone or Exquis. Use internal sounds or retune MIDI synths. Edit the
              scale in the table or drag to retune. SHIFT+ESC toggles a hand-free latch sustain. SHIFT+ENTER takes
              snapshots across tunings.<br />{" "}
              {!showManual && (
                <span className="app-shell__intro-more" onClick={() => setShowManual(true)}>
                  … more
                </span>
              )}
            </em>
          </p>
        )}

        <Suspense fallback={<SidebarLoadingFallback />}>
          {showManual ? (
            <ManualSidebar onClose={() => setShowManual(false)} />
          ) : workspaceTab === "sequencer" ? (
            <Sequencer
              snapshots={snapshots}
              displaySnapshots={sequenceDisplaySnapshots}
              bars={sequenceBars}
              repeats={sequenceRepeats}
              tempi={sequenceTempi}
              snapshotLabelMode={snapshotLabelMode}
              autoCreateBars={sequenceAutoCreateBars}
              activeSequenceName={activeSequenceName}
              activeSequenceSavedName={activeSequenceSavedName}
              activeSequenceDescription={activeSequenceDescription}
              sequenceLegato={sequenceLegato}
              snapSequenceToCurrentTuning={snapSequenceToCurrentTuning}
              sequenceAutoCreateBars={sequenceAutoCreateBars}
              selectedSnapshotId={selectedSnapshotId}
              selectedMarker={selectedSnapshotMarker}
              playingSnapshotId={playingSnapshotId}
              playhead={sequencePlayhead}
              onTakeSnapshot={onTakeSnapshot}
              onAddEmptySnapshot={onAddEmptySnapshot}
              onLoadSequence={onLoadSequence}
              onSequenceNameChange={onSequenceNameChange}
              onSequenceDescriptionChange={setActiveSequenceDescription}
              onSequenceSaved={onSequenceSaved}
              onSequenceLegatoChange={setSequenceLegato}
              onSnapSequenceToCurrentTuningChange={setSnapSequenceToCurrentTuning}
              onSequenceAutoCreateBarsChange={setSequenceAutoCreateBars}
              onSetSnapshotLabelMode={setSnapshotLabelMode}
              onSelectSnapshot={onSelectSequencerSnapshot}
              onSelectMarker={onSelectSequencerMarker}
              onPlaySnapshot={onPlaySnapshot}
              onStopSnapshot={onStopSnapshot}
              onSelectSequenceBar={onSelectSequenceBar}
              onStepSequence={onStepSequence}
              onStepSequenceMarker={onStepSequenceMarker}
              onJumpSequenceSnapshot={onJumpSequenceSnapshot}
              onJumpSequenceCue={onJumpSequenceCue}
              onPlaySequence={onPlaySequence}
              onPlayCue={onPlaySequenceCue}
              onPlayTimedCue={onPlayTimedSequenceCue}
              onResetSequencePlayhead={onResetSequencePlayhead}
              onJumpSequenceEnd={onJumpSequenceEnd}
              getTimedTransportClockSeconds={getTimedTransportClockSeconds}
              onAddBar={onAddSequenceBar}
              onAddTempo={onAddSequenceTempo}
              onAddRepeat={onAddSequenceRepeat}
              onAddBarsBeforeSnapshots={onAddBarsBeforeSnapshots}
              onDeleteBar={onDeleteSequenceBar}
              onDeleteTempo={onDeleteSequenceTempo}
              onDeleteRepeat={onDeleteSequenceRepeat}
              onUpdateBar={onUpdateSequenceBar}
              onUpdateTempo={onUpdateSequenceTempo}
              onUpdateRepeat={onUpdateSequenceRepeat}
              onMoveBar={onMoveSequenceBar}
              onDeleteSnapshot={onDeleteSnapshot}
              onDeleteAllSnapshots={onDeleteAllSnapshots}
              onClearSequence={onClearSequence}
              onMoveSnapshot={onMoveSnapshot}
              onDuplicateSnapshot={onDuplicateSnapshot}
              onUpdateSnapshot={onUpdateSnapshot}
              onResetSnapshotDescription={onResetSnapshotDescription}
            />
          ) : (
            <>
              <Settings
                presetChanged={presetChanged}
                presets={presets}
                onChange={onChange}
                onAtomicChange={onAtomicChange}
                midiLearnActive={midiLearnActive}
                hakenPedalLearnActive={hakenPedalLearnActive}
                onVolumeChange={onVolumeChange}
                onOscLayerVolumeChange={onOscLayerVolumeChange}
                onOscQuickReleaseChange={onOscQuickReleaseChange}
                onOscQuickReleaseTimeChange={onOscQuickReleaseTimeChange}
                onOscQuickReleaseRasterOnlyChange={onOscQuickReleaseRasterOnlyChange}
                onImport={onImport}
                importCount={importCount}
                onLoadCustomPreset={onLoadCustomPreset}
                onClearUserPresets={onClearUserPresets}
                activeSource={activeSource}
                activePresetName={activePresetName}
                pendingRestoredPreset={pendingRestoredPreset}
                isPresetDirty={isPresetDirty}
                currentModulationLibrary={modulationState?.history ?? presetModulationLibrary}
                canCommitModulation={hasCommittableModulation}
                onCommitCurrentModulation={onCommitCurrentModulation}
                persistOnReload={persistOnReload}
                setPersistOnReload={setPersistOnReload}
                showActivateAudioContext={!!pendingRestoredPreset || (restoredOnMount && !userHasInteracted)}
                activateAudioContext={refreshKeyboardAndAudio}
                activatePendingPreset={activatePendingPreset}
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
                keysReadyRevision={keysReadyRevision}
                lumatoneRawPorts={lumatoneRawPorts}
                exquisRawPorts={exquisRawPorts}
                linnstrumentRawPorts={linnstrumentRawPorts}
                hakenRawPorts={hakenRawPorts}
                exquisLedStatus={exquisLedStatus}
                snapshots={snapshots}
                playingSnapshotId={playingSnapshotId}
                onPlaySnapshot={onPlaySnapshot}
                onDeleteSnapshot={onDeleteSnapshot}
                onEnableLumatoneAutoSync={enableLumatoneAutoSyncNow}
              />
              <Credits />
            </>
          )}
        </Suspense>
        <div id="sidebar-spacer"></div>
      </nav>
    </div>
  );
};

export default App;
