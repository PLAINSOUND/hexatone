// This module owns sequencer sessionStorage persistence.
// It saves and restores the active workspace shape so the Sequencer tab can
// survive reloads independently of user-library save/load actions.

import {
  normalizeBarMarkers,
  normalizeRepeatMarkers,
  normalizeTempoMarkers,
} from "./transport.js";
import {
  normalizeManualArpeggiation,
  normalizeSnapshotManualTrigger,
} from "./manual-snapshot-arpeggiation.js";
import { cloneJsonValue } from "../persistence/clone-json-value.js";

export const SEQUENCE_WORKSPACE_STORAGE_KEY = "hexatone_sequence_workspace";

function clone(value) {
  return cloneJsonValue(value);
}

export function serializeSequenceWorkspace(workspace = {}) {
  return {
    version: 2,
    snapshots: clone(Array.isArray(workspace.snapshots)
      ? workspace.snapshots.map(normalizeSnapshotManualTrigger)
      : []),
    bars: clone(Array.isArray(workspace.bars) ? workspace.bars : []),
    tempi: clone(Array.isArray(workspace.tempi) ? workspace.tempi : []),
    repeats: clone(Array.isArray(workspace.repeats) ? workspace.repeats : []),
    snapshotLabelMode: String(workspace.snapshotLabelMode ?? "proportion"),
    activeSequenceSource: String(workspace.activeSequenceSource ?? ""),
    activeSequenceBuiltInName: String(workspace.activeSequenceBuiltInName ?? ""),
    activeSequenceName: String(workspace.activeSequenceName ?? ""),
    activeSequenceSavedName: String(workspace.activeSequenceSavedName ?? ""),
    activeSequenceDescription: String(workspace.activeSequenceDescription ?? ""),
    sequenceLegato: workspace.sequenceLegato !== false,
    snapSequenceToCurrentTuning: workspace.snapSequenceToCurrentTuning === true,
    sequenceAutoCreateBars: workspace.sequenceAutoCreateBars !== false,
    manualArpeggiation: normalizeManualArpeggiation(workspace.manualArpeggiation),
  };
}

export function normalizeSequenceWorkspaceRecord(record) {
  if (!record || typeof record !== "object") return null;
  return {
    version: 2,
    snapshots: clone(Array.isArray(record.snapshots)
      ? record.snapshots.map(normalizeSnapshotManualTrigger)
      : []),
    bars: normalizeBarMarkers(clone(Array.isArray(record.bars) ? record.bars : [])),
    tempi: normalizeTempoMarkers(clone(Array.isArray(record.tempi) ? record.tempi : [])),
    repeats: normalizeRepeatMarkers(clone(Array.isArray(record.repeats) ? record.repeats : [])),
    snapshotLabelMode: String(record.snapshotLabelMode ?? "proportion"),
    activeSequenceSource: String(record.activeSequenceSource ?? ""),
    activeSequenceBuiltInName: String(record.activeSequenceBuiltInName ?? ""),
    activeSequenceName: String(record.activeSequenceName ?? ""),
    activeSequenceSavedName: String(record.activeSequenceSavedName ?? ""),
    activeSequenceDescription: String(record.activeSequenceDescription ?? ""),
    sequenceLegato: record.sequenceLegato !== false,
    snapSequenceToCurrentTuning: record.snapSequenceToCurrentTuning === true,
    sequenceAutoCreateBars: record.sequenceAutoCreateBars !== false,
    manualArpeggiation: normalizeManualArpeggiation(record.manualArpeggiation),
  };
}

export function saveSequenceWorkspaceToSession(workspace) {
  sessionStorage.setItem(
    SEQUENCE_WORKSPACE_STORAGE_KEY,
    JSON.stringify(serializeSequenceWorkspace(workspace)),
  );
}

export function loadSequenceWorkspaceFromSession() {
  try {
    const raw = sessionStorage.getItem(SEQUENCE_WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    return normalizeSequenceWorkspaceRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearSequenceWorkspaceSession() {
  sessionStorage.removeItem(SEQUENCE_WORKSPACE_STORAGE_KEY);
}
