/**
 * mpe_synth — MPE output.
 *
 * Key design decisions:
 *
 * PB → noteOn timing:
 *   Uses WebMIDI's send(data, timestamp) to schedule noteOn exactly PB_GUARD_MS
 *   after the pitch-bend message, at the MIDI driver level with sub-ms precision.
 *   No setTimeout — no timer jitter, no 4ms browser minimum.
 *
 * Release tails:
 *   After noteOff, a channel stays in RELEASING state for releaseGuardMs (default
 *   300ms). No PB reset is sent during this window — the tail decays undisturbed
 *   at the note's own pitch. The channel becomes IDLE when the guard expires, and
 *   the correct PB is set before the next noteOn that uses it.
 *
 * Voice stealing:
 *   Prefers IDLE > oldest-RELEASING > oldest-SOUNDING.
 *   Optional closestPitchSteal mode (useful for slow-release microtonal presets)
 *   selects the SOUNDING channel whose bend is nearest to the incoming note's
 *   bend, minimising the audible pitch jump on the stolen tail.
 */

import { VoicePool } from "../voice_pool_oldest";
import { scalaToCents } from "../settings/scale/parse-scale";

// Time (ms) between sending PB and sending noteOn on the same channel.
// 2ms is enough for virtually all synths; increase if you still hear attack glitches.
const PB_GUARD_MS = 2;

function calculateFreqAtCentralDegree(fundamental, reference_degree, center_degree, scale, equivSteps, equave) {
  let ref_cents = 0;
  if (reference_degree > 0) ref_cents = scalaToCents(scale[reference_degree - 1]);
  let center_cents = 0;
  if (center_degree > 0) center_cents = scalaToCents(scale[center_degree - 1]);
  const freq_at_degree_0 = fundamental / Math.pow(2, ref_cents / 1200);
  return freq_at_degree_0 * Math.pow(2, center_cents / 1200);
}

function freqToMidiAndCents(freq, center_degree, channel, scale, mode) {
  let center_cents = 0;
  if (center_degree > 0) center_cents = scalaToCents(scale[center_degree - 1]);
  const targetMidi = 69 + 12 * Math.log2(freq / 440) - center_cents * 0.01;

  let note, deviation;
  if (mode === 'Ableton_workaround') {
    const baseNote = channel % 16;
    const octaveOffset = Math.round((targetMidi - baseNote) / 16);
    note = baseNote + octaveOffset * 16;
    if (note > 127) note = baseNote + Math.floor((127 - baseNote) / 16) * 16;
    else if (note < 0) note = baseNote;
    deviation = (targetMidi - note) * 100.0;
  } else {
    note = Math.max(0, Math.min(127, Math.round(targetMidi)));
    deviation = (targetMidi - note) * 100.0;
  }
  return { note, deviation };
}

function deviationToBend(cents_offset, bendRange) {
  const ratio   = cents_offset / (bendRange * 100);
  const raw     = Math.round(ratio * 8192);
  const clamped = Math.max(-8192, Math.min(8191, raw));
  return clamped + 8192; // unsigned 0–16383
}

function sendBend(midi_output, channel0, bend, timestamp) {
  const lsb = bend & 0x7F;
  const msb = (bend >> 7) & 0x7F;
  midi_output.send([0xE0 + channel0, lsb, msb], timestamp);
}

export const create_mpe_synth = async (
  midi_output,
  master_ch,
  lo_ch,
  hi_ch,
  fundamental        = 440,
  reference_degree   = 0,
  center_degree      = 0,
  midiin_central_degree = 60,
  scale,
  mpe_mode           = 'Ableton_workaround',
  bendRange          = 48,
  equivSteps         = 12,
  equave             = 2,
  releaseGuardMs     = 300,   // ms — should match your synth's longest release
  closestPitchSteal  = false  // true = steal closest-pitch SOUNDING voice
) => {
  if (!midi_output) return null;

  const actualBendRange = mpe_mode === 'Ableton_workaround' ? 48 : bendRange;
  const masterCh        = master_ch != null ? parseInt(master_ch) - 1 : null;
  const voiceIds        = [];
  for (let ch = lo_ch; ch <= hi_ch; ch++) voiceIds.push(ch);

  const pool = new VoicePool(voiceIds, releaseGuardMs, closestPitchSteal);

  const freqAtCentral    = calculateFreqAtCentralDegree(fundamental, reference_degree, center_degree, scale, equivSteps, equave);
  const midiNoteForDegree0 = midiin_central_degree + center_degree;

  // MPE zone RPN on master channel
  if (masterCh !== null) {
    const numVoices = hi_ch - lo_ch + 1;
    midi_output.send([0xB0 + masterCh, 100, 0]);
    midi_output.send([0xB0 + masterCh, 101, 6]);
    midi_output.send([0xB0 + masterCh, 6, numVoices]);
    midi_output.send([0xB0 + masterCh, 38, 0]);
    midi_output.send([0xB0 + masterCh, 101, 0]);
    midi_output.send([0xB0 + masterCh, 100, 0]);
    midi_output.send([0xB0 + masterCh, 6, actualBendRange]);
    midi_output.send([0xB0 + masterCh, 38, 0]);
  }

  // Pitch-bend range RPN and initial centred PB on every voice channel
  for (const ch of voiceIds) {
    const c = ch - 1;
    midi_output.send([0xB0 + c, 101, 0]);
    midi_output.send([0xB0 + c, 100, 0]);
    midi_output.send([0xB0 + c, 6, actualBendRange]);
    midi_output.send([0xB0 + c, 38, 0]);
    midi_output.send([0xE0 + c, 0, 64]); // 8192 = centred
  }

  return {
    makeHex: (coords, cents, steps, equaves, equivSteps, cents_prev, cents_next,
              note_played, velocity_played, bend, degree0toRef_ratio) => {
      return new MpeHex(
        coords, cents, velocity_played, steps, center_degree,
        midi_output, pool,
        freqAtCentral, midiNoteForDegree0,
        actualBendRange, mpe_mode, scale,
        note_played
      );
    },
  };
};

