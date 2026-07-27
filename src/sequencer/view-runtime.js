// This module owns view-only derivations for the sequencer event list.
// It answers which snapshots should expand, which rows should highlight, and
// where cue scrolling should anchor, without mutating playback or sequence data.

import { buildCueExpandedSnapshotIds } from "./timeline-runtime.js";
import { structuralEventRenderKey } from "./value-runtime.js";

export function firstSnapshotIdInSet(snapshotIds, snapshots) {
  if (!(snapshotIds instanceof Set) || snapshotIds.size === 0) return null;
  const firstSnapshot = snapshots.find((snapshot) => snapshotIds.has(snapshot.id));
  return firstSnapshot?.id ?? null;
}

export function firstSnapshotIdForCueIndex(cueIndexOneBased, sequenceEvents = [], snapshots = []) {
  const targetCueIndex = Number(cueIndexOneBased);
  if (!Number.isFinite(targetCueIndex) || targetCueIndex <= 0) return null;
  const snapshotIds = new Set(
    sequenceEvents
      .filter((event) => (
        event?.type === "note"
        && Number(event?.cueIndex) === targetCueIndex
        && event?.snapshotId != null
      ))
      .map((event) => event.snapshotId),
  );
  return firstSnapshotIdInSet(snapshotIds, snapshots);
}

export function mostRecentAttackSnapshotId({
  sequenceEvents = [],
  snapshots = [],
  attackEventIds = null,
  snapshotIds = null,
  maxCueIndex = null,
} = {}) {
  const constrainedEventIds = attackEventIds instanceof Set ? attackEventIds : null;
  const constrainedSnapshotIds = snapshotIds instanceof Set ? snapshotIds : null;
  const cueLimit = maxCueIndex == null ? null : Number(maxCueIndex);
  const candidates = sequenceEvents.filter((event) => (
    event?.type === "note"
    && event?.kind === "attack"
    && (!constrainedEventIds || constrainedEventIds.has(event.eventId))
    && (!constrainedSnapshotIds || constrainedSnapshotIds.has(event.snapshotId))
    && (cueLimit == null || !Number.isFinite(cueLimit) || Number(event.cueIndex) <= cueLimit)
  ));
  if (candidates.length === 0) return null;

  const eventRank = (event) => {
    const absoluteTime = Number(event.absoluteTime);
    if (Number.isFinite(absoluteTime)) return absoluteTime;
    const cueIndex = Number(event.cueIndex);
    return Number.isFinite(cueIndex) ? cueIndex : -Infinity;
  };
  const mostRecentRank = Math.max(...candidates.map(eventRank));
  const mostRecentSnapshotIds = new Set(
    candidates
      .filter((event) => Math.abs(eventRank(event) - mostRecentRank) < 1e-9)
      .map((event) => event.snapshotId),
  );
  return firstSnapshotIdInSet(mostRecentSnapshotIds, snapshots);
}

export function contentSpanFitsViewport({
  contentHeight,
  viewportHeight,
  stickyHeight = 0,
  gap = 6,
} = {}) {
  const usableHeight = Math.max(0, Number(viewportHeight) - Number(stickyHeight) - (2 * Number(gap)));
  return Number.isFinite(Number(contentHeight)) && Number(contentHeight) <= usableHeight;
}

export function deriveCueViewportModel({
  cueIndexZeroBased,
  sequenceEvents = [],
  soundingAttackEventIds = new Set(),
} = {}) {
  const cueIndexOneBased = Number(cueIndexZeroBased) + 1;
  if (!Number.isFinite(cueIndexOneBased) || cueIndexOneBased <= 0) {
    return {
      eventIds: [],
      snapshotIds: new Set(),
      firstEventId: null,
      overflowEventId: null,
    };
  }

  const soundingIds = soundingAttackEventIds instanceof Set
    ? soundingAttackEventIds
    : new Set();
  const events = sequenceEvents
    .map((event, sourceOrder) => ({ event, sourceOrder }))
    .filter(({ event }) => (
      event?.type === "note"
      && (
        Number(event?.cueIndex) === cueIndexOneBased
        || (event?.kind === "attack" && soundingIds.has(event.eventId))
      )
    ))
    // The rendered list groups by snapshot, then retains sequence-event order
    // inside each snapshot. Anchor selection must use that same visual order.
    .sort((left, right) => {
      const leftSnapshotIndex = Number(left.event?.snapshotIndex);
      const rightSnapshotIndex = Number(right.event?.snapshotIndex);
      const leftRank = Number.isFinite(leftSnapshotIndex) ? leftSnapshotIndex : Infinity;
      const rightRank = Number.isFinite(rightSnapshotIndex) ? rightSnapshotIndex : Infinity;
      return leftRank - rightRank || left.sourceOrder - right.sourceOrder;
    })
    .map(({ event }) => event);
  const latestAttack = events.findLast((event) => event?.kind === "attack") ?? null;
  return {
    eventIds: events.map((event) => event.eventId).filter((eventId) => eventId != null),
    snapshotIds: new Set(events.map((event) => event.snapshotId).filter((snapshotId) => snapshotId != null)),
    firstEventId: events[0]?.eventId ?? null,
    // A release-only cue can have no surviving attack. In that case the last
    // cue row is the only deterministic overflow anchor available.
    overflowEventId: latestAttack?.eventId ?? events.at(-1)?.eventId ?? null,
  };
}

