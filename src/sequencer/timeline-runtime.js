// This module derives cue- and snapshot-level lookup tables for the sequencer.
// It turns normalized event and cue data into fast indexes used by playback,
// scrolling, and row expansion logic, without mutating sequence state.


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
    )
      continue;
    if (
      (event.type === "bar" ||
        event.type === "tempo" ||
        event.type === "barline" ||
        event.type === "repeat-start" ||
        event.type === "repeat-end") &&
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

export function buildFirstSnapshotCueEventIds(snapshotEventsById) {
  const ids = new Map();

  for (const [snapshotId, events] of snapshotEventsById.entries()) {
    for (const event of events) {
      if (event?.type !== "note") continue;
      if (!Number.isFinite(event?.cueIndex)) continue;
      const key = `${snapshotId}:${event.cueIndex}`;
      if (!ids.has(key)) ids.set(key, event.eventId);
    }
  }

  return ids;
}

export function buildCueExpandedSnapshotIds(
  activeCueIndex,
  sequenceEvents = [],
  soundingAttackEventIds = new Set(),
) {
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

function isWholeSequencePosition(time) {
  const value = Number(time);
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - Math.round(value)) < 1e-9;
}
