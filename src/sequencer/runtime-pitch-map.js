// This module remaps stored sequence notes into the current tuning runtime.
// It is used when Snap Sequence to Current Tuning is active, translating saved
// snapshot pitches into nearest current-scale pitches before playback.

import { findNearestDegree } from "../input/scale-mapper.js";
import { noteIdentity } from "./value-runtime.js";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "../tuning/workspace.js";
import { chooseChordSteps, clampChordDrift, chordSearchWithinBudget } from "./chord-snap.js";

const chordCache = new Map();
const formationMappings = new WeakMap();

function chordPitches(notes, runtime) {
  return notes.map(note => absoluteCentsForFrequency(
    Number(note.frequency) > 0 ? Number(note.frequency) : noteFrequency(note.midicents), runtime));
}

export function prepareSequenceChord(notes, runtime, options) {
  if (!runtime?.scale?.length || !options.chordAware || !options.chordSolver) return;
  if (!chordSearchWithinBudget(notes.length, runtime.scale.length, options.chordDrift)) return;
  const pitches = chordPitches(notes, runtime);
  if (pitches.every(Number.isFinite))
    options.chordSolver.prepare(pitches, runtime, options.chordDrift, notes.map(note => !!note.held));
}

export function withSequenceSnapGroup(notes) {
  const pitches = notes.map(note => ({
    ...(note.sequenceOriginalPitch ?? { midicents: Number(note.midicents), frequency: note.frequency }),
    held: note.legatoContinuation === true,
  }));
  return notes.map((note, index) => ({ ...note, sequenceSnapGroup: { pitches, index } }));
}

export function remapSequenceChordToRuntime(notes, runtime, options = {}) {
  const drift = options.chordAware ? clampChordDrift(options.chordDrift) : 0;
  if (!drift || notes.length < 2 || !runtime?.scale?.length)
    return notes.map(note => remapSequenceNoteToRuntime(note, runtime, options));
  const pitches = chordPitches(notes, runtime);
  if (pitches.some(pitch => !Number.isFinite(pitch)))
    return notes.map(note => remapSequenceNoteToRuntime(note, runtime, options));
  let steps;
  if (options.chordLiveEdit) {
    // Explicit user edits may resolve the sounding formation immediately.
    // chooseChordSteps enforces the same search budget as the worker; normal
    // attacks must continue using ready background decisions only.
    steps = chooseChordSteps(pitches, runtime, drift, notes.map(note => !!note.held));
  } else if (options.chordSolver) {
    const held = notes.map(note => !!note.held);
    steps = options.chordReadOnly
      ? options.chordSolver.read(pitches, runtime, drift, held) ?? chooseChordSteps(pitches, runtime, 0)
      : options.chordSolver.choose(pitches, runtime, drift, held);
  } else {
    // Pure callers retain synchronous optimisation for offline/tests, but do
    // not retain arbitrarily large fallback arrays or cache keys.
    if (!chordSearchWithinBudget(notes.length, runtime.scale.length, drift))
      return notes.map(note => remapSequenceNoteToRuntime(note, runtime, options));
    const key = JSON.stringify([runtime.scale, runtime.equivInterval, runtime.fundamental,
      runtime.referenceDegree, pitches, notes.map(note => !!note.held), drift]);
    steps = chordCache.get(key);
    if (!steps) {
      steps = chooseChordSteps(pitches, runtime, drift, notes.map(note => !!note.held));
      if (chordCache.size >= 256) chordCache.delete(chordCache.keys().next().value);
      chordCache.set(key, steps);
    }
  }
  return notes.map((note, index) => remapSequenceNoteAtSteps(note, runtime, steps[index], options));
}

export function resolveSequenceSnapRuntime(settings, liveRuntime, sourceSettings = {}) {
  if (!Array.isArray(settings.scale) || !settings.scale.length) return null;
  const sameScale = !Array.isArray(sourceSettings.scale) ||
    JSON.stringify(sourceSettings.scale) === JSON.stringify(settings.scale);
  const sameReference = sourceSettings.reference_degree == null ||
    sourceSettings.reference_degree === (settings.reference_degree ?? 0);
  if (sameScale && sameReference && liveRuntime?.scale?.length) {
    const oldFundamental = Number(sourceSettings.fundamental);
    const nextFundamental = Number(settings.fundamental);
    // App renders before the imperative Keys fundamental update. Account for
    // that handoff now, retaining any live modulation/preview transposition.
    return oldFundamental > 0 && nextFundamental > 0 && oldFundamental !== nextFundamental
      ? { ...liveRuntime, fundamental: liveRuntime.fundamental * nextFundamental / oldFundamental }
      : liveRuntime;
  }
  const tuning = normalizeWorkspaceForKeys(createScaleWorkspace(settings));
  return { ...tuning, fundamental: settings.fundamental,
    referenceDegree: settings.reference_degree ?? 0, equaveIdentity: tuning.equaveInterval };
}

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
  );
  if (!nearest) return note;
  return remapSequenceNoteAtSteps(note, runtime, nearest.steps, options);
}

