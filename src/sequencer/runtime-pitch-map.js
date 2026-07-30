// This module remaps stored sequence notes into the current tuning runtime.
// It is used when Snap Sequence to Current Tuning is active, translating saved
// snapshot pitches into nearest current-scale pitches before playback.

import { findNearestDegree } from "../input/scale-mapper.js";

function mod(value, modulus) {
  if (!modulus) return value;
  return ((value % modulus) + modulus) % modulus;
}

function noteFrequency(midicents) {
  const pitch = Number(midicents);
  if (!Number.isFinite(pitch)) return null;
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function frequencyToMidicents(value) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  return 69 + Math.log2(frequency / 440) * 12;
}

function degree0ToReferenceCents(runtime) {
  const scale = Array.isArray(runtime?.scale) ? runtime.scale : [];
  const referenceDegree = Number.isFinite(Number(runtime?.referenceDegree))
    ? Number(runtime.referenceDegree)
    : 0;
  return scale[referenceDegree] ?? 0;
}

function degree0Hz(runtime) {
  const referenceFrequency = Number(runtime?.fundamental);
  if (!Number.isFinite(referenceFrequency) || referenceFrequency <= 0) return null;
  return referenceFrequency / Math.pow(2, degree0ToReferenceCents(runtime) / 1200);
}

function absoluteCentsForFrequency(frequency, runtime) {
  const baseFrequency = degree0Hz(runtime);
  if (!Number.isFinite(baseFrequency) || baseFrequency <= 0) return null;
  const hz = Number(frequency);
  if (!Number.isFinite(hz) || hz <= 0) return null;
  return 1200 * Math.log2(hz / baseFrequency);
}

function snappedAbsoluteCents(steps, runtime) {
  const scale = Array.isArray(runtime?.scale) ? runtime.scale : [];
  const scaleLength = scale.length;
  if (!scaleLength) return null;
  const octave = Math.floor(steps / scaleLength);
  const reducedDegree = mod(steps, scaleLength);
  return octave * Number(runtime?.equivInterval ?? 1200) + (scale[reducedDegree] ?? 0);
}

function frequencyForAbsoluteCents(cents, runtime) {
  const baseFrequency = degree0Hz(runtime);
  if (!Number.isFinite(baseFrequency) || baseFrequency <= 0) return null;
  return baseFrequency * Math.pow(2, Number(cents) / 1200);
}

function labelForDegree(reducedDegree, options = {}) {
  const hejiNames = Array.isArray(options.hejiNames) ? options.hejiNames : [];
  const noteNames = Array.isArray(options.noteNames) ? options.noteNames : [];
  return hejiNames[reducedDegree] ?? noteNames[reducedDegree] ?? "";
}

function displacedExactIdentity(steps, reducedDegree, runtime) {
  const interval = runtime?.degreeIntervals?.[reducedDegree] ?? null;
  const equave = runtime?.equaveIdentity ?? null;
  const scaleCents = Number(runtime?.scale?.[reducedDegree]);
  const equaveCents = Number(runtime?.equivInterval);
  if (
    !interval?.ratio?.toFraction ||
    !equave?.ratio?.pow ||
    !Number.isFinite(scaleCents) ||
    !Number.isFinite(equaveCents) ||
    Math.abs(Number(interval.cents) - scaleCents) > 0.001 ||
    Math.abs(Number(equave.cents) - equaveCents) > 0.001
  ) {
    return null;
  }

  const scaleLength = runtime.scale.length;
  const equavePower = Math.floor(steps / scaleLength);
  const ratio =
    equavePower > 0
      ? interval.ratio.mul(equave.ratio.pow(equavePower))
      : equavePower < 0
        ? interval.ratio.div(equave.ratio.pow(Math.abs(equavePower)))
        : interval.ratio;
  const ratioText = ratio.toFraction();
  const intervalMonzo = Array.isArray(interval.monzo) ? interval.monzo : null;
  const equaveMonzo = Array.isArray(equave.monzo) ? equave.monzo : null;
  const monzo =
    intervalMonzo && equaveMonzo
      ? Array.from(
          { length: Math.max(intervalMonzo.length, equaveMonzo.length) },
          (_, index) => (intervalMonzo[index] ?? 0) + equavePower * (equaveMonzo[index] ?? 0),
        )
      : intervalMonzo
        ? [...intervalMonzo]
        : null;

  return {
    ratioText: ratioText.includes("/") ? ratioText : `${ratioText}/1`,
    monzo,
  };
}

export function remapSequenceNoteToRuntime(note, runtime, options = {}) {
  const scale = Array.isArray(runtime?.scale) ? runtime.scale : [];
  const scaleLength = scale.length;
  if (!scaleLength) return note;
  const sourceFrequency =
    Number(note?.frequency) > 0 ? Number(note.frequency) : noteFrequency(note?.midicents);
  const pitchCents = absoluteCentsForFrequency(sourceFrequency, runtime);
  if (!Number.isFinite(pitchCents)) return note;
  const nearest = findNearestDegree(
    pitchCents,
    scale,
    Number(runtime?.equivInterval ?? 1200),
    Number.POSITIVE_INFINITY,
    "accept",
  );
  if (!nearest) return note;
  const nextAbsoluteCents = snappedAbsoluteCents(nearest.steps, runtime);
  const nextFrequency = frequencyForAbsoluteCents(nextAbsoluteCents, runtime);
  const nextMidicents = frequencyToMidicents(nextFrequency);
  if (!Number.isFinite(nextFrequency) || !Number.isFinite(nextMidicents)) return note;
  const reducedDegree = mod(nearest.steps, scaleLength);
  const exactIdentity = displacedExactIdentity(nearest.steps, reducedDegree, runtime);
  return {
    ...note,
    midicents: nextMidicents,
    frequency: nextFrequency,
    displayLabel: labelForDegree(reducedDegree, options) || note?.displayLabel || "",
    displayLabelEdited: false,
    ratioText: exactIdentity?.ratioText,
    monzo: exactIdentity?.monzo,
    // Source-frame modulation identities do not describe the newly snapped
    // pitch. Capture should omit them unless a future mapper can derive the
    // destination frame identity explicitly.
    modulationRatioText: undefined,
    modulationMonzo: undefined,
  };
}

export function remapSequenceSnapshotsToRuntime(snapshots, runtime, options = {}) {
  if (!Array.isArray(snapshots) || !Array.isArray(runtime?.scale) || runtime.scale.length === 0) {
    return snapshots ?? [];
  }
  return snapshots.map((snapshot) => ({
    ...snapshot,
    notes: Array.isArray(snapshot?.notes)
      ? snapshot.notes.map((note) => remapSequenceNoteToRuntime(note, runtime, options))
      : [],
  }));
}
