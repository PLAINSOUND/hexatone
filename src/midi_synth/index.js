import { scalaToCents } from "../settings/scale/parse-scale";
import { WebMidi } from "webmidi";
import { VoicePool } from "../voice_pool_nearest";
import {
  buildBulkDumpMessage,
  buildTuningMapEntries,
  centsToMTS,
} from "../keyboard/mts-helpers.js";

export const tuningmap = new Array(128);
for (let i = 0; i < 128; i++) {
  tuningmap[i] = [i, 0, 0];
}

export const create_midi_synth = async ({
  outputMode,
  tuningContext,
  legacyInput,
  getDynamicBulkConfig = null,
}) => {
  const {
    output: midi_output,
    channel,
    midiMapping: midi_mapping,
    transportMode,
    velocity,
    sysexType: sysex_type,
    deviceId: device_id,
    mapNumber,
    mapName,
    anchorNote,
  } = outputMode;
  const {
    fundamental,
    degree0toRefAsArray,
    scale,
    equivInterval,
    name,
  } = tuningContext;
  const {
    midiin_device,
    midiin_central_degree,
  } = legacyInput;

  // ── Voice pools — one instance per synth, reset on each create_midi_synth call ──
  // MTS1: all 128 MIDI notes available as carriers
  const pool_mts1 = new VoicePool(Array.from({ length: 128 }, (_, i) => i));
  const pool_direct_dynamic = new VoicePool(
    Array.from({ length: 128 }, (_, i) => i),
    750,
  );

  // MTS2 (Pianoteq): low pool notes 23–88, high pool notes 89–106
  const pool_mts2_low  = new VoicePool(Array.from({ length: 66 }, (_, i) => i + 23));
  const pool_mts2_high = new VoicePool(Array.from({ length: 18 }, (_, i) => i + 89));

  // sysex_type: 127 = real-time (0x7F), 126 = non-real-time (0x7E)
  const sysex_rt     = (sysex_type != null ? sysex_type : 127) & 0x7F;
  const sysex_dev_id = (device_id  != null ? device_id  : 127) & 0x7F;
  const dynamicEntries = midi_mapping === "DIRECT" && transportMode === "bulk_dynamic_map" &&
    scale && degree0toRefAsArray
    ? buildTuningMapEntries(
      anchorNote ?? midiin_central_degree ?? 60,
      scale,
      equivInterval,
      fundamental,
      degree0toRefAsArray,
    )
    : null;
  const dynamicTransport = midi_mapping === "DIRECT" && transportMode === "bulk_dynamic_map" && dynamicEntries
    ? createBulkDynamicTransport({
      midi_output,
      channel,
      velocity,
      device_id: sysex_dev_id,
      map_number: mapNumber ?? 0,
      name: mapName ?? name ?? "",
      entries: dynamicEntries,
      pool: pool_direct_dynamic,
      fundamental,
      getDynamicBulkConfig,
      getProtectedEntries: () =>
        [...activeHexes]
          .filter((hex) => !hex.release && hex.mts?.length >= 4)
          .map((hex) => ({
            carrier: hex.mts[0],
            triplet: [hex.mts[1], hex.mts[2], hex.mts[3]],
          })),
    })
    : null;

  const activeHexes = new Set();

  return {
    family: "mts",
    makeHex: (coords, cents, steps, equaves, equivSteps, cents_prev, cents_next, 
      note_played, velocity_played, bend, degree0toRef_ratio) => {
      let hex;
      if (midi_mapping === 'DIRECT') {
        if (transportMode === "bulk_dynamic_map") {
          hex = new DynamicBulkHex(
            coords, cents, steps, equaves,
            note_played, velocity_played, velocity,
            midi_output, channel,
            dynamicTransport,
            degree0toRef_ratio,
            fundamental,
            cents_prev,
            cents_next,
          );
        } else {
          hex = new StaticBulkHex(
            coords, cents, steps, equaves,
            note_played, velocity_played, velocity,
            midi_output, channel,
            anchorNote ?? midiin_central_degree,
            degree0toRef_ratio,
            fundamental,
          );
        }
      } else {
        hex = new MidiHex(
          coords, cents, steps, equaves, equivSteps, cents_prev, cents_next,
          note_played, velocity_played, bend, degree0toRef_ratio,
          midiin_device, midiin_central_degree, midi_output, channel, midi_mapping, velocity, fundamental,
          pool_mts1, pool_mts2_low, pool_mts2_high,
          sysex_rt, sysex_dev_id
        );
      }
      activeHexes.add(hex);
      const originalNoteOff = hex.noteOff.bind(hex);
      hex.noteOff = (release_velocity) => {
        originalNoteOff(release_velocity);
        activeHexes.delete(hex);
      };
      return hex;
    },

    allSoundOff: () => {
      if (!midi_output) return;
      // Send CC123 on the configured output channel.
      midi_output.send([0xB0 + channel, 123, 0]);
    },

    applyControllerState: (state = {}) => {
      if (!midi_output || channel == null || channel < 0) return;
      const ccValues = state.ccValues || {};
      for (const [cc, value] of Object.entries(ccValues)) {
        midi_output.send([0xB0 + channel, Number(cc) & 0x7F, Math.max(0, Math.min(127, value))]);
      }
      if (state.channelPressure != null) {
        midi_output.send([0xD0 + channel, Math.max(0, Math.min(127, state.channelPressure))]);
      }
      if (state.pitchBend14 != null) {
        const bend = Math.max(0, Math.min(16383, state.pitchBend14));
        midi_output.send([0xE0 + channel, bend & 0x7F, (bend >> 7) & 0x7F]);
      }
    },

    releaseAll: () => {
      for (const hex of [...activeHexes]) hex.noteOff(0);
    },
  };
};

