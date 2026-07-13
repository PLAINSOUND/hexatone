import { createRef } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import PropTypes from "prop-types";
import {
  normalizeBarMarkers,
  normalizeRepeatMarkers,
  normalizeSequenceTransport,
  normalizeTempoMarkers,
} from "./transport.js";
import { findPresetSequenceByName, presetSequenceGroups } from "./preset-sequences/index.js";

const STORAGE_KEY = "hexatone_user_sequences";

function cloneSnapshots(snapshots) {
  return JSON.parse(JSON.stringify(Array.isArray(snapshots) ? snapshots : []));
}

function cloneBars(bars) {
  return JSON.parse(JSON.stringify(Array.isArray(bars) ? bars : []));
}

export function normalizeSequenceRecord(record) {
  if (!record || typeof record !== "object") return null;
  const name = String(record.name ?? "").trim();
  if (!name) return null;
  const snapshots = cloneSnapshots(record.snapshots);
  const rawBars = Array.isArray(record.bars) && record.bars.length > 0
    ? record.bars
    : record.meters;
  const bars = normalizeBarMarkers(cloneBars(rawBars), { includeDefault: false });
  const repeats = normalizeRepeatMarkers(record.repeats);
  if (!Array.isArray(snapshots)) return null;
  return {
    type: "hexatone-sequence",
    version: 3,
    name,
    description: String(record.description ?? ""),
    snapshotLabelMode: String(record.snapshotLabelMode ?? "proportion"),
    autoCreateBars: record.autoCreateBars !== false,
    transport: normalizeSequenceTransport(record.transport),
    tempi: normalizeTempoMarkers(record.tempi, { includeDefault: false }),
    snapshots,
    bars,
    repeats,
  };
}

export function loadUserSequences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeSequenceRecord).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveUserSequences(sequences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sequences));
}

