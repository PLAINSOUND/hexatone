import { useState, useEffect } from "preact/hooks";
import { presets, default_settings } from "./settings/presets/preset_values";
import { settingsToHexatonScala } from "./settings/scale/parse-scale.js";
import { loadCustomPresets } from "./settings/presets/custom-presets";
import { PRESET_SKIP_KEYS } from "./persistence/settings-registry.js";
import { normalizeModulationHistory } from "./tuning/modulation-runtime.js";
import { getControllerById } from "./controllers/registry.js";
import { loadSavedAnchor, loadSavedAnchorChannel } from "./input/controller-anchor.js";
import { deriveKeyColorFlags } from "./settings/scale/key-colors-mode.js";
import { primeSharedSampleAudio } from "./sample_synth";

export { PRESET_SKIP_KEYS };
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Scale-related keys to clear on reset (keeps output settings)
export const SCALE_KEYS_TO_CLEAR = [
  "scale",
  "scale_import",
  "note_names",
  "note_colors",
  "key_labels",
  "fundamental",
  "reference_degree",
  "equivSteps",
  "equivInterval",
  "rSteps",
  "drSteps",
  "hexSize",
  "rotation",
  "center_degree",
  // "midiin_anchor_note" excluded — hardware setting, persists across presets
  "key_colors_mode",
  "auto_colors",
  "spectrum_colors",
  "fundamental_color",
  "name",
  "description",
  "short_description",
];

export const clearScaleSettings = () => {
  SCALE_KEYS_TO_CLEAR.forEach((key) => sessionStorage.removeItem(key));
};

export const findPreset = (preset) => {
  for (let g of presets) {
    for (let p of g.settings) {
      if (p.name === preset) {
        return { ...p, scale_import: settingsToHexatonScala(p) };
      }
    }
  }
  return default_settings;
};

// Scale preset hexSize down on phone-sized screens, but not below 20.
// Use the short edge so iPhone landscape matches portrait behaviour.
export const scaleHexSizeForScreen = (hexSize) => {
  const size = hexSize || 42;
  const shortEdge =
    typeof window === "undefined"
      ? Infinity
      : Math.min(window.innerWidth || Infinity, window.innerHeight || Infinity);
  if (shortEdge <= 600 && size > 31) {
    return Math.max(20, Math.floor(size * 0.75));
  }
  return size;
};

