import { centsToMTS } from "../tuning/mts-format.js";
import { allowsPerformanceCC } from "../midi/performance-cc-policy.js";
import { silentOutputHex } from "../audio/output-lifecycle.js";
import { readSnapshotExpression, expressionToMidi } from "../sequencer/snapshot-expression.js";

// Allocation belongs to the transport, so replacing a keyboard graph cannot
// accidentally allocate channels still owned by its previous graph.
const pools = new WeakMap();
let nextOwner = 0;
let nextVoice = 0;
const clamp = (value, max = 127) => Math.max(0, Math.min(max, Math.round(value)));

// Program selection changes future attacks, not existing FluidSynth voices.
// Rearticulate only sequencer-owned held notes on their existing channels so
// pitch/expression and already scheduled releases remain intact. Live keys and
// future queued attacks must not be restarted.
export function reattackFluidSynthSnapshots(output, timestamp = performance.now()) {
  for (const hex of pools.get(output)?.owners ?? []) hex?.reattackSnapshot?.(timestamp);
}

export function createInternalVoiceSynth({ outputMode, tuningContext, ensureAwake, forceAudioRebuild }) {
  const output = outputMode.output;
  const requestedRange = Number(outputMode.pitchBendRange ?? 48);
  // Use precisely the same cents resolution as RPN pitch-bend sensitivity.
  const rangeCents = Number.isFinite(requestedRange) && requestedRange > 0
    ? Math.max(1, Math.min(12700, Math.round(requestedRange * 100))) : 4800;
  let pool = pools.get(output);
  if (!pool) {
    pool = { owners: Array(128).fill(null), lastOwners: Array(128).fill(null),
      availableAt: Array(128).fill(-Infinity), cursor: 0 };
    pools.set(output, pool);
  }
  const active = new Set();
  const owner = ++nextOwner;
  const usedChannels = new Set();
  let closed = false;
  let sequenceGeneration = 0;
  const controllerState = { ccValues: {} };
  const send = (channel, op, a, b, timestamp, metadata) => {
    if (!closed) output.sendCommand({ channel, op, a, b }, timestamp, owner, metadata);
  };
  return {
    family: "mts", ensureAwake, forceAudioRebuild,
    makeHex(coords, cents, steps, equaves, equivSteps, previous, next, notePlayed, velocityPlayed,
      bend, ratio, playbackOptions = {}) {
      if (closed) return silentOutputHex(coords, cents);
      const offset = 1200 * Math.log2((tuningContext.fundamental / ratio) / 261.6255653);
      const metadata = { voice: ++nextVoice,
        scope: Number.isFinite(playbackOptions.absoluteMidicents) ? "sequence" : "live",
        generation: sequenceGeneration };
      const voiceSend = (channel, op, a, b, timestamp) => send(channel, op, a, b, timestamp, metadata);
      const expressionTimestamp = () => Number.isFinite(hex.attackTimestamp) &&
        hex.attackTimestamp > performance.now() ? hex.attackTimestamp : undefined;
      const hex = {
        coords, cents, equaves, note_played: notePlayed, release: false,
        isMtsOutput: true, supportsMpeTimbre: true,
        bend_down: cents - previous, bend_up: next - cents,
        velocity: velocityPlayed > 0 ? velocityPlayed : outputMode.velocity,
        channel: null, sounding: false,
        needsRetainedVoiceRecovery() {
          return !closed && this._hasAttacked === true &&
            (!this.sounding || pool.owners[this.channel] !== this);
        },
        reattackSnapshot(timestamp) {
          if (closed || metadata.scope !== "sequence" || this.release || !this.sounding ||
              pool.owners[this.channel] !== this || this.attackTimestamp > timestamp) return;
          voiceSend(this.channel, "off", this.steps, 0, timestamp);
          voiceSend(this.channel, "on", this.steps, this.velocity, timestamp);
        },
        noteOn(timestamp) {
          if (closed || this.release || this.sounding) return;
          let channel = pool.cursor;
          let foundFree = false;
          const attackAt = Number.isFinite(timestamp) ? timestamp : performance.now();
          for (let i = 0; i < 128; i++) {
            const candidate = (pool.cursor + i) % 128;
            if (!pool.owners[candidate] && pool.availableAt[candidate] <= attackAt) {
              channel = candidate; foundFree = true; break;
            }
          }
          if (!foundFree) {
            // Steal a held channel before delaying behind a free-but-reserved
            // channel. If all channels are reserved, use the earliest release.
            const held = Array.from({ length: 128 }, (_, i) => (pool.cursor + i) % 128)
              .find(candidate => pool.owners[candidate]);
            channel = held ?? pool.availableAt.indexOf(Math.min(...pool.availableAt));
          }
          const stolen = pool.owners[channel];
          if (stolen) {
            this._stolenCoords = stolen.coords;
            stolen.cancelPendingEvents();
            stolen.noteOff(0, timestamp);
          }
          // A release reserved in the future must not kill an earlier live
          // attack. Prefer another channel; if exhausted, defer its reuse.
          if (pool.availableAt[channel] > attackAt) timestamp = pool.availableAt[channel];
          pool.cursor = (channel + 1) % 128;
          pool.owners[channel] = this;
          pool.lastOwners[channel] = owner;
          usedChannels.add(channel);
          this.channel = channel;
          this.attackTimestamp = timestamp;
          this.baseCents = this.cents;
          this.steps = clamp(60 + (this.cents + offset) / 100);
          // Silence old release tails before changing this channel's tuning or expression.
          voiceSend(channel, "cc", 120, 0, timestamp);
          voiceSend(channel, "cc", 121, 0, timestamp);
          for (const [cc, value] of [[101, 0], [100, 0], [6, Math.floor(rangeCents / 100)],
            [38, rangeCents % 100], [101, 127], [100, 127]]) {
            voiceSend(channel, "cc", cc, value, timestamp);
          }
          output.send([0xf0, 0x7f, 0x7f, 8, 2, channel, 1, this.steps,
            ...centsToMTS(60 + (this.cents + offset) / 100, 0), 0xf7], timestamp, owner, metadata);
          voiceSend(channel, "bend", 8192, 0, timestamp);
          this.lastBend = 8192;
          voiceSend(channel, "pressure", this.initialPressure ?? 0, 0, timestamp);
          for (const [cc, value] of Object.entries(controllerState.ccValues)) voiceSend(channel, "cc", Number(cc), value, timestamp);
          if (this.initialTimbre != null) voiceSend(channel, "cc", 74, this.initialTimbre, timestamp);
          voiceSend(channel, "on", this.steps, this.velocity, timestamp);
          this.sounding = true;
          this._hasAttacked = true;
          active.add(this);
        },
        retune(value) {
          if (this.release || !Number.isFinite(value)) return;
          this.cents = value;
          if (!this.sounding || pool.owners[this.channel] !== this) return;
          const pitch = clamp(8192 + (value - this.baseCents) / rangeCents * 8192, 16383);
          if (pitch !== this.lastBend) { voiceSend(this.channel, "bend", pitch, undefined, expressionTimestamp()); this.lastBend = pitch; }
        },
        sequenceRetune(value) {
          if (closed || this.release || !Number.isFinite(value)) return;
          this.cents = value;
          if (!this.sounding || pool.owners[this.channel] !== this) return;
          // Sequence tuning is exact MTS, not the quantized performance wheel.
          const timestamp = Number.isFinite(this.attackTimestamp) && this.attackTimestamp > performance.now()
            ? this.attackTimestamp : undefined;
          output.send([0xf0, 0x7f, 0x7f, 8, 2, this.channel, 1, this.steps,
            ...centsToMTS(60 + (value + offset) / 100, 0), 0xf7], timestamp, owner, metadata);
          this.baseCents = value;
          voiceSend(this.channel, "bend", 8192, 0, timestamp);
          this.lastBend = 8192;
        },
        noteOff(_velocity, timestamp) {
          if (this.release) return;
          if (this.sounding && pool.owners[this.channel] === this) {
            const releaseAt = Number.isFinite(timestamp) ? timestamp : performance.now();
            if (Number.isFinite(this.attackTimestamp) && releaseAt < this.attackTimestamp)
              this.cancelPendingEvents();
            voiceSend(this.channel, "off", this.steps, 0, timestamp);
            pool.availableAt[this.channel] = releaseAt;
            pool.owners[this.channel] = null;
          }
          this.release = true; active.delete(this);
        },
        cancelPendingEvents() { output.cancelEvents?.(owner, null, null, metadata.voice); },
        prepareSnapshotExpression(note) {
          if (note.expression) {
            const expression = readSnapshotExpression(note);
            this.initialPressure = expressionToMidi(expression.pressure);
            this.initialTimbre = expressionToMidi(expression.timbre);
            return;
          }
          this.initialPressure = note.pressure ?? (note.pressure14 == null ? 0 : note.pressure14 >> 7);
          this.initialTimbre = note.timbre ?? (note.timbre14 == null ? null : note.timbre14 >> 7);
        },
      };
      for (const [method, op, cc] of [["aftertouch", "pressure"], ["pressure", "pressure"],
        ["cc74", "cc", 74], ["modwheel", "cc", 1], ["expression", "cc", 11]]) {
        hex[method] = (value) => {
          if (hex.sounding && !hex.release && pool.owners[hex.channel] === hex) {
            voiceSend(hex.channel, op, cc ?? clamp(value), cc == null ? 0 : clamp(value), expressionTimestamp());
          }
        };
      }
      hex.applyNormalizedSnapshotPressure = value => hex.pressure(expressionToMidi(value));
      hex.applyNormalizedSnapshotTimbre = value => hex.cc74(expressionToMidi(value));
      return hex;
    },
    releaseAll() { for (const hex of [...active]) hex.noteOff(0); },
    cancelSequenceEvents() {
      output.cancelEvents?.(owner, "sequence", sequenceGeneration);
      sequenceGeneration++;
    },
    allSoundOff() {
      if (output.panic) output.panic();
      else for (let channel = 0; channel < 128; channel++) send(channel, "cc", 120, 0);
      for (const hex of pool.owners) if (hex) { hex.release = true; hex.sounding = false; }
      pool.owners.fill(null);
      pool.lastOwners.fill(null);
      pool.availableAt.fill(-Infinity);
      active.clear();
    },
    shutdown() {
      if (closed) return;
      for (const hex of [...active]) hex.noteOff(0);
      output.cancelEvents?.(owner);
      // Silence release/sustain tails, but never channels since reused by a
      // replacement graph on the same long-lived FluidSynth transport.
      for (const channel of usedChannels) {
        if (pool.lastOwners[channel] !== owner) continue;
        send(channel, "cc", 64, 0);
        send(channel, "cc", 66, 0);
        send(channel, "cc", 120, 0);
        pool.lastOwners[channel] = null;
      }
      closed = true;
    },
    applyControllerState(state = {}) {
      const values = Object.fromEntries(Object.entries(state.ccValues || {})
        .filter(([cc]) => allowsPerformanceCC(cc)));
      Object.assign(controllerState.ccValues, values);
      for (const hex of active) {
        const timestamp = Number.isFinite(hex.attackTimestamp) && hex.attackTimestamp > performance.now()
          ? hex.attackTimestamp : undefined;
        for (const [cc, value] of Object.entries(values)) send(hex.channel, "cc", Number(cc), clamp(value), timestamp);
        if (state.channelPressure != null) hex.pressure(state.channelPressure);
      }
    },
  };
}
