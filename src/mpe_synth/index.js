/**
 * mpe_synth — MPE (MIDI Polyphonic Expression) output.
 *
 * Each note gets its own voice channel, allocated from a VoicePool.
 * Pitch is expressed as pitch bend on the voice channel.
 *
 * Two modes:
 * - Ableton_workaround: pitch bend range fixed at 48, MIDI note constrained to satisfy
 *   note % 16 = channel (so Ableton can reconstruct the channel from the note number)
 * - Full_MPE: user-selectable pitch bend range 1-96, nearest MIDI note + pitch bend
 *
 * MPE zone layout (lower zone, Ableton default):
 *   Master channel:  1  (or 16 for upper zone, or none)
 *   Voice channels:  mpe_lo_ch … mpe_hi_ch  (default 2–8)
 *
 * On master channel: program change, global CC, all-notes-off
 * On voice channels: note-on/off + pitch bend + channel pressure (aftertouch)
 */

import { VoicePool } from "../voice_pool";
import { scalaToCents } from "../settings/scale/parse-scale";

/**
 * Calculate the frequency at central degree.
 */
function calculateFreqAtCentralDegree(fundamental, reference_degree, center_degree, scale, equivSteps, equave) {
  // Calculate cents offset from reference degree to center degree
  let ref_cents_from_degree0 = 0;
  if (reference_degree > 0) {
    ref_cents_from_degree0 = scalaToCents(scale[reference_degree - 1]);
  }
  let centraldegree_cents_from_degree0 = 0;
  if (center_degree > 0) {
    centraldegree_cents_from_degree0 = scalaToCents(scale[center_degree - 1]);
  }
  
// Frequency at degree 0 (center_degree steps below center)
  const freq_at_degree_0 = fundamental / Math.pow(2, ref_cents_from_degree0 / 1200);

  // Frequency at center degree
  const freqAtCentral = freq_at_degree_0 * Math.pow(2, centraldegree_cents_from_degree0 / 1200);
  
  return freqAtCentral;

}

/**
 * Calculate MIDI note and pitch bend for a given frequency.
 * 
 * @param {number} freq - Frequency in Hz
 * @param {number} midiNoteForDegree0 - MIDI note number that plays degree 0
 * @param {number} channel - Voice channel (1-based)
 * @param {number} bendRange - Pitch bend range in semitones
 * @param {string} mode - "Ableton_workaround" or "Full_MPE"
 * @returns {Object} { note, bend }
 */
function freqToMidiAndCents(freq, center_degree, channel, bendRange, mode) {
  // Convert frequency to cents relative to degree 0
  // We need freqAtDegree0 for this calculation
  // But since we're passed freq directly, we calculate relative to A4 and adjust
  
  // For now, let's calculate the target MIDI note from the frequency
  // MIDI note = 69 + 12*log2(freq/440)
  const targetMidiNote = 69 + 12 * Math.log2(freq / 440);
  
  let note, deviation;
  
  if (mode === "Ableton_workaround") {
    // Ableton workaround: note % 16 must equal channel
    // Find note in range [channel, channel+15, channel+30, ...] closest to target
    const baseNote = channel % 16;
    const octaveOffset = Math.round((targetMidiNote - baseNote) / 16);
    note = baseNote + octaveOffset * 16;
    note = Math.max(0, Math.min(127, note));
    
    // Calculate deviation in cents
    deviation = (targetMidiNote - note) * 100.0;
  } else {
    // Full MPE: nearest MIDI note
    note = Math.round(targetMidiNote);
    note = Math.max(0, Math.min(127, note));
    deviation = (targetMidiNote - note) * 100.0;
  }
  
  return { note, deviation };
}

/**
 * Convert cents deviation to 14-bit pitch bend value.
 */
function deviationToBend(cents_offset, bendRange) {
  // 0x2000 = 8192 = centre (no bend)
  // Full range: -8192 (−bendRange semitones) … +8191 (+bendRange semitones)
  console.log("cents_offset, bendRange",[cents_offset,bendRange])
  const ratio = cents_offset / (bendRange * 100);
  const raw   = Math.round(ratio * 8192);
  const clamped = Math.max(-8192, Math.min(8191, raw));
  console.log("MPE:clamped",clamped);
  return clamped + 8192; // unsigned 0–16383
}

