import { canonicalHejiAnchorLabelInput } from "../notation/heji-normalization.js";
import { spelledHejiLabel } from "../notation/key-label.js";
import { BASE_BY_ID } from "../notation/heji.js";
import {
  parseHejiToStructure,
  pitchStructureToBaseId,
  pitchStructureToHeji,
  temperedPitchStructureFallback,
} from "../notation/pitch-structure.js";
import { buildPitchFrame, resolveStructurePitch } from "../notation/pitch-frame.js";
import { createReferenceFrame } from "../notation/reference-frame.js";
import { normaliseHejiAnchorRatio } from "../settings/scale/parse-scale.js";
import {
  monzoToCentsOnBasis,
  monzoToSafeFractionOnBasis,
  parseExactInterval,
} from "../tuning/interval.js";
import { findRationalCandidates } from "../tuning/rationalise.js";

export const DEFAULT_CALCULATOR_REFERENCE = Object.freeze({
  referenceFrequency: 440,
  referenceInterval: "1/1",
  anchorInterval: "1/1",
  anchorLabel: "*nA",
  targetInterval: "1/1",
  decimalPlaces: 0,
});

export const DEFAULT_CALCULATOR_OCTAVE = 4;

const MIDI_NOTE_NAMES = [
  ["C"],
  ["Db", "C#"],
  ["D"],
  ["Eb", "D#"],
  ["E"],
  ["F"],
  ["Gb", "F#"],
  ["G"],
  ["Ab", "G#"],
  ["A"],
  ["Bb", "A#"],
  ["B"],
];
const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHROMATIC_SEMITONES = { doubleflat: -2, flat: -1, natural: 0, sharp: 1, doublesharp: 2 };

function finitePositive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSignedZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function explicitRatioText(value) {
  const text = String(value ?? "").trim();
  return /^[+-]?\d+$/.test(text) ? `${text}/1` : text;
}

export function parseCalculatorInterval(value) {
  const source = String(value ?? "").trim();
  const parsed = parseExactInterval(source);
  if (!Number.isFinite(parsed.cents)) {
    return { valid: false, source, normalized: source, ...parsed };
  }
  const normalized = parsed.exact
    ? parsed.ratio.toFraction().includes("/")
      ? parsed.ratio.toFraction()
      : `${parsed.ratio.toFraction()}/1`
    : source.endsWith(".")
      ? `${source}0`
      : source;
  return { valid: true, source, normalized, ...parsed };
}

export function canonicalCalculatorAnchorLabelInput(value) {
  const withoutDeviation = String(value ?? "")
    .trim()
    .replace(/\s*[+\-−]\s*\d+(?:\.\d+)?\s*¢?\s*$/u, "");
  return canonicalHejiAnchorLabelInput(withoutDeviation);
}

function splitCalculatorSpelling(value) {
  const source = String(value ?? "").trim();
  const deviationMatch = source.match(/([+\-−]\d+(?:\.\d+)?)\s*¢?\s*$/u);
  const spelling = canonicalCalculatorAnchorLabelInput(source);
  const deviationCents = deviationMatch ? Number(deviationMatch[1].replace("−", "-")) : 0;
  return {
    spelling,
    deviationCents: Number.isFinite(deviationCents) ? deviationCents : 0,
  };
}

export function frequencyFromCents(degree0Frequency, centsFromDegree0) {
  return degree0Frequency * Math.pow(2, centsFromDegree0 / 1200);
}

function intervalFromCents(cents) {
  return normalizeSignedZero(cents).toFixed(6);
}

function temperedDeviationSuffix(cents) {
  const normalized = normalizeSignedZero(Number(cents) || 0);
  const magnitude = Number(Math.abs(normalized).toFixed(6)).toString();
  return `${normalized < 0 ? "−" : "+"}${magnitude}`;
}

function fractionText(ratio) {
  return explicitRatioText(ratio.toFraction());
}

function transposeFractionByOctaves(ratio, octaveShift) {
  let transposed = ratio;
  const shift = Math.trunc(Number(octaveShift) || 0);
  for (let index = 0; index < Math.abs(shift); index += 1) {
    transposed = shift > 0 ? transposed.mul(2) : transposed.div(2);
  }
  return transposed;
}

