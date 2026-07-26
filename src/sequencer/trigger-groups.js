// This module derives the sequencer's canonical event and cue stream.
// It converts snapshots plus structural markers into ordered note/bar/tempo/
// repeat events, then groups those events into shared-time cue bursts used by
// stepping, playback, and display logic.

import {
  deriveTerminalBarlinePosition,
  normalizeBarMarkers,
  normalizeRepeatMarkers,
  normalizeTempoMode,
} from "./transport.js";

// Distinguish releases that belong to already-sounding notes from note-offs
// that are paired with a same-time note-on inside the current cue burst.
function noteEventPhase(event) {
  if (event?.kind === "release") {
    const start = Number(event?.spanStart);
    const time = Number(event?.time ?? event?.absoluteTime);
    if (Number.isFinite(start) && Number.isFinite(time) && start < time) return 0; // old note off
    return 7; // new note off
  }
  return 6; // new note on
}

function sequenceRowPriority(event) {
  if (event?.type === "note") return noteEventPhase(event);
  if (event?.type === "repeat-end") return 1;
  if (event?.type === "repeat-start") return 2;
  if (event?.type === "tempo") return 3;
  if (event?.type === "bar") return 4;
  if (event?.type === "barline") return 5;
  return 6;
}

function noteFrequency(midicents) {
  const pitch = Number(midicents);
  if (!Number.isFinite(pitch)) return null;
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function normalizeNoteSpan(note, fallbackLength = 1) {
  const start = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
  const rawEnd = Number.isFinite(Number(note?.end)) ? Number(note.end) : fallbackLength;
  const end = Math.max(start, rawEnd);
  return { start, end };
}

function normalizeTimeValue(value) {
  return Math.round(value * 1000000) / 1000000;
}

function snapshotBaseTime(snapshotIndex) {
  return Number(snapshotIndex) + 1;
}

function noteIdentity(note, fallbackLength = 1) {
  const midicents = Number.isFinite(Number(note?.midicents)) ? Number(note.midicents) : "na";
  const { start, end } = normalizeNoteSpan(note, fallbackLength);
  return note?.id ?? `${midicents}:${start}:${end}`;
}

function canRestoreEditedDisplayLabel(note) {
  return Number.isFinite(Number(note?.originalMidicents))
    || (note?.displayLabelEdited === true && note?.originalDisplayLabel != null);
}

export function deriveSnapshotTriggerGroups(snapshot) {
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  const events = [];

  for (const note of snapshot?.notes ?? []) {
    const midicents = Number(note?.midicents);
    if (!Number.isFinite(midicents)) continue;
    const { start, end } = normalizeNoteSpan(note, length);
    const frequency = noteFrequency(midicents);
    const noteKey = noteIdentity(note, length);

    events.push({
      noteKey,
      noteId: note.id ?? `${midicents}:${start}:attack`,
      kind: "attack",
      time: start,
      spanStart: start,
      spanEnd: end,
      fractionDenominator: note.startFractionDenominator ?? null,
      midicents,
      frequency,
      displayLabel: note.displayLabel ?? "",
      displayLabelEdited: note.displayLabelEdited === true,
      canRestoreDisplayLabel: canRestoreEditedDisplayLabel(note),
      attackVelocity: note.attackVelocity ?? note.velocity ?? null,
      releaseVelocity: note.releaseVelocity ?? null,
      pressure: note.pressure ?? 0,
      pressure14: note.pressure14 ?? null,
      timbre: note.timbre ?? 0,
      timbre14: note.timbre14 ?? null,
    });

    events.push({
      noteKey,
      noteId: note.id ?? `${midicents}:${end}:release`,
      kind: "release",
      time: end,
      spanStart: start,
      spanEnd: end,
      fractionDenominator: note.endFractionDenominator ?? null,
      midicents,
      frequency,
      displayLabel: note.displayLabel ?? "",
      displayLabelEdited: note.displayLabelEdited === true,
      canRestoreDisplayLabel: canRestoreEditedDisplayLabel(note),
      attackVelocity: note.attackVelocity ?? note.velocity ?? null,
      releaseVelocity: note.releaseVelocity ?? null,
      pressure: note.pressure ?? 0,
      pressure14: note.pressure14 ?? null,
      timbre: note.timbre ?? 0,
      timbre14: note.timbre14 ?? null,
    });
  }

  events.sort((a, b) => (
    a.time - b.time ||
    noteEventPhase(a) - noteEventPhase(b) ||
    b.midicents - a.midicents
  ));

  const groups = [];
  for (const event of events) {
    const time = normalizeTimeValue(event.time);
    const previous = groups.at(-1);
    if (!previous || previous.time !== time) {
      groups.push({ time, events: [event] });
      continue;
    }
    previous.events.push(event);
  }

  return groups;
}

function snapshotIndexForAbsoluteTime(time, snapshotCount) {
  const t = Number(time);
  if (!Number.isFinite(t) || snapshotCount <= 0) return 0;
  const rounded = Math.round(t);
  const isInteger = Math.abs(t - rounded) < 1e-9;
  const rawIndex = isInteger ? rounded - 2 : Math.floor(t - 1);
  return Math.max(0, Math.min(snapshotCount - 1, rawIndex));
}

export function isWholeSequencePosition(time) {
  const value = Number(time);
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - Math.round(value)) < 1e-9;
}

