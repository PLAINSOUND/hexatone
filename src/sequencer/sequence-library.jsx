import { createRef } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import PropTypes from "prop-types";
import {
  normalizeBarMarkers,
  normalizeSequenceTransport,
  normalizeTempoMarkers,
} from "./transport.js";

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

const SequenceLibrary = ({
  snapshots,
  bars,
  tempi,
  snapshotLabelMode,
  autoCreateBars,
  activeSequenceName,
  activeSequenceDescription,
  onLoadSequence,
}) => {
  const [savedSequences, setSavedSequences] = useState(loadUserSequences);
  const [selectedName, setSelectedName] = useState("");
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInputRef = createRef();

  useEffect(() => {
    if (activeSequenceName) setSelectedName(activeSequenceName);
  }, [activeSequenceName]);

  const sequenceName = String(activeSequenceName ?? "").trim();
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
    }),
    [activeSequenceDescription, autoCreateBars, bars, sequenceName, snapshotLabelMode, snapshots, tempi],
  );
  const activeSavedSequence = useMemo(
    () => savedSequences.find((sequence) => sequence.name === sequenceName) ?? null,
    [savedSequences, sequenceName],
  );
  const matchingSavedSequence = useMemo(() => {
    if (!workspaceRecord) return null;
    const workspaceContentKey = sequenceRecordContentKey(workspaceRecord);
    return savedSequences.find((sequence) => (
      sequenceRecordContentKey(sequence) === workspaceContentKey
    )) ?? null;
  }, [savedSequences, workspaceRecord]);
  const isExisting = useMemo(
    () => savedSequences.some((sequence) => sequence.name === sequenceName),
    [savedSequences, sequenceName],
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!workspaceRecord) return false;
    if (!activeSavedSequence) {
      if (matchingSavedSequence) return false;
      return snapshotsPresent;
    }
    return sequenceRecordKey({ ...workspaceRecord, name: activeSavedSequence.name })
      !== sequenceRecordKey(activeSavedSequence);
  }, [activeSavedSequence, matchingSavedSequence, snapshotsPresent, workspaceRecord]);
  const saveLabel = isExisting && hasUnsavedChanges
    ? "Save current sequence and overwrite"
    : "Save current sequence";

  const commitSequences = (next) => {
    saveUserSequences(next);
    setSavedSequences(next);
  };

  const buildWorkspaceRecord = (name) => normalizeSequenceRecord({
    name,
    description: activeSequenceDescription,
    snapshotLabelMode,
    autoCreateBars,
    tempi,
    snapshots,
    bars,
  });

  const stashCurrentWorkspace = (sequences) => {
    if (!snapshotsPresent || !hasUnsavedChanges) return sequences;
    if (matchingSavedSequence) return sequences;
    const takenNames = new Set(sequences.map((entry) => entry.name));
    const preferredName = sequenceName || "User Sequence";
    const stashName = uniqueSequenceName(preferredName, takenNames);
    const record = buildWorkspaceRecord(stashName);
    if (!record) return sequences;
    return [...sequences, record];
  };

  const loadSequenceByName = (name) => {
    if (!name) return;
    const sequence = savedSequences.find((entry) => entry.name === name);
    if (!sequence) return;
    setSelectedName(name);
    setError("");
    onLoadSequence(sequence);
  };

  const beginLoadSequence = (name) => {
    setSelectedName(name);
    if (!name) return;
    const targetSequence = savedSequences.find((entry) => entry.name === name) ?? null;
    if (!targetSequence) return;
    if (workspaceRecord && sequenceRecordContentKey(workspaceRecord) === sequenceRecordContentKey(targetSequence)) {
      setError("");
      onLoadSequence(targetSequence);
      return;
    }
    if (name === sequenceName) {
      loadSequenceByName(name);
      return;
    }
    if (!snapshotsPresent) {
      loadSequenceByName(name);
      return;
    }
    const next = stashCurrentWorkspace([...savedSequences]);
    commitSequences(next);
    const sequence = next.find((entry) => entry.name === name);
    if (!sequence) return;
    setError("");
    onLoadSequence(sequence);
  };

  const handleSelect = (e) => {
    beginLoadSequence(e.currentTarget.value);
  };

  const handleSave = () => {
    if (!sequenceName) {
      setError("Please enter a Sequence Name first.");
      return;
    }
    const record = buildWorkspaceRecord(sequenceName);
    if (!record) {
      setError("There is no valid sequence to save.");
      return;
    }
    const next = isExisting
      ? savedSequences.map((entry) => (entry.name === sequenceName ? record : entry))
      : [...savedSequences, record];
    commitSequences(next);
    setSelectedName(sequenceName);
    setError("");
  };

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

  const handleDelete = () => {
    if (!selectedName) return;
    const next = savedSequences.filter((entry) => entry.name !== selectedName);
    commitSequences(next);
    setSelectedName("");
    setError("");
  };

  const handleClearConfirmed = () => {
    commitSequences([]);
    setSelectedName("");
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

    let next = snapshotsPresent ? stashCurrentWorkspace([...savedSequences]) : [...savedSequences];
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
      setSelectedName(firstImported.name);
      onLoadSequence(firstImported);
    }
    if (input) input.value = "";
  };

  return (
    <fieldset>
      <legend>
        <b>User Sequences</b>
      </legend>

      {savedSequences.length > 0 && (
        <label class="preset-selector-row">
          <select value={selectedName} onChange={handleSelect}>
            <option value="">Choose a user sequence:</option>
            {savedSequences.map((sequence) => (
              <option key={sequence.name} value={sequence.name}>
                {sequence.name}
              </option>
            ))}
          </select>
          {selectedName && (
            <button
              type="button"
              class="preset-refresh-btn"
              onClick={() => {
                beginLoadSequence(selectedName);
              }}
            >
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
          <button
            type="button"
            class="delete-btn preset-utility-btn preset-actions__clear-trigger"
            disabled={!selectedName}
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
          (confirmClear ? (
            <span class="preset-actions__confirm">
              <em class="preset-actions__confirm-text">Clear all user sequences?</em>
              <button type="button" class="delete-btn" onClick={handleClearConfirmed}>
                Yes, clear
              </button>
              <button type="button" onClick={() => setConfirmClear(false)}>
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
          ))}
      </div>

      {snapshotsPresent && (
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
  );
};

SequenceLibrary.propTypes = {
  snapshots: PropTypes.arrayOf(PropTypes.object).isRequired,
  bars: PropTypes.arrayOf(PropTypes.object),
  tempi: PropTypes.arrayOf(PropTypes.object),
  snapshotLabelMode: PropTypes.string.isRequired,
  autoCreateBars: PropTypes.bool.isRequired,
  activeSequenceName: PropTypes.string.isRequired,
  activeSequenceDescription: PropTypes.string.isRequired,
  onLoadSequence: PropTypes.func.isRequired,
};

export default SequenceLibrary;