function normalizeCentsToOctave(cents) {
  if (!Number.isFinite(cents) || Math.abs(cents) < 1e-9) return 0;
  const pitchClass = ((cents % 1200) + 1200) % 1200;
  return Math.abs(pitchClass) < 1e-9 ? 1200 : pitchClass;
}

export function normalizeCalculatorInterval(value) {
  const parsed = typeof value === "object" && value?.valid ? value : parseCalculatorInterval(value);
  if (!parsed.valid) return parsed;
  if (!parsed.exact) {
    const cents = normalizeCentsToOctave(parsed.cents);
    return { ...parsed, cents, normalized: intervalFromCents(cents) };
  }
  if (parsed.ratio.isUnity()) return { ...parsed, normalized: "1/1", cents: 0 };
  let ratio = parsed.ratio;
  while (Number(ratio) > 2) ratio = ratio.div(2);
  while (Number(ratio) <= 1) ratio = ratio.mul(2);
  return parseCalculatorInterval(fractionText(ratio));
}

export function combineCalculatorIntervals(offsetValue, relativeValue) {
  const offset = parseCalculatorInterval(offsetValue);
  const relative = parseCalculatorInterval(relativeValue);
  if (!offset.valid || !relative.valid) return null;
  if (offset.exact && relative.exact) {
    const monzo = offset.monzo.map(
      (exponent, index) => exponent + (relative.monzo?.[index] ?? 0),
    );
    const ratio = monzoToSafeFractionOnBasis(monzo);
    if (ratio != null) return fractionText(ratio);
  }
  return intervalFromCents(offset.cents + relative.cents);
}

export function relativeCalculatorInterval(targetValue, offsetValue) {
  const target = parseCalculatorInterval(targetValue);
  const offset = parseCalculatorInterval(offsetValue);
  if (!target.valid || !offset.valid) return null;
  if (target.exact && offset.exact) {
    const monzo = target.monzo.map(
      (exponent, index) => exponent - (offset.monzo?.[index] ?? 0),
    );
    const ratio = monzoToSafeFractionOnBasis(monzo);
    if (ratio != null) return fractionText(ratio);
  }
  return intervalFromCents(target.cents - offset.cents);
}

export function midiPitchFromFrequency(frequencyHz) {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const midiFloat = 69 + 12 * Math.log2(frequencyHz / 440);
  const midiNote = Math.max(0, Math.min(127, Math.round(midiFloat)));
  const deviationCents = normalizeSignedZero((midiFloat - midiNote) * 100);
  const octave = Math.floor(midiNote / 12) - 1;
  const noteNames = MIDI_NOTE_NAMES[midiNote % 12].map((name) => `${name}${octave}`);
  return {
    midiFloat,
    midiNote,
    noteName: noteNames[0],
    noteNames,
    deviationCents,
  };
}

function notationMeterFromAnchor(anchorLabel, centsFromAnchor) {
  const anchorStructure = parseHejiToStructure(anchorLabel);
  const anchorSemitone = structureSemitone(anchorStructure);
  if (!Number.isFinite(anchorSemitone) || !Number.isFinite(centsFromAnchor)) return null;
  const nearestStep = Math.round(centsFromAnchor / 100);
  const pitchClass = (((anchorSemitone + nearestStep) % 12) + 12) % 12;
  return {
    noteNames: [...MIDI_NOTE_NAMES[pitchClass]],
    deviationCents: normalizeSignedZero(centsFromAnchor - nearestStep * 100),
  };
}

function structureSemitone(structure) {
  if (!structure?.letter) return null;
  const chromatic = BASE_BY_ID[pitchStructureToBaseId(structure)]?.chromatic ?? "natural";
  return LETTER_SEMITONES[structure.letter] + (CHROMATIC_SEMITONES[chromatic] ?? 0);
}