function MpeHex(coords, cents, velocity_played, steps, center_degree,
                midi_output, pool, freqAtCentral, midiNoteForDegree0,
                bendRange, mode, scale, note_played) {
  this.coords            = coords;
  this.cents             = cents;
  this.steps             = steps;
  this.center_degree     = center_degree;
  this.release           = false;
  this.midi_output       = midi_output;
  this.pool              = pool;
  this.freqAtCentral     = freqAtCentral;
  this.midiNoteForDegree0 = midiNoteForDegree0;
  this.bendRange         = bendRange;
  this.mode              = mode;
  this.scale             = scale;
  this.velocity          = Math.max(1, Math.min(127, velocity_played || 72));
  this.note_played       = note_played;

  // Calculate the pitch we need before allocating, so closestPitchSteal can use it
  const freq                = freqAtCentral * Math.pow(2, cents / 1200);
  // channel not yet known, use placeholder 1 for Ableton mode (corrected below)
  const { note: noteGuess } = freqToMidiAndCents(freq, center_degree, 1, scale, mode);
  const bendGuess           = deviationToBend((69 + 12 * Math.log2(freq / 440) - noteGuess) * 100, bendRange);

  const { slot, stolen, stolenSlot, stolenNote, retrigger } =
    pool.noteOn(coords, bendGuess);

  // Kill the stolen voice BEFORE sending our own PB — noteOff on its channel.
  // The stolen channel's state is already RELEASING in the pool.
  // We do NOT send a PB reset to it — its tail decays at the original pitch.
  if (stolen !== null) {
    const ssc = stolenSlot - 1;
    midi_output.send([0x80 + ssc, stolenNote, 0]);
  }

  this.channel = slot; // 1-based

  // Recalculate with actual channel (matters for Ableton_workaround mode)
  const { note, deviation } = freqToMidiAndCents(freq, center_degree, this.channel, scale, mode);
  this.note = note;
  this.bend = deviationToBend(deviation, bendRange);

  // Send PB now, schedule noteOn PB_GUARD_MS later using WebMIDI timestamps.
  // This is processed by the MIDI driver scheduler — no setTimeout jitter.
  const c    = this.channel - 1;
  const now  = performance.now();
  sendBend(midi_output, c, this.bend, now);
  midi_output.send([0x90 + c, this.note, this.velocity], now + PB_GUARD_MS);

  pool.setLastBend(this.channel, this.bend);
  pool.setLastNote(this.channel, this.note);
}

MpeHex.prototype.noteOn = function () {
  // noteOn was already scheduled in the constructor via WebMIDI timestamp.
  // This method is called by keys.js after construction — nothing to do here.
};

MpeHex.prototype.noteOff = function (release_velocity) {
  const c   = this.channel - 1;
  const vel = release_velocity != null ? release_velocity : this.velocity;
  // Send noteOff immediately — no PB reset
  this.midi_output.send([0x80 + c, this.note, vel]);
  // Mark RELEASING in pool (starts the guard timer)
  this.pool.noteOff(this.coords);
  // Guard against aftertouch arriving after release
  this.release = true;
};

/**
 * Retune a held note to newCents.
 * Sends a single pitch bend update — no interpolation timers.
 * The UI interaction already provides natural rate limiting.
 * If the MIDI note number needs to change, sends noteOff → PB → noteOn
 * using WebMIDI timestamps.
 */
MpeHex.prototype.retune = function (newCents) {
  this.cents = newCents;

  const freq               = this.freqAtCentral * Math.pow(2, newCents / 1200);
  const { note, deviation } = freqToMidiAndCents(freq, this.center_degree, this.channel, this.scale, this.mode);
  const newBend            = deviationToBend(deviation, this.bendRange);
  const c                  = this.channel - 1;

  if (note !== this.note) {
    // Note number change: noteOff → PB → noteOn with timing guard
    const now = performance.now();
    this.midi_output.send([0x80 + c, this.note, this.velocity], now);
    this.note = note;
    this.bend = newBend;
    this.pool.setLastBend(this.channel, this.bend);
    this.pool.setLastNote(this.channel, this.note);
    sendBend(this.midi_output, c, this.bend, now + 0.5);
    this.midi_output.send([0x90 + c, this.note, this.velocity], now + PB_GUARD_MS);
  } else {
    // Same note: single PB update, no timing guard needed
    this.bend = newBend;
    this.pool.setLastBend(this.channel, this.bend);
    sendBend(this.midi_output, c, this.bend);
  }
};

MpeHex.prototype.aftertouch = function (value) {
  if (this.release) return;
  const c = this.channel - 1;
  this.midi_output.send([0xD0 + c, Math.max(0, Math.min(127, value))]);
};

export default create_mpe_synth;