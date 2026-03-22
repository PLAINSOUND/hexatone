import { scalaToCents } from "../settings/scale/parse-scale";
import { WebMidi } from "webmidi";
import { VoicePool } from "../voice_pool_nearest";

export const tuningmap = new Array(128);
for (let i = 0; i < 128; i++) {
  tuningmap[i] = [i, 0, 0];
}

export const create_midi_synth = async (midiin_device, midiin_central_degree, midi_output, channel, midi_mapping, velocity, fundamental, sysex_type, device_id) => {

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
    makeHex: (coords, cents, steps, equaves, equivSteps, cents_prev, cents_next, 
      note_played, velocity_played, bend, degree0toRef_ratio) => {
      if (midi_mapping === 'DIRECT') {
        return new DirectHex(
          coords, cents, steps, equaves,
          note_played, velocity_played, velocity,
          midi_output, channel,
          fundamental, degree0toRef_ratio
        );
      }
      return new MidiHex(
        coords, cents, steps, equaves, equivSteps, cents_prev, cents_next,
        note_played, velocity_played, bend, degree0toRef_ratio,
        midiin_device, midiin_central_degree, midi_output, channel, midi_mapping, velocity, fundamental,
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
  note_played, velocity_played, bend, degree0toRef_ratio,
  midiin_device, midiin_central_degree, midi_output, channel, midi_mapping, velocity, fundamental,
  pool_mts1, pool_mts2_low, pool_mts2_high,
  sysex_rt, sysex_dev_id
) {
  if (midiin_central_degree > 127) midiin_central_degree = 127;
  else if (midiin_central_degree < 0) midiin_central_degree = 0;

  let split = channel;
  let steps_cycle;
  let mts = [];
  let bend_down = 0;
  let bend_up   = 0;

  if (channel >= 0) {
    if (midi_mapping === "MTS1" || midi_mapping === "MTS2") {
      const ref        = fundamental / degree0toRef_ratio;
      const ref_offset = 1200 * Math.log2(ref / 261.6255653); // compensated to tempered C at 4409, so correct MTS is sent to 440. Hz tuned (default) instruments, allowing app to globally change the Kammerton
      const ref_cents  = cents + ref_offset; // cents from C@A-440
      
      bend_up   = cents_next - cents;
      bend_down = cents - cents_prev;

      const steps_from_ref = Math.floor(ref_cents / 100.0);

      // Calculate target pitch in cents
      // This is what we want to hear, in cents from reference
      const targetMIDIFloat = ref_cents * 0.01 + 60; // absolute Cents in MIDI terms
      //console.log("target:", targetMIDIFloat);
      
      // Ideal MIDI note (the natural pitch we want to match timbre-wise)
      const idealNote = Math.max(0, Math.min(Math.round(targetMIDIFloat), 127));
      //console.log("MidiHex idealNote:", idealNote);

      // Choose pool based on mapping and target note
      let pool;
      if (midi_mapping === "MTS1") {
        pool = pool_mts1;
      } else {
        // MTS2: route to appropriate pool based on ideal note
        pool = idealNote <= 88 ? pool_mts2_low : pool_mts2_high;
      }

      // Note-number-aware allocation!
      const { slot, stolen, distance, retrigger } = pool.noteOn(coords, targetMIDIFloat);
      
      // If voice was stolen, send noteOff on that slot
      if (stolen !== null) {
        midi_output.send([128 + channel, slot, velocity]);
      }

      // Now compute MTS tuning for this slot
      // The slot IS the near the note number we're using
      mts[0] = slot;  // Slot number
      mts[1] = (steps_from_ref + 180) % 120;
      
      // Calculate fine tuning offset
      // target pitch = slot * 100 + fine
      // fine = target - slot * 100
      let fine = (ref_cents * 0.01) - steps_from_ref;

      //console.log("MTS retuning note:", mts[1], "fine:", fine);
      fine = Math.round(16384 * (fine));  // Convert to 14-bit
      if (fine === 16384) fine = 16383;
      
      mts[2] = (fine & 16383) >> 7;  // MSB
      mts[3] = fine & 127;           // LSB

      steps_cycle = mts[0];
      tuningmap[mts[0]] = [mts[1], mts[2], mts[3]];

      if (note_played != null) {
        keymap[note_played] = [mts[0], mts[1], mts[2], mts[3], bend_down, bend_up, channel];
      }

      this._pool = pool;
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
    this.midiin_central_degree = midiin_central_degree;
    this.midi_output   = midi_output;
    this.channel      = split;
    this.steps        = steps_cycle;
    this.mts          = mts;
    this.sysex_rt     = sysex_rt     != null ? sysex_rt     : 127;
    this.sysex_dev_id = sysex_dev_id != null ? sysex_dev_id : 127;
    this.fundamental      = fundamental;      // needed for retune
    this.degree0toRef_ratio = degree0toRef_ratio; // needed for retune

  } else {
    //console.log("Please choose an output channel!");
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
  this.release = true;

  // Return slot to pool
  if (this._pool) {
    this._pool.noteOff(this.coords);
  }
};

/**
 * Smoothly retune a held note to a new cents value.
 * Sends interpolated MTS real-time tuning messages for smooth pitch glide.
 */
MidiHex.prototype.retune = function(newCents) {
  if (this.release) return;
  const oldCents = this.cents;
  this.cents = newCents;
  
  const delta = newCents - oldCents;
  
  // For small changes, send single message. For larger, interpolate.
  if (Math.abs(delta) < 5) {
    // Small change - send single tuning message
    this._sendMtsTuning(newCents);
  } else {
    // Larger change - interpolate over ~30ms
    const steps = Math.min(8, Math.max(3, Math.ceil(Math.abs(delta) / 10)));
    const stepDelta = delta / steps;
    let step = 0;
    
    const sendStep = () => {
      step++;
      const interpolatedCents = oldCents + stepDelta * step;
      this._sendMtsTuning(interpolatedCents);
      
      if (step < steps) {
        setTimeout(sendStep, 4);
      } else {
        // Final update with exact target
        this._sendMtsTuning(newCents);
        this._updateKeymap();
      }
    };
    
    sendStep();
  }
};

/**
 * Send MTS tuning message for given cents value.
 */
MidiHex.prototype._sendMtsTuning = function(cents) {
  if (this.release) return;
  // Calculate frequency at degree 0 from fundamental (applied at reference degree)
  const ref = this.fundamental / this.degree0toRef_ratio;
  const ref_offset = 1200 * Math.log2(ref / 261.6255653);
  const ref_cents = cents + ref_offset;
  const steps_from_ref = Math.floor(ref_cents / 100.0);
  
  // Update MTS array
  this.mts[1] = (steps_from_ref + 180) % 120;
  let fine = (ref_cents * 0.01) - steps_from_ref;
  fine = Math.round(16384 * fine);
  if (fine === 16384) fine = 16383;
  this.mts[2] = (fine & 16383) >> 7;
  this.mts[3] = fine & 127;
  
  // Send real-time single-note tuning message
  this.midi_output.send([0xF0, 127, this.sysex_dev_id, 0x08, 0x02, 0x00, 0x01,
    this.mts[0], this.mts[1], this.mts[2], this.mts[3], 0xF7]);
};

/**
 * Update keymap with current tuning.
 */
MidiHex.prototype._updateKeymap = function() {
  if (this.note_played != null) {
    keymap[this.note_played] = [this.mts[0], this.mts[1], this.mts[2], this.mts[3], 
                                 this.bend_down, this.bend_up, this.channel];
  }
};

/**
 * DirectHex — for DIRECT midi_mapping mode.
 * Sends plain noteOn/noteOff. No per-note sysex.
 * Relies on a pre-sent 128-note non-real-time bulk tuning map.
 * Carrier note = nearest semitone to target pitch (same calc as MTS1).
 */
function DirectHex(
  coords, cents, steps, equaves,
  note_played, velocity_played, velocity,
  midi_output, channel,
  fundamental, degree0toRef_ratio
) {
  this.coords      = coords;
  this.cents       = cents;
  this.release     = false;
  this._noteOffCalled = false;
  this.midi_output = midi_output;
  this.channel     = channel;
  this.velocity    = velocity_played > 0 ? velocity_played : velocity;
  this.note_played = note_played;

  // Carrier note: nearest semitone to target pitch
  if (channel >= 0 && fundamental && degree0toRef_ratio) {
    const ref        = fundamental / degree0toRef_ratio;
    const ref_offset = 1200 * Math.log2(ref / 261.6255653);
    const ref_cents  = cents + ref_offset;
    this.carrier = Math.max(0, Math.min(Math.round(ref_cents * 0.01 + 60), 127));
  } else {
    this.carrier = 60;
  }
}

DirectHex.prototype.noteOn = function () {
  if (this.channel >= 0 && this.midi_output) {
    this.midi_output.send([0x90 + this.channel, this.carrier, this.velocity]);
  }
};

DirectHex.prototype.noteOff = function (release_velocity) {
  if (this._noteOffCalled) return;
  this._noteOffCalled = true;
  this.release = true;
  if (this.channel >= 0 && this.midi_output) {
    const vel = release_velocity || this.velocity;
    this.midi_output.send([0x80 + this.channel, this.carrier, vel]);
  }
};

DirectHex.prototype.aftertouch = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xA0 + this.channel, this.carrier,
    Math.max(0, Math.min(127, value))]);
};

DirectHex.prototype.retune = function () {
  // No-op: DIRECT uses a static pre-sent map.
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