import { scalaToCents } from "../settings/scale/parse-scale";
import { WebMidi } from "webmidi";
import { VoicePool } from "../voice_pool";

export const tuningmap = new Array(128);
for (let i = 0; i < 128; i++) {
  tuningmap[i] = [i, 0, 0];
}

export const create_midi_synth = async (midiin_device, midiin_degree0, midi_output, channel, midi_mapping, velocity, fundamental, sysex_type, device_id) => {

  // ── Voice pools — one instance per synth, reset on each create_midi_synth call ──
  // MTS1: all 128 MIDI notes available as carriers
  const pool_mts1 = new VoicePool(Array.from({ length: 128 }, (_, i) => i));

  // MTS2 (Pianoteq): low pool notes 23–88, high pool notes 89–106
  const pool_mts2_low  = new VoicePool(Array.from({ length: 66 }, (_, i) => i + 23));
  const pool_mts2_high = new VoicePool(Array.from({ length: 18 }, (_, i) => i + 89));

  // sysex_type: 127 = real-time (0x7F), 126 = non-real-time (0x7E)
  const sysex_rt     = (sysex_type != null ? sysex_type : 127) & 0x7F;
  const sysex_dev_id = (device_id  != null ? device_id  : 127) & 0x7F;

  return {
    makeHex: (coords, cents, velocity_played, steps, equaves, equivSteps, cents_prev, cents_next, note_played, bend, offset) => {
      return new MidiHex(
        coords, cents, steps, equaves, equivSteps, cents_prev, cents_next,
        note_played, velocity_played, bend, offset,
        midiin_device, midiin_degree0, midi_output, channel, midi_mapping, velocity, fundamental,
        pool_mts1, pool_mts2_low, pool_mts2_high,
        sysex_rt, sysex_dev_id
      );
    }
  };
};

let notes = { played: [] };
export { notes };

export const keymap = new Array(128);
for (let i = 0; i < 2048; i++) {
  keymap[i] = [i % 128, 0, 0, 0, 0, 0, 0];
}

function MidiHex(
  coords, cents, steps, equaves, equivSteps, cents_prev, cents_next,
  note_played, velocity_played, bend, offset,
  midiin_device, midiin_degree0, midi_output, channel, midi_mapping, velocity, fundamental,
  pool_mts1, pool_mts2_low, pool_mts2_high,
  sysex_rt, sysex_dev_id
) {
  if (midiin_degree0 > 127) midiin_degree0 = 127;
  else if (midiin_degree0 < 0) midiin_degree0 = 0;

  let split = channel;
  let steps_cycle;
  let mts = [];
  let bend_down = 0;
  let bend_up   = 0;

  if (channel >= 0) {
    /* DEPRECATED: sequential and multichannel output modes removed. */

    if (midi_mapping === "MTS1" || midi_mapping === "MTS2") {
      const ref        = fundamental / offset;
      const ref_offset = 1200 * Math.log2(ref / 261.6255653);
      const ref_cents  = cents + ref_offset;
      bend_up          = cents_next - cents;
      bend_down        = cents - cents_prev;

      const steps_from_ref = Math.floor(ref_cents / 100.0);

      // ── Choose pool and slot ─────────────────────────────────────────────
      let pool;
      if (midi_mapping === "MTS1") {
        pool = pool_mts1;
      } else {
        // MTS2: split by target MIDI note (mts[1]) to stay inside Pianoteq ranges
        const target_note = (steps_from_ref + 180) % 120;
        pool = target_note <= 88 ? pool_mts2_low : pool_mts2_high;
      }

      const { slot, stolen } = pool.noteOn(coords);

      // If a voice was stolen, send its noteOff now so the synth doesn't hang
      if (stolen !== null) {
        const stolenKeymap = note_played != null ? keymap[note_played] : null;
        // stolen slot IS the slot we just got back — send noteOff on it
        midi_output.send([128 + channel, slot, velocity]);
      }

      // ── Compute MTS tuning bytes ─────────────────────────────────────────
      mts[0] = slot;
      mts[1] = (steps_from_ref + 180) % 120;
      let fine = (ref_cents * 0.01) - steps_from_ref;
      fine = Math.round(16384 * fine);
      if (fine === 16384) fine = 16383;
      mts[3] = fine & 127;
      mts[2] = (fine & 16383) >> 7;

      steps_cycle = mts[0];
      tuningmap[mts[0]] = [mts[1], mts[2], mts[3]];

      if (note_played != null) {
        keymap[note_played] = [mts[0], mts[1], mts[2], mts[3], bend_down, bend_up, channel];
      }

      // Store pool reference so noteOff can return the slot
      this._pool  = pool;
    }

    this.coords    = coords;
    this.cents     = cents;
    this.bend_down = bend_down;
    this.bend_up   = bend_up;
    this.equaves   = equaves;
    this.release   = false;
    this.velocity  = velocity_played > 0 ? velocity_played : velocity;
    this.note_played   = note_played;
    this.midiin_device = midiin_device;
    this.midiin_degree0 = midiin_degree0;
    this.midi_output   = midi_output;
    this.channel      = split;
    this.steps        = steps_cycle;
    this.mts          = mts;
    this.sysex_rt     = sysex_rt     != null ? sysex_rt     : 127;
    this.sysex_dev_id = sysex_dev_id != null ? sysex_dev_id : 127;

  } else {
    console.log("Please choose an output channel!");
  }
}

