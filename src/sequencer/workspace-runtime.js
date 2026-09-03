// This module owns whole-workspace normalization for the sequencer sidebar.
// It rebuilds the canonical snapshot/bar/tempo/repeat shape used when creating,
// loading, or restoring a sequence, but does not handle per-row editing.

import { normalizeBarMarkers, normalizeTempoMarkers } from "./transport.js";
import {
  normalizeManualArpeggiation,
  normalizeSnapshotManualTrigger,
} from "./manual-snapshot-arpeggiation.js";
import { cloneJsonValue } from "../persistence/clone-json-value.js";
import { normalizeSequenceLegatoMode } from "./legato.js";
import { hydrateSequencePitchFrames } from "./pitch-frame.js";

function cloneSequenceRecords(records) {
  return Array.isArray(records) ? cloneJsonValue(records) : [];
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
      (max, snapshot) =>
        Math.max(max, Number.isFinite(Number(snapshot?.id)) ? Number(snapshot.id) : 0),
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
  const snapshots = hydrateSequencePitchFrames(
    cloneSequenceRecords(sequence?.snapshots),
    cloneSequenceRecords(sequence?.pitchFrames),
  ).map(normalizeSnapshotManualTrigger);
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
    sequenceLegato: normalizeSequenceLegatoMode(sequence?.legatoMode ?? sequence?.sequenceLegato, {
      legacyTrue: true,
    }),
    manualArpeggiation: normalizeManualArpeggiation(sequence?.manualArpeggiation),
    ids,
  };
}

export function buildRestoredSequenceWorkspace(restoredSequence) {
  const snapshots = Array.isArray(restoredSequence?.snapshots)
    ? hydrateSequencePitchFrames(restoredSequence.snapshots, restoredSequence.pitchFrames).map(
        normalizeSnapshotManualTrigger,
      )
    : [];
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
    sequenceLegato: normalizeSequenceLegatoMode(restoredSequence?.sequenceLegato, {
      legacyTrue: true,
    }),
    // Tuning snap is an audition aid, not part of a saved/restored workspace.
    // Always reopen at the snapshots' own stored pitches.
    snapSequenceToCurrentTuning: false,
    sequenceAutoCreateBars: restoredSequence?.sequenceAutoCreateBars !== false,
    manualArpeggiation: normalizeManualArpeggiation(restoredSequence?.manualArpeggiation),
    ids,
  };
}
