// This module derives cue trigger payloads for timed playback.
// It turns cue groups plus sounding-note state into concrete attack/release
// bursts that can be dispatched through the existing play-cue path.

function cloneTimedNote(note, { reattack = false } = {}) {
  return {
    instanceKey: note.instanceKey ?? null,
    noteKey: note.noteKey,
    noteId: note.noteId ?? null,
    snapshotId: note.snapshotId ?? null,
    snapshotIndex: note.snapshotIndex ?? null,
    eventId: note.eventId ?? null,
    midicents: note.midicents,
    frequency: note.frequency,
    displayLabel: note.displayLabel ?? "",
    displayLabelEdited: note.displayLabelEdited === true,
    attackVelocity: note.attackVelocity ?? null,
    releaseVelocity: note.releaseVelocity ?? null,
    pressure: note.pressure ?? 0,
    pressure14: note.pressure14 ?? null,
    timbre: note.timbre ?? 0,
    timbre14: note.timbre14 ?? null,
    reattack,
  };
}

function sortByDescendingPitch(notes = []) {
  return [...notes].sort(
    (left, right) => Number(right?.midicents ?? -Infinity) - Number(left?.midicents ?? -Infinity),
  );
}

function serializeNotes(soundingAfter = [], newlyAttacked = [], legato = true) {
  const reattackSet = new Set(Array.isArray(newlyAttacked) ? newlyAttacked : []);
  return sortByDescendingPitch(soundingAfter).map((note) =>
    cloneTimedNote(note, {
      reattack: legato ? reattackSet.has(note.instanceKey) : false,
    }),
  );
}

export function deriveTimedCueTriggers(playbackTimeline, { legato = true } = {}) {
  const playbackBursts = Array.isArray(playbackTimeline?.playbackBursts)
    ? playbackTimeline.playbackBursts
    : [];

  return playbackBursts
    .filter((burst) => Number.isFinite(burst?.sourceCueIndex))
    .map((burst) => ({
      cueIndex: Number(burst.sourceCueIndex),
      sequenceTime: Number(burst.sequenceTime),
      absoluteSeconds: Number(burst.elapsedSeconds ?? 0),
      snapshotIndexes: Array.isArray(burst.sourceSnapshotIndexes)
        ? [...burst.sourceSnapshotIndexes]
        : [],
      structuralEvents: (burst.events ?? [])
        .filter((event) => event?.type && event.type !== "note")
        .map((event) => ({ ...event })),
      soundingBefore: serializeNotes(burst.soundingBefore, [], false),
      soundingAfter: serializeNotes(burst.soundingAfter, [], false),
      notes: serializeNotes(burst.soundingAfter, burst.newlyAttacked, legato),
      newlyAttacked: Array.isArray(burst.newlyAttacked) ? [...burst.newlyAttacked] : [],
      released: Array.isArray(burst.released) ? [...burst.released] : [],
      repeatJump: burst.repeatJump ? { ...burst.repeatJump } : null,
    }));
}
