import { sequenceAttackEventIdsAtCueIndex } from "./trigger-groups.js";
import { buildCueExpandedSnapshotIds } from "./timeline-runtime.js";
import { structuralEventRenderKey } from "./value-runtime.js";

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

export function deriveCueScrollAnchorTarget({
  showAllEvents,
  activeCueIndex,
  sequenceCueGroups,
  snapshots,
  cueExpandedSnapshotIds,
  repeatSections = [],
}) {
  if (!Number.isFinite(activeCueIndex)) return null;
  const activeCueZeroBased = activeCueIndex - 1;
  const activeRepeatSection = repeatSections.find((section) => (
    activeCueZeroBased >= Number(section.startCueIndex) &&
    activeCueZeroBased <= Number(section.endCueIndex)
  ));
  if (activeRepeatSection && activeCueZeroBased === Number(activeRepeatSection.startCueIndex)) {
    if (activeRepeatSection.startRepeatId != null) {
      return {
        kind: "structural",
        targetKey: structuralEventRenderKey({
          type: "repeat-start",
          repeatId: activeRepeatSection.startRepeatId,
        }),
      };
    }
  }
  const snapshotId = firstSnapshotIdInSet(cueExpandedSnapshotIds, snapshots);
  if (snapshotId != null) {
    return { kind: "snapshot", targetKey: snapshotId };
  }
  if (showAllEvents) {
    const cueGroup = sequenceCueGroups[activeCueIndex - 1] ?? null;
    const fallbackSnapshotId = cueGroup != null ? (snapshots[cueGroup.snapshotIndex]?.id ?? null) : null;
    return fallbackSnapshotId == null ? null : { kind: "snapshot", targetKey: fallbackSnapshotId };
  }
  return null;
}

export function sameSnapshotSet(left, right) {
  if (!(left instanceof Set) || !(right instanceof Set)) return false;
  if (left.size !== right.size) return false;
  for (const id of right) {
    if (!left.has(id)) return false;
  }
  return true;
}