export function deriveSequenceEvents(snapshots, bars = [], tempi = [], repeats = []) {
  const events = [];

  for (const [snapshotIndex, snapshot] of (snapshots ?? []).entries()) {
    const baseTime = snapshotBaseTime(snapshotIndex);
    const snapshotGroups = deriveSnapshotTriggerGroups(snapshot);

    for (const group of snapshotGroups) {
      for (const event of group.events) {
        events.push({
          ...event,
          type: "note",
          eventId: [
            snapshot?.id ?? snapshotIndex,
            event.noteId,
            event.kind,
            event.time,
          ].join(":"),
          snapshotId: snapshot?.id ?? null,
          snapshotIndex,
          relativeTime: event.time,
          absoluteTime: normalizeTimeValue(baseTime + Number(event.time)),
          snapshotLength: Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1,
        });
      }
    }
  }

  const snapshotCount = snapshots?.length ?? 0;
  const normalizedBars = normalizeBarMarkers(bars);
  for (const [barOrder, bar] of normalizedBars.entries()) {
    const absoluteTime = normalizeTimeValue(Number(bar?.position));
    if (!Number.isFinite(absoluteTime)) continue;
    const snapshotIndex = snapshotIndexForAbsoluteTime(absoluteTime, snapshotCount);
    const relativeTime = normalizeTimeValue(absoluteTime - snapshotBaseTime(snapshotIndex));
    events.push({
      type: "bar",
      kind: "bar",
      barId: bar?.id ?? `bar:${absoluteTime}:${barOrder}`,
      barOrder,
      numerator: Number.isFinite(Number(bar?.numerator)) ? Number(bar.numerator) : 4,
      denominator: Number.isFinite(Number(bar?.denominator)) ? Number(bar.denominator) : 4,
      eventId: `bar:${bar?.id ?? barOrder}:${absoluteTime}`,
      snapshotId: snapshots?.[snapshotIndex]?.id ?? null,
      snapshotIndex,
      relativeTime,
      absoluteTime,
      cueIndex: null,
      cueLead: false,
      cueDisplayLead: false,
      cueOrder: null,
    });
  }

  const normalizedTempi = Array.isArray(tempi) ? tempi : [];
  for (const [tempoOrder, tempo] of normalizedTempi.entries()) {
    const absoluteTime = normalizeTimeValue(Number(tempo?.position));
    if (!Number.isFinite(absoluteTime)) continue;
    const snapshotIndex = snapshotIndexForAbsoluteTime(absoluteTime, snapshotCount);
    const relativeTime = normalizeTimeValue(absoluteTime - snapshotBaseTime(snapshotIndex));
    events.push({
      type: "tempo",
      kind: "tempo",
      tempoId: tempo?.id ?? `tempo:${absoluteTime}:${tempoOrder}`,
      tempoOrder,
      mode: normalizeTempoMode(tempo?.mode),
      bpm: Number(tempo?.bpm),
      beatNumerator: Number.isFinite(Number(tempo?.beatNumerator)) ? Number(tempo.beatNumerator) : 1,
      beatDenominator: Number.isFinite(Number(tempo?.beatDenominator)) ? Number(tempo.beatDenominator) : 4,
      beatLength: Number(tempo?.beatLength),
      eventId: `tempo:${tempo?.id ?? tempoOrder}:${absoluteTime}`,
      snapshotId: snapshots?.[snapshotIndex]?.id ?? null,
      snapshotIndex,
      relativeTime,
      absoluteTime,
      cueIndex: null,
      cueLead: false,
      cueDisplayLead: false,
      cueOrder: null,
    });
  }

  const normalizedRepeats = normalizeRepeatMarkers(repeats);
  for (const [repeatOrder, repeat] of normalizedRepeats.entries()) {
    const absoluteTime = normalizeTimeValue(Number(repeat?.position));
    if (!Number.isFinite(absoluteTime)) continue;
    const snapshotIndex = snapshotIndexForAbsoluteTime(absoluteTime, snapshotCount);
    const relativeTime = normalizeTimeValue(absoluteTime - snapshotBaseTime(snapshotIndex));
    const repeatType = repeat.kind === "end" ? "repeat-end" : "repeat-start";
    events.push({
      type: repeatType,
      kind: repeatType,
      repeatId: repeat?.id ?? `${repeatType}:${absoluteTime}:${repeatOrder}`,
      repeatOrder,
      eventId: `${repeatType}:${repeat?.id ?? repeatOrder}:${absoluteTime}`,
      snapshotId: snapshots?.[snapshotIndex]?.id ?? null,
      snapshotIndex,
      relativeTime,
      absoluteTime,
      cueIndex: null,
      cueLead: false,
      cueDisplayLead: false,
      cueOrder: null,
    });
  }

  const terminalBarlinePosition = deriveTerminalBarlinePosition(snapshots, normalizedBars);
  if (Number.isFinite(Number(terminalBarlinePosition))) {
    const absoluteTime = normalizeTimeValue(Number(terminalBarlinePosition));
    const snapshotIndex = snapshotIndexForAbsoluteTime(absoluteTime, snapshotCount);
    const relativeTime = normalizeTimeValue(absoluteTime - snapshotBaseTime(snapshotIndex));
    events.push({
      type: "barline",
      kind: "barline",
      barlineId: "barline:eof",
      implicit: true,
      eventId: `barline:eof:${absoluteTime}`,
      snapshotId: snapshots?.[snapshotIndex]?.id ?? null,
      snapshotIndex,
      relativeTime,
      absoluteTime,
      cueIndex: null,
      cueLead: false,
      cueDisplayLead: false,
      cueOrder: null,
    });
  }

  events.sort((a, b) => (
    a.absoluteTime - b.absoluteTime ||
    sequenceRowPriority(a) - sequenceRowPriority(b) ||
    ((b.midicents ?? -Infinity) - (a.midicents ?? -Infinity)) ||
    ((a.barOrder ?? 0) - (b.barOrder ?? 0)) ||
    ((a.tempoOrder ?? 0) - (b.tempoOrder ?? 0))
  ));

  let cueIndex = 0;
  let previousTime = null;
  let cueOrder = 0;
  for (const event of events) {
    if (event.type !== "note") continue;
    if (previousTime !== event.absoluteTime) {
      cueIndex += 1;
      cueOrder = 0;
      previousTime = event.absoluteTime;
    }
    event.cueIndex = cueIndex;
    event.cueLead = cueOrder === 0;
    event.cueDisplayLead = false;
    event.cueOrder = cueOrder;
    cueOrder += 1;
  }

  let currentCueIndex = null;
  let currentDisplayLead = null;
  for (const event of events) {
    if (event.type !== "note") continue;
    if (event.cueIndex !== currentCueIndex) {
      if (currentDisplayLead) currentDisplayLead.cueDisplayLead = true;
      currentCueIndex = event.cueIndex;
      currentDisplayLead = event;
      continue;
    }

    const displayLeadShouldAdvance =
      (event.snapshotIndex ?? Infinity) < (currentDisplayLead?.snapshotIndex ?? Infinity) ||
      (
        event.snapshotIndex === currentDisplayLead?.snapshotIndex &&
        (
          event.relativeTime < currentDisplayLead.relativeTime ||
          (
            event.relativeTime === currentDisplayLead.relativeTime &&
            (
              noteEventPhase(event) < noteEventPhase(currentDisplayLead) ||
              (
                noteEventPhase(event) === noteEventPhase(currentDisplayLead) &&
                event.midicents > currentDisplayLead.midicents
              )
            )
          )
        )
      );

    if (displayLeadShouldAdvance) currentDisplayLead = event;
  }
  if (currentDisplayLead) currentDisplayLead.cueDisplayLead = true;

  return events;
}

