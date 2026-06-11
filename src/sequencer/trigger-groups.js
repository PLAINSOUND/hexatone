function eventTypePriority(kind) {
  return kind === "attack" ? 0 : 1;
}

function sequenceRowPriority(type, kind) {
  if (type === "bar") return 0;
  return kind === "attack" ? 1 : 2;
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

function pitchKeyFromMidicents(midicents) {
  const pitch = Number(midicents);
  if (!Number.isFinite(pitch)) return null;
  return pitch.toFixed(3);
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

export function deriveSequenceEvents(snapshots, bars = []) {
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
  const normalizedBars = Array.isArray(bars) ? bars : [];
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

  events.sort((a, b) => (
    a.absoluteTime - b.absoluteTime ||
    sequenceRowPriority(a.type, a.kind) - sequenceRowPriority(b.type, b.kind) ||
    ((b.midicents ?? -Infinity) - (a.midicents ?? -Infinity)) ||
    ((a.barOrder ?? 0) - (b.barOrder ?? 0))
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

export function deriveSequenceCueGroups(snapshots, bars = []) {
  const groups = [];
  const sequenceEvents = deriveSequenceEvents(snapshots, bars).filter((event) => event.type === "note");

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

export function sequenceNotesAtCueIndex(snapshots, cueIndex) {
  const groups = deriveSequenceCueGroups(snapshots);
  const index = Number(cueIndex);
  if (!Number.isFinite(index) || index < 0 || index >= groups.length) return [];

  const activeByPitch = new Map();

  for (let i = 0; i <= index; i += 1) {
    const group = groups[i];
    const attackedThisCue = new Map();
    const releasedThisCue = new Set();

    for (const event of group.events) {
      const pitchKey = pitchKeyFromMidicents(event.midicents);
      if (!pitchKey) continue;
      if (event.kind === "attack") {
        attackedThisCue.set(pitchKey, {
          midicents: event.midicents,
          frequency: event.frequency,
          attackVelocity: event.attackVelocity,
          releaseVelocity: event.releaseVelocity,
          pressure: event.pressure,
          pressure14: event.pressure14,
          timbre: event.timbre,
          timbre14: event.timbre14,
        });
      } else if (!attackedThisCue.has(pitchKey)) {
        releasedThisCue.add(pitchKey);
      }
    }

    for (const [pitchKey, note] of attackedThisCue.entries()) {
      activeByPitch.set(pitchKey, note);
    }
    for (const pitchKey of releasedThisCue) {
      activeByPitch.delete(pitchKey);
    }
  }

  return [...activeByPitch.values()].sort((a, b) => (
    Number(b.midicents) - Number(a.midicents)
  ));
}
