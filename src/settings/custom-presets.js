import { createRef } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import PropTypes from "prop-types";
import { fileToPreset, settingsToPresetJson } from "./scale/parse-scale";

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
  "spectrum_colors",
  "fundamental_color",
  "fundamental",
  "reference_degree",
  "center_degree",
  "rSteps",
  "drSteps",
  "hexSize",
  "rotation",
  "midiin_central_degree",
  "mpe_mode",
  "mpe_pitchbend_range",
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

const CustomPresets = ({
  settings,
  onLoad,
  onClear,
  isActive,
  activeSource,
  activePresetName,
  onRevert,
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
    if (isActive && activePresetName && !selected) {
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
  const isExisting = presets.some((p) => p.name === tuningName);

  const saveLabel = isExisting
    ? "Save current settings and overwrite user preset"
    : "Save current settings";

  const handleSave = () => {
    if (!tuningName) {
      setError("Please enter a name in the Name and Description section first.");
      return;
    }
    const preset = { name: tuningName };
    for (const key of PRESET_FIELDS) {
      if (settings[key] !== undefined) preset[key] = settings[key];
    }
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
    downloadFile(settingsToPresetJson(settings), `${safeName(tuningName)}.json`);
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

  const mergeImportedPresets = (parsed, emptyMessage, inputEl) => {
    if (!parsed.length) {
      setError(emptyMessage);
      if (inputEl) inputEl.value = "";
      return;
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
      const overwrite = window.confirm(
        `${clashes.length} tuning${clashes.length > 1 ? "s" : ""} already exist with the same name:\n\n${names}\n\nOverwrite?`,
      );
      if (!overwrite) {
        const newOnly = uniqueParsed.filter((p) => !existing.some((e) => e.name === p.name));
        if (!newOnly.length) {
          setError("No new tunings to import.");
          if (inputEl) inputEl.value = "";
          return;
        }
        const next = [...existing, ...newOnly];
        saveCustomPresets(next);
        setPresets(next);
        setExpanded(true);
        setError("");
        if (inputEl) inputEl.value = "";
        return;
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

    const parsed = await readPresetFiles(files);
    mergeImportedPresets(parsed, "No valid tunings found in the selected files.", e.target);
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
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          {isActive && onRevert && (
            <button type="button" class="preset-refresh-btn" onClick={onRevert}>
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
          <button
            type="button"
            class="delete-btn preset-utility-btn"
            style={{ marginLeft: "auto" }}
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
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        multiple
        accept=".scl,.ascl,.json"
        style={{ display: "none" }}
        onChange={handleFolderChange}
      />
      <div class="preset-actions" style={{ marginTop: 4 }}>
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
          (confirmClear ? (
            <span>
              <em>Clear all user tunings?&nbsp;</em>
              <button type="button" class="delete-btn" onClick={handleClearConfirmed}>
                Yes, clear
              </button>
              &nbsp;
              <button type="button" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              class="delete-btn preset-utility-btn"
              style={{ marginLeft: "auto" }}
              onClick={handleClear}
            >
              Clear all
            </button>
          ))}
      </div>
      <label style={{ justifyContent: "flex-start", gap: "0.5em", marginTop: "0.35em" }}>
        <input
          type="checkbox"
          checked={includeSubfolders}
          onChange={(e) => setIncludeSubfolders(e.target.checked)}
        />
        <em style={{ color: "#996666" }}>Include subfolders</em>
      </label>

      {/* ── Save / Export — show when a preset is active ── */}
      {activeSource && (
        <label
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 4,
            rowGap: "0.25em",
          }}
        >
          <button type="button" class="preset-action-btn" onClick={handleSave}>
            {saveLabel}
          </button>
          <span style={{ display: "flex", gap: "6px" }}>
            <button type="button" class="preset-utility-btn" onClick={handleExport}>
              Export .json
            </button>{" "}
            {/*
            <button type="button" class="preset-utility-btn" onClick={handleExportLtn}>
              Export .ltn
            </button>*/}
          </span>
        </label>
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
};

export default CustomPresets;
