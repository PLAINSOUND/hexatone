import { Fraction, monzoToCents } from "xen-dev-utils";
import { scalaToCents } from "../settings/scale/parse-scale.js";
import { addMonzos, hejiToMonzo, parseHejiPitchClassLabel } from "./heji.js";
import { canonicalHejiAnchorLabelInput, canonicalHejiLabel, deriveHejiAnchor } from "./heji-normalization.js";
import { spelledHejiLabel } from "./key-label.js";
import { createReferenceFrame } from "./reference-frame.js";
import { monzoToFractionOnBasis } from "../tuning/interval.js";

function trimRenderedLabelToPitchClass(label) {
  const source = String(label ?? "").trim();
  if (!source) return null;
  const match = source.match(/^(.+?[A-Ga-g])(?:[+\-\u2212]\d+(?:\.\d+)?)?$/);
  return match?.[1] ?? source;
}

function inferDegreeNotationRole(parsed) {
  if (!parsed) return null;
  const baseChromatic = parsed.baseId?.split(":")?.[0] ?? "natural";
  if ((parsed.extraIds?.length ?? 0) > 0) return "chromatic";
  if (baseChromatic === "natural") return "diatonic";
  if (
    baseChromatic === "flat"
    || baseChromatic === "sharp"
    || baseChromatic === "doubleflat"
    || baseChromatic === "doublesharp"
  ) {
    return "chromatic";
  }
  return null;
}

function inferDegreeNotationSide(parsed) {
  if (!parsed?.letter) return null;
  const baseChromatic = parsed.baseId?.split(":")?.[0] ?? "natural";
  if (baseChromatic === "flat" || baseChromatic === "doubleflat") return "flat";
  if (baseChromatic === "sharp" || baseChromatic === "doublesharp") return "sharp";
  if (parsed.letter === "D") return "core";
  if (parsed.letter === "F" || parsed.letter === "C" || parsed.letter === "G") return "flat";
  if (parsed.letter === "A" || parsed.letter === "E" || parsed.letter === "B") return "sharp";
  return null;
}

function normalizedAnchorRatio(anchorRatioText) {
  const raw = String(anchorRatioText ?? "").trim();
  return raw || "1/1";
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

function deriveAbstractDReference(referenceFrame) {
  if (!referenceFrame?.globalOffsetMonzo) return null;
  const parsedD = parseHejiPitchClassLabel("D");
  if (!parsedD) return null;
  const absoluteMonzo = hejiToMonzo({
    ...parsedD,
    octave: referenceFrame.anchorOctave ?? 4,
  });
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

function samePitchClass(a, b) {
  if (!a || !b) return false;
  if (a.letter !== b.letter) return false;
  if (a.baseId !== b.baseId) return false;
  if ((a.schismaAmount ?? 0) !== (b.schismaAmount ?? 0)) return false;
  const extrasA = a.extraIds ?? [];
  const extrasB = b.extraIds ?? [];
  if (extrasA.length !== extrasB.length) return false;
  return extrasA.every((id, index) => id === extrasB[index]);
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
  const anchorLabel = canonicalHejiAnchorLabelInput(trimmedExplicitAnchorLabel) ?? derived.label;
  const anchorRatioText = normalizedAnchorRatio(trimmedExplicitAnchorRatio || derived.ratio);
  const frame = createReferenceFrame({ anchorLabel, anchorRatio: anchorRatioText });
  const anchorCents = scalaToCents(String(anchorRatioText));

  const hejiNames = degreeTexts.map((text, index) => {
    const degreeCents = scaleCents[index] ?? 0;
    const centsFromAnchor = ((degreeCents - anchorCents) % 1200 + 1200) % 1200;
    const ratioText = String(text).includes("/") ? text : null;
    return spelledHejiLabel(frame, ratioText, centsFromAnchor, {
      temperedOnly,
      forceShowZeroDeviation: temperedOnly && showCents,
    });
  });

  const hejiNamesKeys = degreeTexts.map((text, index) => {
    const degreeCents = scaleCents[index] ?? 0;
    const centsFromAnchor = ((degreeCents - anchorCents) % 1200 + 1200) % 1200;
    const ratioText = String(text).includes("/") ? text : null;
    return spelledHejiLabel(frame, ratioText, centsFromAnchor, {
      temperedOnly,
      suppressDeviation: !showCents || temperedOnly,
      forceShowZeroDeviation: temperedOnly && showCents,
    });
  });

  const hasExplicitHejiNoteNames = Array.isArray(noteNames)
    && noteNames.some((value) => canonicalHejiLabel(value ?? ""));
  const abstractDReference = hasExplicitHejiNoteNames
    ? deriveAbstractDReference(frame)
    : null;

  const dCandidates = hejiNamesKeys
    .map((label, degree) => {
      const pitchClassLabel = trimRenderedLabelToPitchClass(label);
      const parsed = pitchClassLabel ? parseHejiPitchClassLabel(pitchClassLabel) : null;
      if (!parsed || parsed.letter !== "D") return null;
      const monzo = workspaceMonzos[degree];
      if (!Array.isArray(monzo)) return null;
      const accidentalWeight = String(pitchClassLabel ?? "").replace(/[A-Ga-g]/g, "").length;
      const nonThreeComplexity = monzo.reduce((sum, value, index) => (
        index <= 1 ? sum : sum + Math.abs(value ?? 0)
      ), 0);
      return {
        degree,
        monzo,
        label: pitchClassLabel,
        accidentalWeight,
        nonThreeComplexity,
        absoluteFifthSteps: monzo[1] ?? 0,
        isNatural:
          parsed.baseId === "natural:0"
          && (parsed.schismaAmount ?? 0) === 0
          && (parsed.extraIds?.length ?? 0) === 0,
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
  const degreeMetadata = hejiNamesKeys.map((label, degree) => {
    const explicitSourceLabel = canonicalHejiLabel(noteNames?.[degree] ?? "");
    const renderedPitchClassLabel = trimRenderedLabelToPitchClass(label);
    const pitchClassLabel = explicitSourceLabel ?? renderedPitchClassLabel;
    const parsed = pitchClassLabel ? parseHejiPitchClassLabel(pitchClassLabel) : null;
    const monzo = Array.isArray(workspaceMonzos[degree]) ? workspaceMonzos[degree] : null;
    const absoluteFifthSteps = monzo?.[1] ?? null;
    const relativeFifthSteps =
      monzo && colorReferenceAbsoluteFifthSteps != null
        ? (monzo[1] ?? 0) - colorReferenceAbsoluteFifthSteps
        : null;
    return {
      degree,
      source: explicitSourceLabel ? "note_names" : "derived",
      renderedLabel: label,
      pitchClassLabel,
      parsed,
      notationRole: inferDegreeNotationRole(parsed),
      notationSide: inferDegreeNotationSide(parsed),
      absoluteFifthSteps,
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
    dReferenceDegree: dReference?.degree ?? null,
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

  const targetPitchClass = parseHejiPitchClassLabel(pitchClassLabel);
  if (targetPitchClass && anchorLabel && anchorRatioText) {
    try {
      const referenceFrame = createReferenceFrame({ anchorLabel, anchorRatio: anchorRatioText });
      if (referenceFrame.globalOffsetMonzo) {
        const absoluteMonzo = hejiToMonzo({ ...targetPitchClass, octave: referenceFrame.anchorOctave ?? 4 });
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
    const renderedPitchClass = renderedPitchClassText ? parseHejiPitchClassLabel(renderedPitchClassText) : null;
    if (!samePitchClass(renderedPitchClass, targetPitchClass)) continue;
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
