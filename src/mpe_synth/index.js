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

import { VoicePool } from "../polyphony/voice-pool-oldest";
import { scalaToCents } from "../settings/scale/parse-scale";
import { traceMidiOutput } from "../debug/midi-jitter.js";
import { sendMpeZonePitchBendRange } from "../midi/rpn.js";
import { createAutoMpeYzScheduler } from "./auto-yz.js";

// PB and noteOn are sent in the same synchronous call — the MIDI driver
// processes them in FIFO order, so PB always arrives before noteOn.
// noteOff is NEVER delayed — delaying it risks stuck notes.
const RELEASE_GUARD_MS = 500;
const ACTIVE_MPE_NOTES_STORAGE_PREFIX = "hexatone_active_mpe_notes:";

function activeMpeNotesStorageKey(midiOutput) {
  const outputIdentity = midiOutput?.id ?? midiOutput?.name ?? "default";
  return `${ACTIVE_MPE_NOTES_STORAGE_PREFIX}${String(outputIdentity)}`;
}

function readPersistedMpeNotes(midiOutput) {
  try {
    const stored = globalThis.sessionStorage?.getItem(activeMpeNotesStorageKey(midiOutput));
    const parsed = stored ? JSON.parse(stored) : {};
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([channel, note]) => {
        const channel0 = Number(channel);
        return (
          Number.isInteger(channel0) &&
          channel0 >= 0 &&
          channel0 <= 15 &&
          Number.isInteger(note) &&
          note >= 0 &&
          note <= 127
        );
      }),
    );
  } catch {
    return {};
  }
}

function writePersistedMpeNotes(midiOutput, notesByChannel) {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    const key = activeMpeNotesStorageKey(midiOutput);
    if (Object.keys(notesByChannel).length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(notesByChannel));
  } catch {
    // MIDI output must remain usable when storage is unavailable or full.
  }
}

function rememberMpeNoteOn(midiOutput, channel0, note) {
  const notesByChannel = readPersistedMpeNotes(midiOutput);
  notesByChannel[channel0] = note;
  writePersistedMpeNotes(midiOutput, notesByChannel);
}

function forgetMpeNote(midiOutput, channel0, note) {
  const notesByChannel = readPersistedMpeNotes(midiOutput);
  if (Number(notesByChannel[channel0]) !== note) return;
  delete notesByChannel[channel0];
  writePersistedMpeNotes(midiOutput, notesByChannel);
}

function releasePersistedMpeNotes(midiOutput) {
  if (!midiOutput) return;
  const notesByChannel = readPersistedMpeNotes(midiOutput);
  for (const [channel, note] of Object.entries(notesByChannel)) {
    midiOutput.send([0x80 + Number(channel), note, 0]);
  }
  writePersistedMpeNotes(midiOutput, {});
}

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

function traceMpePitchbend(channel, note, value) {
  traceMidiOutput("mpePitchbendOut", {
    family: "mpe",
    channel,
    note,
    value,
  });
}

function createMpePlusPitchBendScheduler(midi_output) {
  const send = (hex, value) => {
    if (!hex.release) {
      const c = hex.channel - 1;
      sendBend21(midi_output, c, value);
      hex._lastSentBend21 = value;
      hex._lastSentBend = (value >> 7) & 0x3fff;
      traceMpePitchbend(hex.channel, hex.note, value);
    }
  };

  return {
    enqueue(hex, value) {
      send(hex, value);
    },
    sendImmediate(hex, value) {
      send(hex, value);
    },
    cancel() {},
    clear() {},
  };
}

function send14BitCc(midi_output, channel0, cc, value14) {
  sendMpePlusLsb(midi_output, channel0, value14 & 0x7f);
  midi_output.send([0xb0 + channel0, cc & 0x7f, (value14 >> 7) & 0x7f]);
}

function send14BitChannelPressure(midi_output, channel0, value14) {
  sendMpePlusLsb(midi_output, channel0, value14 & 0x7f);
  midi_output.send([0xd0 + channel0, (value14 >> 7) & 0x7f]);
}

