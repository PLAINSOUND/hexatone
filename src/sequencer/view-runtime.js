import { sequenceAttackEventIdsAtCueIndex } from "./trigger-groups.js";
import { buildCueExpandedSnapshotIds } from "./timeline-runtime.js";

export function firstSnapshotIdInSet(snapshotIds, snapshots) {
  if (!(snapshotIds instanceof Set) || snapshotIds.size === 0) return null;
  const firstSnapshot = snapshots.find((snapshot) => snapshotIds.has(snapshot.id));
  return firstSnapshot?.id ?? null;
}

export function buildCueExpandedSnapshotIdsAt(cueIndexZeroBased, renderedSnapshots, sortedBars, sortedTempi, sequenceEvents) {
  const cueIndexOneBased = Number(cueIndexZeroBased) + 1;
  if (!Number.isFinite(cueIndexOneBased) || cueIndexOneBased <= 0) return new Set();
  const attackIds = new Set(
    sequenceAttackEventIdsAtCueIndex(renderedSnapshots, sortedBars, sortedTempi, cueIndexZeroBased),
  );
  return buildCueExpandedSnapshotIds(cueIndexOneBased, sequenceEvents, attackIds);
}

export function deriveSoundingAttackEventIds({
  sequencePlaybackActive,
  playheadMarkerIndex,
  renderedSnapshots,
  sortedBars,
  sortedTempi,
  activeSnapshotId,
  playingSnapshotId,
}) {
  if (!sequencePlaybackActive) return new Set();
  if (playheadMarkerIndex != null) {
    return new Set(sequenceAttackEventIdsAtCueIndex(renderedSnapshots, sortedBars, sortedTempi, playheadMarkerIndex));
  }
  const activeSnapshot = activeSnapshotId != null
    ? renderedSnapshots.find((snapshot) => snapshot.id === activeSnapshotId)
    : renderedSnapshots.find((snapshot) => snapshot.id === playingSnapshotId);
  if (!activeSnapshot) return new Set();
  return new Set(
    (activeSnapshot.notes ?? [])
      .filter((note) => Number.isFinite(Number(note?.midicents)))
      .map((note) => {
        const noteStart = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
        return [
          activeSnapshot.id,
          note.id ?? `${Number(note.midicents)}:${noteStart}:attack`,
          "attack",
          noteStart,
        ].join(":");
      }),
  );
}

export function deriveExpandedSnapshotIds({
  showAllEvents,
  pendingCueJumpIndex,
  cueExpandedSnapshotIdsAt,
  playheadIsOff,
  playheadIsEnd,
  selectedSnapshotId,
  activeCueIndex,
  cueExpandedSnapshotIds,
}) {
  if (showAllEvents) return null;
  if (pendingCueJumpIndex !== "") {
    const previewCueIndex = Number(pendingCueJumpIndex);
    if (Number.isFinite(previewCueIndex)) {
      const previewIds = cueExpandedSnapshotIdsAt(previewCueIndex);
      if (previewIds.size > 0) return previewIds;
    }
  }
  if (playheadIsOff || playheadIsEnd || selectedSnapshotId == null) {
    return new Set();
  }
  if (activeCueIndex != null) {
    return cueExpandedSnapshotIds.size > 0 ? new Set(cueExpandedSnapshotIds) : new Set([selectedSnapshotId]);
  }
  return new Set([selectedSnapshotId]);
}

export function deriveCueScrollAnchorSnapshotId({
  showAllEvents,
  activeCueIndex,
  sequenceCueGroups,
  snapshots,
  cueExpandedSnapshotIds,
}) {
  if (!Number.isFinite(activeCueIndex)) return null;
  if (showAllEvents) {
    const cueGroup = sequenceCueGroups[activeCueIndex - 1] ?? null;
    return cueGroup != null ? (snapshots[cueGroup.snapshotIndex]?.id ?? null) : null;
  }
  return firstSnapshotIdInSet(cueExpandedSnapshotIds, snapshots);
}

export function sameSnapshotSet(left, right) {
  if (!(left instanceof Set) || !(right instanceof Set)) return false;
  if (left.size !== right.size) return false;
  for (const id of right) {
    if (!left.has(id)) return false;
  }
  return true;
}
