import {
  normalizeBarMarkers,
  normalizeTempoMarkers,
} from "./transport.js";

function cloneSequenceRecords(records) {
  return Array.isArray(records) ? JSON.parse(JSON.stringify(records)) : [];
}

export function defaultSequenceBars() {
  return normalizeBarMarkers([{ id: 1, position: 1 }]);
}

export function defaultSequenceTempi() {
  return normalizeTempoMarkers([{ id: 1, position: 1, bpm: 60, beatLength: 1, mode: "immediate" }]);
}

export function deriveSequenceWorkspaceIds({ snapshots = [], bars = [] } = {}) {
  return {
    snapshotId: (Array.isArray(snapshots) ? snapshots : []).reduce(
      (max, snapshot) => Math.max(max, Number.isFinite(Number(snapshot?.id)) ? Number(snapshot.id) : 0),
      0,
    ),
    barId: (Array.isArray(bars) ? bars : []).reduce(
      (max, bar) => Math.max(max, Number.isFinite(Number(bar?.id)) ? Number(bar.id) : 0),
      0,
    ),
  };
}

export function buildLoadedSequenceWorkspace(sequence, options = {}) {
  const source = String(options?.source ?? "user").trim();
  const name = String(sequence?.name ?? "").trim();
  const snapshots = cloneSequenceRecords(sequence?.snapshots);
  const bars = normalizeBarMarkers(cloneSequenceRecords(sequence?.bars));
  const tempi = normalizeTempoMarkers(cloneSequenceRecords(sequence?.tempi));
  const repeats = cloneSequenceRecords(sequence?.repeats);
  const ids = deriveSequenceWorkspaceIds({ snapshots, bars });

  return {
    snapshots,
    bars,
    tempi,
    repeats,
    snapshotLabelMode: String(sequence?.snapshotLabelMode ?? "proportion"),
    sequenceAutoCreateBars: sequence?.autoCreateBars !== false,
    activeSequenceSource: source,
    activeSequenceBuiltInName: source === "builtin" ? name : "",
    activeSequenceName: name,
    activeSequenceSavedName: source === "user" ? name : "",
    activeSequenceDescription: String(sequence?.description ?? ""),
    ids,
  };
}

export function buildRestoredSequenceWorkspace(restoredSequence) {
  const snapshots = Array.isArray(restoredSequence?.snapshots) ? restoredSequence.snapshots : [];
  const bars = Array.isArray(restoredSequence?.bars) ? restoredSequence.bars : [];
  const tempi = Array.isArray(restoredSequence?.tempi) ? restoredSequence.tempi : [];
  const repeats = Array.isArray(restoredSequence?.repeats) ? restoredSequence.repeats : [];
  const ids = deriveSequenceWorkspaceIds({ snapshots, bars });

  return {
    snapshots,
    bars,
    tempi,
    repeats,
    snapshotLabelMode: String(restoredSequence?.snapshotLabelMode ?? "proportion"),
    activeSequenceSource: String(restoredSequence?.activeSequenceSource ?? ""),
    activeSequenceBuiltInName: String(restoredSequence?.activeSequenceBuiltInName ?? ""),
    activeSequenceName: String(restoredSequence?.activeSequenceName ?? ""),
    activeSequenceSavedName: String(restoredSequence?.activeSequenceSavedName ?? ""),
    activeSequenceDescription: String(restoredSequence?.activeSequenceDescription ?? ""),
    sequenceLegato: restoredSequence?.sequenceLegato !== false,
    snapSequenceToCurrentTuning: restoredSequence?.snapSequenceToCurrentTuning === true,
    sequenceAutoCreateBars: restoredSequence?.sequenceAutoCreateBars !== false,
    ids,
  };
}
