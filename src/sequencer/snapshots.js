// This module owns snapshot capture/playback of currently sounding notes.
// It serializes live note state into a portable snapshot form and can reapply
// those notes back onto a Keys instance. It does not manage long-term
// sequencing timelines; it is the lightweight snapshot layer used by the app.

import Point from "../keyboard/point.js";

const normalizeVelocity = (value, fallback = 72) =>
  Math.max(1, Math.min(127, Math.round(value ?? fallback)));

function centsToReference(settings, tuning) {
  return settings.reference_degree > 0
    ? (tuning.scale[settings.reference_degree - 1] ?? 0)
    : 0;
}

function attackVelocityOf(hex, settings) {
  return normalizeVelocity(
    hex?.velocity_played ??
      hex?.velocity ??
      hex?._onVel ??
      settings.midi_velocity ??
      72,
  );
}

/**
 * Capture all currently sounding notes as scale-agnostic snapshot notes.
 *
 * @param {object} runtime Keys-like runtime with settings, tuning, state, and _allActiveHexes().
 * @returns {Array<{ midicents: number, attackVelocity: number, releaseVelocity: number, velocity: number }>}
 */
export function captureSnapshot(runtime) {
  const centsToRef = centsToReference(runtime.settings, runtime.tuning);
  const fund = runtime.settings.fundamental;
  const seen = new Map(); // rounded midicents string -> entry (dedup)

  const add = (hex, releaseVelocity = null) => {
    const freq = fund * Math.pow(2, (hex.cents - centsToRef) / 1200);
    const midicents = 69 + Math.log2(freq / 440) * 12;
    const key = midicents.toFixed(3);
    if (seen.has(key)) return;

    const attack = attackVelocityOf(hex, runtime.settings);
    const release = normalizeVelocity(releaseVelocity, attack);
    seen.set(key, {
      midicents,
      attackVelocity: attack,
      releaseVelocity: release,
      // Backward-compatible alias for older snapshot consumers.
      velocity: attack,
    });
  };

  for (const hex of runtime._allActiveHexes()) {
    add(hex);
  }
  for (const [hex, releaseVelocity] of runtime.state.sustainedNotes) {
    add(hex, releaseVelocity);
  }

  return Array.from(seen.values());
}

/**
 * Play snapshot notes through the current synth.
 *
 * Snapshot pitches are absolute MIDI floats. Playback converts them back to
 * synth-relative cents for the current fundamental/reference context.
 *
 * @param {object} runtime Keys-like runtime with settings, tuning, synth, and stopSnapshot().
 * @param {Array<{ midicents: number, attackVelocity?: number, releaseVelocity?: number, velocity?: number }>} notes
 * @returns {Array<object>} active snapshot hexes
 */
export function playSnapshot(runtime, notes) {
  runtime.stopSnapshot();

  const centsToRef = centsToReference(runtime.settings, runtime.tuning);
  const fund = runtime.settings.fundamental;
  const degree0toRefRatio = runtime.tuning.degree0toRef_asArray?.[1] ?? 1;

  return notes.map((note, index) => {
    const attackVelocity = normalizeVelocity(note.attackVelocity ?? note.velocity);
    const releaseVelocity = normalizeVelocity(note.releaseVelocity, attackVelocity);
    const freq = 440 * Math.pow(2, (note.midicents - 69) / 12);
    const synthCents = centsToRef + Math.log2(freq / fund) * 1200;
    const dummyCoords = new Point(9000 + index, 9000 + index);
    const hex = runtime.synth.makeHex(
      dummyCoords,
      synthCents,
      0,
      0,
      runtime.tuning.equivSteps,
      synthCents,
      synthCents,
      undefined,
      attackVelocity,
      0,
      degree0toRefRatio,
    );
    hex._snapshotReleaseVelocity = releaseVelocity;
    hex.noteOn();
    return hex;
  });
}

/**
 * Stop snapshot playback.
 *
 * @param {Array<object>} snapshotHexes active snapshot hexes
 */
export function stopSnapshot(snapshotHexes) {
  if (!snapshotHexes?.length) return;
  for (const hex of snapshotHexes) {
    hex.noteOff(hex._snapshotReleaseVelocity ?? 0);
  }
}
