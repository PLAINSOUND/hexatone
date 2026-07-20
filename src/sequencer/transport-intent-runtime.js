import {
  armPendingCueSelection,
  armPendingSnapshotSelection,
  clearPendingTransportSelection,
} from "./transport-selection.js";
import {
  firstSnapshotIdForCueIndex,
  firstSnapshotIdInSet,
} from "./view-runtime.js";

export function buildStoppedSequenceTransportState({
  barIndex = 0,
  stepIndex = -1,
  markerIndex = null,
  selectedSnapshotId = null,
  selectedSnapshotMarker = null,
  playingSnapshotId = null,
} = {}) {
  return {
    playingSnapshotId,
    selectedSnapshotId,
    selectedSnapshotMarker,
    playhead: {
      barIndex,
      stepIndex,
      markerIndex,
      stopped: true,
    },
  };
}

export function buildTimedPlaybackUiResetState({
  barIndex = 0,
  stepIndex = -1,
  markerIndex = null,
} = {}) {
  return {
    clockSeconds: -Infinity,
    stepIndex,
    markerIndex,
    barIndex,
  };
}

export function buildCommittedSequencePlaybackState({
  safeStepIndex,
  safeMarkerIndex,
  snapshot,
  cueGroup,
  normalizedNotes,
  barIndex,
  snapshots = [],
} = {}) {
  const selectedSnapshotId = cueGroup?.snapshotIndex != null
    ? (snapshots[cueGroup.snapshotIndex]?.id ?? snapshot?.id ?? null)
    : (snapshot?.id ?? null);
  const selectedSnapshotMarker = safeMarkerIndex == null || cueGroup == null
    ? null
    : {
      snapshotId: snapshots[cueGroup.snapshotIndex]?.id ?? snapshot?.id ?? null,
      time: cueGroup.time - (cueGroup.snapshotIndex + 1),
    };
  return {
    pendingTransportSelection: clearPendingTransportSelection(),
    playingSnapshotId: (normalizedNotes?.length ?? 0) > 0 ? (snapshot?.id ?? null) : null,
    selectedSnapshotId,
    selectedSnapshotMarker,
    playhead: {
      barIndex,
      stepIndex: safeStepIndex,
      markerIndex: safeMarkerIndex,
      stopped: (normalizedNotes?.length ?? 0) === 0,
    },
  };
}

export function resolvePendingSnapshotTransportState({
  targetIndex,
  snapshots = [],
  sequenceCueGroups = [],
  barIndexForTime,
} = {}) {
  const nextIndex = Number(targetIndex);
  if (!Number.isFinite(nextIndex) || nextIndex < 0 || nextIndex >= snapshots.length) return null;
  const snapshot = snapshots[nextIndex] ?? null;
  if (!snapshot) return null;
  return {
    pendingTransportSelection: armPendingSnapshotSelection(nextIndex, sequenceCueGroups),
    ...buildStoppedSequenceTransportState({
      barIndex: barIndexForTime(nextIndex + 1),
      stepIndex: nextIndex,
      selectedSnapshotId: snapshot.id,
    }),
  };
}

export function resolvePendingCueTransportState({
  targetCueIndex,
  sequenceCueGroups = [],
  sequenceEvents = [],
  snapshots = [],
  previewExpandedIds = new Set(),
  barIndexForTime,
} = {}) {
  const nextCueIndex = Number(targetCueIndex);
  if (!Number.isFinite(nextCueIndex) || nextCueIndex < 0 || nextCueIndex >= sequenceCueGroups.length) return null;
  const cueGroup = sequenceCueGroups[nextCueIndex] ?? null;
  if (!cueGroup) return null;
  const anchorSnapshotId = firstSnapshotIdInSet(previewExpandedIds, snapshots)
    ?? firstSnapshotIdForCueIndex(nextCueIndex + 1, sequenceEvents, snapshots)
    ?? (snapshots[cueGroup.snapshotIndex]?.id ?? null);
  const anchorSnapshotIndex = anchorSnapshotId == null
    ? cueGroup.snapshotIndex
    : snapshots.findIndex((snapshot) => snapshot.id === anchorSnapshotId);
  const safeAnchorSnapshotIndex = anchorSnapshotIndex >= 0
    ? anchorSnapshotIndex
    : cueGroup.snapshotIndex;
  const snapshot = snapshots[safeAnchorSnapshotIndex] ?? null;
  return {
    pendingTransportSelection: armPendingCueSelection(nextCueIndex, safeAnchorSnapshotIndex),
    ...buildStoppedSequenceTransportState({
      barIndex: barIndexForTime(cueGroup.time),
      stepIndex: safeAnchorSnapshotIndex,
      markerIndex: nextCueIndex,
      selectedSnapshotId: snapshot?.id ?? null,
      selectedSnapshotMarker: snapshot
        ? {
          snapshotId: snapshot.id,
          time: cueGroup.time - (safeAnchorSnapshotIndex + 1),
        }
        : null,
    }),
  };
}