MidiHex.prototype.noteOn = function () {
  if (this.mts.length > 0) {
    // F0 <rt> <device_id> 08 02 00 01 <slot> <note> <fine_msb> <fine_lsb> F7
    // rt: single-note real-time MUST always be 0x7F (not affected by sysex_type setting)
    this.midi_output.send([0xF0, 127, this.sysex_dev_id, 0x08, 0x02, 0x00, 0x01,
      this.mts[0], this.mts[1], this.mts[2], this.mts[3], 0xF7]);
  }
  this.midi_output.send([144 + this.channel, this.steps, this.velocity]);
};

MidiHex.prototype.aftertouch = function (value) {
  // MTS: polyphonic key pressure on the carrier note (0xA0 = poly aftertouch)
  // MPE: channel pressure on the voice's own channel (0xD0 = channel pressure)
  // For now emit poly aftertouch; MPE synth will override with channel pressure.
  if (this.midi_output && this.steps != null) {
    this.midi_output.send([0xA0 + this.channel, this.steps, value]);
  }
};

MidiHex.prototype.noteOff = function (release_velocity) {
  const velocity = release_velocity || this.velocity;
  this.midi_output.send([128 + this.channel, this.steps, velocity]);

  // Return slot to pool
  if (this._pool) {
    this._pool.noteOff(this.coords);
  }
};

export function centsToMTS(note, bend) {
  let mts = [0, 0, 0];
  if (typeof note === "number" && typeof bend === "number") {
    if (note >= 0) {
      mts[0] = Math.floor(note);
    } else {
      mts[0] = -1 * Math.floor(-1 * note);
      if (mts[0] > note) mts[0] -= 1;
    }
    let total_bend = (bend * 0.01) + note - mts[0];
    let shift = total_bend >= 0
      ? Math.floor(total_bend)
      : -1 * Math.floor(-1 * total_bend);
    if (shift > total_bend) shift -= 1;
    const remainder = total_bend - shift;
    mts[0] += shift;
    if (mts[0] < 0) {
      mts = [0, 0, 0];
    } else if (mts[0] > 127) {
      mts = [127, 127, 126];
    } else {
      let fine = Math.round(16384 * remainder);
      if (fine === 16384) fine = 16383;
      mts[1] = Math.floor(fine / 128);
      mts[2] = Math.round(128 * ((fine / 128) - mts[1]));
      if (mts[2] === 128) mts[2] = 127;
    }
  }
  return mts;
}

export function mtsToMidiFloat(mts) {
  return mts[0] + (mts[1] / 128) + (mts[2] / 16384);
}