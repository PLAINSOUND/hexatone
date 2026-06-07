import { createRef } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import PropTypes from "prop-types";

const STORAGE_KEY = "hexatone_user_sequences";

export function loadUserSequences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserSequences(sequences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sequences));
}

function cloneSnapshots(snapshots) {
  return JSON.parse(JSON.stringify(Array.isArray(snapshots) ? snapshots : []));
}

function normalizeSequenceRecord(record) {
  if (!record || typeof record !== "object") return null;
  const name = String(record.name ?? "").trim();
  if (!name) return null;
  const snapshots = cloneSnapshots(record.snapshots);
  if (!Array.isArray(snapshots)) return null;
  return {
    type: "hexatone-sequence",
    version: 1,
    name,
    description: String(record.description ?? ""),
    snapshotLabelMode: String(record.snapshotLabelMode ?? "proportion"),
    snapshots,
  };
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
      snapshots: parsed?.snapshots,
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

const SequenceLibrary = ({
  snapshots,
  snapshotLabelMode,
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
  const isExisting = useMemo(
    () => savedSequences.some((sequence) => sequence.name === sequenceName),
    [savedSequences, sequenceName],
  );
  const saveLabel = isExisting ? "Save current sequence and overwrite" : "Save current sequence";

  const commitSequences = (next) => {
    saveUserSequences(next);
    setSavedSequences(next);
  };

  const handleSelect = (e) => {
    const name = e.currentTarget.value;
    setSelectedName(name);
    if (!name) return;
    const sequence = savedSequences.find((entry) => entry.name === name);
    if (!sequence) return;
    setError("");
    onLoadSequence(sequence);
  };

  const handleSave = () => {
    if (!sequenceName) {
      setError("Please enter a Sequence Name first.");
      return;
    }
    const record = normalizeSequenceRecord({
      name: sequenceName,
      description: activeSequenceDescription,
      snapshotLabelMode,
      snapshots,
    });
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
    const record = normalizeSequenceRecord({
      name: sequenceName,
      description: activeSequenceDescription,
      snapshotLabelMode,
      snapshots,
    });
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
    const files = Array.from(e.currentTarget.files ?? []).filter((file) => /\.json$/i.test(file.name));
    if (!files.length) {
      setError("No .json sequence files were selected.");
      e.currentTarget.value = "";
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
      e.currentTarget.value = "";
      return;
    }

    const next = [...savedSequences];
    for (const sequence of imported) {
      const index = next.findIndex((entry) => entry.name === sequence.name);
      if (index >= 0) next[index] = sequence;
      else next.push(sequence);
    }
    commitSequences(next);
    setError("");
    e.currentTarget.value = "";
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
                const sequence = savedSequences.find((entry) => entry.name === selectedName);
                if (!sequence) return;
                setError("");
                onLoadSequence(sequence);
              }}
            >
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
          <button
            type="button"
            class="delete-btn preset-utility-btn"
            style={{ marginLeft: "auto" }}
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
        style={{ display: "none" }}
        onChange={handleOpenFiles}
      />

      <div class="preset-actions" style={{ marginTop: 4 }}>
        <button
          type="button"
          class="preset-action-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          Open File(s)…
        </button>
        {savedSequences.length > 0 &&
          (confirmClear ? (
            <span>
              <em>Clear all user sequences?&nbsp;</em>
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
              onClick={() => setConfirmClear(true)}
            >
              Clear All
            </button>
          ))}
      </div>

      {snapshotsPresent && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 4,
            rowGap: "0.25em",
          }}
        >
          <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button type="button" class="preset-action-btn" onClick={handleSave}>
              {saveLabel}
            </button>
          </span>
          <span style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              class="preset-utility-btn"
              style={{ width: "6em", textAlign: "center" }}
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
  snapshotLabelMode: PropTypes.string.isRequired,
  activeSequenceName: PropTypes.string.isRequired,
  activeSequenceDescription: PropTypes.string.isRequired,
  onLoadSequence: PropTypes.func.isRequired,
};

export default SequenceLibrary;