function remapSequenceNoteAtSteps(note, runtime, steps, options) {
  const nextAbsoluteCents = snappedAbsoluteCents(steps, runtime);
  const nextFrequency = frequencyForAbsoluteCents(nextAbsoluteCents, runtime);
  const nextMidicents = frequencyToMidicents(nextFrequency);
  if (!Number.isFinite(nextFrequency) || !Number.isFinite(nextMidicents)) return note;
  const reducedDegree = mod(steps, runtime.scale.length);
  const exactIdentity = displacedExactIdentity(steps, reducedDegree, runtime);
  const destinationLabel = labelForDegree(reducedDegree, options) || note?.displayLabel || "";
  return {
    ...note,
    midicents: nextMidicents,
    frequency: nextFrequency,
    displayLabel: destinationLabel,
    // Event rows prefer hejiName over displayLabel. Never retain the source
    // tuning's spelling in this playback/display-only projection.
    hejiName: destinationLabel,
    displayLabelEdited: false,
    ratioText: exactIdentity?.ratioText,
    monzo: exactIdentity?.monzo,
    // The source note's HEJI equation belongs to its original tuning. A later
    // capture can infer a fresh context from this remapped label and monzo.
    rationalContext: undefined,
    // Source-frame modulation identities do not describe the newly snapped
    // pitch. Capture should omit them unless a future mapper can derive the
    // destination frame identity explicitly.
    modulationRatioText: undefined,
    modulationMonzo: undefined,
  };
}

// Resolve every attack from its stored source, never from a previous snap.
export function resolveLiveSequencePitch(note, runtime = null, pitchOffsetCents = 0, options = {}) {
  const source = note.sequenceOriginalPitch ?? {
    midicents: Number(note.midicents), frequency: note.frequency,
  };
  const original = { ...note, ...source };
  const group = note.sequenceSnapGroup;
  let chosen = null;
  if (runtime && options.chordAware && group) {
    const key = JSON.stringify([runtime.scale, runtime.equivInterval, runtime.fundamental,
      runtime.referenceDegree, options.chordDrift]);
    const entries = formationMappings.get(group.pitches) ?? [];
    let entry = entries.find(item => item.key === key && item.solver === options.chordSolver &&
      item.token === options.decisionToken);
    if (!entry) {
      entry = { key, solver: options.chordSolver, token: options.decisionToken,
        notes: remapSequenceChordToRuntime(group.pitches, runtime, options) };
      // Freeze a complete formation's decision (including a cold fallback).
      // A worker completion may only benefit a NEW formation, never its later
      // attacks or a background render halfway through an arpeggio.
      if (entries.length >= 4) entries.shift();
      entries.push(entry);
      formationMappings.set(group.pitches, entries);
    }
    chosen = entry.notes[group.index];
  }
  const mapped = runtime ? (chosen ? { ...original, ...chosen } : remapSequenceNoteToRuntime(original, runtime, options)) : original;
  const midicents = Number(mapped.midicents) + (Number(pitchOffsetCents) || 0) / 100;
  return { ...mapped, midicents, frequency: noteFrequency(midicents), sequenceOriginalPitch: source };
}

export function remapSequenceSnapshotsToRuntime(snapshots, runtime, options = {}) {
  if (!Array.isArray(snapshots) || !Array.isArray(runtime?.scale) || runtime.scale.length === 0) {
    return snapshots ?? [];
  }
  return snapshots.map((snapshot) => ({
    ...snapshot,
    notes: Array.isArray(snapshot?.notes)
      ? withSequenceSnapGroup(snapshot.notes).map((note) =>
          resolveLiveSequencePitch(
            // Legacy note identities include pitch. Freeze that source identity
            // in this playback-only projection before SNAP changes the pitch,
            // so active voices and their releases still match across toggles.
            { ...note, id: noteIdentity(note, snapshot.length ?? 1),
              sequenceOriginalPitch: note.sequenceOriginalPitch ?? {
                midicents: Number(note.midicents), frequency: note.frequency,
              } },
            runtime,
            0, options,
          ),
        )
      : [],
  }));
}
