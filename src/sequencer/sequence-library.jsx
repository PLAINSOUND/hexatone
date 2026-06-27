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
  const [pendingLoadName, setPendingLoadName] = useState("");
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

  const loadSequenceByName = (name) => {
    if (!name) return;
    const sequence = savedSequences.find((entry) => entry.name === name);
    if (!sequence) return;
    setSelectedName(name);
    setPendingLoadName("");
    setError("");
    onLoadSequence(sequence);
  };

  const beginLoadSequence = (name) => {
    setSelectedName(name);
    if (!name) {
      setPendingLoadName("");
      return;
    }
    if (!snapshotsPresent) {
      loadSequenceByName(name);
      return;
    }
    setPendingLoadName(name);
    setError("");
  };

  const handleSelect = (e) => {
    beginLoadSequence(e.currentTarget.value);
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
      autoCreateBars,
      tempi,
      snapshots,
      bars,
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

  const handleSaveThenLoad = () => {
    handleSave();
    if (sequenceName) loadSequenceByName(pendingLoadName);
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
      autoCreateBars,
      tempi,
      snapshots,
      bars,
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

    const next = [...savedSequences];
    for (const sequence of imported) {
      const index = next.findIndex((entry) => entry.name === sequence.name);
      if (index >= 0) next[index] = sequence;
      else next.push(sequence);
    }
    commitSequences(next);
    setError("");
    if (!snapshotsPresent) {
      const firstImportedName = imported[0]?.name ?? "";
      if (firstImportedName) {
        setSelectedName(firstImportedName);
        setPendingLoadName("");
        onLoadSequence(imported[0]);
      }
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

      {pendingLoadName && (
        <div class="preset-load-confirm" style={{ marginTop: 4 }}>
          <em>Save current sequence?</em>
          <button type="button" class="preset-action-btn" onClick={handleSaveThenLoad}>
            {saveLabel}
          </button>
          <button
            type="button"
            class="preset-utility-btn"
            onClick={() => loadSequenceByName(pendingLoadName)}
          >
            Open without saving
          </button>
          <button
            type="button"
            class="delete-btn preset-utility-btn"
            onClick={() => {
              setPendingLoadName("");
              setSelectedName(activeSequenceName || "");
            }}
          >
            Cancel
          </button>
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