export function calculatorIntervalFromPitchStructure({
  structure,
  anchorLabel,
  anchorInterval,
  deviationCents = 0,
  octave = DEFAULT_CALCULATOR_OCTAVE,
}) {
  if (!structure?.letter) return { valid: false, error: "Choose a note letter" };
  const normalizedAnchorLabel = canonicalHejiAnchorLabelInput(anchorLabel);
  const normalizedAnchor = parseCalculatorInterval(anchorInterval);
  if (!normalizedAnchorLabel || !normalizedAnchor.valid) {
    return { valid: false, error: "Invalid HEJI anchor" };
  }

  if (structure.useTemperedAccidentals === true) {
    const anchorStructure = parseHejiToStructure(normalizedAnchorLabel);
    const sourceSemitone = structureSemitone(structure);
    const anchorSemitone = structureSemitone(anchorStructure);
    if (!Number.isFinite(sourceSemitone) || !Number.isFinite(anchorSemitone)) {
      return { valid: false, error: "Invalid tempered spelling" };
    }
    const octaveShift = Math.trunc(Number(octave) || 0) - DEFAULT_CALCULATOR_OCTAVE;
    const semitoneDistance = sourceSemitone - anchorSemitone + octaveShift * 12;
    const relativeCents = semitoneDistance * 100 + (Number(deviationCents) || 0);
    const cents = normalizedAnchor.cents + relativeCents;
    return {
      valid: true,
      exact: false,
      interval: normalizeSignedZero(cents).toFixed(6),
      relativeInterval: intervalFromCents(relativeCents),
      hejiLabel: `${pitchStructureToHeji(structure)}${temperedDeviationSuffix(deviationCents)}`,
    };
  }

  try {
    const frame = buildPitchFrame(
      {
        heji_anchor_label: normalizedAnchorLabel,
        // Resolve the written interval from the notation anchor independently
        // of the anchor's absolute placement. A cents anchor has no exact
        // monzo and must not be passed through the ratio-only pitch frame.
        heji_anchor_ratio: "1/1",
        reference_degree: 0,
        fundamental: 440,
      },
      null,
    );
    const resolved = resolveStructurePitch(frame, structure);
    const relativeMonzo = resolved?.notationRelativeMonzo;
    const octaveShift = Math.trunc(Number(octave) || 0) - DEFAULT_CALCULATOR_OCTAVE;
    if (!Array.isArray(relativeMonzo)) {
      return { valid: false, error: "Spelling cannot be resolved" };
    }
    const transposedMonzo = [...relativeMonzo];
    transposedMonzo[0] = (transposedMonzo[0] ?? 0) + octaveShift;
    const relativeCents = monzoToCentsOnBasis(transposedMonzo);
    const transposedRelative = monzoToSafeFractionOnBasis(transposedMonzo);
    const relativeRatioText = transposedRelative == null ? null : fractionText(transposedRelative);
    const hejiLabel =
      relativeRatioText == null
        ? `${pitchStructureToHeji(structure)}${
            temperedPitchStructureFallback(
              structure,
              parseHejiToStructure(normalizedAnchorLabel),
              relativeCents,
              { octave, decimals: 0 },
            )?.deviationText ?? ""
          }`
        : spelledHejiLabel(
            createReferenceFrame({ anchorLabel: normalizedAnchorLabel, anchorRatio: "1/1" }),
            relativeRatioText,
            relativeCents,
            { forceShowZeroDeviation: true },
          );
    if (!normalizedAnchor.exact) {
      return {
        valid: true,
        exact: false,
        interval: intervalFromCents(normalizedAnchor.cents + relativeCents),
        relativeExact: relativeRatioText != null,
        relativeInterval: relativeRatioText ?? intervalFromCents(relativeCents),
        hejiLabel,
      };
    }
    const combinedMonzo = transposedMonzo.map(
      (exponent, index) => exponent + (normalizedAnchor.monzo?.[index] ?? 0),
    );
    const combinedRatio = monzoToSafeFractionOnBasis(combinedMonzo);
    if (combinedRatio == null || relativeRatioText == null) {
      return {
        valid: true,
        exact: false,
        interval: intervalFromCents(normalizedAnchor.cents + relativeCents),
        relativeExact: relativeRatioText != null,
        relativeInterval: relativeRatioText ?? intervalFromCents(relativeCents),
        monzo: combinedMonzo,
        hejiLabel,
      };
    }
    return {
      valid: true,
      exact: true,
      interval: fractionText(combinedRatio),
      relativeExact: true,
      relativeInterval: relativeRatioText,
      monzo: combinedMonzo,
      hejiLabel,
    };
  } catch {
    return { valid: false, error: "Spelling cannot be resolved" };
  }
}

