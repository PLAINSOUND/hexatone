/**
 * Pure functions extracted from keys.js for testability.
 *
 * These are the coordinate-space and MIDI-channel calculations that are
 * currently embedded as methods on the Keys class.  Exporting them here
 * lets us unit-test them without constructing a full Keys instance (which
 * requires a canvas, AudioContext, WebMidi, etc.).
 *
 * Usage in keys.js — replace the inline bodies with calls to these:
 *
 *   import { roundTowardZero, hexCoordsToCents,
 *            channelOffset, midiStepsToCoords } from './keyboard_math';
 */

import Euclid from './euclidean';
import Point from './point';

// ── Rounding ──────────────────────────────────────────────────────────────────

export const roundTowardZero = (val) =>
  val < 0 ? Math.ceil(val) : Math.floor(val);

// ── Hex coordinate → pitch ────────────────────────────────────────────────────

/**
 * Convert a hex grid coordinate to cents (and related values).
 *
 * @param {Point}  coords    - hex grid position {x, y}
 * @param {object} settings  - { rSteps, drSteps, scale (cents array), equivInterval, equivSteps }
 * @returns {[number, number, number, number, number, number, number]}
 *   [cents, reducedSteps, distance, octs, equivSteps, cents_prev, cents_next]
 */
export const hexCoordsToCents = (coords, settings) => {
  const { rSteps, drSteps, scale, equivInterval, equivSteps } = settings;
  const len = scale.length;

  const distance = (coords.x * rSteps) + (coords.y * drSteps);

  let octs      = roundTowardZero(distance / len);
  let octs_prev = roundTowardZero((distance - 1) / len);
  let octs_next = roundTowardZero((distance + 1) / len);

  let reducedSteps      = distance % len;
  let reducedSteps_prev = (distance - 1) % len;
  let reducedSteps_next = (distance + 1) % len;

  if (reducedSteps < 0)      { reducedSteps      += len; octs      -= 1; }
  if (reducedSteps_prev < 0) { reducedSteps_prev += len; octs_prev -= 1; }
  if (reducedSteps_next < 0) { reducedSteps_next += len; octs_next -= 1; }

  const cents      = octs      * equivInterval + scale[reducedSteps];
  const cents_prev = octs_prev * equivInterval + scale[reducedSteps_prev];
  const cents_next = octs_next * equivInterval + scale[reducedSteps_next];

  return [cents, reducedSteps, distance, octs, equivSteps, cents_prev, cents_next];
};

// ── MIDI channel → equave offset ─────────────────────────────────────────────

/**
 * Compute equave offset from a Lumatone MIDI channel number.
 * The Lumatone sends notes on channels 1–8; the central channel is
 * midiin_channel (0-indexed).  The wrapping arithmetic maps any channel
 * to an offset in the range -4 … +3.
 *
 * @param {number} midiChannel     - 1-indexed MIDI channel from the message
 * @param {number} midiin_channel  - 0-indexed central channel from settings
 * @returns {number} equave offset (-4 to +3)
 */
export const channelOffset = (midiChannel, midiin_channel) =>
  (((midiChannel - 1 - midiin_channel) + 20) % 8) - 4;

// ── MIDI note + channel → hex coords ─────────────────────────────────────────

/**
 * Convert a MIDI note-on event to hex grid coordinates.
 * Returns a Point if the note maps to a valid grid position, or null if
 * the note number doesn't land on a grid intersection (remainder != 0).
 *
 * @param {object} settings - { midiin_degree0, midiin_channel, equivSteps, rSteps, drSteps, gcd }
 * @param {number} noteNumber   - MIDI note number (0-127)
 * @param {number} midiChannel  - 1-indexed MIDI channel
 * @returns {Point|null}
 */
export const midiNoteToCoords = (settings, noteNumber, midiChannel) => {
  const { midiin_degree0, midiin_channel, equivSteps, rSteps, drSteps, gcd } = settings;

  const offset = channelOffset(midiChannel, midiin_channel);
  const steps  = (noteNumber - midiin_degree0) + (offset * equivSteps);

  const rSteps_count   = Math.round(steps / rSteps);
  const rSteps_to_steps = rSteps * rSteps_count;

  const drSteps_count   = Math.round((steps - rSteps_to_steps) / drSteps);
  const drSteps_to_steps = drSteps * drSteps_count;

  const gcdSteps_count   = Math.floor((steps - rSteps_to_steps - drSteps_to_steps) / gcd[0]);
  const gcdSteps_to_steps = gcdSteps_count * gcd[0];

  const remainder = steps - rSteps_to_steps - drSteps_to_steps - gcdSteps_to_steps;

  if (remainder !== 0) return null;

  return new Point(
    rSteps_count  + (gcdSteps_count * gcd[1]),
    drSteps_count + (gcdSteps_count * gcd[2])
  );
};
