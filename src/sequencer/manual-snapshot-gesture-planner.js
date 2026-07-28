// Pure formation planning for manually triggered snapshot arpeggios.
// It preserves event-list order for tied positions and keeps the final attack
// at the requested total spread after timing variation.

function finiteStart(note) {
  const start = Number(note?.start);
  return Number.isFinite(start) ? start : 0;
}

function variedDuration(centerMs, variation, random) {
  if (centerMs <= 0 || variation <= 0) return centerMs;
  const randomValue = Math.min(1, Math.max(0, Number(random()) || 0));
  const maximumFactor = 1 + variation;
  return centerMs * Math.exp((randomValue * 2 - 1) * Math.log(maximumFactor));
}

function variedOffsets(baseOffsets, spreadMs, variation, random) {
  if (baseOffsets.length <= 1 || spreadMs <= 0 || variation <= 0) return baseOffsets;
  const gaps = baseOffsets.slice(1).map((offset, index) => (
    Math.max(0, offset - baseOffsets[index])
  ));
  const variedGaps = gaps.map((gap) => {
    if (gap <= 0) return 0;
    const randomValue = Math.min(1, Math.max(0, Number(random()) || 0));
    return gap * Math.max(0.001, 1 + ((randomValue * 2 - 1) * variation));
  });
  const total = variedGaps.reduce((sum, gap) => sum + gap, 0);
  if (total <= 0) return baseOffsets;

  let elapsed = 0;
  return [
    0,
    ...variedGaps.map((gap) => {
      elapsed += gap;
      return elapsed * spreadMs / total;
    }),
  ];
}

export function planManualSnapshotFormation(notes, settings = {}, random = Math.random) {
  const source = Array.isArray(notes) ? notes : [];
  const centerSpreadMs = Math.max(0, Number(settings.initialSpreadMs) || 0);
  const spreadVariation = Math.min(
    1,
    Math.max(0, Number(settings.spreadVariation) || 0),
  );
  const variation = Math.min(1, Math.max(0, Number(settings.timingVariation) || 0));
  const ordered = source
    .map((note, index) => ({ note, index, start: finiteStart(note) }))
    .sort((a, b) => a.start - b.start || a.index - b.index);

  if (ordered.length === 0) return { durationMs: 0, events: [] };
  if (ordered.length === 1) {
    const decayMs = Math.max(0, Number(settings.decayMs) || 0);
    const decayVariation = Math.min(
      1,
      Math.max(0, Number(settings.decayVariation) || 0),
    );
    const attack = {
      type: "attack",
      eventId: `note-${ordered[0].index}`,
      offsetMs: 0,
      note: ordered[0].note,
      noteId: ordered[0].note?.id ?? null,
    };
    const releaseOffsetMs = variedDuration(decayMs, decayVariation, random);
    return {
      durationMs: releaseOffsetMs,
      events: decayMs > 0
        ? [attack, { ...attack, type: "release", offsetMs: releaseOffsetMs }]
        : [attack],
    };
  }

  const spreadMs = variedDuration(centerSpreadMs, spreadVariation, random);
  const minStart = ordered[0].start;
  const maxStart = ordered.at(-1).start;
  const hasDistinctStarts = maxStart > minStart;
  const baseOffsets = ordered.map((entry, index) => (
    hasDistinctStarts
      ? ((entry.start - minStart) / (maxStart - minStart)) * spreadMs
      : (index / (ordered.length - 1)) * spreadMs
  ));
  const offsets = variedOffsets(baseOffsets, spreadMs, variation, random);

  const attackEvents = ordered.map((entry, index) => ({
      type: "attack",
      eventId: `note-${entry.index}`,
      offsetMs: offsets[index],
      note: entry.note,
      noteId: entry.note?.id ?? null,
    }));
  const decayMs = Math.max(0, Number(settings.decayMs) || 0);
  const decayVariation = Math.min(
    1,
    Math.max(0, Number(settings.decayVariation) || 0),
  );
  const releaseEvents = decayMs <= 0
    ? []
    : attackEvents.map((attack) => ({
      type: "release",
      eventId: attack.eventId,
      offsetMs: attack.offsetMs + variedDuration(decayMs, decayVariation, random),
      note: attack.note,
      noteId: attack.noteId,
    }));
  const events = [...attackEvents, ...releaseEvents].sort((a, b) => (
    a.offsetMs - b.offsetMs
    || (a.type === b.type ? 0 : (a.type === "attack" ? -1 : 1))
  ));

  return {
    durationMs: events.at(-1)?.offsetMs ?? spreadMs,
    events,
  };
}
