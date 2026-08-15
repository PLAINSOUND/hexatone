export const SEQUENCE_LEGATO_MODES = [
  { value: "off", label: "Off" },
  { value: "per-note", label: "Per Note" },
  { value: "all-common-tones", label: "All Common Tones" },
];

export function normalizeSequenceLegatoMode(value, { legacyTrue = false } = {}) {
  if (value === false || value === "off") return "off";
  if (value === "all-common-tones") return "all-common-tones";
  if (value === true && legacyTrue) return "all-common-tones";
  return "per-note";
}

export function sequenceNoteSlot(note, fallbackIndex = 0) {
  const stored = Number(note?.sequenceSlot);
  return Number.isInteger(stored) && stored >= 0 ? stored : fallbackIndex;
}

export function sequencePitchesMatch(left, right, tolerance = 1e-7) {
  const leftPitch = Number(left?.midicents);
  const rightPitch = Number(right?.midicents);
  return (
    Number.isFinite(leftPitch) &&
    Number.isFinite(rightPitch) &&
    Math.abs(leftPitch - rightPitch) <= tolerance
  );
}

export function deriveSequenceLegatoFlags({ note, noteIndex, previousSnapshot, attackTime, mode }) {
  const normalizedMode = normalizeSequenceLegatoMode(mode);
  const slot = sequenceNoteSlot(note, noteIndex);
  const previousNotes = Array.isArray(previousSnapshot?.notes) ? previousSnapshot.notes : [];
  const touchesAttack = (candidate) => {
    const previousLength = Number.isFinite(Number(previousSnapshot?.length))
      ? Number(previousSnapshot.length)
      : 1;
    const previousEnd = Number.isFinite(Number(candidate?.end))
      ? Number(candidate.end)
      : previousLength;
    return Math.abs(previousEnd - (1 + Number(attackTime))) <= 1e-7;
  };
  const perNoteLegatoCandidate = previousNotes.some(
    (candidate, candidateIndex) =>
      sequenceNoteSlot(candidate, candidateIndex) === slot &&
      sequencePitchesMatch(candidate, note) &&
      touchesAttack(candidate),
  );
  const commonToneLegatoCandidate = previousNotes.some(
    (candidate) => sequencePitchesMatch(candidate, note) && touchesAttack(candidate),
  );
  const forceReattack = note?.forceReattack === true;
  const legatoContinuation =
    normalizedMode === "all-common-tones"
      ? commonToneLegatoCandidate
      : normalizedMode === "per-note" && perNoteLegatoCandidate && !forceReattack;

  return {
    sequenceSlot: slot,
    forceReattack,
    perNoteLegatoCandidate,
    commonToneLegatoCandidate,
    legatoContinuation,
  };
}
