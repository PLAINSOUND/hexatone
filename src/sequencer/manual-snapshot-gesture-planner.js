// Pure formation planning for manually triggered snapshot arpeggios.
// Tied positions rise by pitch (then preserve source order for exact ties), and
// the final attack remains at the requested total spread after variation.

function finiteStart(note) {
  const start = Number(note?.start);
  return Number.isFinite(start) ? start : 0;
}

function finitePitch(note) {
  const pitch = Number(note?.midicents);
  return Number.isFinite(pitch) ? pitch : null;
}

const MAX_TIMING_CURVATURE = 0.8;

function variedDuration(centerMs, variation, random) {
  if (centerMs <= 0 || variation <= 0) return centerMs;
  const randomValue = Math.min(1, Math.max(0, Number(random()) || 0));
  const maximumFactor = 1 + variation;
  // Use a logarithmically balanced multiplicative range rather than ordinary
  // ± percentage: variation .333 spans center/1.333 through center*1.333.
  return centerMs * Math.exp((randomValue * 2 - 1) * Math.log(maximumFactor));
}

function variedOffsets(baseOffsets, spreadMs, variation, random) {
  if (baseOffsets.length <= 1 || spreadMs <= 0 || variation <= 0) return baseOffsets;
  const randomUnit = () => Math.min(1, Math.max(0, Number(random()) || 0));
  // A triangular distribution favours gentle arcs while still allowing the
  // occasional strongly front- or back-weighted gesture.
  const curvature = (randomUnit() + randomUnit() - 1) * MAX_TIMING_CURVATURE;
  const finalIndex = baseOffsets.length - 1;
  const offsets = baseOffsets.map((sourceOffset, index) => {
    const rank = index / finalIndex;
    const curvedRank = rank + (curvature * rank * (1 - rank));
    const generatedOffset = curvedRank * spreadMs;
    return (sourceOffset * (1 - variation)) + (generatedOffset * variation);
  });
  offsets[offsets.length - 1] = spreadMs;
  return offsets;
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
    .map((note, index) => ({
      note,
      index,
      start: finiteStart(note),
      pitch: finitePitch(note),
    }))
    .sort((a, b) => (
      a.start - b.start
      || (
        a.pitch == null || b.pitch == null
          ? a.index - b.index
          : a.pitch - b.pitch || a.index - b.index
      )
    ));

  if (ordered.length === 0) return { durationMs: 0, events: [] };
  if (ordered.length === 1) {
    const attack = {
      type: "attack",
      eventId: `note-${ordered[0].index}`,
      offsetMs: 0,
      note: ordered[0].note,
      noteId: ordered[0].note?.id ?? null,
    };
    return {
      durationMs: 0,
      events: [attack],
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
  return {
    durationMs: attackEvents.at(-1)?.offsetMs ?? spreadMs,
    events: attackEvents,
  };
}

export function planManualSnapshotRelease(attackEvents, settings = {}, random = Math.random) {
  const source = (Array.isArray(attackEvents) ? attackEvents : [])
    .filter((event) => event?.type !== "release");
  const decayMode = settings.decayMode === "immediate"
    ? "immediate"
    : (settings.decayMode === "sustain" ? "sustain" : "timed");
  if (source.length === 0 || decayMode === "sustain") {
    return { durationMs: 0, events: [] };
  }

  const decayMs = decayMode === "immediate"
    ? 0
    : Math.max(0, Number(settings.decayMs) || 0);
  const decayVariation = decayMode === "timed"
    ? Math.min(1, Math.max(0, Number(settings.decayVariation) || 0))
    : 0;
  const events = source.map((attack) => ({
    ...attack,
    type: "release",
    offsetMs: variedDuration(decayMs, decayVariation, random),
  })).sort((a, b) => a.offsetMs - b.offsetMs);

  return {
    durationMs: events.at(-1)?.offsetMs ?? 0,
    events,
  };
}
