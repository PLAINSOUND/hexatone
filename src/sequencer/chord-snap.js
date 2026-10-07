// Prototype: bounded shared-shift search, not independent per-note tolerance.
// Input/output are absolute cents in the same tuning frame. See B09 in
// docs/app-context.md. No clocks, voice mutation, or source-data mutation here.
import { findNearestDegree } from "../input/scale-mapper.js";

export const DEFAULT_CHORD_DRIFT = 20;
export function clampChordDrift(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(50, number)) : DEFAULT_CHORD_DRIFT;
}

function intervalWeight(interval, heldPair) {
  const simple = [0, 1200, 1200 * Math.log2(3 / 2), 1200 * Math.log2(4 / 3)];
  const reduced = Math.abs(interval) % 1200;
  const distance = Math.min(...simple.map(target => Math.abs(reduced - target)));
  return (distance <= 15 ? 3 : 1) * (heldPair ? 2 : 1);
}

export function chooseChordSteps(pitches, runtime, drift = DEFAULT_CHORD_DRIFT, held = []) {
  const { scale, equivInterval: equave = 1200 } = runtime;
  const nearest = pitch => findNearestDegree(pitch, scale, equave, Infinity, "accept").steps;
  const cents = steps => Math.floor(steps / scale.length) * equave +
    scale[((steps % scale.length) + scale.length) % scale.length];
  const baseline = pitches.map(nearest);
  const allowance = clampChordDrift(drift);
  // Bound cold-cache work on large chords/scales; ordinary Snap is the fallback.
  // At zero, preserve the exact existing nearest-degree tie behaviour.
  if (!allowance || pitches.length < 2 || pitches.length > 32 ||
      pitches.length * scale.length * (2 * Math.ceil(allowance) + 1) > 250000)
    return baseline;
  const baseCents = baseline.map(cents);
  const weights = pitches.map((pitch, i) => pitches.map((other, j) =>
    intervalWeight(pitch - other, held[i] && held[j])));
  const score = values => {
    const movements = values.map((value, i) => value - baseCents[i]);
    const mean = movements.reduce((sum, value) => sum + value, 0) / values.length;
    if (Math.abs(mean) > allowance + 1e-7) return Infinity;
    let cost = mean * mean * 0.1;
    for (let i = 0; i < values.length; i++) {
      // Prefer a common displacement; do not reward individual wandering.
      cost += (movements[i] - mean) ** 2 * 0.1;
      for (let j = 0; j < i; j++) {
        const error = (values[i] - values[j]) - (pitches[i] - pitches[j]);
        cost += weights[i][j] * error * error;
      }
    }
    return cost;
  };
  let best = baseline;
  let bestScore = score(baseCents);
  const seen = new Set([baseline.join(",")]);
  // One-cent grid is deliberately approximate and bounded for this prototype.
  // Test both directions with deterministic tie-breaking (nearest wins ties).
  for (let distance = 1; distance <= Math.ceil(allowance); distance++) {
    for (const direction of [-1, 1]) {
      const shift = Math.min(distance, allowance) * direction;
      const candidate = pitches.map(pitch => nearest(pitch + shift));
      const key = candidate.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const values = candidate.map(cents);
      // Do not create a new crossing or collapse distinct source pitches.
      if (values.some((value, i) => values.some((other, j) =>
        pitches[i] < pitches[j] - 1e-7 && value >= other - 1e-7))) continue;
      const cost = score(values);
      if (cost < bestScore - 1e-7) { bestScore = cost; best = candidate; }
    }
  }
  return best;
}
