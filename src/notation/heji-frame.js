import { Fraction, monzoToCents } from "xen-dev-utils";
import { scalaToCents } from "../settings/scale/parse-scale.js";
import { addMonzos } from "./heji.js";
import {
  HEJI_NATURAL_LABELS,
  canonicalHejiAnchorLabelInput,
  canonicalHejiLabel,
  deriveHejiAnchor,
} from "./heji-normalization.js";
import { spelledHejiLabel } from "./key-label.js";
import { parseHejiToStructure, pitchStructureToBaseId, pitchStructureToMonzo } from "./pitch-structure.js";
import { resolveStructurePitch } from "./pitch-frame.js";
import { createReferenceFrame } from "./reference-frame.js";
import { monzoToFractionOnBasis } from "../tuning/interval.js";

function trimRenderedLabelToPitchClass(label) {
  const source = String(label ?? "").trim();
  if (!source) return null;
  const match = source.match(/^(.+?[A-Ga-g])(?:[+\-\u2212]\d+(?:\.\d+)?)?$/);
  return match?.[1] ?? source;
}

function inferDegreeNotationRole(structure) {
  if (!structure) return null;
  const hasHigherPrimeInflection = Object.values(structure.primeExponents ?? {}).some((value) => value !== 0);
  if (hasHigherPrimeInflection) return "chromatic";
  return (structure.accidentalCount ?? 0) === 0 ? "diatonic" : "chromatic";
}

function inferDegreeNotationSide(structure) {
  if (!structure?.letter) return null;
  if ((structure.accidentalCount ?? 0) < 0) return "flat";
  if ((structure.accidentalCount ?? 0) > 0) return "sharp";
  if (structure.letter === "D") return "core";
  if (structure.letter === "F" || structure.letter === "C" || structure.letter === "G") return "flat";
  if (structure.letter === "A" || structure.letter === "E" || structure.letter === "B") return "sharp";
  return null;
}

function normalizedAnchorRatio(anchorRatioText) {
  const raw = String(anchorRatioText ?? "").trim();
  return raw || "1/1";
}

export function resolveEffectiveHejiAnchor({
  referenceDegree,
  noteNames,
  degreeTexts,
  fundamental,
  scaleCents,
  explicitAnchorLabel,
  explicitAnchorRatio,
}) {
  const derived = deriveHejiAnchor(
    referenceDegree,
    noteNames,
    degreeTexts,
    fundamental,
    scaleCents,
  );
  const trimmedExplicitAnchorLabel = String(explicitAnchorLabel ?? "").trim();
  const trimmedExplicitAnchorRatio = String(explicitAnchorRatio ?? "").trim();
  const derivedAnchorLabel =
    !trimmedExplicitAnchorLabel && trimmedExplicitAnchorRatio
      ? HEJI_NATURAL_LABELS.A
      : derived.label;
  return {
    anchorLabel: canonicalHejiAnchorLabelInput(trimmedExplicitAnchorLabel) ?? derivedAnchorLabel,
    anchorRatioText: normalizedAnchorRatio(trimmedExplicitAnchorRatio || derived.ratio),
    inferredTemperedOnly: derived.inferredTemperedOnly === true,
  };
}

function scoreDReferenceCandidate(candidate) {
  return [
    candidate.isNatural ? 0 : 1,
    candidate.nonThreeComplexity === 0 ? 0 : 1,
    candidate.accidentalWeight,
    candidate.nonThreeComplexity,
    Math.abs(candidate.absoluteFifthSteps - 2),
    candidate.degree,
  ];
}

