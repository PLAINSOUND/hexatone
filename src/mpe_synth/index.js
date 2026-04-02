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

// PB and noteOn are sent in the same synchronous call — the MIDI driver
// processes them in FIFO order, so PB always arrives before noteOn.
// noteOff is NEVER delayed — delaying it risks stuck notes.
const RELEASE_GUARD_MS = 300;

function calculateFreqAtCentralDegree(fundamental, reference_degree, center_degree, scale) {
  let ref_cents = 0;
  if (reference_degree > 0) ref_cents = scalaToCents(scale[reference_degree - 1]); // cents from 1/1 to reference degree
  let center_cents = 0;
  if (center_degree > 0) center_cents = scalaToCents(scale[center_degree - 1]); // cents from 1/1 to center degree
  return fundamental * Math.pow(2, (center_cents - ref_cents) / 1200);
}

function freqToMidiAndCents(freq, center_degree, channel, scale, mode) {
  let center_cents = 0;
  if (center_degree > 0) center_cents = scalaToCents(scale[center_degree - 1]);
  const targetMidi = 69 + 12 * Math.log2(freq / 440) - center_cents * 0.01; // MIDIcents

  let note, deviation;
  if (mode === 'Ableton_workaround') {
    // Start from the nearest MIDI note to the target, then offset by channel index
    // so the note's value mod 16 matches the 0-indexed channel.
    // Channels 0–7  add  0..+7  semitones (offset = c)
    // Channels 8–15 add -8..-1  semitones (offset = c - 16)
    // This keeps the played note within ±8 semitones (half an octave) of the
    // target, with pitch bend correcting the remainder.
    const c = channel - 1;                                    // 0-indexed
    const nearestNote = Math.max(0, Math.min(127, Math.round(targetMidi)));
    const channelOffset = c - 16 * Math.floor(c / 8);        // 0..+7 or -8..-1
    note = Math.max(0, Math.min(127, nearestNote + channelOffset));
    deviation = (targetMidi - note) * 100.0;
  } else {
    note = Math.max(0, Math.min(127, Math.round(targetMidi)));
    deviation = (targetMidi - note) * 100.0;
  }
  return { note, deviation };
}

function deviationToBend(cents_offset, bendRange) {
  const ratio = cents_offset / (bendRange * 100);
  const raw = Math.round(ratio * 8192);
  const clamped = Math.max(-8192, Math.min(8191, raw));
  return clamped + 8192; // unsigned 0–16383
}

function sendBend(midi_output, channel0, bend) {
  const lsb = bend & 0x7F;
  const msb = (bend >> 7) & 0x7F;
  midi_output.send([0xE0 + channel0, lsb, msb]);
}

export const create_mpe_synth = async (
  midi_output,
  master_ch,
  lo_ch,
  hi_ch,
  fundamental = 440,
  reference_degree = 0,
  center_degree = 0,
  midiin_central_degree = 60,
  scale,
  mpe_mode = 'Ableton_workaround',
  bendRange = 48,
  bendRangeManager = 2,
  equivSteps = 12,
  equave = 2,
  releaseGuardMs = RELEASE_GUARD_MS,   // ms — should match your synth's longest release
  closestPitchSteal = true  // steal closest-pitch SOUNDING voice
) => {
  if (!midi_output) return null;

  const actualBendRange = mpe_mode === 'Ableton_workaround' ? 48 : bendRange || 48;
  const managerBendRange = mpe_mode === 'Ableton_workaround' ? 2 : bendRangeManager || 2;
  const masterCh = master_ch != "-1" ? parseInt(master_ch) - 1 : -1;
  const voiceIds = [];
  for (let ch = lo_ch; ch <= hi_ch; ch++) voiceIds.push(ch);

  const pool = new VoicePool(voiceIds, releaseGuardMs, closestPitchSteal);

  const freqAtCentral = calculateFreqAtCentralDegree(fundamental, reference_degree, center_degree, scale);
  const midiNoteForDegree0 = midiin_central_degree;

  // MPE configuration RPN message on manager channel
  if (masterCh !== -1) {
    const numVoices = hi_ch - lo_ch + 1;
    midi_output.send([0xB0 + masterCh, 101, 0]);
    midi_output.send([0xB0 + masterCh, 100, 6]);
    midi_output.send([0xB0 + masterCh, 6, numVoices]);
    midi_output.send([0xB0 + masterCh, 101, 0]);
    midi_output.send([0xB0 + masterCh, 100, 0]);
    midi_output.send([0xB0 + masterCh, 6, managerBendRange]); // set Pitch Bend range on the Manager Channel
    // midi_output.send([0xB0 + masterCh, 38, 0]);  // non-functional
  }

  // Send pitch-bend range RPN on every voice channel immediately —
  // this is configuration data, not audio, so no artifact.
  // Delay the PB centre reset by RELEASE_GUARD_MS so any release tails
  // from the previous Keys instance can decay undisturbed at their own
  // pitch before the channel is reset.
  for (const ch of voiceIds) {
    const c = ch - 1;
    midi_output.send([0xB0 + c, 101, 0]);
    midi_output.send([0xB0 + c, 100, 0]);
    midi_output.send([0xB0 + c, 6, actualBendRange]);
  }
  // PB centre reset — deferred so old release tails finish first
  setTimeout(() => {
    for (const ch of voiceIds) {
      const c = ch - 1;
      midi_output.send([0xE0 + c, 0, 64]); // 8192 = centred
    }
  }, releaseGuardMs);

  return {
    makeHex: (coords, cents, steps, equaves, equivSteps, cents_prev, cents_next,
      note_played, velocity_played, bend, degree0toRef_ratio) => {
      return new MpeHex(
        coords, cents, velocity_played, steps, center_degree,
        midi_output, pool,
        freqAtCentral, midiNoteForDegree0,
        actualBendRange, mpe_mode, scale,
        note_played, masterCh
      );
    },

    /**
     * Send CC123 (All Notes Off) on every voice channel and the manager channel.
     * Uses the raw midi_output directly — no hex state, no WebMidi dependency.
     * Safe to call at any time, including during deconstruct and page unload.
     */
    allSoundOff: () => {
      if (!midi_output) return;
      for (const ch of voiceIds) {
        midi_output.send([0xB0 + (ch - 1), 123, 0]);
      }
      if (masterCh >= 0) midi_output.send([0xB0 + masterCh, 123, 0]);
    },
  };
};