let notes = { played: [] };
export { notes };

export const keymap = new Array(128);
for (let i = 0; i < 2048; i++) {
  keymap[i] = [i % 128, 0, 0, 0, 0, 0, 0];
}

// Guard delay between sending a bulk-dump retune and the following noteOn in
// Dynamic Bulk Dump mode. Leave at 0 for immediate trigger; increase slightly
// if a target synth needs time to apply the incoming map before sounding.
const DIRECT_BULK_GUARD_MS = 0;

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
  // Polyphonic key pressure on the carrier note.
  if (this.midi_output && this.steps != null) {
    this.midi_output.send([0xA0 + this.channel, this.steps, Math.max(0, Math.min(127, value))]);
  }
};

// pressure: channel pressure on the output channel (coarser than poly AT, but widely supported).
MidiHex.prototype.pressure = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xD0 + this.channel, Math.max(0, Math.min(127, value))]);
};

// cc74: brightness / timbre on the output channel.
MidiHex.prototype.cc74 = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 74, Math.max(0, Math.min(127, value))]);
};

// modwheel: CC1 on the output channel.
MidiHex.prototype.modwheel = function (value) {
  if (!this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 1, Math.max(0, Math.min(127, value))]);
};

// expression: CC11 on the output channel.
MidiHex.prototype.expression = function (value) {
  if (!this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 11, Math.max(0, Math.min(127, value))]);
};

MidiHex.prototype.noteOff = function (release_velocity) {
  const velocity = release_velocity != null ? release_velocity : this.velocity;
  this.midi_output.send([128 + this.channel, this.steps, velocity]);
  this.release = true;

  // Return slot to pool
  if (this._pool) {
    this._pool.noteOff(this.coords);
  }
};

// Minimum jump (in cents) that triggers the noteOff → retune → noteOn pattern.
// Smooth TuneCell drags are always well below this; octave shifts (±1200¢) are always above.
const MTS_JUMP_THRESHOLD_CENTS = 400;

// Gap between MTS retune sysex and the rescheduled noteOn, in milliseconds.
// Mirrors PB_GUARD_MS in mpe_synth — gives the driver time to process the
// tuning message before the note-on arrives at the MIDI port.
const MTS_NOTE_GUARD_MS = 2;