function compareScores(a, b) {
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function normalizePitchClassCents(cents) {
  const normalized = ((Number(cents) % 1200) + 1200) % 1200;
  return Math.abs(normalized - 1200) < 1e-9 ? 0 : normalized;
}

function deriveAbstractDReference({ pitchFrame = null, referenceFrame = null } = {}) {
  const naturalD = parseHejiToStructure("D");
  if (!naturalD) return null;
  const absoluteMonzo = pitchStructureToMonzo(naturalD);
  if (pitchFrame) {
    const resolvedPitch = resolveStructurePitch(pitchFrame, naturalD);
    if (Array.isArray(resolvedPitch?.degreeRelativeInterval?.monzo)) {
      return {
        absoluteMonzo,
        ratioMonzo: resolvedPitch.degreeRelativeInterval.monzo,
      };
    }
  }
  if (!referenceFrame?.globalOffsetMonzo) return null;
  return {
    absoluteMonzo,
    ratioMonzo: addMonzos(absoluteMonzo, referenceFrame.globalOffsetMonzo),
  };
}

function fractionCompare(a, b) {
  return a.s * a.n * b.d - b.s * b.n * a.d;
}

function normalizeFractionToPitchClass(ratio) {
  let out = ratio;
  while (fractionCompare(out, new Fraction(1, 1)) < 0) out = out.mul(2);
  while (fractionCompare(out, new Fraction(2, 1)) >= 0) out = out.div(2);
  return out;
}

function formatExactScaleTextFromMonzo(monzo) {
  const ratio = normalizeFractionToPitchClass(monzoToFractionOnBasis(monzo));
  const text = ratio.toFraction();
  return text.includes("/") ? text : `${text}/1`;
}

function rawInputUsesTemperedAccidental(text) {
  const source = String(text ?? "");
  return /[\uE2F1\uE2F2\uE2F3]/u.test(source);
}

function pitchClassDistance(a, b) {
  const delta = Math.abs(normalizePitchClassCents(a) - normalizePitchClassCents(b));
  return Math.min(delta, 1200 - delta);
}

const TEMPERED_SEMITONES_FROM_C = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function getTemperedPitchClassCents(structure, anchorStructure) {
  if (!structure?.letter || !anchorStructure?.letter) return null;
  const targetSemitones =
    (TEMPERED_SEMITONES_FROM_C[structure.letter] ?? 0) + (structure.accidentalCount ?? 0);
  const anchorSemitones =
    (TEMPERED_SEMITONES_FROM_C[anchorStructure.letter] ?? 0) + (anchorStructure.accidentalCount ?? 0);
  return normalizePitchClassCents((targetSemitones - anchorSemitones) * 100);
}

function samePitchStructure(a, b) {
  if (!a || !b) return false;
  if (a.letter !== b.letter) return false;
  if ((a.accidentalCount ?? 0) !== (b.accidentalCount ?? 0)) return false;
  if ((a.syntonic ?? 0) !== (b.syntonic ?? 0)) return false;
  if ((a.useTemperedAccidentals ?? false) !== (b.useTemperedAccidentals ?? false)) return false;
  const keys = new Set([
    ...Object.keys(a.primeExponents ?? {}),
    ...Object.keys(b.primeExponents ?? {}),
  ]);
  return [...keys].every((key) => (a.primeExponents?.[key] ?? 0) === (b.primeExponents?.[key] ?? 0));
}

function sameMonzo(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === (b[index] ?? 0));
}

