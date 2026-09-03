// Sequence pitch frames make an editable HEJI name unambiguous. Exported
// sequences deduplicate these records; open workspaces also keep the resolved
// frame on each snapshot so that moves and copies remain self-contained.

import { spelledHejiLabel } from "../notation/key-label.js";
import { parseHejiToStructure, pitchStructureToBaseId } from "../notation/pitch-structure.js";
import { createReferenceFrame } from "../notation/reference-frame.js";
import {
  canonicalHejiAnchorLabelInput,
  normalizeHejiPitchClassInput,
} from "../notation/heji-normalization.js";
import {
  calculatorIntervalFromPitchStructure,
  midiPitchFromFrequency,
  parseCalculatorInterval,
} from "../calculator/runtime.js";
import { ratioToMonzoParts } from "../tuning/interval.js";
import { BASE_BY_ID } from "../notation/heji.js";

const DEFAULT_REFERENCE_FREQUENCY = 440;
const DEFAULT_REFERENCE_LABEL = "A4";
const SCALA_PITCH_EPSILON_CENTS = 0.000001;
const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHROMATIC_SEMITONES = { doubleflat: -2, flat: -1, natural: 0, sharp: 1, doublesharp: 2 };

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
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const snapshotsWithScala = canonicalSnapshots.map((snapshot) => {
    const frame = frameById.get(snapshot.pitchFrameId);
    if (!frame) return snapshot;
    return {
      ...snapshot,
      notes: (snapshot.notes ?? []).map((note) =>
        note?.scalaInterval
          ? note
          : { ...note, scalaInterval: deriveSequenceScalaInterval(note, frame) },
      ),
    };
  });
  return { pitchFrames: frames, snapshots: snapshotsWithScala };
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
    if (!frame) return snapshot;
    return {
      ...snapshot,
      pitchFrameId: frame.id,
      pitchFrame: frame,
      notes: (snapshot.notes ?? []).map((note) =>
        note?.scalaInterval
          ? note
          : { ...note, scalaInterval: deriveSequenceScalaInterval(note, frame) },
      ),
    };
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
  const spelling = normalizeHejiPitchClassInput(pitchClassSource);
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

