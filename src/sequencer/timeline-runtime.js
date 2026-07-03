export function buildSnapshotEventsById(sequenceEvents = []) {
  const groups = new Map();

  for (const event of sequenceEvents) {
    if (
      event.type !== "note" &&
      event.type !== "bar" &&
      event.type !== "tempo" &&
      event.type !== "barline" &&
      event.type !== "repeat-start" &&
      event.type !== "repeat-end"
    ) continue;
    if (
      (
        event.type === "bar" ||
        event.type === "tempo" ||
        event.type === "barline" ||
        event.type === "repeat-start" ||
        event.type === "repeat-end"
      ) &&
      isWholeSequencePosition(event.absoluteTime) &&
      Math.abs(Number(event.absoluteTime) - (Number(event.snapshotIndex) + 1)) < 1e-9
    ) {
      continue;
    }
    if (!groups.has(event.snapshotId)) groups.set(event.snapshotId, []);
    groups.get(event.snapshotId).push(event);
  }

  return groups;
}

export function buildFirstSnapshotEventIds(snapshotEventsById) {
  const ids = new Map();

  for (const [snapshotId, events] of snapshotEventsById.entries()) {
    const firstNoteEvent = events.find((event) => event.type === "note");
    if (firstNoteEvent) ids.set(snapshotId, firstNoteEvent.eventId);
  }

  return ids;
}

export function buildSnapshotStartCueIndexes(firstSnapshotEventIds, sequenceEvents = []) {
  const indexes = new Map();

  for (const [snapshotId, eventId] of firstSnapshotEventIds.entries()) {
    const firstEvent = sequenceEvents.find((event) => event.eventId === eventId);
    if (firstEvent) indexes.set(snapshotId, firstEvent.cueIndex);
  }

  return indexes;
}

export function buildFirstEventIdByCueIndex(sequenceEvents = []) {
  const ids = new Map();

  for (const event of sequenceEvents) {
    if (event.type !== "note") continue;
    if (!Number.isFinite(event.cueIndex)) continue;
    if (!ids.has(event.cueIndex)) ids.set(event.cueIndex, event.eventId);
  }

  return ids;
}

export function buildFirstCueIndexBySnapshotIndex(sequenceCueGroups = []) {
  const indexes = new Map();

  sequenceCueGroups.forEach((group, index) => {
    if (!indexes.has(group.snapshotIndex)) indexes.set(group.snapshotIndex, index);
  });

  return indexes;
}

export function buildFirstCueTimeBySnapshotIndex(sequenceCueGroups = []) {
  const times = new Map();

  sequenceCueGroups.forEach((group) => {
    if (!times.has(group.snapshotIndex)) times.set(group.snapshotIndex, group.time);
  });

  return times;
}

export function buildCueExpandedSnapshotIds(activeCueIndex, sequenceEvents = [], soundingAttackEventIds = new Set()) {
  if (activeCueIndex == null) return new Set();

  const ids = new Set();
  for (const event of sequenceEvents) {
    if (event.type !== "note") continue;
    if (event.kind !== "attack") continue;
    if (event.cueIndex === activeCueIndex || soundingAttackEventIds.has(event.eventId)) {
      if (event.snapshotId != null) ids.add(event.snapshotId);
    }
  }

  return ids;
}

export function deriveSelectedCueAbsoluteTime(
  selectedMarker,
  playheadMarkerIndex,
  sequenceCueGroups,
  snapshotIndexById,
) {
  if (selectedMarker?.snapshotId != null && Number.isFinite(Number(selectedMarker?.time))) {
    const snapshotStart = snapshotIndexById.get(selectedMarker.snapshotId);
    if (snapshotStart != null) return Number((snapshotStart + Number(selectedMarker.time)).toFixed(6));
  }
  if (playheadMarkerIndex != null) {
    const cueGroup = sequenceCueGroups[playheadMarkerIndex];
    if (cueGroup) return Number(cueGroup.time.toFixed(6));
  }
  return null;
}

function isWholeSequencePosition(time) {
  const value = Number(time);
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - Math.round(value)) < 1e-9;
}
