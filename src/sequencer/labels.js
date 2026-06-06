import { gcd, lcm } from "xen-dev-utils";

function noteFrequency(midicents) {
  const pitch = Number(midicents);
  if (!Number.isFinite(pitch)) return null;
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function sortSnapshotNotes(notes = []) {
  return [...notes].sort((a, b) => Number(a?.midicents) - Number(b?.midicents));
}

function formatMidicents(value) {
  const pitch = Number(value);
  if (!Number.isFinite(pitch)) return "";
  return pitch.toFixed(3);
}

function formatIntervalCents(value) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return "";
  return `${cents.toFixed(3)}¢`;
}

function formatFrequency(value) {
  const frequency = noteFrequency(value);
  if (!Number.isFinite(frequency)) return "";
  return `${frequency >= 100 ? frequency.toFixed(2) : frequency.toFixed(3)} Hz`;
}

function parsePositiveRatioText(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d+)(?:\s*\/\s*(\d+))?$/);
  if (!match) return null;
  const numerator = BigInt(match[1]);
  const denominator = BigInt(match[2] ?? "1");
  if (numerator <= 0n || denominator <= 0n) return null;
  const divisor = gcd(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

export function buildChordProportion(notes = []) {
  if (!Array.isArray(notes) || notes.length === 0) return "";
  const ratios = sortSnapshotNotes(notes).map((note) => parsePositiveRatioText(note?.ratioText));
  if (ratios.some((ratio) => ratio == null)) return "";

  const commonDenominator = ratios.reduce(
    (current, ratio) => lcm(current, ratio.denominator),
    1n,
  );
  const integers = ratios.map((ratio) => ratio.numerator * (commonDenominator / ratio.denominator));
  const commonFactor = integers.reduce((current, value) => gcd(current, value));
  return integers
    .map((value) => value / commonFactor)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((value) => value.toString())
    .join(":");
}

function buildChordIntervals(notes = []) {
  const sorted = sortSnapshotNotes(notes);
  const lowest = Number(sorted[0]?.midicents);
  if (!Number.isFinite(lowest)) return "";
  return sorted
    .map((note) => formatIntervalCents((Number(note.midicents) - lowest) * 100))
    .slice(1)
    .filter(Boolean)
    .join(", ");
}

export const SNAPSHOT_LABEL_MODES = [
  { value: "labels", label: "Note Names" },
  { value: "frequency", label: "Frequencies (Hz)" },
  { value: "midicents", label: "MIDIcents" },
  { value: "interval_cents", label: "Chord Intervals (¢)" },
  { value: "proportion", label: "Chord Proportion" },
];

export function buildSnapshotDescription(notes = [], mode = "labels") {
  const sorted = sortSnapshotNotes(notes);
  if (sorted.length === 0) return "";

  if (mode === "midicents") {
    return sorted.map((note) => formatMidicents(note.midicents)).filter(Boolean).join(", ");
  }

  if (mode === "interval_cents") {
    return buildChordIntervals(sorted);
  }

  if (mode === "frequency") {
    return sorted.map((note) => formatFrequency(note.midicents)).filter(Boolean).join(", ");
  }

  if (mode === "proportion") {
    const proportion = buildChordProportion(sorted);
    if (proportion) return proportion;
    const intervals = buildChordIntervals(sorted);
    if (intervals) return intervals;
  }

  const labels = sorted.map((note) => String(note?.displayLabel ?? "").trim()).filter(Boolean);
  if (labels.length > 0) return labels.join(", ");
  return sorted.map((note) => formatFrequency(note.midicents)).filter(Boolean).join(", ");
}
