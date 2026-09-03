// Sequence pitch frames make an editable HEJI name unambiguous. Exported
// sequences deduplicate these records; open workspaces also keep the resolved
// frame on each snapshot so that moves and copies remain self-contained.

import { parseHejiToStructure } from "../notation/pitch-structure.js";
import { canonicalHejiAnchorLabelInput } from "../notation/heji-normalization.js";
import {
  calculatorIntervalFromPitchStructure,
  midiPitchFromFrequency,
  parseCalculatorInterval,
} from "../calculator/runtime.js";
import { ratioToMonzoParts } from "../tuning/interval.js";
import { BASE_BY_ID, HEJI_FAMILIES } from "../notation/heji.js";

const DEFAULT_REFERENCE_FREQUENCY = 440;
const DEFAULT_REFERENCE_LABEL = "A4";

function normalizedInterval(value, fallback = "1/1") {
  const parsed = parseCalculatorInterval(value);
  return parsed.valid ? parsed.normalized : fallback;
}

export function normalizeSequencePitchFrame(frame, fallbackId = "frame-1") {
  if (!frame || typeof frame !== "object") return null;
  const referenceFrequency = Number(frame.referenceFrequency);
  const hejiAnchorLabel = canonicalHejiAnchorLabelInput(
    frame.hejiAnchorLabel ?? frame.anchorLabel ?? "*nA",
  );
  if (!Number.isFinite(referenceFrequency) || referenceFrequency <= 0 || !hejiAnchorLabel) {
    return null;
  }
  return {
    id: String(frame.id ?? fallbackId).trim() || fallbackId,
    referenceLabel:
      String(frame.referenceLabel ?? DEFAULT_REFERENCE_LABEL).trim() || DEFAULT_REFERENCE_LABEL,
    referenceFrequency,
    referenceInterval: normalizedInterval(
      frame.referenceInterval ?? frame.referenceRatioCents ?? "1/1",
    ),
    hejiAnchorLabel,
    hejiAnchorInterval: normalizedInterval(
      frame.hejiAnchorInterval ?? frame.anchorInterval ?? frame.anchorRatioText ?? "1/1",
    ),
  };
}

export function sequencePitchFrameKey(frame) {
  const normalized = normalizeSequencePitchFrame(frame);
  if (!normalized) return "";
  return JSON.stringify([
    normalized.referenceLabel,
    normalized.referenceFrequency,
    normalized.referenceInterval,
    normalized.hejiAnchorLabel,
    normalized.hejiAnchorInterval,
  ]);
}

export function formatSequencePitchFrameCompact(frame) {
  const normalized = normalizeSequencePitchFrame(frame);
  if (!normalized) return "";
  return `Reference ${normalized.referenceLabel} = ${Number(normalized.referenceFrequency).toLocaleString(undefined, { maximumFractionDigits: 6 })} Hz = ${normalized.referenceInterval} | HEJI Anchor ${normalized.hejiAnchorLabel} (0¢)`;
}

export function buildSequencePitchFrameRegistry(snapshots = [], existingFrames = []) {
  const knownById = new Map();
  for (const [index, frame] of (existingFrames ?? []).entries()) {
    const normalized = normalizeSequencePitchFrame(frame, `frame-${index + 1}`);
    if (normalized) knownById.set(normalized.id, normalized);
  }
  const frames = [];
  const idByKey = new Map();
  const canonicalSnapshots = (snapshots ?? []).map((snapshot) => {
    const embedded = normalizeSequencePitchFrame(snapshot?.pitchFrame, snapshot?.pitchFrameId);
    const resolved = embedded ?? knownById.get(String(snapshot?.pitchFrameId ?? "")) ?? null;
    if (!resolved) {
      const { pitchFrame: _pitchFrame, ...rest } = snapshot;
      return rest;
    }
    const key = sequencePitchFrameKey(resolved);
    let id = idByKey.get(key);
    if (!id) {
      const requestedId = String(resolved.id ?? "").trim();
      id =
        requestedId && !frames.some((frame) => frame.id === requestedId)
          ? requestedId
          : `frame-${frames.length + 1}`;
      frames.push({ ...resolved, id });
      idByKey.set(key, id);
    }
    const { pitchFrame: _pitchFrame, ...rest } = snapshot;
    return { ...rest, pitchFrameId: id };
  });
  return { pitchFrames: frames, snapshots: canonicalSnapshots };
}