export function sequenceSoundingAttackEventIdsAtCueIndex(sequenceEvents = [], cueIndexZeroBased) {
  const cueIndexOneBased = Number(cueIndexZeroBased) + 1;
  if (!Number.isFinite(cueIndexOneBased) || cueIndexOneBased <= 0) return [];
  const activeAttacks = new Map();
  for (const event of sequenceEvents) {
    if (event?.type !== "note") continue;
    if (!Number.isFinite(Number(event?.cueIndex))) continue;
    if (Number(event.cueIndex) > cueIndexOneBased) break;
    const instanceKey = `${event.snapshotId}:${event.noteKey}`;
    if (event.kind === "attack") activeAttacks.set(instanceKey, event.eventId);
    else activeAttacks.delete(instanceKey);
  }
  return [...activeAttacks.values()];
}

export function deriveCueViewportPlan({
  cueIndexZeroBased,
  sequenceEvents = [],
} = {}) {
  const soundingAttackEventIds = new Set(
    sequenceSoundingAttackEventIdsAtCueIndex(sequenceEvents, cueIndexZeroBased),
  );
  return {
    cueIndex: Number(cueIndexZeroBased),
    soundingAttackEventIds,
    ...deriveCueViewportModel({
      cueIndexZeroBased,
      sequenceEvents,
      soundingAttackEventIds,
    }),
  };
}

export function buildCueExpandedSnapshotIdsAt(cueIndexZeroBased, renderedSnapshots, sortedBars, sortedTempi, sequenceEvents) {
  const cueIndexOneBased = Number(cueIndexZeroBased) + 1;
  if (!Number.isFinite(cueIndexOneBased) || cueIndexOneBased <= 0) return new Set();
  return deriveCueViewportPlan({
    cueIndexZeroBased,
    sequenceEvents,
  }).snapshotIds;
}

export function deriveCueExpandedSnapshotIds({
  activeCueIndex,
  cueExpandedSnapshotIdsAt,
  sequenceEvents,
  soundingAttackEventIds,
}) {
  if (!Number.isFinite(activeCueIndex)) return new Set();
  const previewIds = cueExpandedSnapshotIdsAt(activeCueIndex - 1);
  if (previewIds.size > 0) return previewIds;
  return buildCueExpandedSnapshotIds(activeCueIndex, sequenceEvents, soundingAttackEventIds);
}

export function deriveSoundingAttackEventIds({
  sequencePlaybackActive,
  playheadMarkerIndex,
  renderedSnapshots,
  sortedBars: _sortedBars,
  sortedTempi: _sortedTempi,
  activeSnapshotId,
  playingSnapshotId,
  sequenceEvents = [],
}) {
  if (!sequencePlaybackActive) return new Set();
  if (playheadMarkerIndex != null) {
    return new Set(sequenceSoundingAttackEventIdsAtCueIndex(sequenceEvents, playheadMarkerIndex));
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
  cueExpandedSnapshotIdsAt,
  playheadIsOff,
  playheadIsEnd,
  selectedSnapshotId,
  activeCueIndex,
  pendingCueIndex = null,
  cueExpandedSnapshotIds,
  suppressSelectedSnapshotPreview = false,
}) {
  if (showAllEvents) return null;
  if (activeCueIndex != null) {
    if (cueExpandedSnapshotIds.size > 0) return new Set(cueExpandedSnapshotIds);
    const previewIds = cueExpandedSnapshotIdsAt(activeCueIndex - 1);
    return previewIds.size > 0 ? previewIds : new Set([selectedSnapshotId]);
  }
  if (Number.isFinite(pendingCueIndex)) {
    const previewIds = cueExpandedSnapshotIdsAt(pendingCueIndex);
    if (previewIds.size > 0) return previewIds;
  }
  if (playheadIsOff || playheadIsEnd || selectedSnapshotId == null) {
    return new Set();
  }
  if (suppressSelectedSnapshotPreview) return new Set();
  return new Set([selectedSnapshotId]);
}

export function resolveCueAnchorSnapshotId({
  activeCueIndex,
  sequenceCueGroups,
  sequenceEvents = [],
  snapshots = [],
  cueExpandedSnapshotIds = new Set(),
} = {}) {
  if (!Number.isFinite(activeCueIndex)) return null;
  const recentSoundingSnapshotId = mostRecentAttackSnapshotId({
    sequenceEvents,
    snapshots,
    snapshotIds: cueExpandedSnapshotIds,
    maxCueIndex: activeCueIndex,
  });
  if (recentSoundingSnapshotId != null) return recentSoundingSnapshotId;
  const expandedSnapshotId = firstSnapshotIdInSet(cueExpandedSnapshotIds, snapshots);
  if (expandedSnapshotId != null) return expandedSnapshotId;
  const cueSnapshotId = firstSnapshotIdForCueIndex(activeCueIndex, sequenceEvents, snapshots);
  if (cueSnapshotId != null) return cueSnapshotId;
  const cueGroup = sequenceCueGroups[activeCueIndex - 1] ?? null;
  return cueGroup != null ? (snapshots[cueGroup.snapshotIndex]?.id ?? null) : null;
}

export function deriveCueScrollAnchorTarget({
  showAllEvents,
  activeCueIndex,
  sequenceCueGroups,
  sequenceEvents = [],
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
  const snapshotId = resolveCueAnchorSnapshotId({
    activeCueIndex,
    sequenceCueGroups,
    sequenceEvents,
    snapshots,
    cueExpandedSnapshotIds,
  });
  if (snapshotId != null) return { kind: "snapshot", targetKey: snapshotId };
  if (!showAllEvents) return null;
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