export function deriveSequenceCueGroupsFromEvents(sequenceEvents = []) {
  const groups = [];

  for (const event of sequenceEvents) {
    if (event?.type !== "note") continue;
    const previous = groups.at(-1);
    if (!previous || previous.time !== event.absoluteTime) {
      groups.push({
        time: event.absoluteTime,
        events: [{ ...event, time: event.absoluteTime }],
        snapshotIndex: event.snapshotIndex,
      });
      continue;
    }
    previous.events.push({ ...event, time: event.absoluteTime });
    previous.snapshotIndex = Math.max(previous.snapshotIndex, event.snapshotIndex ?? -1);
  }

  return groups;
}

export function deriveSequenceCueGroups(snapshots, bars = [], tempi = [], repeats = []) {
  return deriveSequenceCueGroupsFromEvents(
    deriveSequenceEvents(snapshots, bars, tempi, repeats),
  );
}

export function sequenceNotesAtCueTime(snapshots, cueTime) {
  const time = Number(cueTime);
  if (!Number.isFinite(time)) return [];

  return (snapshots ?? []).flatMap((snapshot, snapshotIndex) => {
    const baseTime = snapshotBaseTime(snapshotIndex);
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;

    return (snapshot?.notes ?? []).filter((note) => {
      const start = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
      const rawEnd = Number.isFinite(Number(note?.end)) ? Number(note.end) : length;
      const end = Math.max(start, rawEnd);
      const absoluteStart = normalizeTimeValue(baseTime + start);
      const absoluteEnd = normalizeTimeValue(baseTime + end);
      return absoluteStart <= time && absoluteEnd > time;
    });
  });
}

