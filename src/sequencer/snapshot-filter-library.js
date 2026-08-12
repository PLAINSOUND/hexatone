// This module builds controller filter lists from sequencer snapshots.
// It turns stored snapshot note data into tuning-aware Lumatone and Continuum
// filter entries so the sequencer can feed controller-side snapshot recall.

import { findNearestDegree } from "../input/scale-mapper.js";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "../tuning/workspace.js";

function mod(value, modulus) {
  if (!modulus) return value;
  return ((value % modulus) + modulus) % modulus;
}

function noteFrequency(note) {
  const direct = Number(note?.frequency);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const pitch = Number(note?.midicents);
  if (!Number.isFinite(pitch)) return null;
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function referenceDegreeCents(runtime) {
  const scale = Array.isArray(runtime?.scale) ? runtime.scale : [];
  const referenceDegree = Number.isFinite(Number(runtime?.referenceDegree))
    ? Number(runtime.referenceDegree)
    : 0;
  return scale[referenceDegree] ?? 0;
}

function degree0Hz(runtime) {
  const fundamental = Number(runtime?.fundamental);
  if (!Number.isFinite(fundamental) || fundamental <= 0) return null;
  return fundamental / Math.pow(2, referenceDegreeCents(runtime) / 1200);
}

function absoluteCentsForFrequency(frequency, runtime) {
  const baseFrequency = degree0Hz(runtime);
  const hz = Number(frequency);
  if (!Number.isFinite(baseFrequency) || baseFrequency <= 0) return null;
  if (!Number.isFinite(hz) || hz <= 0) return null;
  return 1200 * Math.log2(hz / baseFrequency);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function normalizedRatioText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizedMonzoKey(monzo) {
  if (!Array.isArray(monzo)) return null;
  let end = monzo.length;
  while (end > 0 && Number(monzo[end - 1] ?? 0) === 0) end -= 1;
  return JSON.stringify(monzo.slice(0, end).map((value) => Number(value) || 0));
}

function buildExactDegreeLookup(runtime) {
  const degreeIntervals = Array.isArray(runtime?.degreeIntervals) ? runtime.degreeIntervals : [];
  if (!degreeIntervals.length) return null;
  const byMonzo = new Map();
  const byRatioText = new Map();
  degreeIntervals.forEach((interval, degree) => {
    const monzoKey = normalizedMonzoKey(interval?.monzo);
    if (monzoKey && !byMonzo.has(monzoKey)) byMonzo.set(monzoKey, degree);
    const ratioText = normalizedRatioText(
      typeof interval?.ratio?.toFraction === "function"
        ? interval.ratio.toFraction()
        : interval?.ratioText,
    );
    if (ratioText && !byRatioText.has(ratioText)) byRatioText.set(ratioText, degree);
  });
  return { byMonzo, byRatioText };
}

function exactDegreeForSnapshotNote(note, runtime) {
  const lookup = buildExactDegreeLookup(runtime);
  if (!lookup) return null;
  const monzoKey = normalizedMonzoKey(note?.monzo);
  if (monzoKey && lookup.byMonzo.has(monzoKey)) return lookup.byMonzo.get(monzoKey);
  const ratioText = normalizedRatioText(note?.ratioText);
  if (ratioText && lookup.byRatioText.has(ratioText)) return lookup.byRatioText.get(ratioText);
  return null;
}

function normalizeSnapshotRuntime(runtime) {
  const scale = Array.isArray(runtime?.scale) ? runtime.scale : [];
  if (scale.length > 0 && scale.every((entry) => Number.isFinite(Number(entry)))) {
    return {
      scale: scale.map((entry) => Number(entry)),
      equivInterval: Number(runtime?.equivInterval ?? 1200),
      referenceDegree: Number.isFinite(Number(runtime?.referenceDegree))
        ? Number(runtime.referenceDegree)
        : 0,
      fundamental: Number(runtime?.fundamental ?? 440),
    };
  }
  if (!scale.length) return null;
  const workspace = createScaleWorkspace({
    scale,
    reference_degree: runtime?.referenceDegree ?? runtime?.reference_degree ?? 0,
    fundamental: runtime?.fundamental ?? 440,
  });
  const normalized = normalizeWorkspaceForKeys(workspace);
  return {
    scale: normalized.scale,
    equivInterval: normalized.equivInterval,
    referenceDegree: Number.isFinite(Number(runtime?.referenceDegree))
      ? Number(runtime.referenceDegree)
      : Number.isFinite(Number(runtime?.reference_degree))
        ? Number(runtime.reference_degree)
        : 0,
    fundamental: Number(runtime?.fundamental ?? 440),
  };
}

export function deriveSnapshotDegreeList(notes, runtime) {
  const normalizedRuntime = normalizeSnapshotRuntime(runtime);
  const scale = Array.isArray(normalizedRuntime?.scale) ? normalizedRuntime.scale : [];
  const scaleLength = scale.length;
  if (!scaleLength || !Array.isArray(notes)) return [];
  const degrees = [];
  for (const note of notes) {
    const frequency = noteFrequency(note);
    const pitchCents = absoluteCentsForFrequency(frequency, normalizedRuntime);
    if (Number.isFinite(pitchCents)) {
      const nearest = findNearestDegree(
        pitchCents,
        scale,
        Number(normalizedRuntime?.equivInterval ?? 1200),
        Number.POSITIVE_INFINITY,
        "accept",
      );
      if (nearest) {
        degrees.push(mod(nearest.steps, scaleLength));
        continue;
      }
    }
    const exactDegree = exactDegreeForSnapshotNote(note, runtime);
    if (Number.isFinite(exactDegree)) degrees.push(mod(exactDegree, scaleLength));
  }
  return uniqueSorted(degrees);
}

export function deriveSnapshotFilterEntries(snapshots, runtime, prefix = "Snapshot") {
  if (!Array.isArray(snapshots)) return [];
  return snapshots
    .map((snapshot, index) => {
      const degrees = deriveSnapshotDegreeList(snapshot?.notes ?? [], runtime);
      if (degrees.length === 0) return null;
      return {
        id: `__snapshot__:${index + 1}`,
        name: `${prefix} ${index + 1}`,
        degrees,
      };
    })
    .filter(Boolean);
}
