import { deriveRepeatSections } from "./repeat-playback-runtime.js";
import { remapSequenceSnapshotsToRuntime } from "./runtime-pitch-map.js";
import {
  deriveSequenceCueGroups,
  deriveSequenceCueGroupsFromEvents,
  deriveSequenceEvents,
} from "./trigger-groups.js";
import {
  deriveTerminalBarlinePosition,
  normalizeBarMarkers,
  normalizeTempoMarkers,
} from "./transport.js";

function normalizeTime(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function normalizeQuarterNotes(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function normalizeSeconds(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function canonicalWholeNotesPerMinute(marker) {
  const bpm = Math.max(0.000001, Number(marker?.bpm) || 60);
  const beatNumerator = Math.max(1, Math.round(Number(marker?.beatNumerator) || 1));
  const beatDenominator = Math.max(1, Math.round(Number(marker?.beatDenominator) || 4));
  return bpm * (beatNumerator / beatDenominator);
}

function buildBarTimingSegments(bars = [], terminalPosition = null) {
  const normalizedBars = normalizeBarMarkers(bars);
  const resolvedTerminalPosition = Number.isFinite(Number(terminalPosition))
    ? Number(terminalPosition)
    : null;
  const segments = [];
  let startQuarterNotes = 0;

  for (let index = 0; index < normalizedBars.length; index += 1) {
    const bar = normalizedBars[index];
    const nextBar = normalizedBars[index + 1] ?? null;
    const startPosition = Number(bar.position);
    const nextPosition = Number(nextBar?.position);
    const endPosition = Number.isFinite(nextPosition)
      ? nextPosition
      : Number.isFinite(resolvedTerminalPosition) && resolvedTerminalPosition > startPosition + 1e-9
        ? resolvedTerminalPosition
        : Infinity;
    const barLength = Number.isFinite(endPosition) && endPosition > startPosition + 1e-9
      ? endPosition - startPosition
      : 1;
    const beatsPerBar = Math.max(0, Math.round(Number(bar.numerator) || 0));
    const beatUnit = Math.max(1, Math.round(Number(bar.denominator) || 4));
    const quarterNotesPerBar = beatsPerBar === 0 ? 0 : beatsPerBar * (4 / beatUnit);
    const quarterNotesPerUnit = quarterNotesPerBar / barLength;

    segments.push({
      startPosition,
      endPosition,
      startQuarterNotes,
      quarterNotesPerUnit,
    });

    if (Number.isFinite(endPosition)) {
      startQuarterNotes += quarterNotesPerBar;
    }
  }

  return segments;
}

function findBarTimingSegment(position, segments = []) {
  const sequencePosition = Number(position);
  if (!Number.isFinite(sequencePosition) || segments.length === 0) return null;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (sequencePosition >= segments[index].startPosition - 1e-9) return segments[index];
  }

  return segments[0] ?? null;
}

function sequencePositionToQuarterNotes(position, segments = []) {
  const segment = findBarTimingSegment(position, segments);
  if (!segment) return null;
  return normalizeQuarterNotes(
    segment.startQuarterNotes
      + Math.max(0, Number(position) - segment.startPosition) * segment.quarterNotesPerUnit,
  );
}

function buildMusicalTempoSegments(tempi = [], bars = [], terminalPosition = null) {
  const normalizedTempi = normalizeTempoMarkers(tempi);
  const barTimingSegments = buildBarTimingSegments(bars, terminalPosition);
  const segments = [];
  let elapsedSeconds = 0;

  for (let index = 0; index < normalizedTempi.length; index += 1) {
    const marker = normalizedTempi[index];
    const nextMarker = normalizedTempi[index + 1] ?? null;
    const startPosition = Number(marker.position);
    const endPosition = Number(nextMarker?.position ?? Infinity);
    const startQuarterNotes = sequencePositionToQuarterNotes(startPosition, barTimingSegments) ?? 0;
    const endQuarterNotes = Number.isFinite(endPosition)
      ? sequencePositionToQuarterNotes(endPosition, barTimingSegments)
      : Infinity;
    const wholeNotesPerMinute = canonicalWholeNotesPerMinute(marker);
    const nextWholeNotesPerMinute = canonicalWholeNotesPerMinute(nextMarker);
    const nextMode = nextMarker?.mode === "gradual" ? "gradual" : "immediate";
    const quarterNotesSpan = Number.isFinite(endQuarterNotes)
      ? Math.max(0, endQuarterNotes - startQuarterNotes)
      : Infinity;
    const secondsPerQuarter = 15 / wholeNotesPerMinute;

    let integratedSeconds = null;
    if (Number.isFinite(quarterNotesSpan)) {
      if (nextMarker && nextMode === "gradual" && quarterNotesSpan > 1e-9) {
        const slope = (nextWholeNotesPerMinute - wholeNotesPerMinute) / quarterNotesSpan;
        integratedSeconds = Math.abs(slope) <= 1e-12
          ? quarterNotesSpan * (15 / wholeNotesPerMinute)
          : (15 / slope) * Math.log(nextWholeNotesPerMinute / wholeNotesPerMinute);
      } else {
        integratedSeconds = quarterNotesSpan * secondsPerQuarter;
      }
    }

    segments.push({
      startPosition,
      endPosition,
      startQuarterNotes,
      endQuarterNotes,
      startSeconds: normalizeSeconds(elapsedSeconds),
      secondsPerQuarter,
      wholeNotesPerMinute,
      beatNumerator: Math.max(1, Math.round(Number(marker?.beatNumerator) || 1)),
      beatDenominator: Math.max(1, Math.round(Number(marker?.beatDenominator) || 4)),
      endWholeNotesPerMinute: nextMarker && nextMode === "gradual"
        ? nextWholeNotesPerMinute
        : wholeNotesPerMinute,
      transitionMode: nextMode,
    });

    if (integratedSeconds != null) {
      elapsedSeconds += integratedSeconds;
    }
  }

  return {
    barTimingSegments,
    tempoSegments: segments,
  };
}

function findTempoSegmentForPosition(position, tempoSegments = []) {
  const sequencePosition = Number(position);
  if (!Number.isFinite(sequencePosition) || tempoSegments.length === 0) return null;

  for (let index = tempoSegments.length - 1; index >= 0; index -= 1) {
    if (sequencePosition >= tempoSegments[index].startPosition - 1e-9) return tempoSegments[index];
  }

  return tempoSegments[0] ?? null;
}

function sequencePositionToTimedSeconds(position, timingModel) {
  const quarterNotes = sequencePositionToQuarterNotes(position, timingModel.barTimingSegments);
  if (quarterNotes == null) return null;
  const segment = findTempoSegmentForPosition(position, timingModel.tempoSegments);
  if (!segment) return null;
  const quarterNoteOffset = Math.max(0, quarterNotes - segment.startQuarterNotes);
  let elapsedWithinSegment = quarterNoteOffset * segment.secondsPerQuarter;

  if (
    segment.transitionMode === "gradual"
    && Math.abs(segment.endWholeNotesPerMinute - segment.wholeNotesPerMinute) > 1e-12
  ) {
    const quarterNotesSpan = Math.max(0, segment.endQuarterNotes - segment.startQuarterNotes);
    const slope = quarterNotesSpan > 1e-9
      ? (segment.endWholeNotesPerMinute - segment.wholeNotesPerMinute) / quarterNotesSpan
      : 0;
    if (Math.abs(slope) > 1e-12 && quarterNoteOffset > 0) {
      const currentWholeNotesPerMinute = segment.wholeNotesPerMinute + slope * quarterNoteOffset;
      elapsedWithinSegment = (15 / slope) * Math.log(currentWholeNotesPerMinute / segment.wholeNotesPerMinute);
    }
  }
  return normalizeSeconds(
    segment.startSeconds + elapsedWithinSegment,
  );
}

function sequenceSpanToTimedSeconds(startPosition, endPosition, timingModel) {
  const startSeconds = sequencePositionToTimedSeconds(startPosition, timingModel);
  const endSeconds = sequencePositionToTimedSeconds(endPosition, timingModel);
  if (startSeconds == null || endSeconds == null) return null;
  return normalizeSeconds(endSeconds - startSeconds);
}

function wholeNotesPerMinuteAtPosition(position, timingModel) {
  const quarterNotes = sequencePositionToQuarterNotes(position, timingModel?.barTimingSegments);
  if (quarterNotes == null) return null;
  const segment = findTempoSegmentForPosition(position, timingModel?.tempoSegments);
  if (!segment) return null;
  const quarterNoteOffset = Math.max(0, quarterNotes - segment.startQuarterNotes);
  if (
    segment.transitionMode === "gradual"
    && Math.abs(segment.endWholeNotesPerMinute - segment.wholeNotesPerMinute) > 1e-12
  ) {
    const quarterNotesSpan = Math.max(0, segment.endQuarterNotes - segment.startQuarterNotes);
    const slope = quarterNotesSpan > 1e-9
      ? (segment.endWholeNotesPerMinute - segment.wholeNotesPerMinute) / quarterNotesSpan
      : 0;
    if (Math.abs(slope) > 1e-12) {
      return normalizeSeconds(segment.wholeNotesPerMinute + slope * quarterNoteOffset);
    }
  }
  return normalizeSeconds(segment.wholeNotesPerMinute);
}

export function deriveTempoAtSequencePosition(position, tempi = [], bars = [], terminalPosition = null) {
  const timingModel = buildMusicalTempoSegments(tempi, bars, terminalPosition);
  const segment = findTempoSegmentForPosition(position, timingModel.tempoSegments);
  if (!segment) return null;
  const wholeNotesPerMinute = wholeNotesPerMinuteAtPosition(position, timingModel);
  if (!Number.isFinite(wholeNotesPerMinute)) return null;
  const beatNumerator = Math.max(1, Math.round(Number(segment.beatNumerator) || 1));
  const beatDenominator = Math.max(1, Math.round(Number(segment.beatDenominator) || 4));
  return {
    wholeNotesPerMinute,
    beatNumerator,
    beatDenominator,
    bpm: normalizeSeconds(wholeNotesPerMinute * (beatDenominator / beatNumerator)),
  };
}

function noteInstanceKey(event) {
  return `${event.snapshotId}:${event.noteKey}`;
}

function cloneActiveNote(event) {
  return {
    instanceKey: noteInstanceKey(event),
    noteKey: event.noteKey,
    noteId: event.noteId ?? null,
    snapshotId: event.snapshotId ?? null,
    snapshotIndex: event.snapshotIndex ?? null,
    eventId: event.eventId ?? null,
    midicents: event.midicents,
    frequency: event.frequency,
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

function cloneSoundingNotes(activeNotes) {
  return [...activeNotes.values()].map((note) => ({ ...note }));
}

function sourceCueIndexForBurst(events) {
  const firstNote = events.find((event) => Number.isFinite(event?.cueIndex));
  return Number.isFinite(firstNote?.cueIndex) ? firstNote.cueIndex : null;
}

function sourceSnapshotIndexesForBurst(events) {
  return [...new Set(
    events
      .map((event) => event?.snapshotIndex)
      .filter((index) => Number.isFinite(index)),
  )].sort((left, right) => left - right);
}

function applyEventsToActiveNotes(events, activeNotes) {
  const released = [];
  const newlyAttacked = [];

  for (const event of events) {
    if (event?.type !== "note") continue;
    const instanceKey = noteInstanceKey(event);
    if (event.kind === "attack") {
      activeNotes.set(instanceKey, cloneActiveNote(event));
      newlyAttacked.push(instanceKey);
      continue;
    }
    if (activeNotes.has(instanceKey)) {
      activeNotes.delete(instanceKey);
      released.push(instanceKey);
    }
  }

  return { released, newlyAttacked };
}

function buildSyntheticRepeatCleanupEvents(activeNotes, burst) {
  return [...activeNotes.values()]
    .sort((left, right) => Number(right.midicents) - Number(left.midicents))
    .map((note, index) => ({
      type: "note",
      kind: "release",
      synthetic: true,
      repeatCleanup: true,
      noteKey: note.noteKey,
      noteId: note.noteId ?? `${note.noteKey}:repeat-cleanup`,
      eventId: `repeat-cleanup:${burst.time}:${note.instanceKey}:${index}`,
      snapshotId: note.snapshotId,
      snapshotIndex: note.snapshotIndex,
      absoluteTime: burst.time,
      time: burst.time,
      cueIndex: burst.sourceCueIndex,
      midicents: note.midicents,
      frequency: note.frequency,
      displayLabel: note.displayLabel,
      displayLabelEdited: note.displayLabelEdited === true,
      attackVelocity: note.attackVelocity ?? null,
      releaseVelocity: note.releaseVelocity ?? note.attackVelocity ?? null,
      pressure: note.pressure ?? 0,
      pressure14: note.pressure14 ?? null,
      timbre: note.timbre ?? 0,
      timbre14: note.timbre14 ?? null,
    }));
}

function firstRepeatEndEvent(events, repeatSectionsById) {
  return events.find((event) => event?.type === "repeat-end" && repeatSectionsById.has(event.repeatId)) ?? null;
}

function repeatJumpForEvent(repeatEndEvent, repeatSection, repeatPlaybackState) {
  if (!repeatEndEvent || !repeatSection) return null;
  const remaining = Number.isFinite(Number(repeatPlaybackState[repeatSection.repeatId]))
    ? Number(repeatPlaybackState[repeatSection.repeatId])
    : repeatSection.repeatCount - 1;
  if (remaining <= 0) return null;
  return {
    fromRepeatId: repeatSection.repeatId,
    toStartRepeatId: repeatSection.startRepeatId,
    jumpToSequenceTime: repeatSection.startPosition,
    remainingRepeatsAfterJump: remaining - 1,
  };
}

export function buildCueBursts(sequenceEvents = []) {
  const bursts = [];

  for (const event of sequenceEvents ?? []) {
    const time = normalizeTime(event?.absoluteTime);
    if (!Number.isFinite(time)) continue;
    const previous = bursts.at(-1);
    const clonedEvent = { ...event, time };
    if (!previous || Math.abs(previous.time - time) > 1e-9) {
      bursts.push({
        burstIndex: bursts.length,
        time,
        events: [clonedEvent],
      });
      continue;
    }
    previous.events.push(clonedEvent);
  }

  return bursts.map((burst, index) => ({
    ...burst,
    burstIndex: index,
    sourceCueIndex: sourceCueIndexForBurst(burst.events),
    sourceSnapshotIndexes: sourceSnapshotIndexesForBurst(burst.events),
  }));
}

export function deriveBurstSoundingState(cueBursts = []) {
  const activeNotes = new Map();

  return cueBursts.map((burst) => {
    const soundingBefore = cloneSoundingNotes(activeNotes);
    const { released, newlyAttacked } = applyEventsToActiveNotes(burst.events, activeNotes);
    const soundingAfter = cloneSoundingNotes(activeNotes);
    return {
      ...burst,
      soundingBefore,
      soundingAfter,
      released,
      newlyAttacked,
    };
  });
}

export function buildPlaybackBursts(cueBursts = [], repeatSections = [], timingModel) {
  if (!Array.isArray(cueBursts) || cueBursts.length === 0) return [];

  const burstsByTime = new Map(cueBursts.map((burst, index) => [normalizeTime(burst.time), index]));
  const repeatSectionsById = new Map(repeatSections.map((section) => [section.repeatId, section]));
  const activeNotes = new Map();
  const playbackBursts = [];
  const repeatPlaybackState = {};
  const pendingRepeatSkips = new Map();

  let currentBurstIndex = 0;
  let playbackIndex = 0;
  let elapsedSeconds = sequencePositionToTimedSeconds(cueBursts[0].time, timingModel) ?? 0;
  let guard = 0;

  while (currentBurstIndex >= 0 && currentBurstIndex < cueBursts.length && guard < 20000) {
    guard += 1;
    const burst = cueBursts[currentBurstIndex];
    const soundingBefore = cloneSoundingNotes(activeNotes);
    const repeatEndEvent = firstRepeatEndEvent(burst.events, repeatSectionsById);
    const repeatSection = repeatEndEvent ? repeatSectionsById.get(repeatEndEvent.repeatId) : null;
    const repeatJump = repeatJumpForEvent(repeatEndEvent, repeatSection, repeatPlaybackState);
    let repeatSkip = null;

    if (repeatJump && repeatEndEvent) {
      const skipActiveNotes = new Map(activeNotes);
      const skipResult = applyEventsToActiveNotes(burst.events, skipActiveNotes);
      repeatSkip = {
        nextPlaybackIndex: null,
        events: burst.events,
        soundingAfter: cloneSoundingNotes(skipActiveNotes),
        newlyAttacked: skipResult.newlyAttacked,
        released: skipResult.released,
      };
    }

    let executedEvents = burst.events;
    if (repeatJump && repeatEndEvent) {
      const repeatEndIndex = burst.events.findIndex((event) => event.eventId === repeatEndEvent.eventId);
      executedEvents = burst.events.slice(0, repeatEndIndex + 1);
    }

    const { released, newlyAttacked } = applyEventsToActiveNotes(executedEvents, activeNotes);
    let cleanupEvents = [];
    let releasedAfterCleanup = released;

    if (repeatJump) {
      cleanupEvents = buildSyntheticRepeatCleanupEvents(activeNotes, burst);
      if (cleanupEvents.length > 0) {
        releasedAfterCleanup = [...released, ...cleanupEvents.map((event) => noteInstanceKey(event))];
      }
      activeNotes.clear();
      repeatPlaybackState[repeatSection.repeatId] = repeatJump.remainingRepeatsAfterJump;
    } else if (repeatEndEvent && repeatSection) {
      delete repeatPlaybackState[repeatSection.repeatId];
    }

    const soundingAfter = cloneSoundingNotes(activeNotes);
    const playbackBurst = {
      playbackIndex,
      sequenceTime: burst.time,
      elapsedSeconds,
      sourceCueIndex: burst.sourceCueIndex,
      sourceSnapshotIndexes: burst.sourceSnapshotIndexes,
      events: cleanupEvents.length > 0 ? [...executedEvents, ...cleanupEvents] : executedEvents,
      soundingBefore,
      soundingAfter,
      newlyAttacked,
      released: releasedAfterCleanup,
      repeatJump,
      repeatSkip,
    };
    playbackBursts.push(playbackBurst);
    playbackIndex += 1;

    if (repeatJump && repeatSection) {
      const pending = pendingRepeatSkips.get(repeatSection.repeatId) ?? [];
      pending.push(repeatSkip);
      pendingRepeatSkips.set(repeatSection.repeatId, pending);
    } else if (repeatEndEvent && repeatSection) {
      const pending = pendingRepeatSkips.get(repeatSection.repeatId) ?? [];
      pending.forEach((skip) => {
        skip.nextPlaybackIndex = playbackIndex;
      });
      pendingRepeatSkips.delete(repeatSection.repeatId);
    }

    let nextBurstIndex = currentBurstIndex + 1;
    let nextElapsedSeconds = elapsedSeconds;

    if (repeatJump) {
      nextBurstIndex = burstsByTime.get(normalizeTime(repeatJump.jumpToSequenceTime)) ?? -1;
    } else if (nextBurstIndex < cueBursts.length) {
      nextElapsedSeconds += sequenceSpanToTimedSeconds(burst.time, cueBursts[nextBurstIndex].time, timingModel) ?? 0;
    } else {
      nextBurstIndex = -1;
    }

    currentBurstIndex = nextBurstIndex;
    elapsedSeconds = nextElapsedSeconds;
  }

  return playbackBursts;
}

export function buildPlaybackTimeline({
  snapshots = [],
  bars = [],
  tempi = [],
  repeats = [],
  runtimePitchMode = "stored",
  runtimePitchContext = null,
  sequenceEvents: precomputedSequenceEvents = null,
  sequenceCueGroups: precomputedSequenceCueGroups = null,
} = {}) {
  const effectiveSnapshots = runtimePitchMode === "snapped" && runtimePitchContext
    ? remapSequenceSnapshotsToRuntime(snapshots, runtimePitchContext, {
      hejiNames: runtimePitchContext.hejiNames,
      noteNames: runtimePitchContext.noteNames,
    })
    : snapshots;

  const sequenceEvents = Array.isArray(precomputedSequenceEvents)
    ? precomputedSequenceEvents
    : deriveSequenceEvents(effectiveSnapshots, bars, tempi, repeats);
  const cueBursts = deriveBurstSoundingState(buildCueBursts(sequenceEvents));
  const sequenceCueGroups = Array.isArray(precomputedSequenceCueGroups)
    ? precomputedSequenceCueGroups
    : Array.isArray(precomputedSequenceEvents)
      ? deriveSequenceCueGroupsFromEvents(precomputedSequenceEvents)
      : deriveSequenceCueGroups(effectiveSnapshots, bars, tempi, repeats);
  const repeatSections = deriveRepeatSections(sequenceCueGroups, repeats);
  const timingModel = buildMusicalTempoSegments(
    tempi,
    bars,
    deriveTerminalBarlinePosition(effectiveSnapshots, bars),
  );
  const playbackBursts = buildPlaybackBursts(cueBursts, repeatSections, timingModel);
  const timelineEndPosition = playbackBursts.at(-1)?.sequenceTime ?? null;
  const totalElapsedSeconds = playbackBursts.at(-1)?.elapsedSeconds ?? 0;

  return {
    noteEvents: sequenceEvents,
    cueBursts,
    repeatSections,
    playbackBursts,
    timelineEndPosition,
    totalElapsedSeconds,
  };
}