export function calculatorPalettePitchFromAnalysis({ hejiLabel, centsFromAnchor, anchorLabel }) {
  const { spelling, deviationCents } = splitCalculatorSpelling(hejiLabel);
  const structure = parseHejiToStructure(spelling);
  if (!structure?.letter || !Number.isFinite(centsFromAnchor)) return null;

  const base = calculatorIntervalFromPitchStructure({
    structure,
    anchorLabel,
    anchorInterval: "1/1",
    deviationCents,
    octave: DEFAULT_CALCULATOR_OCTAVE,
  });
  const parsedBase = parseCalculatorInterval(base.relativeInterval);
  if (!base.valid || !parsedBase.valid) return null;

  const octaveShift = Math.round((centsFromAnchor - parsedBase.cents) / 1200);
  return {
    spelling,
    deviation: `${deviationCents < 0 ? "−" : "+"}${Math.abs(deviationCents)}`,
    octave: DEFAULT_CALCULATOR_OCTAVE + octaveShift,
  };
}

export function deriveCalculatorSeed(settings = {}, effectiveAnchor = {}) {
  const hasLoadedScale = Array.isArray(settings.scale) && settings.scale.length > 0;
  if (!hasLoadedScale) {
    return {
      ...DEFAULT_CALCULATOR_REFERENCE,
      anchorReferenceInterval: "1/1",
      anchorFrequency: DEFAULT_CALCULATOR_REFERENCE.referenceFrequency,
    };
  }
  const referenceDegree = Math.max(0, Number.parseInt(settings.reference_degree, 10) || 0);
  const scaleReference =
    referenceDegree === 0 ? "1/1" : String(settings.scale?.[referenceDegree - 1] ?? "");
  const referenceInterval = parseCalculatorInterval(scaleReference).valid
    ? scaleReference
    : DEFAULT_CALCULATOR_REFERENCE.referenceInterval;
  const referenceFrequency = finitePositive(
    settings.fundamental,
    DEFAULT_CALCULATOR_REFERENCE.referenceFrequency,
  );
  const anchorInterval =
    normaliseHejiAnchorRatio(
      settings.heji_anchor_ratio ||
        effectiveAnchor.ratio ||
        DEFAULT_CALCULATOR_REFERENCE.anchorInterval,
    ) ?? DEFAULT_CALCULATOR_REFERENCE.anchorInterval;
  const anchorLabel =
    canonicalHejiAnchorLabelInput(
      settings.heji_anchor_label ||
        effectiveAnchor.label ||
        DEFAULT_CALCULATOR_REFERENCE.anchorLabel,
    ) ?? DEFAULT_CALCULATOR_REFERENCE.anchorLabel;
  const referenceCents = parseCalculatorInterval(referenceInterval).cents;
  const anchorCents = parseCalculatorInterval(anchorInterval).cents;
  const degree0Frequency = frequencyFromCents(referenceFrequency, -referenceCents);
  const derivedAnchorFrequency = frequencyFromCents(degree0Frequency, anchorCents);
  const explicitAnchorFrequency = finitePositive(settings.heji_anchor_frequency, null);

  return {
    referenceFrequency,
    referenceInterval,
    anchorInterval,
    anchorReferenceInterval: relativeCalculatorInterval(anchorInterval, referenceInterval) ?? "1/1",
    anchorLabel,
    anchorFrequency: explicitAnchorFrequency ?? derivedAnchorFrequency,
    targetInterval: DEFAULT_CALCULATOR_REFERENCE.targetInterval,
    decimalPlaces: Math.max(
      0,
      Math.min(
        6,
        Number(settings.heji_palette_decimals) || DEFAULT_CALCULATOR_REFERENCE.decimalPlaces,
      ),
    ),
  };
}