export function sequenceNotesAtCueIndex(snapshots, cueIndex) {
  const groups = deriveSequenceCueGroups(snapshots);
  const index = Number(cueIndex);
  if (!Number.isFinite(index) || index < 0 || index >= groups.length) return [];

  const activeByInstance = new Map();

  for (let i = 0; i <= index; i += 1) {
    const group = groups[i];
    for (const note of activeByInstance.values()) {
      delete note.reattack;
    }

    for (const event of group.events) {
      const instanceKey = `${event.snapshotId ?? ""}:${event.noteKey}`;
      if (event.kind === "attack") {
        activeByInstance.set(instanceKey, {
          instanceKey,
          noteKey: event.noteKey,
          noteId: event.noteId ?? null,
          snapshotId: event.snapshotId ?? null,
          midicents: event.midicents,
          frequency: event.frequency,
          attackVelocity: event.attackVelocity,
          releaseVelocity: event.releaseVelocity,
          pressure: event.pressure,
          pressure14: event.pressure14,
          timbre: event.timbre,
          timbre14: event.timbre14,
          reattack: true,
        });
      } else {
        activeByInstance.delete(instanceKey);
      }
    }
  }

  return [...activeByInstance.values()].sort((a, b) => (
    Number(b.midicents) - Number(a.midicents)
  ));
}

export function sequenceNoteKeysAtCueIndex(snapshots, bars = [], tempi = [], cueIndex) {
  const events = deriveSequenceEvents(snapshots, bars, tempi).filter((event) => event.type === "note");
  const index = Number(cueIndex);
  if (!Number.isFinite(index) || index < 0) return [];

  const activeNoteKeys = new Set();
  for (const event of events) {
    if (!Number.isFinite(event.cueIndex) || event.cueIndex - 1 > index) break;
    if (event.kind === "attack") activeNoteKeys.add(event.noteKey);
    else activeNoteKeys.delete(event.noteKey);
  }

  return [...activeNoteKeys];
}

export function sequenceNoteInstanceKeysAtCueIndex(snapshots, bars = [], tempi = [], cueIndex) {
  const events = deriveSequenceEvents(snapshots, bars, tempi).filter((event) => event.type === "note");
  const index = Number(cueIndex);
  if (!Number.isFinite(index) || index < 0) return [];

  const activeNoteKeys = new Set();
  for (const event of events) {
    if (!Number.isFinite(event.cueIndex) || event.cueIndex - 1 > index) break;
    const instanceKey = `${event.snapshotId}:${event.noteKey}`;
    if (event.kind === "attack") activeNoteKeys.add(instanceKey);
    else activeNoteKeys.delete(instanceKey);
  }

  return [...activeNoteKeys];
}

export function sequenceAttackEventIdsAtCueIndex(snapshots, bars = [], tempi = [], cueIndex) {
  const events = deriveSequenceEvents(snapshots, bars, tempi).filter((event) => event.type === "note");
  const index = Number(cueIndex);
  if (!Number.isFinite(index) || index < 0) return [];

  const activeAttackIds = new Map();
  for (const event of events) {
    if (!Number.isFinite(event.cueIndex) || event.cueIndex - 1 > index) break;
    const instanceKey = `${event.snapshotId}:${event.noteKey}`;
    if (event.kind === "attack") activeAttackIds.set(instanceKey, event.eventId);
    else activeAttackIds.delete(instanceKey);
  }

  return [...activeAttackIds.values()];
}