/**
 * Retune a held note to a new cents value.
 *
 * Small jumps (TuneCell / FundamentalTuneCell drags, < MTS_JUMP_THRESHOLD_CENTS):
 *   Send the MTS sysex immediately. Pointer events fire at ~60 fps; the event
 *   stream itself is the glide. No setTimeout, no overlapping chains.
 *
 * Large jumps (octave shift, ≥ MTS_JUMP_THRESHOLD_CENTS):
 *   noteOff → MTS retune sysex → noteOn, all sequenced with WebMIDI timestamps
 *   so the driver processes them in order with sub-ms precision. Mirrors the
 *   mechanism MpeHex uses for PB_GUARD_MS.
 */
MidiHex.prototype.retune = function(newCents) {
  if (this.release) return;
  const delta = Math.abs(newCents - this.cents);
  this.cents = newCents;

  if (delta >= MTS_JUMP_THRESHOLD_CENTS) {
    // Large jump: silence the note, retune, restart — avoids audible pitch-
    // glide artefacts when the synth hears the old pitch while ringing.
    const now = performance.now();
    this.midi_output.send([0x80 + this.channel, this.steps, this.velocity], now);
    this._sendMtsTuning(newCents);
    this.midi_output.send([0x90 + this.channel, this.steps, this.velocity], now + MTS_NOTE_GUARD_MS);
  } else {
    this._sendMtsTuning(newCents);
  }
  this._updateKeymap();
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

function createBulkDynamicTransport({
  midi_output,
  channel,
  velocity,
  device_id,
  map_number,
  name,
  entries,
  pool,
  getDynamicBulkConfig,
  getProtectedEntries,
}) {
  let currentEntries = entries.map((entry) => [...entry]);

  // Pending rAF handle for retune coalescing — null when no dump is scheduled.
  let _retunePending = null;

  const sendBulkDump = () => {
    const protectedEntries = getProtectedEntries ? getProtectedEntries() : [];
    const entriesForDump = currentEntries.map((entry) => [...entry]);
    for (const entry of protectedEntries) {
      if (entry?.carrier == null || !entry.triplet) continue;
      entriesForDump[entry.carrier] = [...entry.triplet];
    }
    const liveConfig = getDynamicBulkConfig ? getDynamicBulkConfig() : null;
    const dump = buildBulkDumpMessage(
      liveConfig?.deviceId ?? device_id,
      liveConfig?.mapNumber ?? map_number,
      liveConfig?.name ?? name,
      entriesForDump,
    );
    midi_output.send([0xF0, ...dump, 0xF7]);
  };

  return {
    allocate(coords, targetMidiFloat) {
      return pool.noteOn(coords, targetMidiFloat);
    },
    release(coords) {
      pool.noteOff(coords);
    },
    noteOn({ coords, carrier, triplet, velocity: noteVelocity }) {
      // Cancel any pending coalesced retune — the noteOn dump supersedes it.
      if (_retunePending !== null) { cancelAnimationFrame(_retunePending); _retunePending = null; }
      currentEntries[carrier] = [...triplet];
      sendBulkDump();
      const noteOnVelocity = noteVelocity > 0 ? noteVelocity : velocity;
      const at = DIRECT_BULK_GUARD_MS > 0
        ? performance.now() + DIRECT_BULK_GUARD_MS
        : undefined;
      midi_output.send([0x90 + channel, carrier, noteOnVelocity], at);
    },
    noteOff({ carrier, velocity: noteVelocity }) {
      midi_output.send([0x80 + channel, carrier, noteVelocity != null ? noteVelocity : velocity]);
    },
    retune({ carrier, triplet }) {
      // Update the map immediately so the latest pitch is always in currentEntries,
      // but coalesce the bulk dump to at most one send per animation frame.
      currentEntries[carrier] = [...triplet];
      if (_retunePending === null) {
        _retunePending = requestAnimationFrame(() => {
          _retunePending = null;
          sendBulkDump();
        });
      }
    },
    setEntry({ carrier, triplet }) {
      currentEntries[carrier] = [...triplet];
    },
  };
}

function buildDynamicBulkAllocation({
  coords,
  cents,
  cents_prev,
  cents_next,
  degree0toRef_ratio,
  fundamental,
  transport,
}) {
  const ref = fundamental / degree0toRef_ratio;
  const ref_offset = 1200 * Math.log2(ref / 261.6255653);
  const ref_cents = cents + ref_offset;
  const targetMIDIFloat = ref_cents * 0.01 + 60;
  const idealNote = Math.max(0, Math.min(Math.round(targetMIDIFloat), 127));
  const allocation = transport.allocate(coords, targetMIDIFloat);
  const carrier = allocation.slot;
  const triplet = centsToMTS(carrier, (targetMIDIFloat - carrier) * 100);
  return {
    carrier,
    triplet,
    ref_cents,
    targetMIDIFloat,
    idealNote,
    stolenSlot: allocation.stolenSlot,
    stolen: allocation.stolen,
  };
}

/**
 * DynamicBulkHex — current transport behind the DIRECT section.
 * Uses MTS1-like carrier allocation but sends a full bulk dump before noteOn.
 */
function DynamicBulkHex(
  coords, cents, steps, equaves,
  note_played, velocity_played, velocity,
  midi_output, channel,
  transport,
  degree0toRef_ratio,
  fundamental,
  cents_prev,
  cents_next,
) {
  this.coords      = coords;
  this.cents       = cents;
  this.release     = false;
  this._noteOffCalled = false;
  this.midi_output = midi_output;
  this.channel     = channel;
  this.velocity    = velocity_played > 0 ? velocity_played : velocity;
  this.note_played = note_played;
  this.transport   = transport;
  this.degree0toRef_ratio = degree0toRef_ratio;
  this.fundamental = fundamental;
  this.cents_prev  = cents_prev;
  this.cents_next  = cents_next;
  this.mts         = [];
}

DynamicBulkHex.prototype.noteOn = function () {
  if (this.channel >= 0 && this.midi_output && this.transport) {
    const allocation = buildDynamicBulkAllocation({
      coords: this.coords,
      cents: this.cents,
      cents_prev: this.cents_prev,
      cents_next: this.cents_next,
      degree0toRef_ratio: this.degree0toRef_ratio,
      fundamental: this.fundamental,
      transport: this.transport,
    });

    this.carrier = allocation.carrier;
    this.mts = [allocation.carrier, ...allocation.triplet];
    if (allocation.stolenSlot !== null) {
      this.transport.noteOff({ carrier: allocation.stolenSlot, velocity: this.velocity });
    }
    this.transport.noteOn({
      coords: this.coords,
      carrier: allocation.carrier,
      triplet: allocation.triplet,
      velocity: this.velocity,
    });
  }
};

DynamicBulkHex.prototype.noteOff = function (release_velocity) {
  if (this._noteOffCalled) return;
  this._noteOffCalled = true;
  this.release = true;
  if (this.channel >= 0 && this.midi_output && this.transport && this.carrier != null) {
    const vel = release_velocity != null ? release_velocity : this.velocity;
    this.transport.noteOff({ carrier: this.carrier, velocity: vel });
    this.transport.release(this.coords);
  }
};

DynamicBulkHex.prototype.aftertouch = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xA0 + this.channel, this.carrier,
    Math.max(0, Math.min(127, value))]);
};