function nearbyRationalValues(targetCents, options = {}) {
  if (!Number.isFinite(targetCents)) return [];
  const pitchClassCents = ((targetCents % 1200) + 1200) % 1200;
  const octaveShift = Math.floor(targetCents / 1200);
  const candidates = findRationalCandidates(pitchClassCents, {
    primeLimit: options.primeLimit ?? 31,
    primeBounds: options.primeBounds,
    primeBoundsUt: options.primeBoundsUt,
    oddLimit: options.oddLimit ?? 255,
    centsTolerance: options.centsTolerance ?? 30,
    region: options.region,
    maxCandidates: options.maxCandidates ?? 16,
  }).map((candidate) => {
    const parsedCandidate = parseCalculatorInterval(candidate.ratioText);
    const ratioText = parsedCandidate.valid
      ? fractionText(transposeFractionByOctaves(parsedCandidate.ratio, octaveShift))
      : explicitRatioText(candidate.ratioText);
    const cents = candidate.cents + octaveShift * 1200;
    const oddRadius = candidate.harmonicRadius;
    const harmonicRadius = oddRadius + 0.5 * Math.abs((candidate.monzo?.[0] ?? 0) + octaveShift);
    return {
      ratioText,
      cents,
      deviationCents: normalizeSignedZero(cents - targetCents),
      primeLimit: candidate.primeLimit,
      oddLimit: candidate.oddLimit,
      harmonicRadius,
      oddRadius,
      aggregateScore: candidate.aggregateScore,
    };
  });
  const sorters = {
    deviation: (a, b) => Math.abs(a.deviationCents) - Math.abs(b.deviationCents),
    harmonicRadius: (a, b) => a.harmonicRadius - b.harmonicRadius,
    oddRadius: (a, b) => a.oddRadius - b.oddRadius,
    prime: (a, b) => a.primeLimit - b.primeLimit,
    odd: (a, b) => a.oddLimit - b.oddLimit,
  };
  const sorter = sorters[options.sortBy];
  return sorter
    ? candidates
        .map((candidate, index) => ({ candidate, index }))
        .sort((a, b) => sorter(a.candidate, b.candidate) || a.index - b.index)
        .map(({ candidate }) => candidate)
    : candidates;
}

function formatRationalHejiCentsSuffix(label, alwaysIncludeCents) {
  const value = String(label ?? "");
  if (!value || /[\uE2F1-\uE2F3]/u.test(value)) return value;
  const trailingDeviation = /[+\u2212-]\d+(?:\.\d+)?(?:¢)?$/u;
  const trailingZeroDeviation = /[+\u2212-]0(?:\.0+)?(?:¢)?$/u;
  if (alwaysIncludeCents) return trailingDeviation.test(value) ? value : `${value}+0`;
  return value.replace(trailingZeroDeviation, "");
}