function sendMpePanic(midi_output, masterChannel0, voiceIds) {
  if (!midi_output) return;
  // Some MPE receivers do not treat channel-mode CC120/123 as a complete
  // zone clear. Release the exact voices retained from this page (or a crashed
  // predecessor) before sending the standard channel-mode fallback.
  releasePersistedMpeNotes(midi_output);
  const channels = new Set([
    ...(masterChannel0 >= 0 ? [masterChannel0] : []),
    ...voiceIds.map((channel) => channel - 1),
  ]);
  for (const channel0 of channels) {
    midi_output.send([0xb0 + channel0, 123, 0]); // All Notes Off
    midi_output.send([0xb0 + channel0, 120, 0]); // All Sound Off
  }
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
  mpePlusPitchBendEnabled = false,
  autoGenerateMpeYzEnabled = false,
) => {
  if (!midi_output) return null;

  const actualBendRange = mpe_mode === "Ableton_workaround" ? 48 : bendRange || 48;
  const managerBendRange = mpe_mode === "Ableton_workaround" ? 2 : bendRangeManager || 2;
  const masterCh = master_ch != "-1" ? parseInt(master_ch) - 1 : -1;
  const voiceIds = [];
  for (let ch = lo_ch; ch <= hi_ch; ch++) voiceIds.push(ch);

  const pool = new VoicePool(voiceIds, releaseGuardMs, closestPitchSteal);
  const deferredTimers = new Set();
  let shuttingDown = false;
  const scheduleDeferred = (callback, delayMs) => {
    const timerId = setTimeout(() => {
      deferredTimers.delete(timerId);
      if (!shuttingDown) callback();
    }, delayMs);
    deferredTimers.add(timerId);
    return timerId;
  };

  const freqAtCentral = calculateFreqAtCentralDegree(
    fundamental,
    reference_degree,
    center_degree,
    scale,
  );
  const midiNoteForDegree0 = midiin_anchor_note;

  // A browser renderer crash cannot run beforeunload or component teardown.
  // Clear the configured MPE zone on every fresh session so an external synth
  // cannot retain note-ons whose owning browser process no longer exists.
  sendMpePanic(midi_output, masterCh, voiceIds);

  // Send MPE-zone and pitch-bend configuration immediately.
  sendMpeZonePitchBendRange(midi_output, {
    managerChannel0: masterCh,
    memberChannels0: voiceIds.map((channel) => channel - 1),
    memberBendRange: actualBendRange,
    managerBendRange,
  });

  // Centre every member channel on startup so the first note cannot inherit a
  // stale bend from an earlier MPE session.
  for (const ch of voiceIds) {
    const c = ch - 1;
    midi_output.send([0xe0 + c, 0, 64]); // 8192 = centred
  }
  // PB centre reset — deferred so old release tails finish first
  scheduleDeferred(() => {
    for (const ch of voiceIds) {
      const c = ch - 1;
      if (pool.getChannelState(ch) === "IDLE") {
        midi_output.send([0xe0 + c, 0, 64]); // 8192 = centred
      }
    }
  }, releaseGuardMs);

  const activeHexes = new Set();
  const mpePlusPitchBendScheduler = createMpePlusPitchBendScheduler(midi_output);
  const autoMpeYzScheduler = createAutoMpeYzScheduler(midi_output);
  let mpePlusPitchBendDefault = mpePlusPitchBendEnabled === true;
  let autoGenerateMpeYzDefault = autoGenerateMpeYzEnabled === true;
  const releaseAllVoices = () => {
    for (const hex of [...activeHexes]) hex.noteOff(0);
    mpePlusPitchBendScheduler.clear();
    for (const channel of voiceIds) autoMpeYzScheduler.reset(channel);
  };

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
        mpePlusPitchBendDefault,
        mpePlusPitchBendScheduler,
        autoGenerateMpeYzDefault,
        autoMpeYzScheduler,
        scheduleDeferred,
      );
      activeHexes.add(hex);
      const originalNoteOff = hex.noteOff.bind(hex);
      hex.noteOff = (release_velocity) => {
        originalNoteOff(release_velocity);
        activeHexes.delete(hex);
      };
      return hex;
    },

    /** Clear every voice channel and the manager channel with CC123 + CC120. */
    allSoundOff: () => {
      sendMpePanic(midi_output, masterCh, voiceIds);
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

    releaseAll: releaseAllVoices,

    shutdown: () => {
      for (const hex of [...activeHexes]) hex.noteOff(0);
      shuttingDown = true;
      for (const timerId of deferredTimers) clearTimeout(timerId);
      deferredTimers.clear();
      mpePlusPitchBendScheduler.clear();
      for (const channel of voiceIds) {
        const channel0 = channel - 1;
        midi_output.send([0xb0 + channel0, 74, 0]);
        midi_output.send([0xd0 + channel0, 0]);
      }
      autoMpeYzScheduler.shutdown();
    },

    setMpePlusPitchBendEnabled: (enabled) => {
      mpePlusPitchBendDefault = enabled === true;
      for (const hex of activeHexes) hex.setMpePlusPitchBendEnabled(enabled);
    },

    setAutoGenerateMpeYzEnabled: (enabled) => {
      autoGenerateMpeYzDefault = enabled === true;
      for (const hex of activeHexes) hex.setAutoGenerateMpeYzEnabled(enabled);
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
  mpePlusPitchBendEnabled,
  mpePlusPitchBendScheduler,
  autoGenerateMpeYzEnabled,
  autoMpeYzScheduler,
  scheduleDeferred,
) {
  this.coords = coords;
  this.cents = cents;
  this.standardWheelPassthroughOnly = true;
  this.supportsMpeTimbre = true;
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
  this.mpePlusPitchBendEnabled = mpePlusPitchBendEnabled === true;
  this.mpePlusPitchBendScheduler = mpePlusPitchBendScheduler;
  this.autoGeneratesMpeYZ = autoGenerateMpeYzEnabled === true;
  this.autoMpeYzScheduler = autoMpeYzScheduler;
  this.scheduleDeferred = scheduleDeferred;
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

  const { slot, allocationToken, stolen, stolenSlot, stolenNote, retrigger } = pool.noteOn(
    coords,
    bendGuess,
  );

  this.channel = slot; // 1-based
  this.allocationToken = allocationToken;
  this._stolenCoords = stolen;

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
  if (this.mpePlusPitchBendEnabled) {
    this._sendMpePlusPitchBend(this.bend21, { immediate: true });
  } else {
    sendBend(midi_output, c, this.bend);
    this._lastSentBend = this.bend;
    traceMidiOutput("mpePitchbendOut", {
      family: "mpe",
      channel: this.channel,
      note: this.note,
      value: this.bend,
    });
  }
  midi_output.send([0x90 + c, this.note, this.velocity]);
  rememberMpeNoteOn(midi_output, c, this.note);
  traceMidiOutput("mpeNoteOn", {
    family: "mpe",
    channel: this.channel,
    note: this.note,
    value: this.velocity,
  });
  if (this.autoGeneratesMpeYZ) {
    this.autoMpeYzScheduler?.onset(this.channel, this.velocity);
  }

  pool.setLastBend(this.channel, this.bend);
  pool.setLastNote(this.channel, this.note);
}

MpeHex.prototype.noteOn = function () {
  // noteOn was already scheduled in the constructor via WebMIDI timestamp.
  // This method is called by keys.js after construction — nothing to do here.
};

MpeHex.prototype._ownsVoiceChannel = function () {
  return this.pool?.owns?.(this.coords, this.channel, this.allocationToken) === true;
};

MpeHex.prototype._invalidateDisplacedVoice = function () {
  this.mpePlusPitchBendScheduler?.cancel(this);
  this.release = true;
};

MpeHex.prototype.noteOff = function (release_velocity) {
  if (this.release) return;
  // A stolen MPE hex still exists in higher-level legato registries, but its
  // channel now belongs to another note. It must never note-off that owner.
  if (!this._ownsVoiceChannel()) {
    this._invalidateDisplacedVoice();
    return;
  }
  const c = this.channel - 1;
  const vel = release_velocity != null ? release_velocity : this.velocity;
  this.mpePlusPitchBendScheduler?.cancel(this);
  // Send noteOff immediately — no PB reset during the release tail
  this.midi_output.send([0x80 + c, this.note, vel]);
  forgetMpeNote(this.midi_output, c, this.note);
  traceMidiOutput("mpeNoteOff", {
    family: "mpe",
    channel: this.channel,
    note: this.note,
    value: vel,
  });
  if (this.autoGeneratesMpeYZ) {
    this.autoMpeYzScheduler?.release(this.channel, vel);
  }
  // Mark RELEASING in pool (starts the guard timer)
  this.pool.noteOff(this.coords, this.allocationToken);
  // Guard against aftertouch arriving after release
  this.release = true;

  // After the release tail decays, reset PB to centre only if this exact
  // allocation generation still owns the pending release. This keeps channels
  // clean without resetting one that was reallocated in the meantime.
  const channel = this.channel;
  const allocationToken = this.allocationToken;
  const pool = this.pool;
  const midi_out = this.midi_output;
  this.scheduleDeferred(() => {
    if (pool.completeRelease(channel, allocationToken)) {
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
  // Voice stealing removes this coordinate from the pool before reassigning
  // the channel. A stale sequencer voice must not bend the replacement note.
  if (!this._ownsVoiceChannel()) {
    this._invalidateDisplacedVoice();
    return;
  }
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
    traceMidiOutput("mpeNoteOff", {
      family: "mpe",
      channel: this.channel,
      note: this.note,
      value: this.velocity,
    });
    this.note = note;
    this.bend = newBend;
    this.bend21 = newBend21;
    this.pool.setLastBend(this.channel, this.bend);
    this.pool.setLastNote(this.channel, this.note);
    if (this.mpePlusPitchBendEnabled) {
      this._sendMpePlusPitchBend(this.bend21, { immediate: true });
    } else {
      sendBend(this.midi_output, c, this.bend);
      this._lastSentBend = this.bend;
      traceMidiOutput("mpePitchbendOut", {
        family: "mpe",
        channel: this.channel,
        note: this.note,
        value: this.bend,
      });
    }
    this.midi_output.send([0x90 + c, this.note, this.velocity]);
    rememberMpeNoteOn(this.midi_output, c, this.note);
    traceMidiOutput("mpeNoteOn", {
      family: "mpe",
      channel: this.channel,
      note: this.note,
      value: this.velocity,
    });
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
    if (this.mpePlusPitchBendEnabled) {
      if (this._lastSentBend21 !== this.bend21) {
        this._sendMpePlusPitchBend(this.bend21);
      }
    } else if (this._lastSentBend !== this.bend) {
      sendBend(this.midi_output, c, this.bend);
      this._lastSentBend = this.bend;
      traceMidiOutput("mpePitchbendOut", {
        family: "mpe",
        channel: this.channel,
        note: this.note,
        value: this.bend,
      });
    }
  }
};

// Sequencer PITCH keeps the allocated MPE note/channel sounding and expresses
// the absolute target through its configured bend range.
MpeHex.prototype.sequenceRetune = function (newCents) {
  this.retune(newCents, true);
};

MpeHex.prototype.setMpePlusPitchBendEnabled = function (enabled) {
  const next = enabled === true;
  if (this.mpePlusPitchBendEnabled === next) return;
  this.mpePlusPitchBendScheduler?.cancel(this);
  this.mpePlusPitchBendEnabled = next;
  this._lastSentBend21 = next ? this.bend21 : null;
};

MpeHex.prototype.setAutoGenerateMpeYzEnabled = function (enabled) {
  const next = enabled === true;
  if (this.autoGeneratesMpeYZ === next) return;
  this.autoGeneratesMpeYZ = next;
  if (next && !this.release && this._ownsVoiceChannel()) {
    this.autoMpeYzScheduler?.onset(this.channel, this.velocity);
  } else if (!next && this._ownsVoiceChannel()) {
    this.autoMpeYzScheduler?.reset(this.channel);
  }
};

MpeHex.prototype._sendMpePlusPitchBend = function (bend21, { immediate = false } = {}) {
  if (this.release) return;
  if (immediate) this.mpePlusPitchBendScheduler?.sendImmediate(this, bend21);
  else this.mpePlusPitchBendScheduler?.enqueue(this, bend21);
};

MpeHex.prototype.aftertouch = function (value, value14 = null, context = null) {
  if (this.release) return;
  if (!this._ownsVoiceChannel()) {
    this._invalidateDisplacedVoice();
    return;
  }
  if (this.autoGeneratesMpeYZ) {
    const pressure = Number.isFinite(value14) ? value14 >> 7 : value;
    // Sequence snapshots normally carry an explicit zero-pressure default
    // immediately after note-on. That is not pressure activity and must not
    // erase the generated velocity onset. A captured non-zero value is real
    // expression and does shape the generated envelope.
    if (context?.initialSnapshotExpression && pressure <= 0) return;
    this.autoMpeYzScheduler?.pressure(this.channel, pressure, this.velocity);
    return;
  }
  const c = this.channel - 1;
  if (Number.isFinite(value14)) {
    const next = Math.max(0, Math.min(16256, value14));
    if (this._lastSentAftertouch14 === next) return;
    send14BitChannelPressure(this.midi_output, c, next);
    traceMidiOutput("mpeAftertouchOut", {
      family: "mpe",
      channel: this.channel,
      note: this.note,
      value: next,
    });
    this._lastSentAftertouch14 = next;
    this._lastSentAftertouch = (next >> 7) & 0x7f;
    return;
  }
  const next = Math.max(0, Math.min(127, value));
  if (this._lastSentAftertouch === next && this._lastSentAftertouch14 == null) return;
  this.midi_output.send([0xd0 + c, next]);
  traceMidiOutput("mpeAftertouchOut", {
    family: "mpe",
    channel: this.channel,
    note: this.note,
    value: next,
  });
  this._lastSentAftertouch = next;
  this._lastSentAftertouch14 = null;
};

MpeHex.prototype.applySnapshotPressure = function (value, value14 = null) {
  this.aftertouch(value, value14, { initialSnapshotExpression: true });
};

// pressure: channel pressure on the voice's own channel (same as aftertouch for MPE).
MpeHex.prototype.pressure = function (value, value14 = null) {
  this.aftertouch(value, value14);
};

// cc74: brightness / timbre — per-voice CC on the voice channel (MPE dimension 3).
MpeHex.prototype.cc74 = function (value, value14 = null) {
  if (this.release) return;
  if (!this._ownsVoiceChannel()) {
    this._invalidateDisplacedVoice();
    return;
  }
  // Auto Y/Z owns both expression dimensions. Incoming CC74 is intentionally
  // ignored so a stored snapshot's default timbre=0 cannot erase its generated
  // velocity onset.
  if (this.autoGeneratesMpeYZ) return;
  const c = this.channel - 1;
  if (Number.isFinite(value14)) {
    const next = Math.max(0, Math.min(16256, value14));
    if (this._lastSentCc7414 === next) return;
    send14BitCc(this.midi_output, c, 74, next);
    traceMidiOutput("mpeCC74Out", {
      family: "mpe",
      channel: this.channel,
      note: this.note,
      value: next,
    });
    this._lastSentCc7414 = next;
    this._lastSentCc74 = (next >> 7) & 0x7f;
    return;
  }
  const next = Math.max(0, Math.min(127, value));
  if (this._lastSentCc74 === next && this._lastSentCc7414 == null) return;
  this.midi_output.send([0xb0 + c, 74, next]);
  traceMidiOutput("mpeCC74Out", {
    family: "mpe",
    channel: this.channel,
    note: this.note,
    value: next,
  });
  this._lastSentCc74 = next;
  this._lastSentCc7414 = null;
};

MpeHex.prototype.mpeTimbre = function (value, value14 = null) {
  this.cc74(value, value14);
};

MpeHex.prototype.polyTimbre = function (value, value14 = null) {
  this.cc74(value, value14);
};

// modwheel: CC1 — zone-wide, sent on manager channel.
MpeHex.prototype.modwheel = function (value) {
  if (this.release || !this._ownsVoiceChannel()) return;
  if (this.masterCh < 0) return;
  this.midi_output.send([0xb0 + this.masterCh, 1, Math.max(0, Math.min(127, value))]);
};

// expression: CC11 — zone-wide, sent on manager channel.
MpeHex.prototype.expression = function (value) {
  if (this.release || !this._ownsVoiceChannel()) return;
  if (this.masterCh < 0) return;
  this.midi_output.send([0xb0 + this.masterCh, 11, Math.max(0, Math.min(127, value))]);
};

export default create_mpe_synth;