export const create_mpe_synth = async (
  midi_output,
  master_ch,
  lo_ch,
  hi_ch,
  fundamental = 440,
  reference_degree = 0,
  center_degree = 0,
  midiin_degree0 = 60,
  scale,
  mpe_mode = "Ableton_workaround",
  bendRange = 48,
  equivSteps = 12,
  equave = 2
) => {
  if (!midi_output) return null;

  // Determine actual bend range: always 48 for Ableton_workaround, user-specified for Full_MPE
  const actualBendRange = mpe_mode === "Ableton_workaround" ? 48 : bendRange;
  console.log("MPE:bendrange",actualBendRange);

  // master_ch: 1-based MIDI channel number, or null/undefined for no master
  // lo_ch, hi_ch: 1-based MIDI channel numbers for voice pool
  const masterCh  = master_ch != null ? parseInt(master_ch) - 1 : null; // 0-based for send
  const voiceIds  = [];
  for (let ch = lo_ch; ch <= hi_ch; ch++) voiceIds.push(ch);
  const pool = new VoicePool(voiceIds); // slot = 1-based channel number

  // Calculate frequency at central degree
  const freqAtCentral = calculateFreqAtCentralDegree(fundamental, reference_degree, center_degree, scale, equivSteps, equave);
  const midiNoteForDegree0 = midiin_degree0 + center_degree;

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
    midi_output.send([0xB0 + masterCh, 6, actualBendRange]);
    midi_output.send([0xB0 + masterCh, 38, 0]);
  }

  // Set pitch bend range on every voice channel
  for (const ch of voiceIds) {
    const c = ch - 1; // 0-based
    midi_output.send([0xB0 + c, 101, 0]);
    midi_output.send([0xB0 + c, 100, 0]);
    midi_output.send([0xB0 + c, 6, actualBendRange]);
    midi_output.send([0xB0 + c, 38, 0]);
  }

  return {
    makeHex: (coords, cents, velocity_played, steps, center_degree, equaves, equivSteps, cents_prev, cents_next, note_played, bend, offsetCents) => {
      return new MpeHex(
        coords, cents, velocity_played, steps, center_degree,
        midi_output, pool,
        freqAtCentral, midiNoteForDegree0,
        actualBendRange, mpe_mode
      );
    },
  };
};

function MpeHex(coords, cents, velocity_played, steps, center_degree, midi_output, pool, freqAtCentral, midiNoteForDegree0, bendRange, mode) {
  this.coords      = coords;
  this.cents       = cents;
  this.steps       = steps;
  this.center_degree = center_degree;
  this.release     = false;
  this.midi_output = midi_output;
  this.pool        = pool;
  this.freqAtCentral = freqAtCentral;
  this.midiNoteForDegree0 = midiNoteForDegree0;
  this.bendRange = bendRange;
  this.mode = mode;
  this.velocity    = Math.max(1, Math.min(127, velocity_played || 72));

  // Allocate voice channel — steal oldest if pool exhausted
  const { slot, stolen } = pool.noteOn(coords);
  if (stolen !== null) {
    // Send note-off on stolen channel immediately
    const sc = slot - 1;
    midi_output.send([0x80 + sc, this._stolenNote || 60, 0]);
  }
  this.channel = slot; // 1-based

  // Calculate frequency from cents (deviation from degree 0)
  const freq = this.freqAtCentral * Math.pow(2, cents / 1200);

  // Calculate MIDI note and pitch bend
  const { note, deviation } = freqToMidiAndCents(freq, this.center_degree, this.channel, this.bendRange, this.mode);
  this.note = note;
  this.bend = deviationToBend(deviation, bendRange);
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

/*
MpeHex.prototype.retune = function (newCents) {
  this.cents = newCents;
  
  // Calculate new frequency from cents
  const freq = this.freqAtCentral * Math.pow(2, newCents / 1200);
  
  // Recalculate MIDI note and pitch bend
  const { note, bend } = freqToMidiAndCents(freq, this.freqAtCentral, this.midiNoteForDegree0, this.channel, this.bendRange, this.mode);
  this.note = note;
  this.bend = bend;
  
  // Send new pitch bend
  const c       = this.channel - 1;
  const bendLSB = bend & 0x7F;
  const bendMSB = (bend >> 7) & 0x7F;
  this.midi_output.send([0xE0 + c, bendLSB, bendMSB]);
};
*/

MpeHex.prototype.aftertouch = function (value) {
  const c = this.channel - 1;
  // Channel pressure on the voice channel = MPE per-note pressure
  this.midi_output.send([0xD0 + c, Math.max(0, Math.min(127, value))]);
};

export default create_mpe_synth;
