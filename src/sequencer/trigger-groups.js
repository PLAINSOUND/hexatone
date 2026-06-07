function eventTypePriority(kind) {
  return kind === "attack" ? 0 : 1;
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
  return Math.round(value * 1000) / 1000;
}

function snapshotBaseTime(snapshotIndex) {
  return Number(snapshotIndex) + 1;
}

function noteIdentity(note, fallbackLength = 1) {
  const midicents = Number.isFinite(Number(note?.midicents)) ? Number(note.midicents) : "na";
  const { start, end } = normalizeNoteSpan(note, fallbackLength);
  return note?.id ?? `${midicents}:${start}:${end}`;
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
      midicents,
      frequency,
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
      midicents,
      frequency,
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
    eventTypePriority(a.kind) - eventTypePriority(b.kind) ||
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

export function deriveSequenceEvents(snapshots) {
  const events = [];

  for (const [snapshotIndex, snapshot] of (snapshots ?? []).entries()) {
    const baseTime = snapshotBaseTime(snapshotIndex);
    const snapshotGroups = deriveSnapshotTriggerGroups(snapshot);

    for (const group of snapshotGroups) {
      for (const event of group.events) {
        events.push({
          ...event,
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

  events.sort((a, b) => (
    a.absoluteTime - b.absoluteTime ||
    eventTypePriority(a.kind) - eventTypePriority(b.kind) ||
    b.midicents - a.midicents
  ));

  let cueIndex = 0;
  let previousTime = null;
  let cueOrder = 0;
  for (const event of events) {
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
              eventTypePriority(event.kind) < eventTypePriority(currentDisplayLead.kind) ||
              (
                eventTypePriority(event.kind) === eventTypePriority(currentDisplayLead.kind) &&
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

export function deriveSequenceCueGroups(snapshots) {
  const groups = [];
  const sequenceEvents = deriveSequenceEvents(snapshots);

  for (const event of sequenceEvents) {
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
