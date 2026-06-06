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