export function hydrateSequencePitchFrames(snapshots = [], pitchFrames = []) {
  const byId = new Map(
    (pitchFrames ?? [])
      .map((frame, index) => normalizeSequencePitchFrame(frame, `frame-${index + 1}`))
      .filter(Boolean)
      .map((frame) => [frame.id, frame]),
  );
  return (snapshots ?? []).map((snapshot) => {
    const frame =
      normalizeSequencePitchFrame(snapshot?.pitchFrame, snapshot?.pitchFrameId) ??
      byId.get(String(snapshot?.pitchFrameId ?? ""));
    return frame ? { ...snapshot, pitchFrameId: frame.id, pitchFrame: frame } : snapshot;
  });
}

export function captureSequencePitchFrame(runtime) {
  if (!runtime) return null;
  const settings = runtime?.settings ?? {};
  const referenceFrequency = Number(settings.fundamental) || DEFAULT_REFERENCE_FREQUENCY;
  const referenceDegree = Math.max(0, Number.parseInt(settings.reference_degree, 10) || 0);
  const referenceInterval =
    referenceDegree === 0 ? "1/1" : String(settings.scale?.[referenceDegree - 1] ?? "1/1");
  const referenceLabel =
    midiPitchFromFrequency(referenceFrequency)?.noteName ?? DEFAULT_REFERENCE_LABEL;
  return normalizeSequencePitchFrame({
    id: "frame-1",
    referenceLabel,
    referenceFrequency,
    referenceInterval,
    hejiAnchorLabel: settings.heji_anchor_label_effective ?? settings.heji_anchor_label ?? "*nA",
    hejiAnchorInterval: settings.heji_anchor_ratio_effective ?? settings.heji_anchor_ratio ?? "1/1",
  });
}

function expandSequenceLigaturePrefix(value) {
  const source = String(value ?? "")
    .replace(/^\*ft/iu, "")
    .replace(/^\*nt/iu, "")
    .replace(/^\*st/iu, "");
  const ligatureMatch = source.match(/^\*(ff|ss|f|n|s)((?:[ou]\d+)*)/iu);
  if (!ligatureMatch) return source;
  const chromatic = {
    f: "flat",
    n: "natural",
    s: "sharp",
    ff: "doubleflat",
    ss: "doublesharp",
  }[ligatureMatch[1].toLowerCase()];
  const primeExponents = new Map();
  for (const modifier of ligatureMatch[2].matchAll(/([ou])(\d+)/giu)) {
    let product = Number(modifier[2]);
    const amount = modifier[1].toLowerCase() === "o" ? -1 : 1;
    if (!Number.isSafeInteger(product) || product < 1 || product % 2 === 0) return source;
    for (const prime of [5, ...HEJI_FAMILIES.map((family) => family.prime)]) {
      while (product % prime === 0) {
        primeExponents.set(prime, (primeExponents.get(prime) ?? 0) + amount);
        product /= prime;
      }
    }
    if (product !== 1) return source;
  }
  const syntonic = primeExponents.get(5) ?? 0;
  primeExponents.delete(5);
  const clampedSyntonic = Math.max(-3, Math.min(3, syntonic));
  const baseGlyph = BASE_BY_ID[`${chromatic}:${clampedSyntonic}`]?.glyph;
  if (!baseGlyph) return source;
  const syntonicSpill =
    Math.abs(syntonic) > 3
      ? (BASE_BY_ID[`natural:${syntonic < 0 ? -1 : 1}`]?.glyph ?? "").repeat(Math.abs(syntonic) - 3)
      : "";
  const extras = [...primeExponents.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([prime, exponent]) => {
      const family = HEJI_FAMILIES.find((candidate) => candidate.prime === prime);
      const glyph = exponent < 0 ? family?.lower?.glyph : family?.upper?.glyph;
      return glyph?.repeat(Math.abs(exponent)) ?? "";
    })
    .join("");
  return `${extras}${baseGlyph}${syntonicSpill}${source.slice(ligatureMatch[0].length)}`;
}

function normalizeGermanNoteLetter(value) {
  const source = String(value ?? "");
  if (/^[Hh]/u.test(source)) return `B${source.slice(1)}`;
  return source.replace(/[Hh]$/u, "B");
}

