// Snapshot expression has one source of truth: expression.{pressure,timbre}
// are normalized floats, independent of controller resolution and backend.
// Legacy 7/14-bit fields are accepted only at migration/playback boundaries.
export const MIDI_EXPRESSION_14_MAX = 127 * 128;

export function clampExpression(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0;
}

export function expressionToMidi(value, maximum = 127) {
  return Math.round(clampExpression(value) * maximum);
}

function legacyExpression(value, fine) {
  // Zero alongside positive 7-bit data was a legacy placeholder, not detail.
  if (fine != null && Number.isFinite(Number(fine)) && !(Number(fine) === 0 && Number(value) > 0))
    return clampExpression(Number(fine) / MIDI_EXPRESSION_14_MAX);
  return clampExpression(Number(value) / 127);
}

export function readSnapshotExpression(note) {
  if (note?.expression) return {
    pressure: clampExpression(note.expression.pressure),
    timbre: clampExpression(note.expression.timbre),
  };
  return {
    pressure: legacyExpression(note?.pressure, note?.pressure14),
    timbre: legacyExpression(note?.timbre, note?.timbre14),
  };
}

export function normalizeNoteExpression(note) {
  if (!note || !["expression", "pressure", "pressure14", "timbre", "timbre14"].some(key => key in note)) return note;
  const { pressure: _pressure, pressure14: _pressure14, timbre: _timbre,
    timbre14: _timbre14, ...rest } = note;
  return { ...rest, expression: readSnapshotExpression(note) };
}

export function normalizeSnapshotExpression(snapshot) {
  if (!Array.isArray(snapshot?.notes)) return snapshot;
  return { ...snapshot, notes: snapshot.notes.map(normalizeNoteExpression) };
}

// Temporary MIDI projections belong to adapters, never saved snapshots. Keep
// legacy caller signatures intact; canonical notes quantize here, not at capture.
export function snapshotMidiExpression(note) {
  if (!note?.expression) return note;
  const { pressure, timbre } = readSnapshotExpression(note);
  return { ...note, pressure: expressionToMidi(pressure),
    pressure14: expressionToMidi(pressure, MIDI_EXPRESSION_14_MAX),
    timbre: expressionToMidi(timbre),
    timbre14: expressionToMidi(timbre, MIDI_EXPRESSION_14_MAX) };
}

// Derived event rows retain legacy fields for old callers, but modern events
// carry only normalized expression. UI display and backend conversion are separate.
export function snapshotExpressionFields(note) {
  if (note?.expression) return { expression: readSnapshotExpression(note) };
  return { pressure: note?.pressure ?? 0, pressure14: note?.pressure14 ?? null,
    timbre: note?.timbre ?? 0, timbre14: note?.timbre14 ?? null };
}