DynamicBulkHex.prototype.pressure = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xD0 + this.channel, Math.max(0, Math.min(127, value))]);
};

DynamicBulkHex.prototype.cc74 = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 74, Math.max(0, Math.min(127, value))]);
};

DynamicBulkHex.prototype.modwheel = function (value) {
  if (!this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 1, Math.max(0, Math.min(127, value))]);
};

DynamicBulkHex.prototype.expression = function (value) {
  if (!this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 11, Math.max(0, Math.min(127, value))]);
};

DynamicBulkHex.prototype.retune = function (newCents) {
  if (this.release || !this.transport || this.carrier == null) return;
  this.cents = newCents;
  const targetMIDIFloat =
    ((newCents + 1200 * Math.log2((this.fundamental / this.degree0toRef_ratio) / 261.6255653)) * 0.01) + 60;
  const triplet = centsToMTS(this.carrier, (targetMIDIFloat - this.carrier) * 100);
  this.mts = [this.carrier, ...triplet];
  this.transport.setEntry?.({ carrier: this.carrier, triplet });
  // Bulk-dump mode is now deliberately non-live for held-note retuning:
  // TuneCell drags, held-note glides, and recency wheel retune must not flood
  // the synth with repeated full-map traffic. We keep the local cents/MTS state
  // current so OCT-triggered bulk resends and later noteOn dumps reflect the
  // heard pitch without sending live bulk traffic on every retune gesture.
};

