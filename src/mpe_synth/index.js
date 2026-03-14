/**
 * mpe_synth — MPE (MIDI Polyphonic Expression) output.
 *
 * Each note gets its own voice channel, allocated from a VoicePool.
 * Pitch is expressed as pitch bend on the voice channel (14-bit, ±48 semitones
 * range so any microtonally retuned note fits within one bend range).
 *
 * MPE zone layout (lower zone, Ableton default):
 *   Master channel:  1  (or 16 for upper zone, or none)
 *   Voice channels:  mpe_lo_ch … mpe_hi_ch  (default 2–8)
 *
 * On master channel: program change, global CC, all-notes-off
 * On voice channels: note-on/off + pitch bend + channel pressure (aftertouch)
 */

import { VoicePool } from "../voice_pool";

// Convert absolute cents + reference settings to cents relative to MIDI note 60 (C4)
function centsToMidiCents(cents, fundamental, referenceRatio) {
  const ref = fundamental / referenceRatio;
  const refOffset = 1200 * Math.log2(ref / 261.6255653);
  return cents + refOffset;
}

export const create_mpe_synth = async (midi_output, master_ch, lo_ch, hi_ch, fundamental = 440, referenceRatio = 1, bendRange = 48) => {
  if (!midi_output) return null;

  // master_ch: 1-based MIDI channel number, or null/undefined for no master
  // lo_ch, hi_ch: 1-based MIDI channel numbers for voice pool
  const masterCh  = master_ch != null ? parseInt(master_ch) - 1 : null; // 0-based for send
  const voiceIds  = [];
  for (let ch = lo_ch; ch <= hi_ch; ch++) voiceIds.push(ch);
  const pool = new VoicePool(voiceIds); // slot = 1-based channel number

  // Send MPE zone configuration RPN on master channel
  if (masterCh !== null) {
    const numVoices = hi_ch - lo_ch + 1;
    // RPN 0x0006 (MPE config) = number of member channels
    // MSB select: CC 100 = 0x00, CC 101 = 0x06
    // Data entry: CC 6 = numVoices, CC 38 = 0
    midi_output.send([0xB0 + masterCh, 100, 0]);   // RPN LSB
    midi_output.send([0xB0 + masterCh, 101, 6]);   // RPN MSB (0x0006 = MPE config)
    midi_output.send([0xB0 + masterCh, 6, numVoices]); // data entry MSB
    midi_output.send([0xB0 + masterCh, 38, 0]);    // data entry LSB

    // Set pitch bend range on master channel (RPN 0x0000)
    midi_output.send([0xB0 + masterCh, 101, 0]);
    midi_output.send([0xB0 + masterCh, 100, 0]);
    midi_output.send([0xB0 + masterCh, 6, bendRange]);
    midi_output.send([0xB0 + masterCh, 38, 0]);
  }

  // Set pitch bend range on every voice channel
  for (const ch of voiceIds) {
    const c = ch - 1; // 0-based
    midi_output.send([0xB0 + c, 101, 0]);
    midi_output.send([0xB0 + c, 100, 0]);
    midi_output.send([0xB0 + c, 6, bendRange]);
    midi_output.send([0xB0 + c, 38, 0]);
  }

  return {
    makeHex: (coords, cents, velocity_played, steps, equaves, equivSteps, cents_prev, cents_next, note_played, bend, referenceRatio) => {
      return new MpeHex(coords, cents, velocity_played, midi_output, pool, fundamental, referenceRatio, bendRange);
    },
  };
};

/**
 * Convert a cents offset to a 14-bit pitch bend value.
 * Uses the configured bend range.
 */
function centsToBend(cents_offset, bendRange) {
  // 0x2000 = 8192 = centre (no bend)
  // Full range: -8192 (−bendRange semitones) … +8191 (+bendRange semitones)
  const ratio = 24 * cents_offset / (bendRange * 100); // bug????
  const raw   = Math.round(ratio * 8192);
  const clamped = Math.max(-8192, Math.min(8191, raw));
  return clamped + 8192; // unsigned 0–16383
}

/**
 * Nearest MIDI note and cents deviation for MIDI-relative cents.
 * e.g. 350¢ → note 3 (Eb4 relative to C4=0¢), deviation +50¢
 */
function centsToNoteAndBend(midi_cents) {
  const note_float = midi_cents / 100;
  const note       = Math.round(note_float);
  const deviation  = (note_float - note) * 100; // cents
  return { note: Math.max(0, Math.min(127, note + 60)), deviation };
}

function MpeHex(coords, cents, velocity_played, midi_output, pool, fundamental, referenceRatio, bendRange) {
  this.coords      = coords;
  this.cents       = cents;
  this.release     = false;
  this.midi_output = midi_output;
  this.pool        = pool;
  this.fundamental = fundamental;
  this.referenceRatio = referenceRatio;
  this.bendRange = bendRange;
  this.velocity    = Math.max(1, Math.min(127, velocity_played || 72));

  // Allocate voice channel — steal oldest if pool exhausted
  const { slot, stolen } = pool.noteOn(coords);
  if (stolen !== null) {
    // Send note-off on stolen channel immediately
    const sc = slot - 1;
    midi_output.send([0x80 + sc, this._stolenNote || 60, 0]);
  }
  this.channel = slot; // 1-based

  // Compute MIDI note and pitch bend for this pitch
  // Convert absolute cents to MIDI-relative cents using reference frequency
  const midi_cents = centsToMidiCents(cents, fundamental, referenceRatio);
  const { note, deviation } = centsToNoteAndBend(midi_cents);
  this.note = note;
  this.bend = centsToBend(deviation, bendRange);
}

MpeHex.prototype.noteOn = function () {
  const c = this.channel - 1; // 0-based for MIDI status byte
  // 1. Pitch bend first (before note-on, per MPE spec)
  const bendLSB = this.bend & 0x7F;
  const bendMSB = (this.bend >> 7) & 0x7F;
  this.midi_output.send([0xE0 + c, bendLSB, bendMSB]);
  // 2. Note on
  this.midi_output.send([0x90 + c, this.note, this.velocity]);
};

MpeHex.prototype.noteOff = function (release_velocity) {
  const c   = this.channel - 1;
  const vel = release_velocity != null ? release_velocity : this.velocity;
  this.midi_output.send([0x80 + c, this.note, vel]);
  this.pool.noteOff(this.coords);
};

MpeHex.prototype.retune = function (newCents) {
  this.cents = newCents;
  const midi_cents = centsToMidiCents(newCents, this.fundamental, this.referenceRatio);
  const { note, deviation } = centsToNoteAndBend(midi_cents);
  const bend    = centsToBend(deviation, this.bendRange);
  const c       = this.channel - 1;
  const bendLSB = bend & 0x7F;
  const bendMSB = (bend >> 7) & 0x7F;
  this.midi_output.send([0xE0 + c, bendLSB, bendMSB]);
  // Note number doesn't change mid-hold — only bend moves
};

MpeHex.prototype.aftertouch = function (value) {
  const c = this.channel - 1;
  // Channel pressure on the voice channel = MPE per-note pressure
  this.midi_output.send([0xD0 + c, Math.max(0, Math.min(127, value))]);
};

export default create_mpe_synth;
