/**
 * mpe_synth — MPE (MIDI Polyphonic Expression) output.
 *
 * Each note gets its own voice channel, allocated from a VoicePool.
 * Pitch is expressed as pitch bend on the voice channel.
 *
 * Two modes:
 * - Ableton_workaround: pitch bend range fixed at 48, MIDI note constrained to satisfy
 *   note % 16 = channel (so Ableton can reconstruct the channel from the note number and users can play multiple notes that are close to each other by sending them on different MIDI notes)
 * - Full_MPE: user-selectable pitch bend range 1-96, nearest MIDI note + pitch bend
 * optimal tuning resolution like MTS is PB range 1, optimal glissando range is 96 (Continuum)
 *
 * MPE zone layout (lower zone, Ableton default):
 *   Master channel:  1  (or 16 for upper zone, or none)
 *   Voice channels:  mpe_lo_ch … mpe_hi_ch  (default 2–8)
 *
 * On master channel: program change, global CC, all-notes-off
 * On voice channels: note-on/off + pitch bend + channel pressure (aftertouch)
 * 
 * ALGORITHM has 2 parts 1.) is direct from app to MPE, 2.) adds a layer of incoming MIDI notes
 * 
 * 1.) Determine from the hex which MPE data to send:
 * from incoming values fundamental (reference Frequency) and cents we calculate a MIDIcents value
 * MIDIcents = 1200 * log2 (fundamental / 440) + 69 + cents; this is the sounding note that will be send as MPE by the modes above on the channel assigned by the voice allocator
 * 
 * 2.) determine which hex the incoming MIDI note and channel need to trigger as follows:
 * obtain the MIDI note and channel 
 * consider the (Central) MIDI Input Channel (midiin_channel) for transposition by equaves
 * we need to know which hex to play
 * midiin_central_degree plays central_degree
 * 
 * we need to look at
 * note_played
 * 
 * + (channel_played - midiin_channel) % 8 * equivSteps   ---- this needs to be adjusted so equaves up and down are nicely handled ----
 * 
 * - midiin_central degree - central_degree
 * 
 * to determine the number of scale steps from fundamental, which gives us a hex to play.
 * 
 * 
 */

import { VoicePool } from "../voice_pool_oldest";
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
 * @param {number} center_degree - The central degree of the scale
 * @param {number} channel - Voice channel (1-based)
 * @param {number[]} scale - The scale in cents
 * @param {string} mode - "Ableton_workaround" or "Full_MPE"
 * @returns {Object} { note, deviation }
 */
