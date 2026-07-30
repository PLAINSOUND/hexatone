// SequenceLibrary owns the built-in and user sequence pickers.
// It mirrors the Hexatone tuning-library workflow inside the Sequencer tab:
// recall, save, save-as-copy, import, delete, and dirty-state confirmation for
// the current sequence workspace.

import { createRef } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import PropTypes from "prop-types";
import { cloneJsonValue } from "../persistence/clone-json-value.js";
import { orderPresetsByName } from "../persistence/preset-name-order.js";
import {
  normalizeBarMarkers,
  normalizeRepeatMarkers,
  normalizeSequenceTransport,
  normalizeTempoMarkers,
} from "./transport.js";
import {
  findPresetSequenceByName,
  loadPresetSequenceByName,
  presetSequenceGroups,
} from "./preset-sequences/index.js";
import {
  normalizeManualArpeggiation,
  normalizeSnapshotManualTrigger,
} from "./manual-snapshot-arpeggiation.js";

const STORAGE_KEY = "hexatone_user_sequences";

function cloneSnapshots(snapshots) {
  return cloneJsonValue(Array.isArray(snapshots) ? snapshots : []);
}

function cloneBars(bars) {
  return cloneJsonValue(Array.isArray(bars) ? bars : []);
}

export function normalizeSequenceRecord(record) {
  if (!record || typeof record !== "object") return null;
  const name = String(record.name ?? "").trim();
  if (!name) return null;
  const snapshots = cloneSnapshots(record.snapshots).map(normalizeSnapshotManualTrigger);
  const rawBars =
    Array.isArray(record.bars) && record.bars.length > 0 ? record.bars : record.meters;
  const bars = normalizeBarMarkers(cloneBars(rawBars), { includeDefault: false });
  const repeats = normalizeRepeatMarkers(record.repeats);
  if (!Array.isArray(snapshots)) return null;
  return {
    type: "hexatone-sequence",
    version: 4,
    name,
    description: String(record.description ?? ""),
    snapshotLabelMode: String(record.snapshotLabelMode ?? "proportion"),
    autoCreateBars: record.autoCreateBars !== false,
    manualArpeggiation: normalizeManualArpeggiation(record.manualArpeggiation),
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
      manualArpeggiation: parsed?.manualArpeggiation,
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
  const rawBase = String(baseName ?? "").trim() || "User Sequence";
  const match = rawBase.match(/^(.*?)(?:\s+(\d+))?$/);
  const stem = String(match?.[1] ?? rawBase).trim() || "User Sequence";
  const startingSuffix = Number.parseInt(match?.[2] ?? "", 10);
  if (!takenNames.has(rawBase)) return rawBase;
  let suffix = Number.isFinite(startingSuffix) ? startingSuffix + 1 : 2;
  while (takenNames.has(`${stem} ${suffix}`)) suffix += 1;
  return `${stem} ${suffix}`;
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
  manualArpeggiation,
  activeSequenceSource,
  activeSequenceBuiltInName,
  activeSequenceName,
  activeSequenceSavedName,
  activeSequenceDescription,
  onLoadSequence,
  onClearSequence,
  onSequenceSaved,
  onSaveActionStateChange,
  onPrimarySaveVisibilityChange,
}) => {
  const [savedSequences, setSavedSequences] = useState(loadUserSequences);
  const orderedSavedSequences = useMemo(() => orderPresetsByName(savedSequences), [savedSequences]);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadedBuiltInSequence, setLoadedBuiltInSequence] = useState(null);
  const [loadingBuiltInName, setLoadingBuiltInName] = useState("");
  const fileInputRef = createRef();
  const primarySaveRowRef = useRef(null);

  const sequenceName = String(activeSequenceName ?? "").trim();
  const activeSource = String(activeSequenceSource ?? "").trim();
  const activeBuiltInName = String(activeSequenceBuiltInName ?? "").trim();
  const savedSequenceName = String(activeSequenceSavedName ?? "").trim();
  const snapshotsPresent = (snapshots?.length ?? 0) > 0;
  const metadataPresent =
    sequenceName.length > 0 || String(activeSequenceDescription ?? "").trim().length > 0;
  const workspaceRecord = useMemo(
    () =>
      normalizeSequenceRecord({
        name: sequenceName || "User Sequence",
        description: activeSequenceDescription,
        snapshotLabelMode,
        autoCreateBars,
        manualArpeggiation,
        tempi,
        snapshots,
        bars,
        repeats,
      }),
    [
      activeSequenceDescription,
      autoCreateBars,
      bars,
      manualArpeggiation,
      repeats,
      sequenceName,
      snapshotLabelMode,
      snapshots,
      tempi,
    ],
  );
  const workspaceHasContent = useMemo(() => {
    return snapshotsPresent || metadataPresent;
  }, [metadataPresent, snapshotsPresent]);
  const activeSavedSequence = useMemo(
    () => savedSequences.find((sequence) => sequence.name === savedSequenceName) ?? null,
    [savedSequences, savedSequenceName],
  );
  const activeBuiltInSequence = useMemo(
    () =>
      activeSource === "builtin" && activeBuiltInName
        ? loadedBuiltInSequence?.name === activeBuiltInName
          ? loadedBuiltInSequence
          : findPresetSequenceByName(activeBuiltInName)
        : null,
    [activeBuiltInName, activeSource, loadedBuiltInSequence],
  );

  useEffect(() => {
    if (activeSource !== "builtin" || !activeBuiltInName || activeBuiltInSequence) return undefined;
    let cancelled = false;
    loadPresetSequenceByName(activeBuiltInName).then((sequence) => {
      if (!cancelled && sequence) setLoadedBuiltInSequence(sequence);
    });
    return () => {
      cancelled = true;
    };
  }, [activeBuiltInName, activeBuiltInSequence, activeSource]);
  const hasUnsavedChanges = useMemo(() => {
    if (!workspaceRecord || !workspaceHasContent) return false;
    if (activeSource === "builtin") {
      return activeBuiltInSequence
        ? sequenceRecordContentKey(workspaceRecord) !==
            sequenceRecordContentKey(normalizeSequenceRecord(activeBuiltInSequence))
        : false;
    }
    if (!activeSavedSequence) return true;
    return (
      sequenceRecordKey({ ...workspaceRecord, name: activeSavedSequence.name }) !==
      sequenceRecordKey(activeSavedSequence)
    );
  }, [
    activeBuiltInSequence,
    activeSavedSequence,
    activeSource,
    workspaceHasContent,
    workspaceRecord,
  ]);
  const nameCollision = useMemo(
    () =>
      !!sequenceName &&
      savedSequences.some((sequence) => sequence.name === sequenceName) &&
      sequenceName !== savedSequenceName,
    [savedSequences, savedSequenceName, sequenceName],
  );
  const workspaceStatus = !workspaceHasContent
    ? "empty"
    : activeSource === "builtin" && activeBuiltInSequence && !hasUnsavedChanges
      ? "builtin-clean"
      : !activeSavedSequence
        ? "draft"
        : hasUnsavedChanges
          ? "saved-dirty"
          : "saved-clean";
  const showDraftOption = activeSource !== "builtin" && workspaceStatus === "draft";
  const menuValue =
    activeSource === "builtin"
      ? ""
      : activeSavedSequence
        ? savedSequenceName
        : workspaceHasContent
          ? DRAFT_SEQUENCE_VALUE
          : "";
  const builtInMenuValue = activeSource === "builtin" ? activeBuiltInName : "";
  const saveLabel =
    activeSource === "builtin"
      ? "Save current sequence in user library"
      : nameCollision
        ? "Save current sequence and overwrite"
        : "Save current sequence";

  const commitSequences = useCallback((next) => {
    saveUserSequences(next);
    setSavedSequences(next);
  }, []);

  const loadBuiltInSequence = useCallback(async (name) => {
    setLoadingBuiltInName(name);
    try {
      const sequence = await loadPresetSequenceByName(name);
      if (sequence) setLoadedBuiltInSequence(sequence);
      return sequence;
    } catch {
      setError("Unable to load the selected built-in sequence.");
      return null;
    } finally {
      setLoadingBuiltInName("");
    }
  }, []);

  const buildWorkspaceRecord = useCallback(
    (name) =>
      normalizeSequenceRecord({
        name,
        description: activeSequenceDescription,
        snapshotLabelMode,
        autoCreateBars,
        manualArpeggiation,
        tempi,
        snapshots,
        bars,
        repeats,
      }),
    [
      activeSequenceDescription,
      autoCreateBars,
      bars,
      manualArpeggiation,
      repeats,
      snapshotLabelMode,
      snapshots,
      tempi,
    ],
  );

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
    if (
      workspaceRecord &&
      sequenceRecordContentKey(workspaceRecord) === sequenceRecordContentKey(targetSequence)
    ) {
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
    const attachedName = activeSavedSequence?.name ?? "";
    const conflictingSequence =
      savedSequences.find((entry) => entry.name === sequenceName && entry.name !== attachedName) ??
      null;

    if (
      conflictingSequence &&
      typeof window !== "undefined" &&
      !window.confirm("A user sequence with this name exists. Overwrite it?")
    ) {
      return;
    }

    let next = savedSequences;
    if (attachedName) {
      next = savedSequences.filter(
        (entry) => entry.name !== attachedName && entry.name !== record.name,
      );
      next.push(record);
    } else if (conflictingSequence) {
      next = savedSequences.map((entry) => (entry.name === record.name ? record : entry));
    } else {
      next = [...savedSequences, record];
    }
    commitSequences(next);
    setError("");
    onSequenceSaved?.(record.name);
  }, [
    activeSavedSequence,
    buildWorkspaceRecord,
    commitSequences,
    onSequenceSaved,
    savedSequences,
    sequenceName,
  ]);

  const handleSaveCopy = useCallback(() => {
    const baseName = sequenceName || "User Sequence";
    const uniqueName = uniqueSequenceName(
      baseName,
      new Set(savedSequences.map((entry) => entry.name)),
    );
    const record = buildWorkspaceRecord(uniqueName);
    if (!record) {
      setError("There is no valid sequence to save.");
      return;
    }
    commitSequences([...savedSequences, record]);
    setError("");
    onSequenceSaved?.(record.name);
  }, [buildWorkspaceRecord, commitSequences, onSequenceSaved, savedSequences, sequenceName]);

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

  useEffect(
    () => () => {
      onSaveActionStateChange?.({
        visible: false,
        label: "",
        action: null,
      });
    },
    [onSaveActionStateChange],
  );

  useEffect(() => {
    if (typeof onPrimarySaveVisibilityChange !== "function") return undefined;
    if (!workspaceHasContent) {
      onPrimarySaveVisibilityChange(false);
      return undefined;
    }
    const node = primarySaveRowRef.current;
    if (!node) {
      onPrimarySaveVisibilityChange(false);
      return undefined;
    }
    if (typeof IntersectionObserver !== "function") {
      onPrimarySaveVisibilityChange(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        onPrimarySaveVisibilityChange(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.01 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      onPrimarySaveVisibilityChange(false);
    };
  }, [onPrimarySaveVisibilityChange, workspaceHasContent]);

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

  const handleBuiltInSelect = async (e) => {
    const nextName = e.currentTarget.value;
    if (!nextName) return;
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
    const targetSequence = await loadBuiltInSequence(nextName);
    if (!targetSequence) return;
    onLoadSequence(targetSequence, { source: "builtin" });
  };

  const handleReloadBuiltIn = async () => {
    if (!activeBuiltInName) return;
    setError("");
    const targetSequence = await loadBuiltInSequence(activeBuiltInName);
    if (!targetSequence) return;
    onLoadSequence(targetSequence, { source: "builtin" });
  };

  return (
    <>
      <fieldset>
        <legend>
          <b>Built-in Sequences</b>
        </legend>
        <label class="preset-selector-row">
          <select
            aria-label="Built-in sequences"
            value={builtInMenuValue}
            onChange={handleBuiltInSelect}
            disabled={!!loadingBuiltInName}
          >
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
            <button type="button" class="preset-refresh-btn" onClick={handleReloadBuiltIn}>
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
        </label>
      </fieldset>

      <fieldset>
        <legend>
          <b>User Sequences</b>
        </legend>

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
        </div>

        {(savedSequences.length > 0 || showDraftOption) && (
          <label class="preset-selector-row">
            <select aria-label="User sequences" value={menuValue} onChange={handleSelect}>
              <option value="">Choose a user sequence:</option>
              {showDraftOption && <option value={DRAFT_SEQUENCE_VALUE}>Unsaved sequence</option>}
              {orderedSavedSequences.map((sequence) => {
                const isDirtyActiveSequence =
                  sequence.name === savedSequenceName &&
                  (hasUnsavedChanges || sequenceName !== savedSequenceName);
                return (
                  <option key={sequence.name} value={sequence.name}>
                    {isDirtyActiveSequence ? `${sequence.name}*` : sequence.name}
                  </option>
                );
              })}
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
            {savedSequenceName && (
              <button
                type="button"
                class="delete-btn preset-utility-btn preset-actions__clear-trigger"
                onClick={handleDelete}
              >
                Delete
              </button>
            )}
          </label>
        )}

        <div class="preset-actions preset-actions--library">
          {savedSequences.length > 0 && (
            <span class="preset-actions__clear-slot">
              {confirmClear ? (
                <span class="preset-actions__confirm">
                  <em class="preset-actions__confirm-text">Clear all user sequences?</em>
                  <button
                    type="button"
                    class="delete-btn preset-utility-btn settings-form__inline-button--nowrap"
                    onClick={handleClearConfirmed}
                  >
                    Yes, clear
                  </button>
                  <button
                    type="button"
                    class="preset-utility-btn settings-form__inline-button--nowrap"
                    onClick={() => setConfirmClear(false)}
                  >
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
          <div
            ref={primarySaveRowRef}
            class="settings-form__action-row settings-form__action-row--top"
          >
            <span class="settings-form__action-group settings-form__action-group--wrap">
              <button type="button" class="preset-action-btn" onClick={handleSave}>
                {saveLabel}
              </button>
              <button type="button" class="preset-action-btn" onClick={handleSaveCopy}>
                Save as copy
              </button>
            </span>
            <span class="settings-form__action-group settings-form__action-group--sequence-export">
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
  manualArpeggiation: PropTypes.object,
  activeSequenceSource: PropTypes.string,
  activeSequenceBuiltInName: PropTypes.string,
  activeSequenceName: PropTypes.string.isRequired,
  activeSequenceSavedName: PropTypes.string.isRequired,
  activeSequenceDescription: PropTypes.string.isRequired,
  onLoadSequence: PropTypes.func.isRequired,
  onClearSequence: PropTypes.func,
  onSequenceSaved: PropTypes.func,
  onSaveActionStateChange: PropTypes.func,
  onPrimarySaveVisibilityChange: PropTypes.func,
};

export default SequenceLibrary;