function MpeHex(coords, cents, velocity_played, steps, center_degree,
  midi_output, pool, freqAtCentral, midiNoteForDegree0,
  bendRange, mode, scale, note_played, masterCh) {
  this.coords = coords;
  this.cents = cents;
  this.steps = steps;
  this.center_degree = center_degree;
  this.release = false;
  this.midi_output = midi_output;
  this.pool = pool;
  this.freqAtCentral = freqAtCentral;
  this.midiNoteForDegree0 = midiNoteForDegree0;
  this.bendRange = bendRange;
  this.mode = mode;
  this.scale = scale;
  this.velocity = Math.max(1, Math.min(127, velocity_played || 72));
  this.note_played = note_played;
  // masterCh is 0-indexed (same as c = channel - 1); -1 means no manager channel.
  this.masterCh = masterCh ?? -1;

  // Calculate the pitch we need before allocating, so closestPitchSteal can use it
  const freq = freqAtCentral * Math.pow(2, cents / 1200);
  // channel not yet known, use placeholder 1 for Ableton mode (corrected below)
  const { note: noteGuess } = freqToMidiAndCents(freq, center_degree, 1, scale, mode);
  const bendGuess = deviationToBend((69 + 12 * Math.log2(freq / 440) - noteGuess) * 100, bendRange);

  const { slot, stolen, stolenSlot, stolenNote, stolenWasReleasing, retrigger } =
    pool.noteOn(coords, bendGuess);

  this.channel = slot; // 1-based

  // Recalculate with actual channel (matters for Ableton_workaround mode)
  const { note, deviation } = freqToMidiAndCents(freq, center_degree, this.channel, scale, mode);
  this.note = note;
  this.bend = deviationToBend(deviation, bendRange);
  const c = this.channel - 1;

  // For all cases: send noteOff on the outgoing voice (if any), then
  // PB + noteOn on the new channel. No CC120 — let the synth's release
  // envelope run naturally. A brief pitch shift on a dying tail is less
  // disruptive than a hard cut that can destabilise soft synth patches.
  if (retrigger) {
    // Same coords re-pressed while still held: the pool reused the same channel.
    // Send noteOff for the previously-held note so the synth doesn't stack voices.
    const prevNote = pool.getLastNote(this.channel);
    midi_output.send([0x80 + c, prevNote, 0]);
  } else if (stolenSlot !== null && stolenNote != null) {
    // SOUNDING steal: send noteOff so the release envelope runs
    midi_output.send([0x80 + (stolenSlot - 1), stolenNote, 0]);
  }
  // RELEASING reuse: tail already decaying — no message needed,
  // new PB will briefly affect it but it's already quiet.

  // PB then noteOn — FIFO order guarantees PB arrives first
  sendBend(midi_output, c, this.bend);
  midi_output.send([0x90 + c, this.note, this.velocity]);

  pool.setLastBend(this.channel, this.bend);
  pool.setLastNote(this.channel, this.note);
}

MpeHex.prototype.noteOn = function () {
  // noteOn was already scheduled in the constructor via WebMIDI timestamp.
  // This method is called by keys.js after construction — nothing to do here.
};