/**
 * StaticBulkHex — sequential playback against a pre-sent centered bulk map.
 */
function StaticBulkHex(
  coords, cents, steps, equaves,
  note_played, velocity_played, velocity,
  midi_output, channel,
  anchor,
  degree0toRef_ratio,
  fundamental,
) {
  this.coords      = coords;
  this.cents       = cents;
  this.release     = false;
  this._noteOffCalled = false;
  this.midi_output = midi_output;
  this.channel     = channel;
  this.velocity    = velocity_played > 0 ? velocity_played : velocity;
  this.note_played = note_played;
  this.carrier     = Math.max(0, Math.min(anchor + steps, 127));
  this.degree0toRef_ratio = degree0toRef_ratio;
  this.fundamental = fundamental;
  this.mts = null;
  this._updateMts(cents);
}

StaticBulkHex.prototype._updateMts = function (cents) {
  if (this.degree0toRef_ratio == null || this.fundamental == null) return;
  const targetMIDIFloat =
    ((cents + 1200 * Math.log2((this.fundamental / this.degree0toRef_ratio) / 261.6255653)) * 0.01) + 60;
  const triplet = centsToMTS(this.carrier, (targetMIDIFloat - this.carrier) * 100);
  this.mts = [this.carrier, ...triplet];
};

StaticBulkHex.prototype.noteOn = function () {
  if (this.channel >= 0 && this.midi_output) {
    this.midi_output.send([0x90 + this.channel, this.carrier, this.velocity]);
  }
};

StaticBulkHex.prototype.noteOff = function (release_velocity) {
  if (this._noteOffCalled) return;
  this._noteOffCalled = true;
  this.release = true;
  if (this.channel >= 0 && this.midi_output) {
    const vel = release_velocity != null ? release_velocity : this.velocity;
    this.midi_output.send([0x80 + this.channel, this.carrier, vel]);
  }
};

StaticBulkHex.prototype.aftertouch = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xA0 + this.channel, this.carrier,
    Math.max(0, Math.min(127, value))]);
};

StaticBulkHex.prototype.pressure = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xD0 + this.channel, Math.max(0, Math.min(127, value))]);
};

StaticBulkHex.prototype.cc74 = function (value) {
  if (this.release || !this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 74, Math.max(0, Math.min(127, value))]);
};

StaticBulkHex.prototype.modwheel = function (value) {
  if (!this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 1, Math.max(0, Math.min(127, value))]);
};

StaticBulkHex.prototype.expression = function (value) {
  if (!this.midi_output) return;
  this.midi_output.send([0xB0 + this.channel, 11, Math.max(0, Math.min(127, value))]);
};

StaticBulkHex.prototype.retune = function (newCents) {
  // Static bulk mode does not emit per-note transport traffic here, but it
  // does keep its current cents/MTS state up to date so held-slot-protected
  // bulk resends can reflect the pitch the user is actually hearing.
  if (typeof newCents === "number") {
    this.cents = newCents;
    this._updateMts(newCents);
  }
};


// centsToMTS is imported from mts-helpers.js above and re-exported here
// for any external callers that import it from this module.
export { centsToMTS };

export function mtsToMidiFloat(mts) {
  return mts[0] + (mts[1] / 128) + (mts[2] / 16384);
}