export function buildHejiNotationFrame({
  referenceDegree,
  noteNames,
  degreeTexts,
  fundamental,
  scaleCents,
  explicitAnchorLabel,
  explicitAnchorRatio,
  temperedOnly = false,
  showCents = true,
  workspaceMonzos = [],
  pitchFrame = null,
}) {
  const resolvedAnchor = pitchFrame
    ? {
        anchorLabel: pitchFrame.notationZero?.label ?? "",
        anchorRatioText: pitchFrame.degree0ToNotationZeroInterval?.ratioText ?? "1/1",
      }
    : resolveEffectiveHejiAnchor({
        referenceDegree,
        noteNames,
        degreeTexts,
        fundamental,
        scaleCents,
        explicitAnchorLabel,
        explicitAnchorRatio,
      });
  const anchorLabel = resolvedAnchor.anchorLabel;
  const anchorRatioText = resolvedAnchor.anchorRatioText;
  const frame = createReferenceFrame({ anchorLabel, anchorRatio: anchorRatioText });
  const anchorCents = Number.isFinite(pitchFrame?.degree0ToNotationZeroInterval?.cents)
    ? pitchFrame.degree0ToNotationZeroInterval.cents
    : scalaToCents(String(anchorRatioText));

  const rows = degreeTexts.map((text, degree) => {
    const degreeCents = scaleCents[degree] ?? 0;
    const centsFromAnchor = ((degreeCents - anchorCents) % 1200 + 1200) % 1200;
    const ratioText = String(text).includes("/") ? text : null;
    const renderedLabel = spelledHejiLabel(frame, ratioText, centsFromAnchor, {
      temperedOnly,
      forceShowZeroDeviation: temperedOnly && showCents,
    });
    const renderedKeyLabel = spelledHejiLabel(frame, ratioText, centsFromAnchor, {
      temperedOnly,
      suppressDeviation: !showCents || temperedOnly,
      forceShowZeroDeviation: temperedOnly && showCents,
    });
    const explicitSourceLabel = canonicalHejiLabel(noteNames?.[degree] ?? "");
    const explicitSourceStructure = explicitSourceLabel ? parseHejiToStructure(explicitSourceLabel) : null;
    const renderedPitchClassLabel = trimRenderedLabelToPitchClass(renderedKeyLabel);
    const renderedStructure = renderedPitchClassLabel ? parseHejiToStructure(renderedPitchClassLabel) : null;
    const pitchClassLabel = explicitSourceLabel ?? renderedPitchClassLabel;
    const structure = explicitSourceStructure ?? renderedStructure;
    const monzo = Array.isArray(workspaceMonzos[degree]) ? workspaceMonzos[degree] : null;
    const absoluteFifthSteps = monzo?.[1] ?? null;
    const nonThreeComplexity = monzo
      ? monzo.reduce((sum, value, index) => (index <= 1 ? sum : sum + Math.abs(value ?? 0)), 0)
      : null;
    const accidentalWeight = structure
      ? String(pitchClassLabel ?? "").replace(/[A-Ga-g]/g, "").length
      : null;
    return {
      degree,
      renderedLabel,
      renderedKeyLabel,
      explicitSourceLabel,
      pitchClassLabel,
      parsed: structure,
      monzo,
      absoluteFifthSteps,
      nonThreeComplexity,
      accidentalWeight,
      notationRole: inferDegreeNotationRole(structure),
      notationSide: inferDegreeNotationSide(structure),
    };
  });

  const hejiNames = rows.map((row) => row.renderedLabel);
  const hejiNamesKeys = rows.map((row) => row.renderedKeyLabel);
  const abstractDReference = deriveAbstractDReference({ pitchFrame, referenceFrame: frame });

  const dCandidates = rows
    .map((row) => {
      if (!row.parsed || row.parsed.letter !== "D" || !row.monzo) return null;
      return {
        degree: row.degree,
        monzo: row.monzo,
        label: row.pitchClassLabel,
        accidentalWeight: row.accidentalWeight ?? 0,
        nonThreeComplexity: row.nonThreeComplexity ?? 0,
        absoluteFifthSteps: row.absoluteFifthSteps ?? 0,
        isNatural:
          pitchStructureToBaseId(row.parsed) === "natural:0"
          && (row.parsed.syntonic ?? 0) === 0
          && Object.values(row.parsed.primeExponents ?? {}).every((value) => value === 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => compareScores(scoreDReferenceCandidate(a), scoreDReferenceCandidate(b)));

  const dReference = dCandidates[0] ?? null;
  const colorReferenceMonzo = abstractDReference?.ratioMonzo ?? dReference?.monzo ?? null;
  const colorReferenceAbsoluteFifthSteps =
    abstractDReference?.absoluteMonzo?.[1]
    ?? colorReferenceMonzo?.[1]
    ?? null;
  const dReferenceDegree = colorReferenceMonzo
    ? (rows.find((row) => sameMonzo(row.monzo, colorReferenceMonzo))?.degree ?? dReference?.degree ?? null)
    : (dReference?.degree ?? null);
  const degreeMetadata = rows.map((row) => {
    const relativeFifthSteps =
      row.monzo && colorReferenceAbsoluteFifthSteps != null
        ? (row.monzo[1] ?? 0) - colorReferenceAbsoluteFifthSteps
        : null;
    return {
      degree: row.degree,
      source: row.explicitSourceLabel ? "note_names" : "derived",
      renderedLabel: row.renderedKeyLabel,
      pitchClassLabel: row.pitchClassLabel,
      parsed: row.parsed,
      notationRole: row.notationRole,
      notationSide: row.notationSide,
      absoluteFifthSteps: row.absoluteFifthSteps,
      relativeFifthSteps,
    };
  });

  return {
    anchorLabel,
    anchorRatioText,
    anchorCents,
    referenceFrame: frame,
    hejiNames,
    hejiNamesKeys,
    degreeMetadata,
    dReferenceDegree,
    dReferenceMonzo: colorReferenceMonzo,
    dReferenceAbsoluteFifthSteps: colorReferenceAbsoluteFifthSteps,
    colorMonzoOffset: colorReferenceMonzo,
  };
}

export function resolveTypedHejiLabel({
  text,
  degreeTexts,
  scaleCents,
  renderedLabels,
  anchorLabel,
  anchorRatioText,
  workspaceMonzos = [],
  pitchFrame = null,
}) {
  const source = String(text ?? "").trim();
  if (!source) return null;
  const usesTemperedAccidental = rawInputUsesTemperedAccidental(source);
  const match = source.match(/^(.*?)([+\-\u2212]\d+(?:\.\d+)?)?$/);
  const pitchClassLabel = canonicalHejiAnchorLabelInput(match?.[1] ?? source);
  if (!pitchClassLabel) return null;
  const centsOffset = Number.parseFloat((match?.[2] ?? "").replace("\u2212", "-"));
  const normalizedOffset = usesTemperedAccidental && Number.isFinite(centsOffset) ? centsOffset : 0;
  let computedFallback = null;
  let computedExactFallback = null;
  const targetStructure = parseHejiToStructure(pitchClassLabel);
  const anchorStructure = pitchFrame?.notationZero?.structure
    ?? parseHejiToStructure(anchorLabel || "A")
    ?? parseHejiToStructure("A");

  if (usesTemperedAccidental && targetStructure) {
    const temperedTargetCents = getTemperedPitchClassCents(targetStructure, anchorStructure);
    if (Number.isFinite(temperedTargetCents)) {
      return {
        degree: null,
        scaleText: (temperedTargetCents + normalizedOffset).toFixed(6),
        matchedExactly: false,
      };
    }
  }

  if (targetStructure && pitchFrame) {
    try {
      const resolvedPitch = resolveStructurePitch(pitchFrame, targetStructure);
      const ratioMonzo = resolvedPitch?.degreeRelativeInterval?.monzo ?? null;
      const matchIndex = workspaceMonzos.findIndex((candidate) => sameMonzo(candidate, ratioMonzo));
      if (matchIndex >= 0) {
        const baseText = degreeTexts[matchIndex] ?? "1/1";
        if (Math.abs(normalizedOffset) < 1e-9) {
          return { degree: matchIndex, scaleText: baseText, matchedExactly: true };
        }
        const targetCents = (scaleCents[matchIndex] ?? 0) + normalizedOffset;
        return { degree: matchIndex, scaleText: targetCents.toFixed(6), matchedExactly: false };
      }
      if (!usesTemperedAccidental && Math.abs(normalizedOffset) < 1e-9) {
        const exactScaleText = resolvedPitch?.degreeRelativeInterval?.ratioText;
        if (exactScaleText) {
          computedExactFallback = {
            degree: null,
            scaleText: exactScaleText,
            matchedExactly: true,
          };
        }
      }
      if (Number.isFinite(resolvedPitch?.cents)) {
        computedFallback = {
          degree: null,
          scaleText: (resolvedPitch.cents + normalizedOffset).toFixed(6),
          matchedExactly: false,
        };
      }
    } catch {
      // Fall through to older compatibility paths.
    }
  }

  if (!computedFallback && !computedExactFallback && targetStructure && anchorLabel && anchorRatioText) {
    try {
      const referenceFrame = createReferenceFrame({ anchorLabel, anchorRatio: anchorRatioText });
      if (referenceFrame.globalOffsetMonzo) {
        const absoluteMonzo = pitchStructureToMonzo(targetStructure);
        const ratioMonzo = addMonzos(absoluteMonzo, referenceFrame.globalOffsetMonzo);
        const matchIndex = workspaceMonzos.findIndex((candidate) => (
          Array.isArray(candidate)
          && candidate.length === ratioMonzo.length
          && candidate.slice(1).every((value, index) => value === (ratioMonzo[index + 1] ?? 0))
        ));
        if (matchIndex >= 0) {
          const baseText = degreeTexts[matchIndex] ?? "1/1";
          if (Math.abs(normalizedOffset) < 1e-9) {
            return { degree: matchIndex, scaleText: baseText, matchedExactly: true };
          }
          const targetCents = (scaleCents[matchIndex] ?? 0) + normalizedOffset;
          return { degree: matchIndex, scaleText: targetCents.toFixed(6), matchedExactly: false };
        }
        if (!usesTemperedAccidental && Math.abs(normalizedOffset) < 1e-9) {
          computedExactFallback = {
            degree: null,
            scaleText: formatExactScaleTextFromMonzo(ratioMonzo),
            matchedExactly: true,
          };
        }
        const computedCents = normalizePitchClassCents(monzoToCents(ratioMonzo) + normalizedOffset);
        computedFallback = {
          degree: null,
          scaleText: computedCents.toFixed(6),
          matchedExactly: false,
        };
      }
    } catch {
      // Fall through to rendered-label matching.
    }
  }

  const renderedMatches = [];
  for (let degree = 0; degree < renderedLabels.length; degree += 1) {
    const renderedPitchClassText = canonicalHejiAnchorLabelInput(trimRenderedLabelToPitchClass(renderedLabels[degree]));
    const renderedPitchClass = renderedPitchClassText ? parseHejiToStructure(renderedPitchClassText) : null;
    if (!samePitchStructure(renderedPitchClass, targetStructure)) continue;
    const baseText = degreeTexts[degree] ?? "1/1";
    renderedMatches.push({
      degree,
      baseText,
      exactRatio: String(baseText).includes("/"),
      cents: scaleCents[degree] ?? 0,
    });
  }

  if (renderedMatches.length) {
    const computedTargetCents = computedFallback ? Number.parseFloat(computedFallback.scaleText) : null;
    renderedMatches.sort((a, b) => {
      if (a.exactRatio !== b.exactRatio) return a.exactRatio ? -1 : 1;
      if (Number.isFinite(computedTargetCents)) {
        const distanceA = pitchClassDistance(a.cents, computedTargetCents);
        const distanceB = pitchClassDistance(b.cents, computedTargetCents);
        if (distanceA !== distanceB) return distanceA - distanceB;
      }
      return a.degree - b.degree;
    });
    const best = renderedMatches[0];
    if (Math.abs(normalizedOffset) < 1e-9) {
      return { degree: best.degree, scaleText: best.baseText, matchedExactly: true };
    }
    const targetCents = best.cents + normalizedOffset;
    return { degree: best.degree, scaleText: targetCents.toFixed(6), matchedExactly: false };
  }

  if (computedExactFallback) return computedExactFallback;
  return computedFallback;
}