export function formatSequenceHejiNameForDisplay(value, options = {}) {
  const parsed = splitOctaveHejiName(value, options);
  if (!parsed) return null;
  if (!parsed.hasDeviation) return `${parsed.spelling}${parsed.octave}`;
  const roundedDeviation =
    Math.sign(parsed.deviationCents) * Math.round(Math.abs(parsed.deviationCents));
  const normalizedDeviation = Object.is(roundedDeviation, -0) ? 0 : roundedDeviation;
  return `${parsed.spelling}${parsed.octave}${normalizedDeviation < 0 ? "−" : "+"}${Math.abs(normalizedDeviation)}`;
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

function formatSequenceCents(value) {
  const cents = Math.abs(Number(value)) < SCALA_PITCH_EPSILON_CENTS ? 0 : Number(value);
  return cents.toFixed(6);
}

function sequenceMidicentsFromIntervalCents(intervalCents, frame) {
  const normalizedFrame = normalizeSequencePitchFrame(frame);
  const referenceInterval = parseCalculatorInterval(normalizedFrame?.referenceInterval);
  if (!normalizedFrame || !referenceInterval.valid || !Number.isFinite(Number(intervalCents))) {
    return null;
  }
  const frequency =
    normalizedFrame.referenceFrequency *
    Math.pow(2, (Number(intervalCents) - referenceInterval.cents) / 1200);
  return 69 + 12 * Math.log2(frequency / 440);
}

function sequenceStructureSemitone(structure) {
  const chromatic = BASE_BY_ID[pitchStructureToBaseId(structure)]?.chromatic ?? "natural";
  return LETTER_SEMITONES[structure?.letter] + (CHROMATIC_SEMITONES[chromatic] ?? 0);
}

function sequenceOctaveForSpelling(spelling, centsFromAnchor, anchorLabel) {
  const structure = parseHejiToStructure(spelling);
  const anchorStructure = parseHejiToStructure(anchorLabel);
  const semitone = sequenceStructureSemitone(structure);
  const anchorSemitone = sequenceStructureSemitone(anchorStructure);
  if (
    !Number.isFinite(semitone) ||
    !Number.isFinite(anchorSemitone) ||
    !Number.isFinite(centsFromAnchor)
  ) {
    return null;
  }
  const anchorAbsoluteSemitone = (4 + 1) * 12 + anchorSemitone;
  const octave = Math.round(
    (anchorAbsoluteSemitone + centsFromAnchor / 100 - (12 + semitone)) / 12,
  );
  const relativeTemperedCents = ((octave + 1) * 12 + semitone - anchorAbsoluteSemitone) * 100;
  return {
    octave,
    structure,
    relativeTemperedCents,
  };
}

function formatSequenceDeviation(value) {
  const normalized = Math.abs(Number(value)) < SCALA_PITCH_EPSILON_CENTS ? 0 : Number(value);
  const magnitude = Number(Math.abs(normalized).toFixed(6)).toString();
  return `${normalized < 0 ? "−" : "+"}${magnitude}`;
}

function sequenceHejiNameFromScalaInterval(resolved, frame) {
  const normalizedFrame = normalizeSequencePitchFrame(frame);
  const anchor = parseCalculatorInterval(normalizedFrame?.hejiAnchorInterval);
  if (!normalizedFrame || !anchor.valid) return null;
  try {
    const notationFrame = createReferenceFrame({
      anchorLabel: normalizedFrame.hejiAnchorLabel,
      anchorRatio: normalizedFrame.hejiAnchorInterval,
      anchorOctave: 4,
    });
    const rawLabel = spelledHejiLabel(
      notationFrame,
      resolved.ratioText ?? null,
      resolved.cents - anchor.cents,
      {
        suppressDeviation: Boolean(resolved.ratioText),
        forceShowZeroDeviation: true,
      },
    );
    const spelling = rawLabel.replace(/[+\-−]\d+(?:\.\d+)?¢?$/u, "");
    const centsFromAnchor = resolved.cents - anchor.cents;
    const octaveData = sequenceOctaveForSpelling(
      spelling,
      centsFromAnchor,
      normalizedFrame.hejiAnchorLabel,
    );
    if (!octaveData) return null;
    if (octaveData.structure.useTemperedAccidentals !== true) {
      return `${spelling}${octaveData.octave}`;
    }
    const deviation = centsFromAnchor - octaveData.relativeTemperedCents;
    return `${spelling}${octaveData.octave}${formatSequenceDeviation(deviation)}`;
  } catch {
    return null;
  }
}

export function sequenceIntervalCentsFromMidicents(midicents, frame) {
  const normalizedFrame = normalizeSequencePitchFrame(frame);
  const referenceInterval = parseCalculatorInterval(normalizedFrame?.referenceInterval);
  const pitch = Number(midicents);
  if (!normalizedFrame || !referenceInterval.valid || !Number.isFinite(pitch)) return null;
  const referenceMidicents =
    69 + 12 * Math.log2(normalizedFrame.referenceFrequency / DEFAULT_REFERENCE_FREQUENCY);
  return referenceInterval.cents + (pitch - referenceMidicents) * 100;
}

export function resolveSequenceScalaInterval(value, frame) {
  const parsed = parseCalculatorInterval(value);
  if (!parsed.valid) return null;
  const midicents = sequenceMidicentsFromIntervalCents(parsed.cents, frame);
  if (!Number.isFinite(midicents)) return null;
  if (!parsed.exact) {
    const resolved = {
      midicents,
      cents: parsed.cents,
      intervalText: formatSequenceCents(parsed.cents),
    };
    return { ...resolved, hejiName: sequenceHejiNameFromScalaInterval(resolved, frame) };
  }
  const { monzo, residual } = ratioToMonzoParts(parsed.ratio);
  const resolved = {
    midicents,
    cents: parsed.cents,
    intervalText: parsed.normalized,
    ratioText: parsed.normalized,
    ...(residual ? {} : { monzo }),
  };
  return { ...resolved, hejiName: sequenceHejiNameFromScalaInterval(resolved, frame) };
}

function matchingExactSequenceInterval(note, frame) {
  const noteMidicents = Number(note?.midicents);
  if (!Number.isFinite(noteMidicents)) return null;
  const namedPitch = resolveSequenceHejiName(note?.hejiName, frame);
  if (
    namedPitch?.ratioText &&
    Math.abs(Number(namedPitch.midicents) - noteMidicents) * 100 <= 0.001
  ) {
    return namedPitch.ratioText;
  }
  const ratio = parseCalculatorInterval(note?.ratioText);
  if (!ratio.valid || !ratio.exact) return null;
  const resolvedRatio = resolveSequenceScalaInterval(ratio.normalized, frame);
  return resolvedRatio && Math.abs(resolvedRatio.midicents - noteMidicents) * 100 <= 0.001
    ? ratio.normalized
    : null;
}

export function formatSequenceScalaInterval(note, frame) {
  if (note?.scalaIntervalDraft) {
    const draft = parseCalculatorInterval(note.scalaIntervalDraft);
    if (!draft.valid) return "";
    return draft.exact ? draft.normalized : Number(draft.cents).toFixed(1);
  }
  if (note?.displayLabelEdited !== true && note?.scalaInterval) {
    const stored = parseCalculatorInterval(note.scalaInterval);
    if (stored.valid) return stored.exact ? stored.normalized : Number(stored.cents).toFixed(1);
  }
  if (note?.displayLabelEdited !== true) {
    const namedPitch = resolveSequenceHejiName(note?.hejiName, frame);
    if (namedPitch?.ratioText) return namedPitch.ratioText;
  }
  const ratio = parseCalculatorInterval(note?.ratioText);
  if (ratio.valid && ratio.exact) return ratio.normalized;
  const targetCents = sequenceIntervalCentsFromMidicents(note?.midicents, frame);
  if (!Number.isFinite(targetCents)) return "";
  return Number(targetCents).toFixed(1);
}

export function formatEditableSequenceScalaInterval(note, frame) {
  if (note?.scalaIntervalDraft) return note.scalaIntervalDraft;
  if (note?.displayLabelEdited !== true && note?.scalaInterval) return note.scalaInterval;
  if (note?.displayLabelEdited !== true) {
    const namedPitch = resolveSequenceHejiName(note?.hejiName, frame);
    if (namedPitch?.ratioText) return namedPitch.ratioText;
  }
  const ratio = parseCalculatorInterval(note?.ratioText);
  if (ratio.valid && ratio.exact) return ratio.normalized;
  const targetCents = sequenceIntervalCentsFromMidicents(note?.midicents, frame);
  if (!Number.isFinite(targetCents)) return "";
  return formatSequenceCents(targetCents);
}

export function deriveSequenceScalaInterval(note, frame) {
  if (note?.scalaIntervalDraft) {
    const draft = parseCalculatorInterval(note.scalaIntervalDraft);
    if (draft.valid) return draft.exact ? draft.normalized : formatSequenceCents(draft.cents);
  }
  const exactInterval = matchingExactSequenceInterval(note, frame);
  if (exactInterval) return exactInterval;
  const targetCents = sequenceIntervalCentsFromMidicents(note?.midicents, frame);
  return Number.isFinite(targetCents) ? formatSequenceCents(targetCents) : "";
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