function sessionIntOrFallback(key, fallback) {
  if (typeof sessionStorage === "undefined") return fallback;
  const raw = sessionStorage.getItem(key);
  if (raw === null) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sessionIntFromAliases(keys, fallback) {
  for (const key of keys) {
    const value = sessionIntOrFallback(key, null);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function restorePersistentAnchorFields(fallback = {}) {
  return {
    midiin_anchor_note: sessionIntFromAliases(
      ["midiin_anchor_note", "midiin_central_degree", "lumatone_center_note"],
      fallback.midiin_anchor_note ?? fallback.midiin_central_degree ?? 60,
    ),
    midiin_anchor_channel: sessionIntFromAliases(
      ["midiin_anchor_channel", "lumatone_center_channel"],
      fallback.midiin_anchor_channel ?? 1,
    ),
  };
}

const PRESET_ANCHOR_CONFIGS = [
  {
    controllerId: "lumatone",
    controller: getControllerById("lumatone"),
    noteKey: "lumatone_anchor_note",
    channelKey: "lumatone_anchor_channel",
    appliesInSettings: (settings) =>
      settings.midiin_controller_override === "lumatone" && settings.midi_passthrough !== true,
  },
  {
    controllerId: "exquis",
    controller: getControllerById("exquis"),
    noteKey: "exquis_anchor_note",
    appliesInSettings: (settings) =>
      settings.midiin_controller_override === "exquis" && settings.midi_passthrough !== true,
  },
  {
    controllerId: "linnstrument",
    controller: getControllerById("linnstrument"),
    noteKey: "linnstrument_anchor_note",
    appliesInSettings: (settings) =>
      settings.midiin_controller_override === "linnstrument" && settings.midi_passthrough !== true,
  },
];

function hasPresetAnchor(settings = {}) {
  return PRESET_ANCHOR_CONFIGS.some(
    ({ noteKey, channelKey }) =>
      Number.isFinite(settings[noteKey]) || (channelKey && Number.isFinite(settings[channelKey])),
  );
}

function getPresetAnchorConfig(settings = {}) {
  return PRESET_ANCHOR_CONFIGS.find(
    ({ noteKey, channelKey }) =>
      Number.isFinite(settings[noteKey]) || (channelKey && Number.isFinite(settings[channelKey])),
  );
}

function getAnchorFallback(settings = {}) {
  if (!hasPresetAnchor(settings)) {
    return {
      midiin_anchor_note: settings.midiin_anchor_note ?? 60,
      midiin_anchor_channel: settings.midiin_anchor_channel ?? 1,
    };
  }

  const presetAnchorConfig = getPresetAnchorConfig(settings);
  if (!presetAnchorConfig?.controller) {
    return {
      midiin_anchor_note: settings.midiin_anchor_note ?? 60,
      midiin_anchor_channel: settings.midiin_anchor_channel ?? 1,
    };
  }

  return {
    midiin_anchor_note: loadSavedAnchor(presetAnchorConfig.controller, settings, { preferStored: false }),
    midiin_anchor_channel: loadSavedAnchorChannel(presetAnchorConfig.controller, settings, {
      preferStored: false,
    }) ?? 1,
  };
}

// HEJI anchors may be auto-derived from the current preset's tuning/labels.
// Reset them on preset load so an inferred anchor from the previous preset
// cannot survive the merge unless the incoming preset explicitly defines one.
export const mergePresetIntoSettings = (settings, preset) => {
  const persistentAnchorFallback = getAnchorFallback(settings);
  const restoredAnchor = restorePersistentAnchorFields(persistentAnchorFallback);
  const activePresetAnchorConfig = PRESET_ANCHOR_CONFIGS.find(({ appliesInSettings }) =>
    appliesInSettings(settings),
  );
  const presetAnchorNote =
    activePresetAnchorConfig && Number.isFinite(preset[activePresetAnchorConfig.noteKey])
      ? preset[activePresetAnchorConfig.noteKey]
      : restoredAnchor.midiin_anchor_note;
  const presetAnchorChannel =
    activePresetAnchorConfig?.channelKey &&
    Number.isFinite(preset[activePresetAnchorConfig.channelKey])
      ? preset[activePresetAnchorConfig.channelKey]
      : restoredAnchor.midiin_anchor_channel;

  const clearedPresetAnchorFields = Object.fromEntries(
    PRESET_ANCHOR_CONFIGS.flatMap(({ noteKey, channelKey }) => [
      [noteKey, undefined],
      ...(channelKey ? [[channelKey, undefined]] : []),
    ]),
  );
  const presetWithoutControllerAnchors = { ...preset };
  for (const { noteKey, channelKey } of PRESET_ANCHOR_CONFIGS) {
    delete presetWithoutControllerAnchors[noteKey];
    if (channelKey) delete presetWithoutControllerAnchors[channelKey];
  }
  const incomingPresetAnchorFields = Object.fromEntries(
    PRESET_ANCHOR_CONFIGS.flatMap(({ noteKey, channelKey }) => [
      [noteKey, Number.isFinite(preset[noteKey]) ? preset[noteKey] : undefined],
      ...(channelKey
        ? [[channelKey, Number.isFinite(preset[channelKey]) ? preset[channelKey] : undefined]]
        : []),
    ]),
  );

  const keyColorFlags = deriveKeyColorFlags(preset);

  return {
    ...settings,
    heji_anchor_ratio: "",
    heji_anchor_label: "",
    key_colors_mode: undefined,
    auto_colors: undefined,
    spectrum_colors: undefined,
    ...clearedPresetAnchorFields,
    ...presetWithoutControllerAnchors,
    ...keyColorFlags,
    midiin_anchor_note: presetAnchorNote,
    midiin_anchor_channel: presetAnchorChannel,
    ...incomingPresetAnchorFields,
    controller_virtual_anchor_x: null,
    controller_virtual_anchor_y: null,
  };
};

// Fields that count as "edits" for dirty detection — same as PRESET_SKIP_KEYS.
const DIRTY_FIELDS = PRESET_SKIP_KEYS;

const snapshotOf = (s, modulationLibrary = []) => {
  const settingsSnap = {};
  for (const k of DIRTY_FIELDS) settingsSnap[k] = JSON.stringify(s[k]);
  return {
    settings: settingsSnap,
    modulationLibrary: JSON.stringify(normalizeModulationHistory(modulationLibrary, { zeroCounts: true })),
  };
};

const isDirty = (snap, s, modulationLibrary = []) => {
  if (!snap) return false;
  for (const k of DIRTY_FIELDS) {
    if (JSON.stringify(s[k]) !== snap.settings[k]) return true;
  }
  return (
    JSON.stringify(normalizeModulationHistory(modulationLibrary, { zeroCounts: true })) !==
    snap.modulationLibrary
  );
};

// localStorage key for the "restore on reload" preference
const PERSIST_ON_RELOAD_KEY = "hexatone_persist_on_reload";

function schedulePresetRuntimeReset(callback) {
  if (typeof callback !== "function") return;
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => callback());
    return;
  }
  setTimeout(() => callback(), 0);
}

/**
 * Manages preset state: active preset identity, dirty detection, and all
 * load/revert operations. Persists the active preset selection to sessionStorage
 * so it survives page refresh (when persistOnReload is enabled).
 *
 * @param {object}   settings         - Current app settings (initial value read on mount)
 * @param {function} setSettings      - Settings updater from useQuery
 * @param {object}   options
 * @param {object}   options.synthRef - Ref to the live synth (for prepare() on preset load)
 * @param {function} options.onUserInteraction - Called to mark the user as having interacted
 * @param {function} options.bumpImportCount - Bumps the scale reset token so TuneCell preview UI clears
 * @param {function} options.bumpPresetRuntimeReset - Forces a full musical-surface rebuild/reset
 *                                                    for sidebar preset refresh actions
 *                                               (required to start AudioContext)
 * @returns {{ activeSource, activePresetName, isPresetDirty,
 *             persistOnReload, setPersistOnReload,
 *             presetChanged, onLoadCustomPreset, onClearUserPresets,
 *             onRevertBuiltin, onRevertUser }}
 */
const usePresets = (
  settings,
  setSettings,
  {
    synthRef,
    onUserInteraction,
    bumpImportCount,
    bumpPresetRuntimeReset,
    currentModulationLibrary,
    setPresetModulationLibrary,
    onPresetModulationLibraryLoaded,
  },
) => {
  const [activeSource, setActiveSource] = useState(null);
  const [activePresetName, setActivePresetName] = useState(null);
  const [restoredOnMount, setRestoredOnMount] = useState(false);
  const [pendingRestoredPreset, setPendingRestoredPreset] = useState(null);
  // Snapshot stored in state so updating it triggers a re-render and
  // isPresetDirty recalculates correctly.
  const [savedPresetSnapshot, setSavedPresetSnapshot] = useState(null);
  // Defaults to false (clean start on reload) — opt-in, stored in localStorage.
  const [persistOnReload, setPersistOnReloadState] = useState(
    () => localStorage.getItem(PERSIST_ON_RELOAD_KEY) === "true",
  );

  const setPersistOnReload = (value) => {
    localStorage.setItem(PERSIST_ON_RELOAD_KEY, String(value));
    setPersistOnReloadState(value);
  };

  // On mount: restore the previously active preset from sessionStorage,
  // unless the user has opted into a clean start on every reload.
  useEffect(() => {
    if (!persistOnReload) return;

    const savedSource = sessionStorage.getItem("hexatone_preset_source");
    const savedName = sessionStorage.getItem("hexatone_preset_name");

    if (!savedSource || !savedName) return;

    if (isIOS) {
      setActiveSource(savedSource);
      setActivePresetName(savedName);
      if (savedSource === "builtin") {
        const presetData = findPreset(savedName);
        if (presetData) {
          const savedLibrary = normalizeModulationHistory(presetData.modulation_library, { zeroCounts: true });
          setPresetModulationLibrary(savedLibrary);
          onPresetModulationLibraryLoaded?.(savedLibrary);
        }
      } else if (savedSource === "user") {
        const preset = loadCustomPresets().find((p) => p.name === savedName);
        if (preset) {
          const savedLibrary = normalizeModulationHistory(preset.modulation_library, { zeroCounts: true });
          setPresetModulationLibrary(savedLibrary);
          onPresetModulationLibraryLoaded?.(savedLibrary);
        }
      }
      setPendingRestoredPreset({ source: savedSource, name: savedName });
      return;
    }

    if (savedSource === "builtin") {
      setRestoredOnMount(true);
      setActiveSource("builtin");
      setActivePresetName(savedName);
      const presetData = findPreset(savedName);
      if (presetData) {
        const adjustedPreset = {
          ...presetData,
          hexSize: scaleHexSizeForScreen(presetData.hexSize),
        };
        const merged = mergePresetIntoSettings(settings, adjustedPreset);
        const savedLibrary = normalizeModulationHistory(presetData.modulation_library, { zeroCounts: true });
        setPresetModulationLibrary(savedLibrary);
        onPresetModulationLibraryLoaded?.(savedLibrary);
        setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
        bumpImportCount?.();
        setSettings(() => merged, { updateUrl: false });
        schedulePresetRuntimeReset(bumpPresetRuntimeReset);
      }
    } else if (savedSource === "user") {
      setRestoredOnMount(true);
      const customPresets = loadCustomPresets();
      const preset = customPresets.find((p) => p.name === savedName);
      if (preset) {
        setActiveSource("user");
        setActivePresetName(preset.name);
        const adjustedPreset = {
          ...preset,
          hexSize: scaleHexSizeForScreen(preset.hexSize),
        };
        const merged = mergePresetIntoSettings(settings, adjustedPreset);
        const savedLibrary = normalizeModulationHistory(preset.modulation_library, { zeroCounts: true });
        setPresetModulationLibrary(savedLibrary);
        onPresetModulationLibraryLoaded?.(savedLibrary);
        setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
        bumpImportCount?.();
        setSettings(() => merged, { updateUrl: false });
        schedulePresetRuntimeReset(bumpPresetRuntimeReset);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount-only: restores session preset on initial load; re-running on settings change would override user edits

  const activatePendingPreset = async () => {
    if (!pendingRestoredPreset) return false;
    const { source, name } = pendingRestoredPreset;
    if (isIOS) {
      await primeSharedSampleAudio();
    }
    await onUserInteraction?.();
    if (source === "builtin") {
      const presetData = findPreset(name);
      if (!presetData) return false;
      const adjustedPreset = {
        ...presetData,
        hexSize: scaleHexSizeForScreen(presetData.hexSize),
      };
      const merged = mergePresetIntoSettings(settings, adjustedPreset);
      bumpImportCount?.();
      const savedLibrary = normalizeModulationHistory(presetData.modulation_library, { zeroCounts: true });
      setPresetModulationLibrary(savedLibrary);
      onPresetModulationLibraryLoaded?.(savedLibrary);
      setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
      setSettings(() => merged);
    } else if (source === "user") {
      const preset = loadCustomPresets().find((p) => p.name === name);
      if (!preset) return false;
      const adjustedPreset = {
        ...preset,
        hexSize: scaleHexSizeForScreen(preset.hexSize),
      };
      const merged = mergePresetIntoSettings(settings, adjustedPreset);
      bumpImportCount?.();
      const savedLibrary = normalizeModulationHistory(preset.modulation_library, { zeroCounts: true });
      setPresetModulationLibrary(savedLibrary);
      onPresetModulationLibraryLoaded?.(savedLibrary);
      setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
      setSettings(() => merged);
    } else {
      return false;
    }
    setPendingRestoredPreset(null);
    setRestoredOnMount(false);
    return true;
  };

  const presetChanged = async (e) => {
    const presetName = e.target.value;
    if (!presetName) return;
    // Mark user interaction immediately so sample/audio warmup can begin in the
    // current gesture turn, but do not await prepare() here — iOS select
    // controls can lose the first committed value if the handler blocks before
    // the controlled value/state update lands.
    onUserInteraction();
    setRestoredOnMount(false);
    setPendingRestoredPreset(null);
    setActiveSource("builtin");
    setActivePresetName(presetName);
    sessionStorage.setItem("hexatone_preset_source", "builtin");
    sessionStorage.setItem("hexatone_preset_name", presetName);
    const presetData = findPreset(presetName);
    const adjustedPreset = {
      ...presetData,
      hexSize: scaleHexSizeForScreen(presetData.hexSize),
    };
    const merged = mergePresetIntoSettings(settings, adjustedPreset);
    bumpImportCount?.();
    const savedLibrary = normalizeModulationHistory(presetData.modulation_library, { zeroCounts: true });
    setPresetModulationLibrary(savedLibrary);
    onPresetModulationLibraryLoaded?.(savedLibrary);
    setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
    setSettings(() => merged);
    synthRef.current?.prepare?.();
  };

  const onLoadCustomPreset = (preset) => {
    onUserInteraction();
    setRestoredOnMount(false);
    setPendingRestoredPreset(null);
    setActiveSource("user");
    setActivePresetName(preset.name || null);
    sessionStorage.setItem("hexatone_preset_source", "user");
    if (preset.name) {
      sessionStorage.setItem("hexatone_preset_name", preset.name);
    } else {
      sessionStorage.removeItem("hexatone_preset_name");
    }
    const adjustedPreset = {
      ...preset,
      hexSize: scaleHexSizeForScreen(preset.hexSize),
    };
    const merged = mergePresetIntoSettings(settings, adjustedPreset);
    bumpImportCount?.();
    const savedLibrary = normalizeModulationHistory(preset.modulation_library, { zeroCounts: true });
    setPresetModulationLibrary(savedLibrary);
    onPresetModulationLibraryLoaded?.(savedLibrary);
    setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
    setSettings(() => merged);
  };

  const onClearUserPresets = () => {
    const remaining = loadCustomPresets();
    setActiveSource(null);
    setActivePresetName(null);
    setPendingRestoredPreset(null);
    setPresetModulationLibrary([]);
    onPresetModulationLibraryLoaded?.([]);
    sessionStorage.removeItem("hexatone_preset_source");
    sessionStorage.removeItem("hexatone_preset_name");

    if (remaining.length > 0) {
      // Load the first remaining preset after the deleted one(s)
      const preset = remaining[0];
      setActiveSource("user");
      setActivePresetName(preset.name);
      sessionStorage.setItem("hexatone_preset_source", "user");
      sessionStorage.setItem("hexatone_preset_name", preset.name);
      const merged = mergePresetIntoSettings(settings, preset);
      const savedLibrary = normalizeModulationHistory(preset.modulation_library, { zeroCounts: true });
      setPresetModulationLibrary(savedLibrary);
      onPresetModulationLibraryLoaded?.(savedLibrary);
      setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
      setSettings(() => merged);
    } else {
      // No user presets remain — clear scale keys and start fresh
      clearScaleSettings();
      window.location.reload();
    }
  };

  const onRevertBuiltin = () => {
    onUserInteraction();
    setRestoredOnMount(false);
    setPendingRestoredPreset(null);
    if (activePresetName) {
      const presetData = findPreset(activePresetName);
      const adjustedPreset = {
        ...presetData,
        hexSize: scaleHexSizeForScreen(presetData.hexSize),
      };
      const merged = mergePresetIntoSettings(settings, adjustedPreset);
      bumpImportCount?.();
      const savedLibrary = normalizeModulationHistory(presetData.modulation_library, { zeroCounts: true });
      setPresetModulationLibrary(savedLibrary);
      onPresetModulationLibraryLoaded?.(savedLibrary);
      setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
      setSettings(() => merged);
      schedulePresetRuntimeReset(bumpPresetRuntimeReset);
    }
  };

  const onRevertUser = () => {
    onUserInteraction();
    setRestoredOnMount(false);
    setPendingRestoredPreset(null);
    if (activePresetName) {
      const saved = loadCustomPresets().find((p) => p.name === activePresetName);
      if (saved) {
        const adjustedPreset = {
          ...saved,
          hexSize: scaleHexSizeForScreen(saved.hexSize),
        };
        const merged = mergePresetIntoSettings(settings, adjustedPreset);
        bumpImportCount?.();
        const savedLibrary = normalizeModulationHistory(saved.modulation_library, { zeroCounts: true });
        setPresetModulationLibrary(savedLibrary);
        onPresetModulationLibraryLoaded?.(savedLibrary);
        setSavedPresetSnapshot(snapshotOf(merged, savedLibrary));
        setSettings(() => merged);
        schedulePresetRuntimeReset(bumpPresetRuntimeReset);
      }
    }
  };

  // Called by useSettingsChange when scale_divide fires — the user has
  // generated a new scale that is no longer tied to any loaded preset.
  const onUserScaleEdit = (name) => {
    setActiveSource("user");
    setRestoredOnMount(false);
    setPendingRestoredPreset(null);
    setActivePresetName(name || null);
    sessionStorage.setItem("hexatone_preset_source", "user");
    if (name) {
      sessionStorage.setItem("hexatone_preset_name", name);
    } else {
      sessionStorage.removeItem("hexatone_preset_name");
    }
    setSavedPresetSnapshot(null);
  };

  return {
    activeSource,
    activePresetName,
    restoredOnMount,
    pendingRestoredPreset,
    isPresetDirty: isDirty(savedPresetSnapshot, settings, currentModulationLibrary),
    persistOnReload,
    setPersistOnReload,
    activatePendingPreset,
    presetChanged,
    onLoadCustomPreset,
    onClearUserPresets,
    onRevertBuiltin,
    onRevertUser,
    onUserScaleEdit,
  };
};

export default usePresets;
