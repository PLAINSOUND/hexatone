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
 *   500ms). No PB reset is sent during this window — the tail decays undisturbed
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
const RELEASE_GUARD_MS = 500;

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
  if (mode === "Ableton_workaround") {
    // Start from the nearest MIDI note to the target, then offset by channel index
    // so the note's value mod 16 matches the 0-indexed channel.
    // Channels 0–7  add  0..+7  semitones (offset = c)
    // Channels 8–15 add -8..-1  semitones (offset = c - 16)
    // This keeps the played note within ±8 semitones (half an octave) of the
    // target, with pitch bend correcting the remainder.
    const c = channel - 1; // 0-indexed
    const nearestNote = Math.max(0, Math.min(127, Math.round(targetMidi)));
    const channelOffset = c - 16 * Math.floor(c / 8); // 0..+7 or -8..-1
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

function deviationToBend21(cents_offset, bendRange) {
  const ratio = cents_offset / (bendRange * 100);
  const raw = Math.round(ratio * 1048576);
  const clamped = Math.max(-1048576, Math.min(1048448, raw));
  return clamped + 1048576; // unsigned 0–2097024
}

function sendBend(midi_output, channel0, bend) {
  const lsb = bend & 0x7f;
  const msb = (bend >> 7) & 0x7f;
  midi_output.send([0xe0 + channel0, lsb, msb]);
}

function sendMpePlusLsb(midi_output, channel0, value) {
  midi_output.send([0xb0 + channel0, 87, value & 0x7f]);
}

function sendBend21(midi_output, channel0, bend21) {
  sendMpePlusLsb(midi_output, channel0, bend21 & 0x7f);
  sendBend(midi_output, channel0, (bend21 >> 7) & 0x3fff);
}

function send14BitCc(midi_output, channel0, cc, value14) {
  sendMpePlusLsb(midi_output, channel0, value14 & 0x7f);
  midi_output.send([0xb0 + channel0, cc & 0x7f, (value14 >> 7) & 0x7f]);
}

function send14BitChannelPressure(midi_output, channel0, value14) {
  sendMpePlusLsb(midi_output, channel0, value14 & 0x7f);
  midi_output.send([0xd0 + channel0, (value14 >> 7) & 0x7f]);
}

function sendRpn(midi_output, channel0, msb, lsb, dataMsb, dataLsb = 0) {
  midi_output.send([0xb0 + channel0, 101, msb & 0x7f]);
  midi_output.send([0xb0 + channel0, 100, lsb & 0x7f]);
  midi_output.send([0xb0 + channel0, 6, dataMsb & 0x7f]);
  midi_output.send([0xb0 + channel0, 38, dataLsb & 0x7f]);
  // Null RPN selection so later Data Entry messages cannot accidentally keep
  // editing the previously selected parameter on stricter hardware synths.
  midi_output.send([0xb0 + channel0, 101, 127]);
  midi_output.send([0xb0 + channel0, 100, 127]);
}

export const create_mpe_synth = async (
  midi_output,
  master_ch,
  lo_ch,
  hi_ch,
  fundamental = 440,
  reference_degree = 0,
  center_degree = 0,
  midiin_anchor_note = 60,
  scale,
  mpe_mode = "Ableton_workaround",
  bendRange = 48,
  bendRangeManager = 2,
  _equivSteps = 12,
  _equave = 2,
  releaseGuardMs = RELEASE_GUARD_MS, // ms — should match your synth's longest release
  closestPitchSteal = true, // steal closest-pitch SOUNDING voice
  mpePlusEnabled = false,
) => {
  if (!midi_output) return null;

  const actualBendRange = mpe_mode === "Ableton_workaround" ? 48 : bendRange || 48;
  const managerBendRange = mpe_mode === "Ableton_workaround" ? 2 : bendRangeManager || 2;
  const masterCh = master_ch != "-1" ? parseInt(master_ch) - 1 : -1;
  const voiceIds = [];
  for (let ch = lo_ch; ch <= hi_ch; ch++) voiceIds.push(ch);

  const pool = new VoicePool(voiceIds, releaseGuardMs, closestPitchSteal);

  const freqAtCentral = calculateFreqAtCentralDegree(
    fundamental,
    reference_degree,
    center_degree,
    scale,
  );
  const midiNoteForDegree0 = midiin_anchor_note;

  // MPE configuration RPN message on manager channel
  if (masterCh !== -1) {
    const numVoices = hi_ch - lo_ch + 1;
    sendRpn(midi_output, masterCh, 0, 6, numVoices, 0);
    sendRpn(midi_output, masterCh, 0, 0, managerBendRange, 0);
  }

  // Send pitch-bend range RPN on every voice channel immediately —
  // this is configuration data, not audio, so no artifact.
  // Also send an immediate PB centre reset on startup so the first note after
  // re-enabling MPE cannot inherit stale bend from a previous MPE session.
  // Keep the deferred reset as well so any old release tails are eventually
  // cleaned up once the guard window has passed.
  // Delay the PB centre reset by RELEASE_GUARD_MS so any release tails
  // from the previous Keys instance can decay undisturbed at their own
  // pitch before the channel is reset.
  for (const ch of voiceIds) {
    const c = ch - 1;
    sendRpn(midi_output, c, 0, 0, actualBendRange, 0);
    midi_output.send([0xe0 + c, 0, 64]); // 8192 = centred
  }
  // PB centre reset — deferred so old release tails finish first
  setTimeout(() => {
    for (const ch of voiceIds) {
      const c = ch - 1;
      if (pool.getChannelState(ch) === "IDLE") {
        midi_output.send([0xe0 + c, 0, 64]); // 8192 = centred
      }
    }
  }, releaseGuardMs);

  const activeHexes = new Set();

  return {
    family: "mpe",
    makeHex: (
      coords,
      cents,
      steps,
      equaves,
      equivSteps,
      cents_prev,
      cents_next,
      note_played,
      velocity_played,
      _bend,
      _degree0toRef_ratio,
    ) => {
      const hex = new MpeHex(
        coords,
        cents,
        velocity_played,
        steps,
        center_degree,
        midi_output,
        pool,
        freqAtCentral,
        midiNoteForDegree0,
        actualBendRange,
        mpe_mode,
        scale,
        note_played,
        masterCh,
        mpePlusEnabled,
      );
      activeHexes.add(hex);
      const originalNoteOff = hex.noteOff.bind(hex);
      hex.noteOff = (release_velocity) => {
        originalNoteOff(release_velocity);
        activeHexes.delete(hex);
      };
      return hex;
    },

    /**
     * Send CC123 (All Notes Off) on every voice channel and the manager channel.
     * Uses the raw midi_output directly — no hex state, no WebMidi dependency.
     * Safe to call at any time, including during deconstruct and page unload.
     */
    allSoundOff: () => {
      if (!midi_output) return;
      for (const ch of voiceIds) {
        midi_output.send([0xb0 + (ch - 1), 123, 0]);
      }
      if (masterCh >= 0) midi_output.send([0xb0 + masterCh, 123, 0]);
    },

    applyControllerState: (state = {}) => {
      if (!midi_output || masterCh < 0) return;
      const ccValues = state.ccValues || {};
      for (const [cc, value] of Object.entries(ccValues)) {
        midi_output.send([0xb0 + masterCh, Number(cc) & 0x7f, Math.max(0, Math.min(127, value))]);
      }
      if (state.channelPressure != null) {
        midi_output.send([0xd0 + masterCh, Math.max(0, Math.min(127, state.channelPressure))]);
      }
      if (state.pitchBend14 != null) {
        sendBend(midi_output, masterCh, Math.max(0, Math.min(16383, state.pitchBend14)));
      }
    },

    releaseAll: () => {
      for (const hex of [...activeHexes]) hex.noteOff(0);
    },
  };
};

function MpeHex(
  coords,
  cents,
  velocity_played,
  steps,
  center_degree,
  midi_output,
  pool,
  freqAtCentral,
  midiNoteForDegree0,
  bendRange,
  mode,
  scale,
  note_played,
  masterCh,
  mpePlusEnabled,
) {
  this.coords = coords;
  this.cents = cents;
  this.standardWheelPassthroughOnly = true;
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
  this.mpePlusEnabled = mpePlusEnabled === true;
  this._lastSentBend = null;
  this._lastSentBend21 = null;
  this._lastSentAftertouch = null;
  this._lastSentAftertouch14 = null;
  this._lastSentCc74 = null;
  this._lastSentCc7414 = null;
  // masterCh is 0-indexed (same as c = channel - 1); -1 means no manager channel.
  this.masterCh = masterCh ?? -1;

  // Calculate the pitch we need before allocating, so closestPitchSteal can use it
  const freq = freqAtCentral * Math.pow(2, cents / 1200);
  // channel not yet known, use placeholder 1 for Ableton mode (corrected below)
  const { note: noteGuess } = freqToMidiAndCents(freq, center_degree, 1, scale, mode);
  const bendGuess = deviationToBend((69 + 12 * Math.log2(freq / 440) - noteGuess) * 100, bendRange);

  const { slot, stolen: _stolen, stolenSlot, stolenNote, stolenWasReleasing: _stolenWasReleasing, retrigger } = pool.noteOn(
    coords,
    bendGuess,
  );

  this.channel = slot; // 1-based

  // Recalculate with actual channel (matters for Ableton_workaround mode)
  const { note, deviation } = freqToMidiAndCents(freq, center_degree, this.channel, scale, mode);
  this.note = note;
  this.bend = deviationToBend(deviation, bendRange);
  this.bend21 = deviationToBend21(deviation, bendRange);
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
  if (this.mpePlusEnabled) {
    sendBend21(midi_output, c, this.bend21);
    this._lastSentBend21 = this.bend21;
    this._lastSentBend = (this.bend21 >> 7) & 0x3fff;
  } else {
    sendBend(midi_output, c, this.bend);
    this._lastSentBend = this.bend;
  }
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
    if (pool.getChannelState(channel) === "IDLE") {
      midi_out.send([0xe0 + c, 0, 64]); // PB centred (8192)
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
  const { note, deviation } = freqToMidiAndCents(
    freq,
    this.center_degree,
    this.channel,
    this.scale,
    this.mode,
  );
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
    const newBend21 = deviationToBend21(deviation, this.bendRange);
    this.midi_output.send([0x80 + c, this.note, this.velocity]);
    this.note = note;
    this.bend = newBend;
    this.bend21 = newBend21;
    this.pool.setLastBend(this.channel, this.bend);
    this.pool.setLastNote(this.channel, this.note);
    if (this.mpePlusEnabled) {
      sendBend21(this.midi_output, c, this.bend21);
      this._lastSentBend21 = this.bend21;
      this._lastSentBend = (this.bend21 >> 7) & 0x3fff;
    } else {
      sendBend(this.midi_output, c, this.bend);
      this._lastSentBend = this.bend;
    }
    this.midi_output.send([0x90 + c, this.note, this.velocity]);
  } else {
    // Same note, or bendOnly: send PB only, clamped to ±8192. No reattack.
    // When bendOnly, recompute deviation against the locked note (this.note) rather
    // than the newly-computed note, preserving center_degree correction by using
    // the already-corrected targetMidi from freqToMidiAndCents.
    const bendDeviation = bendOnly ? deviation + (note - this.note) * 100 : deviation;
    const newBend = deviationToBend(bendDeviation, this.bendRange);
    const newBend21 = deviationToBend21(bendDeviation, this.bendRange);
    this.bend = newBend;
    this.bend21 = newBend21;
    this.pool.setLastBend(this.channel, this.bend);
    if (this.mpePlusEnabled) {
      if (this._lastSentBend21 !== this.bend21) {
        sendBend21(this.midi_output, c, this.bend21);
        this._lastSentBend21 = this.bend21;
        this._lastSentBend = (this.bend21 >> 7) & 0x3fff;
      }
    } else if (this._lastSentBend !== this.bend) {
      sendBend(this.midi_output, c, this.bend);
      this._lastSentBend = this.bend;
    }
  }
};

MpeHex.prototype.aftertouch = function (value, value14 = null) {
  if (this.release) return;
  const c = this.channel - 1;
  if (this.mpePlusEnabled && Number.isFinite(value14)) {
    const next = Math.max(0, Math.min(16256, value14));
    if (this._lastSentAftertouch14 === next) return;
    send14BitChannelPressure(this.midi_output, c, next);
    this._lastSentAftertouch14 = next;
    this._lastSentAftertouch = (next >> 7) & 0x7f;
    return;
  }
  const next = Math.max(0, Math.min(127, value));
  if (this._lastSentAftertouch === next && this._lastSentAftertouch14 == null) return;
  this.midi_output.send([0xd0 + c, next]);
  this._lastSentAftertouch = next;
  this._lastSentAftertouch14 = null;
};

// pressure: channel pressure on the voice's own channel (same as aftertouch for MPE).
MpeHex.prototype.pressure = function (value, value14 = null) {
  this.aftertouch(value, value14);
};

// cc74: brightness / timbre — per-voice CC on the voice channel (MPE dimension 3).
MpeHex.prototype.cc74 = function (value, value14 = null) {
  if (this.release) return;
  const c = this.channel - 1;
  if (this.mpePlusEnabled && Number.isFinite(value14)) {
    const next = Math.max(0, Math.min(16256, value14));
    if (this._lastSentCc7414 === next) return;
    send14BitCc(this.midi_output, c, 74, next);
    this._lastSentCc7414 = next;
    this._lastSentCc74 = (next >> 7) & 0x7f;
    return;
  }
  const next = Math.max(0, Math.min(127, value));
  if (this._lastSentCc74 === next && this._lastSentCc7414 == null) return;
  this.midi_output.send([0xb0 + c, 74, next]);
  this._lastSentCc74 = next;
  this._lastSentCc7414 = null;
};

// modwheel: CC1 — zone-wide, sent on manager channel.
MpeHex.prototype.modwheel = function (value) {
  if (this.masterCh < 0) return;
  this.midi_output.send([0xb0 + this.masterCh, 1, Math.max(0, Math.min(127, value))]);
};

// expression: CC11 — zone-wide, sent on manager channel.
MpeHex.prototype.expression = function (value) {
  if (this.masterCh < 0) return;
  this.midi_output.send([0xb0 + this.masterCh, 11, Math.max(0, Math.min(127, value))]);
};

export default create_mpe_synth;
