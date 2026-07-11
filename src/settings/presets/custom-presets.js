// This module owns the browser-local custom preset library.
// It loads, saves, imports, exports, and edits user preset JSON stored outside
// the built-in preset set. It does not build the live synth graph; it manages
// persistence and UI-facing preset records.

import { createRef } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import PropTypes from "prop-types";
import {
  derivePresetControllerAnchorFields,
  fileToPreset,
  settingsToPresetJson,
} from "../scale/parse-scale";
import { normalizeModulationHistory } from "../../tuning/modulation-runtime.js";
import { resolveKeyColorsMode } from "../scale/key-colors-mode.js";
import { presets as builtinPresetGroups } from "./preset_values";

const STORAGE_KEY = "hexatone_custom_presets";

const PRESET_FIELDS = [
  "name",
  "description",
  "short_description",
  "scale_import",
  "scale",
  "equivSteps",
  "equivInterval",
  "note_names",
  "note_colors",
  "key_labels",
  "key_colors_mode",
  "fundamental_color",
  "prime_family_colors",
  "fundamental",
  "reference_degree",
  "center_degree",
  "heji_anchor_ratio",
  "heji_anchor_label",
  "rSteps",
  "drSteps",
  "hexSize",
  "rotation",
  "midiin_anchor_note",
  "midiin_anchor_channel",
  "lumatone_anchor_note",
  "lumatone_anchor_channel",
  "exquis_anchor_note",
  "linnstrument_anchor_note",
  "mpe_mode",
  "mpe_pitchbend_range",
  "modulation_library",
];

export const loadCustomPresets = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveCustomPresets = (presets) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

const downloadFile = (content, filename, mimeType = "application/json") => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const safeName = (name) => (name || "preset").replace(/[^a-zA-Z0-9_\-]/g, "_");

const isBuiltinPresetName = (name) => {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return false;
  return builtinPresetGroups.some((group) => group.settings.some((preset) => preset.name === trimmed));
};

