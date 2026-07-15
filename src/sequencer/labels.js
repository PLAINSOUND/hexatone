// This module owns human-readable snapshot labels for the sequencer.
// It formats proportions, odd-partial reductions, cents, frequencies, and
// note-name derived descriptions from the stored snapshot note data.

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
  return cents.toFixed(1);
}

function formatFrequency(value) {
  const frequency = noteFrequency(value);
  if (!Number.isFinite(frequency)) return "";
  return `${frequency >= 100 ? frequency.toFixed(2) : frequency.toFixed(3)}`;
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

function compareRatios(left, right) {
  const scaledLeft = left.numerator * right.denominator;
  const scaledRight = right.numerator * left.denominator;
  if (scaledLeft < scaledRight) return -1;
  if (scaledLeft > scaledRight) return 1;
  return 0;
}

function liftRatioByOctaves(ratio, minimum) {
  if (!ratio || !minimum) return ratio;
  let current = ratio;
  while (compareRatios(current, minimum) <= 0) {
    current = {
      numerator: current.numerator * 2n,
      denominator: current.denominator,
    };
  }
  return current;
}

function buildVoicedRatios(notes = []) {
  if (!Array.isArray(notes) || notes.length === 0) return [];
  const ratios = [];
  let previousRatio = null;
  for (const note of sortSnapshotNotes(notes)) {
    const ratio = parsePositiveRatioText(note?.ratioText);
    if (!ratio) return [];
    const voicedRatio = previousRatio
      ? liftRatioByOctaves(ratio, previousRatio)
      : ratio;
    ratios.push(voicedRatio);
    previousRatio = voicedRatio;
  }

  return ratios;
}

function ratiosToIntegerProportion(ratios = [], { sort = false } = {}) {
  if (!Array.isArray(ratios) || ratios.length === 0) return "";
  if (ratios.some((ratio) => ratio == null)) return "";

  let integers = ratios.map((ratio) => ratio);
  if (sort) {
    integers = [...integers].sort(compareRatios);
  }

  const commonDenominator = integers.reduce(
    (current, ratio) => lcm(current, ratio.denominator),
    1n,
  );
  const scaledIntegers = integers.map((ratio) => ratio.numerator * (commonDenominator / ratio.denominator));
  const commonFactor = scaledIntegers.reduce((current, value) => gcd(current, value));
  const normalized = scaledIntegers
    .map((value) => value / commonFactor)
    .map((value) => value.toString());
  const unique = normalized.filter((value, index) => normalized.indexOf(value) === index);
  return unique.join(":");
}

function reduceRatioToOddPartial(ratio) {
  let numerator = ratio.numerator;
  while (numerator % 2n === 0n && numerator > 0n) {
    numerator /= 2n;
  }
  return {
    numerator,
    denominator: 1n,
  };
}

export function buildChordProportion(notes = []) {
  const ratios = buildVoicedRatios(notes);
  return ratiosToIntegerProportion(ratios);
}

export function buildOddPartialProportion(notes = []) {
  if (!Array.isArray(notes) || notes.length === 0) return "";
  const oddRatios = buildVoicedRatios(notes).map(reduceRatioToOddPartial);
  return ratiosToIntegerProportion(oddRatios, { sort: true });
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
  { value: "interval_cents", label: "Chord Intervals from Lowest Note (¢)" },
  { value: "proportion", label: "Chord Proportion" },
  { value: "odd_proportion", label: "Odd Partial Proportion" },
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

  if (mode === "odd_proportion") {
    const proportion = buildOddPartialProportion(sorted);
    if (proportion) return proportion;
    const intervals = buildChordIntervals(sorted);
    if (intervals) return intervals;
  }

  const labels = sorted.map((note) => String(note?.displayLabel ?? "").trim()).filter(Boolean);
  if (labels.length > 0) return labels.join(", ");
  return sorted.map((note) => formatFrequency(note.midicents)).filter(Boolean).join(", ");
}
