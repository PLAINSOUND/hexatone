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

export function deriveSnapshotTriggerGroups(snapshot) {
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  const events = [];

  for (const note of snapshot?.notes ?? []) {
    const midicents = Number(note?.midicents);
    if (!Number.isFinite(midicents)) continue;
    const { start, end } = normalizeNoteSpan(note, length);
    const frequency = noteFrequency(midicents);

    events.push({
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

export function deriveSequenceCueGroups(snapshots) {
  const groups = [];

  for (const [snapshotIndex, snapshot] of (snapshots ?? []).entries()) {
    const baseTime = snapshotBaseTime(snapshotIndex);
    const snapshotGroups = deriveSnapshotTriggerGroups(snapshot);

    for (const group of snapshotGroups) {
      const absoluteTime = normalizeTimeValue(baseTime + Number(group.time));
      const previous = groups.at(-1);
      const events = group.events.map((event) => ({
        ...event,
        snapshotId: snapshot?.id ?? null,
        snapshotIndex,
        relativeTime: event.time,
        time: absoluteTime,
      }));

      if (!previous || previous.time !== absoluteTime) {
        groups.push({ time: absoluteTime, events });
        continue;
      }
      previous.events.push(...events);
    }
  }

  for (const group of groups) {
    group.events.sort((a, b) => (
      eventTypePriority(a.kind) - eventTypePriority(b.kind) ||
      b.midicents - a.midicents
    ));
    group.snapshotIndex = group.events.reduce(
      (maxIndex, event) => Math.max(maxIndex, event.snapshotIndex ?? -1),
      -1,
    );
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