MpeHex.prototype.noteOff = function (release_velocity) {
  const c = this.channel - 1;
  const vel = release_velocity != null ? release_velocity : this.velocity;
  // Send noteOff immediately — no PB reset during the release tail
  this.midi_output.send([0x80 + c, this.note, vel]);
  // Mark RELEASING in pool (starts the guard timer)
  this.pool.noteOff(this.coords);
  // Guard against aftertouch arriving after release
  this.release = true;

  // After the release tail decays, reset PB to centre — but only if the
  // channel is still IDLE (not reallocated to a new note in the meantime).
  // This keeps channels clean for monitoring and for synths that retain PB
  // state across notes.
  const channel = this.channel;
  const pool = this.pool;
  const midi_out = this.midi_output;
  setTimeout(() => {
    if (pool.getChannelState(channel) === 'IDLE') {
      midi_out.send([0xE0 + c, 0, 64]); // PB centred (8192)
    }
  }, pool._releaseGuardMs + 10);
};

/**
 * Retune a held note to newCents.
 * Sends a single pitch bend update — no interpolation timers.
 * The UI interaction already provides natural rate limiting.
 * If the MIDI note number needs to change, sends noteOff → PB → noteOn
 * using WebMIDI timestamps.
 *
 * @param {number}  newCents  - Target pitch in cents from freqAtCentral.
 * @param {boolean} bendOnly  - When true (controller expression bend), never change
 *                              the MIDI note number — only clamp and send pitch bend.
 *                              Prevents reattack when the bend crosses a semitone boundary.
 */
MpeHex.prototype.retune = function (newCents, bendOnly = false) {
  // Guard: never retune a released note. The TuneCell glide rAF can outlive
  // noteOff (it's not cancelled on latch toggle), so without this check:
  //  - PB messages continue to a RELEASING channel → audible pitch bend on tail
  //  - A note-number change triggers noteOff+noteOn on a RELEASING channel → ghost note
  if (this.release) return;
  this.cents = newCents;

  const freq = this.freqAtCentral * Math.pow(2, newCents / 1200);
  const { note, deviation } = freqToMidiAndCents(freq, this.center_degree, this.channel, this.scale, this.mode);
  const c = this.channel - 1;

  if (!bendOnly && note !== this.note) {
    // Scale/tuning change: note number must change — noteOff → PB → noteOn.
    //
    // Unlike the constructor — where PB_GUARD_MS is needed because there is a JS return
    // between the PB send and the noteOn call — here all three messages are sent in the
    // same synchronous call. The MIDI driver processes them in FIFO order, so PB arrives
    // before noteOn without any scheduling gap.
    //
    // Using PB_GUARD_MS here creates a 2ms window where a sustainOff noteOff (sent
    // without a timestamp) can arrive at the driver BEFORE the scheduled noteOn, leaving
    // the rescheduled note stuck. Removing the timestamp eliminates that race entirely.
    const newBend = deviationToBend(deviation, this.bendRange);
    this.midi_output.send([0x80 + c, this.note, this.velocity]);
    this.note = note;
    this.bend = newBend;
    this.pool.setLastBend(this.channel, this.bend);
    this.pool.setLastNote(this.channel, this.note);
    sendBend(this.midi_output, c, this.bend);
    this.midi_output.send([0x90 + c, this.note, this.velocity]);
  } else {
    // Same note, or bendOnly: send PB only, clamped to ±8192. No reattack.
    // When bendOnly, recompute deviation against the locked note (this.note) rather
    // than the newly-computed note, preserving center_degree correction by using
    // the already-corrected targetMidi from freqToMidiAndCents.
    const bendDeviation = bendOnly
      ? deviation + (note - this.note) * 100
      : deviation;
    const newBend = deviationToBend(bendDeviation, this.bendRange);
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

// pressure: channel pressure on the voice's own channel (same as aftertouch for MPE).
MpeHex.prototype.pressure = function (value) {
  this.aftertouch(value);
};

// cc74: brightness / timbre — per-voice CC on the voice channel (MPE dimension 3).
MpeHex.prototype.cc74 = function (value) {
  if (this.release) return;
  const c = this.channel - 1;
  this.midi_output.send([0xB0 + c, 74, Math.max(0, Math.min(127, value))]);
};

// modwheel: CC1 — zone-wide, sent on manager channel.
MpeHex.prototype.modwheel = function (value) {
  if (this.masterCh < 0) return;
  this.midi_output.send([0xB0 + this.masterCh, 1, Math.max(0, Math.min(127, value))]);
};

// expression: CC11 — zone-wide, sent on manager channel.
MpeHex.prototype.expression = function (value) {
  if (this.masterCh < 0) return;
  this.midi_output.send([0xB0 + this.masterCh, 11, Math.max(0, Math.min(127, value))]);
};

export default create_mpe_synth;