export function splitOctaveHejiName(value, { fallbackOctave = null, fallbackName = null } = {}) {
  const source = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\*-/g, "−");
  if (/^-?\d+$/u.test(source) && fallbackName != null) {
    const fallback = splitOctaveHejiName(fallbackName);
    const octave = Number(source);
    return fallback && Number.isInteger(octave) ? { ...fallback, octave } : null;
  }
  const deviationMatch = source.match(/([+\-−]\d+(?:\.\d+)?)¢?$/u);
  const deviationText = deviationMatch?.[1] ?? "";
  const withoutDeviation = deviationMatch ? source.slice(0, deviationMatch.index) : source;
  const octaveMatch = withoutDeviation.match(/(-?\d+)$/);
  const octave = octaveMatch
    ? Number(octaveMatch[1])
    : fallbackOctave == null
      ? Number.NaN
      : Number(fallbackOctave);
  const pitchClassSource = octaveMatch
    ? withoutDeviation.slice(0, octaveMatch.index)
    : withoutDeviation;
  const spellingSource = expandSequenceLigaturePrefix(normalizeGermanNoteLetter(pitchClassSource));
  const spelling = canonicalHejiAnchorLabelInput(spellingSource);
  const deviationCents = deviationText ? Number(deviationText.replace("−", "-")) : 0;
  if (!spelling || !Number.isInteger(octave) || !Number.isFinite(deviationCents)) return null;
  const tempered = /[\uE2F1-\uE2F3]/u.test(spelling);
  if (!tempered && Math.abs(deviationCents) > 1e-9) return null;
  return {
    spelling,
    octave,
    deviationCents,
    hasDeviation: tempered || Boolean(deviationMatch),
    tempered,
  };
}

export function normalizeSequenceHejiName(value, options = {}) {
  const parsed = splitOctaveHejiName(value, options);
  if (!parsed) return null;
  const suffix = parsed.hasDeviation
    ? `${parsed.deviationCents < 0 ? "−" : "+"}${Math.abs(parsed.deviationCents)}`
    : "";
  return `${parsed.spelling}${parsed.octave}${suffix}`;
}

export function resolveSequenceHejiName(value, frame, options = {}) {
  const parsedName = splitOctaveHejiName(value, options);
  const normalizedFrame = normalizeSequencePitchFrame(frame);
  if (!parsedName || !normalizedFrame) return null;
  const structure = parseHejiToStructure(parsedName.spelling);
  const resolved = calculatorIntervalFromPitchStructure({
    structure,
    anchorLabel: normalizedFrame.hejiAnchorLabel,
    anchorInterval: normalizedFrame.hejiAnchorInterval,
    deviationCents: parsedName.deviationCents,
    octave: parsedName.octave,
  });
  const noteInterval = parseCalculatorInterval(resolved?.interval);
  const referenceInterval = parseCalculatorInterval(normalizedFrame.referenceInterval);
  if (!resolved?.valid || !noteInterval.valid || !referenceInterval.valid) return null;
  const frequency =
    normalizedFrame.referenceFrequency *
    Math.pow(2, (noteInterval.cents - referenceInterval.cents) / 1200);
  const midicents = 69 + 12 * Math.log2(frequency / 440);
  const canonicalName = normalizeSequenceHejiName(value, options);
  if (!resolved.exact)
    return { midicents, displayLabel: parsedName.spelling, hejiName: canonicalName };
  const ratio = parseCalculatorInterval(resolved.interval).ratio;
  const { monzo, residual } = ratioToMonzoParts(ratio);
  const rawRatioText = ratio.toFraction();
  const ratioText = rawRatioText.includes("/") ? rawRatioText : `${rawRatioText}/1`;
  return residual
    ? { midicents, displayLabel: parsedName.spelling, hejiName: canonicalName, ratioText }
    : { midicents, displayLabel: parsedName.spelling, hejiName: canonicalName, ratioText, monzo };
}

export function inferSequenceHejiName(note, frame) {
  const label = canonicalHejiAnchorLabelInput(note?.displayLabel ?? "");
  if (!label || !Number.isFinite(Number(note?.midicents))) return null;
  let best = null;
  for (let octave = -1; octave <= 10; octave += 1) {
    const resolved = resolveSequenceHejiName(`${label}${octave}+0`, frame);
    const error = resolved ? Math.abs(resolved.midicents - Number(note.midicents)) : Infinity;
    if (!best || error < best.error) best = { name: `${label}${octave}`, error };
  }
  return best?.error <= 0.001 ? best.name : null;
}