export function calculatePitchLookup(input = {}) {
  const referenceFrequency = finitePositive(
    input.referenceFrequency,
    DEFAULT_CALCULATOR_REFERENCE.referenceFrequency,
  );
  const reference = parseCalculatorInterval(
    input.referenceInterval || DEFAULT_CALCULATOR_REFERENCE.referenceInterval,
  );
  const anchor = parseCalculatorInterval(
    input.anchorInterval || DEFAULT_CALCULATOR_REFERENCE.anchorInterval,
  );
  const offsetFromAnchor = parseCalculatorInterval(input.offsetFromAnchorInterval || "1/1");
  const pitchFromOffset = parseCalculatorInterval(input.pitchFromOffsetInterval || "1/1");
  const parsedTarget = parseCalculatorInterval(
    input.targetInterval || DEFAULT_CALCULATOR_REFERENCE.targetInterval,
  );
  const target = input.normalizeResults ? normalizeCalculatorInterval(parsedTarget) : parsedTarget;
  const anchorLabel =
    canonicalHejiAnchorLabelInput(input.anchorLabel || DEFAULT_CALCULATOR_REFERENCE.anchorLabel) ??
    DEFAULT_CALCULATOR_REFERENCE.anchorLabel;

  if (
    !reference.valid ||
    !anchor.valid ||
    !offsetFromAnchor.valid ||
    !pitchFromOffset.valid ||
    !target.valid
  ) {
    return {
      valid: false,
      error: !reference.valid
        ? "Invalid reference ratio/cents value"
        : !anchor.valid
          ? "Invalid HEJI anchor ratio/cents value"
          : !offsetFromAnchor.valid
            ? "Invalid offset ratio/cents value"
            : !pitchFromOffset.valid
              ? "Invalid pitch ratio/cents value"
              : "Invalid lookup ratio/cents value",
    };
  }

  const degree0Frequency = frequencyFromCents(referenceFrequency, -reference.cents);
  const anchorFrequency = frequencyFromCents(degree0Frequency, anchor.cents);
  const frequencyHz = frequencyFromCents(degree0Frequency, target.cents);
  const centsFromReference = normalizeSignedZero(target.cents - reference.cents);
  const centsFromAnchor = normalizeSignedZero(target.cents - anchor.cents);
  const notationMeter = notationMeterFromAnchor(anchorLabel, centsFromAnchor);
  const referenceRelativeText = relativeCalculatorInterval(target.normalized, reference.normalized);
  const referenceRelative = referenceRelativeText
    ? parseCalculatorInterval(referenceRelativeText)
    : null;
  const displayedReferenceRelative =
    input.normalizeResults && referenceRelative
      ? normalizeCalculatorInterval(referenceRelative)
      : referenceRelative;
  const ratioFromReferenceText = displayedReferenceRelative?.exact
    ? displayedReferenceRelative.normalized
    : null;
  const anchorRelative = parseCalculatorInterval(
    combineCalculatorIntervals(offsetFromAnchor.normalized, pitchFromOffset.normalized),
  );
  const displayedOffsetRelative = input.normalizeResults
    ? normalizeCalculatorInterval(pitchFromOffset)
    : pitchFromOffset;
  const displayedAnchorRelative = input.normalizeResults
    ? normalizeCalculatorInterval(anchorRelative)
    : anchorRelative;
  const displayedCentsFromReference = input.normalizeResults
    ? normalizeCentsToOctave(centsFromReference)
    : centsFromReference;
  const rationalSearchTarget =
    input.pitchFromOffsetInterval == null ? target : displayedOffsetRelative;
  let hejiLabel = "";
  try {
    const frame = createReferenceFrame({ anchorLabel, anchorRatio: "1/1" });
    const resolvedLabel =
      input.preferredHejiLabel ||
      spelledHejiLabel(
        frame,
        anchorRelative.exact ? anchorRelative.normalized : null,
        centsFromAnchor,
        {
          forceShowZeroDeviation: true,
        },
      );
    hejiLabel = anchorRelative.exact
      ? formatRationalHejiCentsSuffix(
          resolvedLabel,
          input.alwaysIncludeCentsInSpelling === true,
        )
      : resolvedLabel;
  } catch {
    hejiLabel = "";
  }

  return {
    valid: true,
    referenceFrequency,
    referenceInterval: reference.normalized,
    referenceCents: reference.cents,
    degree0Frequency,
    anchorInterval: anchor.normalized,
    anchorLabel,
    anchorFrequency,
    targetInterval: target.normalized,
    exact: target.exact,
    ratioText: target.exact ? target.normalized : null,
    ratioFromReferenceText,
    ratioFromOffsetText: displayedOffsetRelative.exact ? displayedOffsetRelative.normalized : null,
    centsFromOffset: normalizeSignedZero(displayedOffsetRelative.cents),
    ratioFromAnchorText: displayedAnchorRelative.exact ? displayedAnchorRelative.normalized : null,
    displayedCentsFromAnchor: normalizeSignedZero(displayedAnchorRelative.cents),
    centsFromDegree0: normalizeSignedZero(target.cents),
    centsFromReference: displayedCentsFromReference,
    centsFromAnchor,
    frequencyHz,
    hejiLabel,
    midi: midiPitchFromFrequency(frequencyHz),
    notationMeter,
    nearbyRatios: nearbyRationalValues(rationalSearchTarget.cents, input.rationalSearch),
    monzo: target.exact ? target.monzo : null,
    primeLimit: target.exact ? target.primeLimit : null,
  };
}
