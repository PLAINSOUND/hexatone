import { useState, useEffect } from "preact/hooks";
import { presets, default_settings } from "./settings/preset_values";
import { settingsToHexatonScala } from "./settings/scale/parse-scale.js";
import { loadCustomPresets } from "./settings/custom-presets";

// Preset-specific fields are never restored from URL or localStorage on reload.
// They only come from the preset_values defaults or an explicit preset load.
export const PRESET_SKIP_KEYS = [
  "name",
  "description",
  "scale",
  "note_names",
  "note_colors",
  "spectrum_colors",
  "fundamental_color",
  "reference_degree",
  "center_degree",
  "equivSteps",
  "rSteps",
  "drSteps",
  "key_labels",
  "hexSize",
  "rotation",
];

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
  // "midiin_central_degree" excluded — hardware setting, persists across presets
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
  console.log("Unable to find preset");
  return default_settings;
};

// Scale hexSize down on phones (max-width 600px), but not below 20
const scaleHexSizeForScreen = (hexSize) => {
  const size = hexSize || 42;
  if (window.innerWidth <= 600 && size > 31) {
    return Math.max(20, Math.floor(size * 0.75));
  }
  return size;
};

// Fields that count as "edits" for dirty detection — same as PRESET_SKIP_KEYS.
const DIRTY_FIELDS = PRESET_SKIP_KEYS;

const snapshotOf = (s) => {
  const snap = {};
  for (const k of DIRTY_FIELDS) snap[k] = JSON.stringify(s[k]);
  return snap;
};

const isDirty = (snap, s) => {
  if (!snap) return false;
  for (const k of DIRTY_FIELDS) {
    if (JSON.stringify(s[k]) !== snap[k]) return true;
  }
  return false;
};

// localStorage key for the "restore on reload" preference
const PERSIST_ON_RELOAD_KEY = "hexatone_persist_on_reload";

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
 *                                               (required to start AudioContext)
 * @returns {{ activeSource, activePresetName, isPresetDirty,
 *             persistOnReload, setPersistOnReload,
 *             presetChanged, onLoadCustomPreset, onClearUserPresets,
 *             onRevertBuiltin, onRevertUser }}
 */
const usePresets = (settings, setSettings, { synthRef, onUserInteraction }) => {
  const [activeSource, setActiveSource] = useState(null);
  const [activePresetName, setActivePresetName] = useState(null);
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

    if (savedSource === "builtin") {
      setActiveSource("builtin");
      setActivePresetName(savedName);
      const presetData = findPreset(savedName);
      if (presetData) {
        const adjustedPreset = {
          ...presetData,
          hexSize: scaleHexSizeForScreen(presetData.hexSize),
        };
        setSavedPresetSnapshot(snapshotOf({ ...settings, ...adjustedPreset }));
        setSettings(() => ({ ...settings, ...adjustedPreset }));
      }
    } else if (savedSource === "user") {
      const customPresets = loadCustomPresets();
      const preset = customPresets.find((p) => p.name === savedName);
      if (preset) {
        setActiveSource("user");
        setActivePresetName(preset.name);
        const adjustedPreset = {
          ...preset,
          hexSize: scaleHexSizeForScreen(preset.hexSize),
        };
        setSavedPresetSnapshot(snapshotOf({ ...settings, ...adjustedPreset }));
        setSettings(() => ({ ...settings, ...adjustedPreset }));
      }
    }
  }, []);

  const presetChanged = async (e) => {
    if (!e.target.value) return;
    // Mark user interaction immediately — before any await — so that
    // useSynthWiring sees userHasInteracted=true when it rebuilds the synth
    // after setSettings, and can call prepare() within the same gesture window.
    // On iOS, calling resume() outside the direct gesture turn causes a stall.
    onUserInteraction();
    if (synthRef.current?.prepare) await synthRef.current.prepare();
    setActiveSource("builtin");
    setActivePresetName(e.target.value);
    sessionStorage.setItem("hexatone_preset_source", "builtin");
    sessionStorage.setItem("hexatone_preset_name", e.target.value);
    const presetData = findPreset(e.target.value);
    const adjustedPreset = {
      ...presetData,
      hexSize: scaleHexSizeForScreen(presetData.hexSize),
    };
    const merged = { ...settings, ...adjustedPreset };
    setSavedPresetSnapshot(snapshotOf(merged));
    setSettings(() => merged);
  };

  const onLoadCustomPreset = (preset) => {
    onUserInteraction();
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
    const merged = { ...settings, ...adjustedPreset };
    setSavedPresetSnapshot(snapshotOf(merged));
    setSettings(() => merged);
  };

  const onClearUserPresets = () => {
    const remaining = loadCustomPresets();
    setActiveSource(null);
    setActivePresetName(null);
    sessionStorage.removeItem("hexatone_preset_source");
    sessionStorage.removeItem("hexatone_preset_name");

    if (remaining.length > 0) {
      // Load the first remaining preset after the deleted one(s)
      const preset = remaining[0];
      setActiveSource("user");
      setActivePresetName(preset.name);
      sessionStorage.setItem("hexatone_preset_source", "user");
      sessionStorage.setItem("hexatone_preset_name", preset.name);
      const merged = { ...settings, ...preset };
      setSavedPresetSnapshot(snapshotOf(merged));
      setSettings(() => merged);
    } else {
      // No user presets remain — clear scale keys and start fresh
      clearScaleSettings();
      window.location.reload();
    }
  };

  const onRevertBuiltin = () => {
    onUserInteraction();
    if (activePresetName) {
      const presetData = findPreset(activePresetName);
      const adjustedPreset = {
        ...presetData,
        hexSize: scaleHexSizeForScreen(presetData.hexSize),
      };
      const merged = { ...settings, ...adjustedPreset };
      setSavedPresetSnapshot(snapshotOf(merged));
      setSettings(() => merged);
    }
  };

  const onRevertUser = () => {
    onUserInteraction();
    if (activePresetName) {
      const saved = loadCustomPresets().find(
        (p) => p.name === activePresetName,
      );
      if (saved) {
        const adjustedPreset = {
          ...saved,
          hexSize: scaleHexSizeForScreen(saved.hexSize),
        };
        const merged = { ...settings, ...adjustedPreset };
        setSavedPresetSnapshot(snapshotOf(merged));
        setSettings(() => merged);
      }
    }
  };

  return {
    activeSource,
    activePresetName,
    isPresetDirty: isDirty(savedPresetSnapshot, settings),
    persistOnReload,
    setPersistOnReload,
    presetChanged,
    onLoadCustomPreset,
    onClearUserPresets,
    onRevertBuiltin,
    onRevertUser,
  };
};

export default usePresets;
