function noteFrequency(midicents) {
  const pitch = Number(midicents);
  if (!Number.isFinite(pitch)) return null;
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function sortSnapshotNotes(notes = []) {
  return [...notes].sort((a, b) => Number(b?.midicents) - Number(a?.midicents));
}

function formatMidicents(value) {
  const pitch = Number(value);
  if (!Number.isFinite(pitch)) return "";
  return pitch.toFixed(3);
}

function formatFrequency(value) {
  const frequency = noteFrequency(value);
  if (!Number.isFinite(frequency)) return "";
  return frequency >= 100 ? frequency.toFixed(2) : frequency.toFixed(3);
}

export const SNAPSHOT_LABEL_MODES = [
  { value: "labels", label: "Note Names" },
  { value: "frequency", label: "Frequencies (Hz)" },
  { value: "midicents", label: "MIDIcents" },
];

export function buildSnapshotDescription(notes = [], mode = "labels") {
  const sorted = sortSnapshotNotes(notes);
  if (sorted.length === 0) return "";

  if (mode === "midicents") {
    return sorted.map((note) => formatMidicents(note.midicents)).filter(Boolean).join(", ");
  }

  if (mode === "frequency") {
    return sorted.map((note) => formatFrequency(note.midicents)).filter(Boolean).join(", ");
  }

  const labels = sorted.map((note) => String(note?.displayLabel ?? "").trim()).filter(Boolean);
  if (labels.length > 0) return labels.join(", ");
  return sorted.map((note) => formatFrequency(note.midicents)).filter(Boolean).join(", ");
}
