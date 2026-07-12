import { createRef } from "preact";
import { useMemo, useState } from "preact/hooks";
import PropTypes from "prop-types";
import { settingsToTuningRecord, serializeTuningRecord } from "./tuning-record.js";
import { fileToPreset } from "../settings/scale/parse-scale.js";
import {
  clearUserTunings,
  deleteUserTuning,
  loadUserTunings,
  parseTuningJson,
  uniqueTuningName,
  upsertUserTuning,
} from "./user-tunings.js";

function downloadFile(content, filename, mimeType = "application/json") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(name) {
  return (name || "preset").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

const TuningLibrary = ({
  presetGroups,
  settings,
  currentModulationLibrary,
  activeSource,
  activePresetName,
  isPresetDirty,
  persistOnReload,
  setPersistOnReload,
  showActivateAudioContext,
  activateAudioContext,
  activatePendingPreset,
  onLoadBuiltinTuning,
  onLoadUserTuning,
  onClearWorkspace,
  onRevertBuiltin,
  onRevertUser,
  canCommitModulation,
  onCommitCurrentModulation,
}) => {
  const [userTunings, setUserTunings] = useState(loadUserTunings);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const fileInputRef = createRef();
  const folderInputRef = createRef();

  const tuningName = String(settings?.name ?? "").trim();
  const hasWorkspace = Array.isArray(settings?.scale) && settings.scale.length > 0;
  const activeBuiltInName = activeSource === "builtin" ? activePresetName : "";
  const activeUserName = activeSource === "user" ? activePresetName : "";

  const builtInValue = activeBuiltInName || "";
  const userValue = activeUserName || "";
  const workspaceRecord = useMemo(() => settingsToTuningRecord(settings, {
    modulation_library: currentModulationLibrary,
  }), [currentModulationLibrary, settings]);
  const existingUserTuning = useMemo(
    () => userTunings.find((entry) => entry.name === tuningName) ?? null,
    [tuningName, userTunings],
  );
  const isLoadedExistingUserTuning = !!(
    activeSource === "user" &&
    activePresetName &&
    tuningName &&
    activePresetName === tuningName &&
    existingUserTuning &&
    existingUserTuning.name === activePresetName
  );
  const showWorkspaceActions = !!activeSource || (hasWorkspace && !!tuningName);
  const saveLabel = existingUserTuning && (!isLoadedExistingUserTuning || isPresetDirty)
    ? "Save current settings and overwrite user preset"
    : "Save current settings";
  const hasUnsavedWorkspace = !!workspaceRecord && (
    (!activeSource && !!tuningName) ||
    (activeSource === "builtin" && !!isPresetDirty) ||
    (activeSource === "user" && (
      (activePresetName ? !!isPresetDirty : !!tuningName)
      || activePresetName !== tuningName
    ))
  );

  const handleBuiltInSelect = (e) => {
    const nextName = e.currentTarget.value;
    if (!nextName) return;
    const target = presetGroups
      .flatMap((group) => group.settings)
      .find((entry) => entry.name === nextName) ?? null;
    if (!target) return;
    if (
      hasUnsavedWorkspace &&
      !(activeSource === "builtin" && activePresetName === nextName) &&
      typeof window !== "undefined" &&
      !window.confirm("Discard current unsaved tuning?")
    ) {
      return;
    }
    setError("");
    onLoadBuiltinTuning?.(target);
  };

  const handleUserSelect = (e) => {
    const nextName = e.currentTarget.value;
    if (!nextName) return;
    const target = userTunings.find((entry) => entry.name === nextName) ?? null;
    if (!target) return;
    if (
      hasUnsavedWorkspace &&
      !(activeSource === "user" && activePresetName === nextName) &&
      typeof window !== "undefined" &&
      !window.confirm("Discard current unsaved tuning?")
    ) {
      return;
    }
    setError("");
    onLoadUserTuning?.(target);
  };

  const handleSave = () => {
    if (!tuningName) {
      setError("Please enter a name in the Name and Description section first.");
      return;
    }
    const record = settingsToTuningRecord(settings, {
      modulation_library: currentModulationLibrary,
    });
    if (!record) {
      setError("There is no valid tuning to save.");
      return;
    }
    const nextLibrary = upsertUserTuning(record, userTunings);
    setUserTunings(nextLibrary);
    setError("");
    onLoadUserTuning?.(record);
  };

  const handleSaveCopy = () => {
    const record = settingsToTuningRecord(settings, {
      modulation_library: currentModulationLibrary,
    });
    if (!record) {
      setError("There is no valid tuning to save.");
      return;
    }
    const uniqueName = uniqueTuningName(record.name, userTunings);
    const copy = { ...record, name: uniqueName };
    const nextLibrary = upsertUserTuning(copy, userTunings);
    setUserTunings(nextLibrary);
    setError("");
    onLoadUserTuning?.(copy);
  };

  const handleDelete = () => {
    if (!activeUserName) return;
    const nextLibrary = deleteUserTuning(activeUserName, userTunings);
    setUserTunings(nextLibrary);
    setError("");
    onClearWorkspace?.();
  };

  const handleExport = () => {
    const json = serializeTuningRecord(settingsToTuningRecord(settings, {
      modulation_library: currentModulationLibrary,
    }));
    if (!json) {
      setError("There is no valid tuning to export.");
      return;
    }
    setError("");
    downloadFile(json, `${safeName(tuningName || "preset")}.json`);
  };

  const handleClearConfirmed = () => {
    setUserTunings(clearUserTunings());
    setConfirmClear(false);
    setError("");
    if (activeSource === "user") onClearWorkspace?.();
  };

  const handleOpenFiles = () => {
    fileInputRef.current?.click();
  };

  const handleOpenFolders = () => {
    folderInputRef.current?.click();
  };

  const parseImportedFile = async (file) => {
    const text = await file.text();
    if (/\.json$/i.test(file.name)) return parseTuningJson(text);
    const parsed = fileToPreset(file.name, text);
    return parsed ? [parsed] : [];
  };

  const handleImportFiles = async (e) => {
    const files = Array.from(e.currentTarget?.files ?? e.target?.files ?? [])
      .filter((file) => /\.(scl|ascl|json)$/i.test(file.name));
    if (!files.length) return;

    if (
      hasUnsavedWorkspace &&
      typeof window !== "undefined" &&
      !window.confirm("Discard current unsaved tuning?")
    ) {
      if (e.currentTarget) e.currentTarget.value = "";
      return;
    }

    const imported = [];
    for (const file of files) {
      const parsed = await parseImportedFile(file);
      for (const record of parsed) {
        const baseName = String(record?.name ?? "").trim() || file.name.replace(/\.json$/i, "");
        const taken = [...userTunings, ...imported];
        const needsRename = taken.some((entry) => entry.name === baseName);
        const name = needsRename ? uniqueTuningName(baseName, taken) : baseName;
        imported.push({ ...record, name });
      }
    }

    if (e.currentTarget) e.currentTarget.value = "";
    if (!imported.length) {
      setError("No valid tunings found in the selected files.");
      return;
    }

    let nextLibrary = userTunings;
    for (const record of imported) nextLibrary = upsertUserTuning(record, nextLibrary);
    setUserTunings(nextLibrary);
    setError("");
    onLoadUserTuning?.(imported[imported.length - 1]);
  };

  const handleImportFolders = async (e) => {
    const files = Array.from(e.currentTarget?.files ?? e.target?.files ?? [])
      .filter((file) => /\.(scl|ascl|json)$/i.test(file.name))
      .filter((file) => {
        if (includeSubfolders) return true;
        const rel = file.webkitRelativePath || "";
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
      if (e.currentTarget) e.currentTarget.value = "";
      return;
    }

    const imported = [];
    for (const file of files) {
      const parsed = await parseImportedFile(file);
      for (const record of parsed) {
        const baseName = String(record?.name ?? "").trim() || file.name.replace(/\.(json|scl|ascl)$/i, "");
        const taken = [...userTunings, ...imported];
        const needsRename = taken.some((entry) => entry.name === baseName);
        const name = needsRename ? uniqueTuningName(baseName, taken) : baseName;
        imported.push({ ...record, name });
      }
    }

    if (e.currentTarget) e.currentTarget.value = "";
    if (!imported.length) {
      setError("No valid tunings found in the selected folder.");
      return;
    }

    let nextLibrary = userTunings;
    for (const record of imported) nextLibrary = upsertUserTuning(record, nextLibrary);
    setUserTunings(nextLibrary);
    setError("");
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
    const record = settingsToTuningRecord(committedSettings);
    if (!record) {
      setError("There is no valid tuning to save.");
      return;
    }
    const nextLibrary = upsertUserTuning(record, userTunings);
    setUserTunings(nextLibrary);
    setError("");
    onLoadUserTuning?.(record);
  };

  return (
    <>
      <fieldset>
        <legend>
          <b>Built-in Tunings</b>
        </legend>
        <label class="preset-selector-row">
          <select
            aria-label="Built-in tunings"
            value={builtInValue}
            onChange={handleBuiltInSelect}
          >
            <option value="">Choose a built-in tuning:</option>
            {presetGroups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.settings.map((setting) => (
                  <option key={setting.name} value={setting.name}>
                    {setting.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {activeSource === "builtin" && onRevertBuiltin && (
            <button type="button" class="preset-refresh-btn" onClick={onRevertBuiltin}>
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
        </label>
        <div class="settings-form__reload-row settings-form__checkbox-row--sm">
          {showActivateAudioContext && (activateAudioContext || activatePendingPreset) ? (
            <button
              type="button"
              class="preset-action-btn settings-form__activate-audio-btn"
              onClick={() => void (activateAudioContext || activatePendingPreset)()}
            >
              Activate Audio Context
            </button>
          ) : (
            <label class="settings-form__checkbox-row settings-form__reload-checkbox">
              <input
                type="checkbox"
                checked={persistOnReload}
                onChange={(e) => setPersistOnReload(e.target.checked)}
              />
              <em class="settings-form__helper-text">Restore preset on reload</em>
            </label>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>
          <b>User Tunings</b>
        </legend>

        <input
          ref={fileInputRef}
          type="file"
          accept=".scl,.ascl,.json"
          multiple
          class="settings-form__hidden-file-input"
          onChange={(e) => void handleImportFiles(e)}
        />
        <input
          ref={folderInputRef}
          type="file"
          webkitdirectory="true"
          multiple
          accept=".scl,.ascl,.json"
          class="settings-form__hidden-file-input"
          onChange={(e) => void handleImportFolders(e)}
        />

        <div class="preset-actions preset-actions--library">
          <span class="settings-form__action-group settings-form__action-group--wrap">
            <button type="button" class="preset-action-btn" onClick={handleOpenFiles}>
              Open File(s)...
            </button>
            <button type="button" class="preset-action-btn" onClick={handleOpenFolders}>
              Import Folder(s)...
            </button>
          </span>
        </div>
        <label class="settings-form__checkbox-row settings-form__checkbox-row--sm">
          <input
            type="checkbox"
            checked={includeSubfolders}
            onChange={(e) => setIncludeSubfolders(e.target.checked)}
          />
          <em class="settings-form__helper-text">Include subfolders</em>
        </label>

        {userTunings.length > 0 && (
          <label class="preset-selector-row">
            <select aria-label="User tunings" value={userValue} onChange={handleUserSelect}>
              <option value="">Choose a user tuning:</option>
              {userTunings.map((entry) => {
                const isDirtyActivePreset = activeSource === "user" && isPresetDirty && entry.name === activePresetName;
                return (
                  <option key={entry.name} value={entry.name}>
                    {isDirtyActivePreset ? `${entry.name} *` : entry.name}
                  </option>
                );
              })}
            </select>
            {activeSource === "user" && onRevertUser && (
              <button type="button" class="preset-refresh-btn" onClick={onRevertUser}>
                <span class="preset-refresh-glyph">⟳</span>
              </button>
            )}
            <button
              type="button"
              class="delete-btn preset-utility-btn preset-actions__clear-trigger"
              disabled={!activeUserName}
              onClick={handleDelete}
            >
              Delete
            </button>
          </label>
        )}
        <div class="preset-actions preset-actions--library">
          {userTunings.length > 0 && (
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
                  onClick={() => setConfirmClear(true)}
                >
                  Clear All
                </button>
              )}
            </span>
          )}
        </div>

        {showWorkspaceActions && (
          <div class="settings-form__action-row">
            <span class="settings-form__action-group settings-form__action-group--wrap">
              <button type="button" class="preset-action-btn" onClick={handleSave}>
                {saveLabel}
              </button>
              <button type="button" class="preset-action-btn" onClick={handleSaveCopy}>
                Save as copy
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
              </button>
            </span>
          </div>
        )}

        {error && <p class="preset-error">{error}</p>}
      </fieldset>
    </>
  );
};

TuningLibrary.propTypes = {
  presetGroups: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      settings: PropTypes.arrayOf(
        PropTypes.shape({
          name: PropTypes.string.isRequired,
        }),
      ).isRequired,
    }),
  ).isRequired,
  settings: PropTypes.object.isRequired,
  currentModulationLibrary: PropTypes.arrayOf(PropTypes.object),
  activeSource: PropTypes.string,
  activePresetName: PropTypes.string,
  isPresetDirty: PropTypes.bool,
  persistOnReload: PropTypes.bool,
  setPersistOnReload: PropTypes.func.isRequired,
  showActivateAudioContext: PropTypes.bool,
  activateAudioContext: PropTypes.func,
  activatePendingPreset: PropTypes.func,
  onLoadBuiltinTuning: PropTypes.func.isRequired,
  onLoadUserTuning: PropTypes.func.isRequired,
  onClearWorkspace: PropTypes.func,
  onRevertBuiltin: PropTypes.func,
  onRevertUser: PropTypes.func,
  canCommitModulation: PropTypes.bool,
  onCommitCurrentModulation: PropTypes.func,
};

export default TuningLibrary;