function parseSequenceJson(name, text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeSequenceRecord).filter(Boolean);
    }
    const normalized = normalizeSequenceRecord({
      name: parsed?.name ?? name.replace(/\.json$/i, ""),
      description: parsed?.description ?? "",
      snapshotLabelMode: parsed?.snapshotLabelMode,
      autoCreateBars: parsed?.autoCreateBars,
      transport: parsed?.transport,
      tempi: parsed?.tempi,
      snapshots: parsed?.snapshots,
      bars: parsed?.bars,
      repeats: parsed?.repeats,
      meters: parsed?.meters,
    });
    return normalized ? [normalized] : [];
  } catch {
    return [];
  }
}

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
  return (name || "sequence").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function uniqueSequenceName(baseName, takenNames) {
  const base = String(baseName ?? "").trim() || "User Sequence";
  if (!takenNames.has(base)) return base;
  let suffix = 2;
  while (takenNames.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function sequenceRecordKey(record) {
  return JSON.stringify(record ?? null);
}

function sequenceRecordContentKey(record) {
  if (!record || typeof record !== "object") return JSON.stringify(null);
  const { name: _name, ...content } = record;
  return JSON.stringify(content);
}

const DRAFT_SEQUENCE_VALUE = "__draft__";

const SequenceLibrary = ({
  snapshots,
  bars,
  repeats,
  tempi,
  snapshotLabelMode,
  autoCreateBars,
  activeSequenceSource,
  activeSequenceBuiltInName,
  activeSequenceName,
  activeSequenceSavedName,
  activeSequenceDescription,
  onLoadSequence,
  onClearSequence,
  onSequenceSaved,
  onSaveActionStateChange,
}) => {
  const [savedSequences, setSavedSequences] = useState(loadUserSequences);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInputRef = createRef();

  const sequenceName = String(activeSequenceName ?? "").trim();
  const activeSource = String(activeSequenceSource ?? "").trim();
  const activeBuiltInName = String(activeSequenceBuiltInName ?? "").trim();
  const savedSequenceName = String(activeSequenceSavedName ?? "").trim();
  const snapshotsPresent = (snapshots?.length ?? 0) > 0;
  const workspaceRecord = useMemo(
    () => normalizeSequenceRecord({
      name: sequenceName || "User Sequence",
      description: activeSequenceDescription,
      snapshotLabelMode,
      autoCreateBars,
      tempi,
      snapshots,
      bars,
      repeats,
    }),
    [activeSequenceDescription, autoCreateBars, bars, repeats, sequenceName, snapshotLabelMode, snapshots, tempi],
  );
  const workspaceHasContent = useMemo(() => {
    return snapshotsPresent;
  }, [snapshotsPresent]);
  const activeSavedSequence = useMemo(
    () => savedSequences.find((sequence) => sequence.name === savedSequenceName) ?? null,
    [savedSequences, savedSequenceName],
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!workspaceRecord || !workspaceHasContent) return false;
    if (!activeSavedSequence) return true;
    return sequenceRecordKey({ ...workspaceRecord, name: activeSavedSequence.name })
      !== sequenceRecordKey(activeSavedSequence);
  }, [activeSavedSequence, workspaceHasContent, workspaceRecord]);
  const nameCollision = useMemo(
    () => (
      activeSource !== "builtin" &&
      !!sequenceName &&
      savedSequences.some((sequence) => sequence.name === sequenceName) &&
      sequenceName !== savedSequenceName
    ),
    [activeSource, savedSequences, savedSequenceName, sequenceName],
  );
  const workspaceStatus = !workspaceHasContent
    ? "empty"
    : !activeSavedSequence
      ? "draft"
      : hasUnsavedChanges
        ? "saved-dirty"
        : "saved-clean";
  const showDraftOption = activeSource !== "builtin" && workspaceStatus === "draft";
  const menuValue = activeSource === "builtin"
    ? ""
    : activeSavedSequence
    ? savedSequenceName
    : workspaceHasContent
      ? DRAFT_SEQUENCE_VALUE
      : "";
  const builtInMenuValue = activeSource === "builtin" ? activeBuiltInName : "";
  const saveLabel = (activeSavedSequence && hasUnsavedChanges) || nameCollision
    ? "Save current sequence and overwrite"
    : "Save current sequence";

  const commitSequences = useCallback((next) => {
    saveUserSequences(next);
    setSavedSequences(next);
  }, []);

  const buildWorkspaceRecord = useCallback((name) => normalizeSequenceRecord({
    name,
    description: activeSequenceDescription,
    snapshotLabelMode,
    autoCreateBars,
    tempi,
    snapshots,
    bars,
    repeats,
  }), [
    activeSequenceDescription,
    autoCreateBars,
    bars,
    repeats,
    snapshotLabelMode,
    snapshots,
    tempi,
  ]);

  const loadSequenceByName = (name) => {
    if (!name) return;
    const sequence = savedSequences.find((entry) => entry.name === name);
    if (!sequence) return;
    setError("");
    onLoadSequence(sequence, { source: "user" });
  };

  const beginLoadSequence = (name) => {
    if (!name || name === DRAFT_SEQUENCE_VALUE) return;
    const targetSequence = savedSequences.find((entry) => entry.name === name) ?? null;
    if (!targetSequence) return;
    if (
      workspaceStatus !== "empty" &&
      (workspaceStatus === "draft" || hasUnsavedChanges) &&
      name !== savedSequenceName &&
      typeof window !== "undefined" &&
      !window.confirm("Discard current unsaved sequence?")
    ) {
      return;
    }
    if (workspaceRecord && sequenceRecordContentKey(workspaceRecord) === sequenceRecordContentKey(targetSequence)) {
      setError("");
      onLoadSequence(targetSequence, { source: "user" });
      return;
    }
    if (name === savedSequenceName || workspaceStatus === "empty") {
      loadSequenceByName(name);
      return;
    }
    loadSequenceByName(name);
  };

  const handleSelect = (e) => {
    beginLoadSequence(e.currentTarget.value);
  };

  const handleSave = useCallback(() => {
    if (!sequenceName) {
      setError("Please enter a Sequence Name first.");
      return;
    }
    const record = buildWorkspaceRecord(sequenceName);
    if (!record) {
      setError("There is no valid sequence to save.");
      return;
    }
    const next = savedSequences.some((entry) => entry.name === sequenceName)
      ? savedSequences.map((entry) => (entry.name === sequenceName ? record : entry))
      : [...savedSequences, record];
    commitSequences(next);
    setError("");
    onSequenceSaved?.(sequenceName);
  }, [
    buildWorkspaceRecord,
    commitSequences,
    onSequenceSaved,
    savedSequences,
    sequenceName,
  ]);

  const handleExport = () => {
    if (!sequenceName) {
      setError("Please enter a Sequence Name first.");
      return;
    }
    const record = buildWorkspaceRecord(sequenceName);
    if (!record) {
      setError("There is no valid sequence to export.");
      return;
    }
    downloadFile(JSON.stringify(record, null, 2), `${safeName(sequenceName)}.json`);
  };

  useEffect(() => {
    onSaveActionStateChange?.(
      workspaceHasContent
        ? {
          visible: true,
          label: saveLabel,
          action: handleSave,
        }
        : {
          visible: false,
          label: "",
          action: null,
        },
    );
  }, [handleSave, onSaveActionStateChange, saveLabel, workspaceHasContent]);

  useEffect(() => () => {
    onSaveActionStateChange?.({
      visible: false,
      label: "",
      action: null,
    });
  }, [onSaveActionStateChange]);

  const handleDelete = () => {
    if (!savedSequenceName) return;
    const next = savedSequences.filter((entry) => entry.name !== savedSequenceName);
    commitSequences(next);
    setError("");
    onClearSequence?.();
  };

  const handleClearConfirmed = () => {
    commitSequences([]);
    setError("");
    setConfirmClear(false);
  };

  const handleOpenFiles = async (e) => {
    const input = e.currentTarget;
    const files = Array.from(input?.files ?? []).filter((file) => /\.json$/i.test(file.name));
    if (!files.length) {
      setError("No .json sequence files were selected.");
      if (input) input.value = "";
      return;
    }

    const parsedLists = await Promise.all(
      files.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(parseSequenceJson(file.name, ev.target?.result ?? ""));
            reader.onerror = () => resolve([]);
            reader.readAsText(file);
          }),
      ),
    );

    const imported = parsedLists.flat();
    if (!imported.length) {
      setError("No valid sequences found in the selected files.");
      if (input) input.value = "";
      return;
    }

    let next = [...savedSequences];
    const takenNames = new Set(next.map((entry) => entry.name));
    const importedWithUniqueNames = imported.map((sequence) => {
      const uniqueName = uniqueSequenceName(sequence.name, takenNames);
      takenNames.add(uniqueName);
      return { ...sequence, name: uniqueName };
    });

    for (const sequence of importedWithUniqueNames) {
      next.push(sequence);
    }
    commitSequences(next);
    setError("");
    const firstImported = importedWithUniqueNames[0] ?? null;
    if (firstImported) {
      onLoadSequence(firstImported, { source: "user" });
    }
    if (input) input.value = "";
  };

  const handleBuiltInSelect = (e) => {
    const nextName = e.currentTarget.value;
    if (!nextName) return;
    const targetSequence = findPresetSequenceByName(nextName);
    if (!targetSequence) return;
    const switchingBetweenSameNamedSavedSources =
      activeSource === "user" &&
      !!savedSequenceName &&
      !!sequenceName &&
      savedSequenceName === sequenceName &&
      nextName === savedSequenceName;
    if (
      workspaceStatus !== "empty" &&
      (workspaceStatus === "draft" || hasUnsavedChanges) &&
      !switchingBetweenSameNamedSavedSources &&
      !(activeSource === "builtin" && nextName === activeBuiltInName) &&
      typeof window !== "undefined" &&
      !window.confirm("Discard current unsaved sequence?")
    ) {
      return;
    }
    setError("");
    onLoadSequence(targetSequence, { source: "builtin" });
  };

  const handleReloadBuiltIn = () => {
    if (!activeBuiltInName) return;
    const targetSequence = findPresetSequenceByName(activeBuiltInName);
    if (!targetSequence) return;
    setError("");
    onLoadSequence(targetSequence, { source: "builtin" });
  };

  return (
    <>
      <fieldset>
        <legend>
          <b>Built-in Sequences</b>
        </legend>
        <label class="preset-selector-row">
          <select aria-label="Built-in sequences" value={builtInMenuValue} onChange={handleBuiltInSelect}>
            <option value="">Choose a built-in sequence:</option>
            {presetSequenceGroups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.sequences.map((sequence) => (
                  <option key={sequence.name} value={sequence.name}>
                    {sequence.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {activeSource === "builtin" && activeBuiltInName && (
            <button
              type="button"
              class="preset-refresh-btn"
              onClick={handleReloadBuiltIn}
            >
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
        </label>
      </fieldset>

      <fieldset>
        <legend>
          <b>User Sequences</b>
        </legend>

        {(savedSequences.length > 0 || showDraftOption) && (
        <label class="preset-selector-row">
          <select aria-label="User sequences" value={menuValue} onChange={handleSelect}>
            <option value="">Choose a user sequence:</option>
            {showDraftOption && (
              <option value={DRAFT_SEQUENCE_VALUE}>Unsaved sequence</option>
            )}
            {savedSequences.map((sequence) => (
              <option key={sequence.name} value={sequence.name}>
                {sequence.name === savedSequenceName && hasUnsavedChanges ? `${sequence.name}*` : sequence.name}
              </option>
            ))}
          </select>
          {savedSequenceName && (
            <button
              type="button"
              class="preset-refresh-btn"
              onClick={() => {
                beginLoadSequence(savedSequenceName);
              }}
            >
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
          <button
            type="button"
            class="delete-btn preset-utility-btn preset-actions__clear-trigger"
            disabled={!savedSequenceName}
            onClick={handleDelete}
          >
            Delete
          </button>
        </label>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".json"
          class="settings-form__hidden-file-input"
          onChange={handleOpenFiles}
        />

        <div class="preset-actions preset-actions--library">
          <button
            type="button"
            class="preset-action-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Open File(s)…
          </button>
          {savedSequences.length > 0 &&
            (
              <span class="preset-actions__clear-slot">
                {confirmClear ? (
                  <span class="preset-actions__confirm">
                    <em class="preset-actions__confirm-text">Clear all user sequences?</em>
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

        {workspaceHasContent && (
          <div class="settings-form__action-row">
            <span class="settings-form__action-group settings-form__action-group--wrap">
              <button type="button" class="preset-action-btn" onClick={handleSave}>
                {saveLabel}
              </button>
            </span>
            <span class="settings-form__action-group">
              <button
                type="button"
                class="preset-utility-btn settings-form__utility-btn--export"
                onClick={handleExport}
              >
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

SequenceLibrary.propTypes = {
  snapshots: PropTypes.arrayOf(PropTypes.object).isRequired,
  bars: PropTypes.arrayOf(PropTypes.object),
  repeats: PropTypes.arrayOf(PropTypes.object),
  tempi: PropTypes.arrayOf(PropTypes.object),
  snapshotLabelMode: PropTypes.string.isRequired,
  autoCreateBars: PropTypes.bool.isRequired,
  activeSequenceSource: PropTypes.string,
  activeSequenceBuiltInName: PropTypes.string,
  activeSequenceName: PropTypes.string.isRequired,
  activeSequenceSavedName: PropTypes.string.isRequired,
  activeSequenceDescription: PropTypes.string.isRequired,
  onLoadSequence: PropTypes.func.isRequired,
  onClearSequence: PropTypes.func,
  onSequenceSaved: PropTypes.func,
  onSaveActionStateChange: PropTypes.func,
};

export default SequenceLibrary;