const CustomPresets = ({
  settings,
  onLoad,
  onClear,
  isActive,
  activeSource,
  activePresetName,
  isPresetDirty,
  onRevert,
  currentModulationLibrary,
  canCommitModulation,
  onCommitCurrentModulation,
}) => {
  const [presets, setPresets] = useState(loadCustomPresets);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  // Only reveal the full UI once the user actively engages in this session —
  // not just because presets exist in localStorage from a previous session.
  const [expanded, setExpanded] = useState(() => loadCustomPresets().length > 0);
  const fileInputRef = createRef();
  const folderInputRef = createRef();

  // Reset selection only when switching away from a user preset to a built-in
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !isActive) setSelected("");
    if (isActive) setExpanded(true);
    wasActive.current = isActive;
  }, [isActive]);

  // Sync selected with activePresetName when restoring a user preset on reload
  useEffect(() => {
    if (isActive && activePresetName && selected !== activePresetName) {
      setSelected(activePresetName);
    }
  }, [isActive, activePresetName, selected]);

  useEffect(() => {
    if (activeSource) setExpanded(true);
  }, [activeSource]);

  const handleSelect = (e) => {
    const val = e.target.value;
    setSelected(val);
    setExpanded(true);
    if (!val) return;
    const preset = presets.find((p) => p.name === val);
    if (preset) onLoad(preset);
  };

  const tuningName = (settings.name || "").trim();
  const hasNonBuiltinWorkspace =
    Array.isArray(settings.scale) &&
    settings.scale.length > 0 &&
    !!tuningName &&
    !isBuiltinPresetName(tuningName);
  const showWorkspaceActions = !!activeSource || hasNonBuiltinWorkspace;
  const isExisting = presets.some((p) => p.name === tuningName);
  const isLoadedUserPreset =
    isActive && activeSource === "user" && activePresetName && activePresetName === tuningName;

  const saveLabel = isExisting && (!isLoadedUserPreset || isPresetDirty)
    ? "Save current settings and overwrite user preset"
    : "Save current settings";
  const hasUnsavedWorkspace =
    !!tuningName &&
    (
      activeSource !== "user" ||
      isPresetDirty ||
      !activePresetName ||
      activePresetName !== tuningName
    );

  const handleSave = () => {
    if (!tuningName) {
      setError("Please enter a name in the Name and Description section first.");
      return;
    }
    const preset = { name: tuningName };
    for (const key of PRESET_FIELDS) {
      if (key === "key_colors_mode") {
        preset[key] = resolveKeyColorsMode(settings);
      } else if (settings[key] !== undefined) {
        preset[key] = settings[key];
      }
    }
    Object.assign(preset, derivePresetControllerAnchorFields(settings));
    const normalizedLibrary = normalizeModulationHistory(currentModulationLibrary, { zeroCounts: true });
    if (normalizedLibrary.length > 0) preset.modulation_library = normalizedLibrary;
    else delete preset.modulation_library;
    const next = isExisting
      ? presets.map((p) => (p.name === tuningName ? preset : p))
      : [...presets, preset];
    saveCustomPresets(next);
    setPresets(next);
    setSelected(tuningName);
    setExpanded(true);
    setError("");
    onLoad(preset); // marks this as the active source, resetting the built-in menu
  };

  const handleExport = () => {
    if (!tuningName) {
      setError("Please enter a name in the Name and Description section first.");
      return;
    }
    downloadFile(
      settingsToPresetJson(settings, {
        modulation_library: normalizeModulationHistory(currentModulationLibrary, { zeroCounts: true }),
      }),
      `${safeName(tuningName)}.json`,
    );
  };

  const handleCommitModulation = () => {
    if (!tuningName) {
      setError("Please enter a name in the Name and Description section first.");
      return;
    }
    const committedSettings = onCommitCurrentModulation?.();
    if (!committedSettings) {
      setError("No active modulation to commit.");
      return;
    }

    const preset = { name: tuningName };
    for (const key of PRESET_FIELDS) {
      if (key === "key_colors_mode") {
        preset[key] = resolveKeyColorsMode(committedSettings);
      } else if (committedSettings[key] !== undefined) {
        preset[key] = committedSettings[key];
      }
    }
    Object.assign(preset, derivePresetControllerAnchorFields(committedSettings));
    delete preset.modulation_library;

    const next = isExisting
      ? presets.map((p) => (p.name === tuningName ? preset : p))
      : [...presets, preset];
    saveCustomPresets(next);
    setPresets(next);
    setSelected(tuningName);
    setExpanded(true);
    setError("");
    onLoad(preset);
  };

  const handleDelete = () => {
    if (!selected) return;
    const next = presets.filter((p) => p.name !== selected);
    saveCustomPresets(next);
    setPresets(next);
    setSelected("");
    setError("");
    if (onClear) onClear();
  };

  const handleClear = () => setConfirmClear(true);

  const handleClearConfirmed = () => {
    saveCustomPresets([]);
    setPresets([]);
    setSelected("");
    setError("");
    setConfirmClear(false);
    if (onClear) onClear();
  };

  const mergeImportedPresets = (parsed, emptyMessage, inputEl, { activateImported = false } = {}) => {
    if (!parsed.length) {
      setError(emptyMessage);
      if (inputEl) inputEl.value = "";
      return null;
    }

    const seenNames = new Set();
    const uniqueParsed = [];
    for (const p of parsed) {
      if (!seenNames.has(p.name)) {
        seenNames.add(p.name);
        uniqueParsed.push(p);
      }
    }
    if (uniqueParsed.length < parsed.length) {
      // eslint-disable-next-line no-console
      console.log(`Skipped ${parsed.length - uniqueParsed.length} duplicate tuning(s) in import`);
    }

    const existing = loadCustomPresets();
    const clashes = uniqueParsed.filter((p) => existing.some((e) => e.name === p.name));

    if (clashes.length > 0) {
      const names = clashes.map((p) => p.name).join(", ");
      const message =
        clashes.length === 1
          ? `A user tuning with the same name exists:\n\n${names}\n\nOverwrite?`
          : `${clashes.length} user tunings with the same name already exist:\n\n${names}\n\nOverwrite?`;
      const overwrite = window.confirm(
        message,
      );
      if (!overwrite) {
        const newOnly = uniqueParsed.filter((p) => !existing.some((e) => e.name === p.name));
        if (!newOnly.length) {
          setError("No new tunings to import.");
          if (inputEl) inputEl.value = "";
          return null;
        }
        const next = [...existing, ...newOnly];
        saveCustomPresets(next);
        setPresets(next);
        setExpanded(true);
        setError("");
        if (inputEl) inputEl.value = "";
        if (activateImported) {
          const activated = next.find((preset) => preset.name === newOnly[0]?.name) ?? null;
          if (activated) {
            setSelected(activated.name);
            onLoad(activated);
          }
          return activated;
        }
        return null;
      }
    }

    const next = [
      ...existing.map((ex) => {
        const match = uniqueParsed.find((p) => p.name === ex.name);
        return match || ex;
      }),
      ...uniqueParsed.filter((p) => !existing.some((ex) => ex.name === p.name)),
    ];
    saveCustomPresets(next);
    setPresets(next);
    setExpanded(true);
    setError("");
    if (inputEl) inputEl.value = "";
    if (activateImported) {
      const activated = next.find((preset) => preset.name === uniqueParsed[0]?.name) ?? null;
      if (activated) {
        setSelected(activated.name);
        onLoad(activated);
      }
      return activated;
    }
    return null;
  };

  const readPresetFiles = async (files) => {
    const results = await Promise.all(
      files.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve({ name: file.name, text: ev.target.result });
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
          }),
      ),
    );

    return results
      .filter(Boolean)
      .map(({ name, text }) => fileToPreset(name, text))
      .filter(Boolean);
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files).filter((f) => /\.(scl|ascl|json)$/i.test(f.name));
    if (!files.length) {
      setError("No .scl, .ascl or .json files were selected.");
      e.target.value = "";
      return;
    }

    if (
      hasUnsavedWorkspace &&
      typeof window !== "undefined" &&
      !window.confirm("Discard current unsaved tuning?")
    ) {
      e.target.value = "";
      return;
    }

    const parsed = await readPresetFiles(files);
    mergeImportedPresets(parsed, "No valid tunings found in the selected files.", e.target, {
      activateImported: true,
    });
  };

  // Folder import — reads all .scl, .ascl, .json files in the chosen folder
  const handleFolderChange = async (e) => {
    const files = Array.from(e.target.files)
      .filter((f) => /\.(scl|ascl|json)$/i.test(f.name))
      .filter((f) => {
        if (includeSubfolders) return true;
        const rel = f.webkitRelativePath || "";
        if (!rel) return true;
        const parts = rel.split("/").filter(Boolean);
        return parts.length <= 2;
      });

    if (!files.length) {
      setError(
        includeSubfolders
          ? "No .scl, .ascl or .json files found in the chosen folder."
          : "No .scl, .ascl or .json files found in the chosen folder root.",
      );
      e.target.value = "";
      return;
    }

    const parsed = await readPresetFiles(files);
    mergeImportedPresets(parsed, "No valid tunings found in the chosen folder.", e.target);
  };

  return (
    <fieldset>
      <legend>
        <b>User Tunings</b>
      </legend>

      {/* ── Selector row — only shown once there are saved presets ── */}
      {expanded && presets.length > 0 && (
        <label class="preset-selector-row">
          <select value={selected} onChange={handleSelect}>
            <option value="">Choose a user tuning:</option>
            {presets.map((p) => {
              const isDirtyActivePreset = isActive && isPresetDirty && p.name === activePresetName;
              return (
                <option key={p.name} value={p.name}>
                  {isDirtyActivePreset ? `${p.name} *` : p.name}
                </option>
              );
            })}
          </select>
          {isActive && onRevert && (
            <button type="button" class="preset-refresh-btn" onClick={onRevert}>
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
          <button
            type="button"
            class="delete-btn preset-utility-btn preset-actions__clear-trigger"
            disabled={!selected}
            onClick={handleDelete}
          >
            Delete
          </button>
        </label>
      )}

      {/* ── Import actions — always visible ── */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".scl,.ascl,.json"
        class="settings-form__hidden-file-input"
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        multiple
        accept=".scl,.ascl,.json"
        class="settings-form__hidden-file-input"
        onChange={handleFolderChange}
      />
      <div class="preset-actions preset-actions--library">
        <button
          type="button"
          class="preset-action-btn"
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
        >
          Open File(s)…
        </button>
        <button
          type="button"
          class="preset-action-btn"
          onClick={() => folderInputRef.current && folderInputRef.current.click()}
        >
          Import Folder(s)…
        </button>
        {expanded &&
          presets.length > 0 &&
          (
            <span class="preset-actions__clear-slot">
              {confirmClear ? (
                <span class="preset-actions__confirm">
                  <em class="preset-actions__confirm-text">Clear all user tunings?</em>
                  <button type="button" class="delete-btn preset-utility-btn settings-form__inline-button--nowrap" onClick={handleClearConfirmed}>
                    Yes, clear
                  </button>
                  <button type="button" class="preset-utility-btn settings-form__inline-button--nowrap" onClick={() => setConfirmClear(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  class="delete-btn preset-utility-btn preset-actions__clear-trigger"
                  onClick={handleClear}
                >
                  Clear All
                </button>
              )}
            </span>
          )}
      </div>
      <label class="settings-form__checkbox-row settings-form__checkbox-row--sm">
        <input
          type="checkbox"
          checked={includeSubfolders}
          onChange={(e) => setIncludeSubfolders(e.target.checked)}
        />
        <em class="settings-form__helper-text">Include subfolders</em>
      </label>

      {/* ── Save / Export — show when a preset is active ── */}
      {showWorkspaceActions && (
        <div class="settings-form__action-row">
          <span class="settings-form__action-group settings-form__action-group--wrap">
            <button type="button" class="preset-action-btn" onClick={handleSave}>
              {saveLabel}
            </button>
            {canCommitModulation && (
              <button type="button" class="preset-action-btn" onClick={handleCommitModulation}>
                Commit Modulation
              </button>
            )}
          </span>
          <span class="settings-form__action-group">
            <button type="button" class="preset-utility-btn settings-form__utility-btn--export" onClick={handleExport}>
              Export .json
            </button>{" "}
            {/*
            <button type="button" class="preset-utility-btn" onClick={handleExportLtn}>
              Export .ltn
            </button>*/}
          </span>
        </div>
      )}

      {error && <p class="preset-error">{error}</p>}
    </fieldset>
  );
};

CustomPresets.propTypes = {
  settings: PropTypes.object.isRequired,
  onLoad: PropTypes.func.isRequired,
  isActive: PropTypes.bool,
  activeSource: PropTypes.string,
  activePresetName: PropTypes.string,
  isPresetDirty: PropTypes.bool,
  onRevert: PropTypes.func,
  currentModulationLibrary: PropTypes.arrayOf(PropTypes.object),
  canCommitModulation: PropTypes.bool,
  onCommitCurrentModulation: PropTypes.func,
};

export default CustomPresets;
