// This module keeps exact snapshot pitch identity reconstructible after an
// event-list pitch/name edit. HEJI labels are relative to a notation frame, so
// the label alone is not enough: each captured note carries the compact monzo
// offset that maps its HEJI spelling back into the sequence ratio coordinate.

import { addMonzos, subtractMonzos } from "../notation/heji.js";
import { parseHejiToStructure, pitchStructureToMonzo } from "../notation/pitch-structure.js";
import {
  CANONICAL_MONZO_BASIS,
  monzoToCentsOnBasis,
  monzoToFractionOnBasis,
} from "../tuning/interval.js";

const DEFAULT_ANCHOR_OCTAVE = 4;
const PITCH_MATCH_TOLERANCE_CENTS = 0.01;

function cloneCanonicalMonzo(monzo) {
  if (!Array.isArray(monzo)) return null;
  return CANONICAL_MONZO_BASIS.map((_, index) => Number(monzo[index]) || 0);
}

function ratioTextFromMonzo(monzo) {
  const fraction = monzoToFractionOnBasis(monzo);
  const text = fraction.toFraction();
  return text.includes("/") ? text : `${text}/1`;
}

function hejiAbsoluteMonzo(label, anchorOctave = DEFAULT_ANCHOR_OCTAVE) {
  const structure = parseHejiToStructure(label);
  if (structure?.useTemperedAccidentals) return null;
  return structure ? pitchStructureToMonzo(structure, anchorOctave) : null;
}

function inferredGlobalOffsetMonzo(label, ratioMonzo, anchorOctave) {
  const absoluteMonzo = hejiAbsoluteMonzo(label, anchorOctave);
  const normalizedRatioMonzo = cloneCanonicalMonzo(ratioMonzo);
  if (!absoluteMonzo || !normalizedRatioMonzo) return null;
  return subtractMonzos(normalizedRatioMonzo, absoluteMonzo);
}

function midiCentsOffset(midicents, ratioMonzo) {
  const pitch = Number(midicents);
  const monzo = cloneCanonicalMonzo(ratioMonzo);
  if (!Number.isFinite(pitch) || !monzo) return null;
  return pitch * 100 - monzoToCentsOnBasis(monzo);
}

export function buildSnapshotRationalContext({
  displayLabel,
  monzo,
  midicents,
  referenceFrame = null,
  existingContext = null,
} = {}) {
  const anchorOctave = Number.isFinite(Number(referenceFrame?.anchorOctave))
    ? Number(referenceFrame.anchorOctave)
    : Number.isFinite(Number(existingContext?.anchorOctave))
      ? Number(existingContext.anchorOctave)
      : DEFAULT_ANCHOR_OCTAVE;
  const globalOffsetMonzo =
    cloneCanonicalMonzo(referenceFrame?.globalOffsetMonzo) ??
    cloneCanonicalMonzo(existingContext?.globalOffsetMonzo) ??
    inferredGlobalOffsetMonzo(displayLabel, monzo, anchorOctave);
  if (!globalOffsetMonzo) return null;

  const centsOffset = Number.isFinite(Number(existingContext?.midiCentsOffset))
    ? Number(existingContext.midiCentsOffset)
    : midiCentsOffset(midicents, monzo);

  return {
    version: 1,
    anchorLabel:
      String(referenceFrame?.anchorLabel ?? existingContext?.anchorLabel ?? "").trim() || null,
    anchorRatioText:
      String(referenceFrame?.anchorRatioText ?? existingContext?.anchorRatioText ?? "").trim() ||
      null,
    anchorOctave,
    globalOffsetMonzo,
    midiCentsOffset: Number.isFinite(centsOffset) ? centsOffset : null,
  };
}

export function rebuildSnapshotRationalIdentity(note, context = null) {
  const resolvedContext = buildSnapshotRationalContext({
    displayLabel: note?.originalDisplayLabel ?? note?.displayLabel,
    monzo: note?.monzo,
    midicents: note?.originalMidicents ?? note?.midicents,
    existingContext: context ?? note?.rationalContext,
  });
  if (!resolvedContext) return null;

  const absoluteMonzo = hejiAbsoluteMonzo(note?.displayLabel, resolvedContext.anchorOctave);
  if (!absoluteMonzo) return null;
  const monzo = cloneCanonicalMonzo(addMonzos(absoluteMonzo, resolvedContext.globalOffsetMonzo));
  if (!monzo) return null;

  const actualMidiCents = Number(note?.midicents) * 100;
  const midiOffset = Number(resolvedContext.midiCentsOffset);
  if (Number.isFinite(actualMidiCents) && Number.isFinite(midiOffset)) {
    const baseExpectedMidiCents = monzoToCentsOnBasis(monzo) + midiOffset;
    monzo[0] += Math.round((actualMidiCents - baseExpectedMidiCents) / 1200);
  }
  const expectedMidiCents = monzoToCentsOnBasis(monzo) + midiOffset;
  const pitchErrorCents =
    Number.isFinite(actualMidiCents) && Number.isFinite(expectedMidiCents)
      ? actualMidiCents - expectedMidiCents
      : null;

  return {
    ratioText: ratioTextFromMonzo(monzo),
    monzo,
    rationalContext: resolvedContext,
    pitchErrorCents,
    pitchMatches:
      pitchErrorCents == null || Math.abs(pitchErrorCents) <= PITCH_MATCH_TOLERANCE_CENTS,
  };
}