function freqToMidiAndCents(freq, center_degree, channel, scale, mode) {
  // Convert frequency to cents relative to degree 0
  let centraldegree_cents_from_degree0 = 0;
  if (center_degree > 0) {
    centraldegree_cents_from_degree0 = scalaToCents(scale[center_degree - 1]);
  }
  const targetMidiNote = 69 + (12 * Math.log2(freq / 440)) - (centraldegree_cents_from_degree0 * 0.01);
  
  let note, deviation;
  
  if (mode === "Ableton_workaround") {
    // Ableton workaround: note % 16 must equal channel
    // Find note in range [channel, channel+15, channel+30, ...] closest to target
    const baseNote = channel % 16;
    const octaveOffset = Math.round((targetMidiNote - baseNote) / 16);
    note = baseNote + octaveOffset * 16;
    
    // BUG FIX: if clamped, find nearest valid note within MIDI range
    if (note > 127) {
      // Find highest valid note for this channel
      note = baseNote + Math.floor((127 - baseNote) / 16) * 16;
    } else if (note < 0) {
      note = baseNote;  // lowest valid note for this channel
    }
    
    // Calculate deviation in cents
    deviation = (targetMidiNote - note) * 100.0;
    
    //console.log(`Ableton: target=${targetMidiNote.toFixed(2)} channel=${channel} baseNote=${baseNote} octaveOffset=${octaveOffset} note=${note} deviation=${deviation.toFixed(0)} cents`);
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
  const ratio = cents_offset / (bendRange * 100);
  const raw = Math.round(ratio * 8192);
  const clamped = Math.max(-8192, Math.min(8191, raw));
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
  midiin_central_degree = 60,
  scale,
  mpe_mode = "Ableton_workaround",
  bendRange = 48,
  equivSteps = 12,
  equave = 2
) => {
  if (!midi_output) return null;

  // Determine actual bend range: always 48 for Ableton_workaround, user-specified for Full_MPE
  const actualBendRange = mpe_mode === "Ableton_workaround" ? 48 : bendRange;

  // master_ch: 1-based MIDI channel number, or null/undefined for no master
  // lo_ch, hi_ch: 1-based MIDI channel numbers for voice pool
  const masterCh = master_ch != null ? parseInt(master_ch) - 1 : null; // 0-based for send
  const voiceIds = [];
  for (let ch = lo_ch; ch <= hi_ch; ch++) voiceIds.push(ch);
  const pool = new VoicePool(voiceIds); // slot = 1-based channel number

  // Calculate frequency at central degree
  const freqAtCentral = calculateFreqAtCentralDegree(fundamental, reference_degree, center_degree, scale, equivSteps, equave);
  const midiNoteForDegree0 = midiin_central_degree + center_degree;

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

  // Initialize all voice channels to centered pitch bend (8192)
  for (const ch of voiceIds) {
    const c = ch - 1; // 0-based
    midi_output.send([0xE0 + c, 0, 64]);  // 8192 = centered
  }

  return {
    makeHex: (coords, cents, steps, equaves, equivSteps, cents_prev, cents_next, 
      note_played, velocity_played, bend, degree0toRef_ratio) => {
      return new MpeHex(
        coords, cents, velocity_played, steps, center_degree,
        midi_output, pool,
        freqAtCentral, midiNoteForDegree0,
        actualBendRange, mpe_mode,
        scale,
        note_played  // for aftertouch tracking
      );
    },
  };
};

function MpeHex(coords, cents, velocity_played, steps, center_degree, midi_output, pool, freqAtCentral, midiNoteForDegree0, bendRange, mode, scale, note_played) {
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
  this.note_played = note_played;  // for aftertouch tracking from Lumatone

  // Allocate voice channel — steal oldest if pool exhausted
  const { slot, stolen, lastBend, lastNote, cleanSlot, stolenSlot, stolenNote, retrigger } = pool.noteOn(coords);
  
  //console.log(`=== NEW NOTE ===`);
  //console.log(`  slot=${slot} cleanSlot=${cleanSlot} stolenSlot=${stolenSlot} lastBend=${lastBend}`);
  
  // Reset pitch bend on cleanSlot (channel that was killed in previous steal)
  // This gives the release tail time to fade before we reset PB
  if (cleanSlot !== null) {
    const csc = cleanSlot - 1;  // 0-based
    midi_output.send([0xE0 + csc, 0, 64]);  // 8192 = centered
    //console.log(`  → RESET PB on cleanSlot ${cleanSlot} to center (8192)`);
  } else if (stolen !== null) {
    // FIRST steal: using reserved cleanSlot, but NO PB reset sent!
    // This could be the bug - the channel might have residual PB
    //console.log(`  → FIRST STEAL: no cleanSlot reset, channel ${slot} should already be at 8192`);
  }
  
  // Kill stolen voice with noteOff on its channel
  if (stolen !== null) {
    const ssc = stolenSlot - 1;  // 0-based channel of killed voice
    midi_output.send([0x80 + ssc, stolenNote, 0]);
    //console.log(`  → KILL voice on channel ${stolenSlot}, note ${stolenNote}`);
  }
  
  this.channel = slot; // 1-based

  // Calculate frequency from cents (deviation from degree 0)
  const freq = this.freqAtCentral * Math.pow(2, cents / 1200);

  // Calculate MIDI note and pitch bend
  const { note, deviation } = freqToMidiAndCents(freq, this.center_degree, this.channel, this.scale, this.mode);
  this.note = note;
  this.bend = deviationToBend(deviation, bendRange);
  
  // Send pitch bend NOW (in constructor) so it's ready before noteOn
  const c = this.channel - 1;
  const bendLSB = this.bend & 0x7F;
  const bendMSB = (this.bend >> 7) & 0x7F;
  midi_output.send([0xE0 + c, bendLSB, bendMSB]);
  
  // Debug: log the actual bend values
  const bendOffset = this.bend - 8192;  // signed offset from center
  const bendSemis = (bendOffset / 8192) * bendRange;
  //console.log(`BEND: channel=${this.channel} note=${this.note} deviation=${deviation.toFixed(0)}¢ bend=${this.bend} (offset=${bendOffset}, ${bendSemis.toFixed(2)} semitones) LSB=${bendLSB} MSB=${bendMSB}`);
  
  // Track current bend and note in pool for future reference
  pool.setLastBend(this.channel, this.bend);
  pool.setLastNote(this.channel, this.note);
}

MpeHex.prototype.noteOn = function () {
  const c = this.channel - 1; // 0-based for MIDI status byte
  
  // Pitch bend already sent in constructor
  // Small delay for synth to process pitch bend before noteOn
  //console.log(`noteOn: channel=${this.channel} note=${this.note} velocity=${this.velocity} (delaying 2ms)`);
  setTimeout(() => {
    this.midi_output.send([0x90 + c, this.note, this.velocity]);
    //console.log(`  → noteOn SENT: [${0x90 + c}, ${this.note}, ${this.velocity}]`);
  }, 1);
};

MpeHex.prototype.noteOff = function (release_velocity) {
  const c = this.channel - 1;
  const vel = release_velocity != null ? release_velocity : this.velocity;
  this.midi_output.send([0x80 + c, this.note, vel]);
  this.pool.noteOff(this.coords);
};


/**
 * Smoothly retune a held note to a new cents value.
 * Sends interpolated pitch bend messages for smooth pitch glide.
 * If the pitch crosses the pitch bend range boundary, sends note-off
 * and note-on on new note.
 */
MpeHex.prototype.retune = function(newCents) {
  const oldCents = this.cents;
  this.cents = newCents;
  
  // Calculate new frequency from cents
  const freq = this.freqAtCentral * Math.pow(2, newCents / 1200);
  
  // Recalculate MIDI note and pitch bend
  const { note, deviation } = freqToMidiAndCents(freq, this.center_degree, this.channel, this.scale, this.mode);
  const newNote = note;
  const newBend = deviationToBend(deviation, this.bendRange);
  
  const c = this.channel - 1; // 0-based for MIDI
  
  // Check if we crossed the pitch bend range boundary (note number changed)
  const noteChanged = newNote !== this.note;
  
  if (noteChanged) {
    // Send note-off on old note
    this.midi_output.send([0x80 + c, this.note, this.velocity]);
    
    // Update stored values
    this.note = newNote;
    this.bend = newBend;
    this.pool.setLastBend(this.channel, this.bend);
    this.pool.setLastNote(this.channel, this.note);
    
    // Send new pitch bend (before note-on, per MPE spec)
    const bendLSB = this.bend & 0x7F;
    const bendMSB = (this.bend >> 7) & 0x7F;
    this.midi_output.send([0xE0 + c, bendLSB, bendMSB]);
    
    // Send note-on on new note
    this.midi_output.send([0x90 + c, this.note, this.velocity]);
  } else {
    // Interpolate pitch bend for smooth transition
    const oldBend = this.bend;
    const delta = newBend - oldBend;
    
    // For small changes, send single message. For larger, interpolate.
    if (Math.abs(delta) < 200) {
      // Small change - send single pitch bend
      this.bend = newBend;
      this.pool.setLastBend(this.channel, this.bend);
      const bendLSB = this.bend & 0x7F;
      const bendMSB = (this.bend >> 7) & 0x7F;
      this.midi_output.send([0xE0 + c, bendLSB, bendMSB]);
    } else {
      // Larger change - interpolate over ~30ms
      const steps = Math.min(8, Math.max(3, Math.ceil(Math.abs(delta) / 200)));
      const stepDelta = delta / steps;
      let step = 0;
      
      const sendStep = () => {
        step++;
        this.bend = Math.round(oldBend + stepDelta * step);
        
        const bendLSB = this.bend & 0x7F;
        const bendMSB = (this.bend >> 7) & 0x7F;
        this.midi_output.send([0xE0 + c, bendLSB, bendMSB]);
        
        if (step < steps) {
          setTimeout(sendStep, 4);
        } else {
          // Ensure final value is exact
          this.bend = newBend;
          this.pool.setLastBend(this.channel, this.bend);
          const bendLSB = this.bend & 0x7F;
          const bendMSB = (this.bend >> 7) & 0x7F;
          this.midi_output.send([0xE0 + c, bendLSB, bendMSB]);
        }
      };
      
      sendStep();
    }
  }
};

MpeHex.prototype.aftertouch = function (value) {
  // Guard: don't send aftertouch if voice was stolen
  if (this.release) return;
  
  const c = this.channel - 1;
  // Channel pressure on the voice channel = MPE per-note pressure
  this.midi_output.send([0xD0 + c, Math.max(0, Math.min(127, value))]);
  //console.log(`AFTERTOUCH: note_played=${this.note_played} → MPE channel ${this.channel} value=${value}`);
};

export default create_mpe_synth;