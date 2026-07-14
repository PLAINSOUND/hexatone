import { deriveTimedCueTriggers } from "./timed-cue-triggers.js";

function cloneRepeatJump(repeatJump) {
  return repeatJump ? { ...repeatJump } : null;
}

function cloneStructuralEvent(event) {
  return {
    ...event,
  };
}

function cloneScheduledNoteEvent(event) {
  return {
    ...event,
    displayLabel: event.displayLabel ?? "",
    displayLabelEdited: event.displayLabelEdited === true,
    attackVelocity: event.attackVelocity ?? null,
    releaseVelocity: event.releaseVelocity ?? null,
    pressure: event.pressure ?? 0,
    pressure14: event.pressure14 ?? null,
    timbre: event.timbre ?? 0,
    timbre14: event.timbre14 ?? null,
  };
}

function cloneTimedNote(note) {
  return {
    ...note,
    displayLabel: note.displayLabel ?? "",
    displayLabelEdited: note.displayLabelEdited === true,
    attackVelocity: note.attackVelocity ?? null,
    releaseVelocity: note.releaseVelocity ?? null,
    pressure: note.pressure ?? 0,
    pressure14: note.pressure14 ?? null,
    timbre: note.timbre ?? 0,
    timbre14: note.timbre14 ?? null,
    reattack: note.reattack === true,
  };
}

export function compileScheduledPlaybackPlan(playbackTimeline, { legato = true } = {}) {
  const playbackBursts = Array.isArray(playbackTimeline?.playbackBursts)
    ? playbackTimeline.playbackBursts
    : [];
  const timedCueTriggers = deriveTimedCueTriggers(playbackTimeline, { legato });
  const cueTriggerByCueIndex = new Map(
    timedCueTriggers
      .filter((trigger) => Number.isFinite(trigger?.cueIndex))
      .map((trigger) => [Number(trigger.cueIndex), trigger]),
  );

  const scheduledBursts = playbackBursts.map((burst) => {
    const cueIndex = Number.isFinite(burst?.sourceCueIndex) ? Number(burst.sourceCueIndex) : null;
    const cueTrigger = cueIndex != null ? (cueTriggerByCueIndex.get(cueIndex) ?? null) : null;
    const noteEvents = (burst.events ?? [])
      .filter((event) => event?.type === "note")
      .map(cloneScheduledNoteEvent);
    const structuralEvents = (burst.events ?? [])
      .filter((event) => event?.type && event.type !== "note")
      .map(cloneStructuralEvent);

    return {
      playbackIndex: Number(burst?.playbackIndex ?? 0),
      sequenceTime: Number(burst?.sequenceTime ?? 0),
      absoluteSeconds: Number(burst?.elapsedSeconds ?? 0),
      cueIndex,
      snapshotIndexes: Array.isArray(burst?.sourceSnapshotIndexes)
        ? [...burst.sourceSnapshotIndexes]
        : [],
      noteEvents,
      structuralEvents,
      soundingBefore: Array.isArray(cueTrigger?.soundingBefore)
        ? cueTrigger.soundingBefore.map(cloneTimedNote)
        : [],
      soundingAfter: Array.isArray(cueTrigger?.soundingAfter)
        ? cueTrigger.soundingAfter.map(cloneTimedNote)
        : [],
      cueNotes: Array.isArray(cueTrigger?.notes)
        ? cueTrigger.notes.map(cloneTimedNote)
        : [],
      repeatJump: cloneRepeatJump(burst?.repeatJump),
    };
  });

  const scheduledEvents = scheduledBursts.flatMap((burst) => (
    (playbackBursts[burst.playbackIndex]?.events ?? []).map((event, eventOrder) => {
      const clonedEvent = event?.type === "note"
        ? cloneScheduledNoteEvent(event)
        : cloneStructuralEvent(event);
      return {
        ...clonedEvent,
        playbackIndex: burst.playbackIndex,
        eventOrder,
        sequenceTime: burst.sequenceTime,
        absoluteSeconds: burst.absoluteSeconds,
        cueIndex: burst.cueIndex,
        snapshotIndexes: [...burst.snapshotIndexes],
        repeatJump: cloneRepeatJump(burst.repeatJump),
      };
    })
  ));

  return {
    scheduledBursts,
    scheduledEvents,
    totalElapsedSeconds: Number(playbackTimeline?.totalElapsedSeconds ?? 0),
  };
}

export default compileScheduledPlaybackPlan;
