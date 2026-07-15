// This module owns pitch-frame resolution above committed scale data.
// It turns workspace slots plus notation structure into resolved pitch objects
// with ratio, cents, frequency, and display information for the UI.

import { addMonzos, subtractMonzos } from "./heji.js";
import { createPitchStructure, parseHejiToStructure, pitchStructureToMonzo } from "./pitch-structure.js";
import { getCommittedInterval, getWorkspaceSlot } from "../tuning/workspace.js";
import { monzoToFractionOnBasis, parseExactInterval } from "../tuning/interval.js";
import { normaliseHejiAnchorRatio } from "../settings/scale/parse-scale.js";

function cloneMonzo(monzo) {
  return Array.isArray(monzo) ? [...monzo] : null;
}

function intervalRatioText(interval) {
  if (interval?.ratio?.toFraction) {
    const text = interval.ratio.toFraction();
    return text.includes("/") ? text : `${text}/1`;
  }
  return interval?.sourceText ?? null;
}

function negateMonzo(monzo) {
  return Array.isArray(monzo) ? monzo.map((value) => -(value ?? 0)) : null;
}

function invertExactInterval(interval) {
  if (!interval?.exact || !Array.isArray(interval?.monzo)) {
    return {
      exact: false,
      cents: Number.isFinite(interval?.cents) ? -interval.cents : null,
      ratio: null,
      ratioText: null,
      monzo: null,
      sourceText: null,
    };
  }
  const ratio = monzoToFractionOnBasis(negateMonzo(interval.monzo));
  const ratioText = ratio.toFraction();
  return {
    ...parseExactInterval(ratioText.includes("/") ? ratioText : `${ratioText}/1`),
    ratioText: ratioText.includes("/") ? ratioText : `${ratioText}/1`,
  };
}

function combineExactIntervals(a, b) {
  if (!Array.isArray(a?.monzo) || !Array.isArray(b?.monzo)) return null;
  const monzo = addMonzos(a.monzo, b.monzo);
  const ratio = monzoToFractionOnBasis(monzo);
  const ratioText = ratio.toFraction();
  const parsed = parseExactInterval(ratioText.includes("/") ? ratioText : `${ratioText}/1`);
  return {
    ...parsed,
    ratioText: ratioText.includes("/") ? ratioText : `${ratioText}/1`,
  };
}

function buildDegreePitch(frame, slot) {
  if (!slot) return null;
  const degreeInterval = slot.committedIdentity ?? null;
  const notationToDegreeInterval = combineExactIntervals(
    frame.notationZeroToDegree0Interval,
    degreeInterval,
  );
  const notationToDegreeCents =
    Number.isFinite(slot.cents) && Number.isFinite(frame.degree0ToNotationZeroInterval?.cents)
      ? slot.cents - frame.degree0ToNotationZeroInterval.cents
      : null;
  const referenceSlot = getWorkspaceSlot(frame.workspace, frame.referenceDegree);
  const frequencyHz =
    Number.isFinite(frame.referenceFrequencyHz)
      && Number.isFinite(slot.cents)
      && Number.isFinite(referenceSlot?.cents)
      ? frame.referenceFrequencyHz * Math.pow(2, (slot.cents - referenceSlot.cents) / 1200)
      : null;

  return {
    degree: slot.degree,
    degreeInterval,
    notationToDegreeInterval,
    notationToDegreeMonzo: cloneMonzo(notationToDegreeInterval?.monzo),
    notationToDegreeRatioText: notationToDegreeInterval?.ratioText ?? intervalRatioText(notationToDegreeInterval),
    notationToDegreeCents,
    frequencyHz,
  };
}

export function buildPitchFrame(settings, workspace) {
  const notationZeroStructure = parseHejiToStructure(settings?.heji_anchor_label || "") ?? createPitchStructure({
    letter: "A",
  });
  const notationZeroAbsoluteMonzo = pitchStructureToMonzo(notationZeroStructure);
  const degree0ToNotationZeroInterval = parseExactInterval(
    normaliseHejiAnchorRatio(settings?.heji_anchor_ratio || "") || "1/1",
  );
  const notationZeroToDegree0Interval = invertExactInterval(degree0ToNotationZeroInterval);
  const degree0ToReferenceInterval = getCommittedInterval(workspace, settings?.reference_degree ?? 0);
  const notationZeroToReferenceInterval = combineExactIntervals(
    notationZeroToDegree0Interval,
    degree0ToReferenceInterval,
  );

  return {
    notationZero: {
      structure: notationZeroStructure,
      absoluteMonzo: cloneMonzo(notationZeroAbsoluteMonzo),
      label: settings?.heji_anchor_label || "",
    },
    degree0ToNotationZeroInterval: {
      ...degree0ToNotationZeroInterval,
      ratioText: intervalRatioText(degree0ToNotationZeroInterval),
    },
    notationZeroToDegree0Interval: {
      ...notationZeroToDegree0Interval,
      ratioText: intervalRatioText(notationZeroToDegree0Interval),
    },
    degree0ToReferenceInterval,
    notationZeroToReferenceInterval,
    referenceDegree: settings?.reference_degree ?? 0,
    referenceFrequencyHz: settings?.fundamental ?? 440,
    workspace,
    equaveInterval: workspace?.baseScale?.equaveInterval ?? null,
  };
}

export function resolveDegreePitch(frame, degree) {
  return buildDegreePitch(frame, getWorkspaceSlot(frame.workspace, degree));
}

export function resolveStructurePitch(frame, structure) {
  const targetStructure = createPitchStructure(structure);
  const absoluteMonzo = pitchStructureToMonzo(targetStructure);
  const notationRelativeMonzo = subtractMonzos(absoluteMonzo, frame.notationZero.absoluteMonzo);
  const ratio = monzoToFractionOnBasis(notationRelativeMonzo);
  const ratioText = ratio.toFraction();
  const interval = parseExactInterval(ratioText.includes("/") ? ratioText : `${ratioText}/1`);
  const degreeRelative = combineExactIntervals(frame.degree0ToNotationZeroInterval, interval);
  const referenceSlot = getWorkspaceSlot(frame.workspace, frame.referenceDegree);
  const degreeRelativeCents = degreeRelative?.cents ?? null;
  const frequencyHz =
    Number.isFinite(frame.referenceFrequencyHz)
      && Number.isFinite(degreeRelativeCents)
      && Number.isFinite(referenceSlot?.cents)
      ? frame.referenceFrequencyHz * Math.pow(2, (degreeRelativeCents - referenceSlot.cents) / 1200)
      : null;

  return {
    structure: targetStructure,
    notationRelativeMonzo,
    notationRelativeInterval: {
      ...interval,
      ratioText: ratioText.includes("/") ? ratioText : `${ratioText}/1`,
    },
    degreeRelativeInterval: degreeRelative,
    cents: degreeRelativeCents,
    frequencyHz,
  };
}

export function pitchToDisplayRatio(pitch) {
  return pitch?.notationToDegreeRatioText
    ?? pitch?.notationRelativeInterval?.ratioText
    ?? null;
}

export function pitchToDisplayCents(pitch) {
  return pitch?.notationToDegreeCents ?? pitch?.cents ?? null;
}

export function pitchToFrequency(pitch) {
  return pitch?.frequencyHz ?? null;
}
