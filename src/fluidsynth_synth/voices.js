import { centsToMTS } from "../tuning/mts-format.js";
import { allowsPerformanceCC } from "../midi/performance-cc-policy.js";
import { silentOutputHex } from "../audio/output-lifecycle.js";

// Allocation belongs to the transport, so replacing a keyboard graph cannot
// accidentally allocate channels still owned by its previous graph.
const pools = new WeakMap();
let nextOwner = 0;
const clamp = (value, max = 127) => Math.max(0, Math.min(max, Math.round(value)));

export function createInternalVoiceSynth({ outputMode, tuningContext, ensureAwake, forceAudioRebuild }) {
  const output = outputMode.output;
  const requestedRange = Number(outputMode.pitchBendRange ?? 48);
  // Use precisely the same cents resolution as RPN pitch-bend sensitivity.
  const rangeCents = Number.isFinite(requestedRange) && requestedRange > 0
    ? Math.max(1, Math.min(12700, Math.round(requestedRange * 100))) : 4800;
  let pool = pools.get(output);
  if (!pool) {
    pool = { owners: Array(128).fill(null), lastOwners: Array(128).fill(null), cursor: 0 };
    pools.set(output, pool);
  }
  const active = new Set();
  const owner = ++nextOwner;
  const usedChannels = new Set();
  let closed = false;
  const controllerState = { ccValues: {} };
  const send = (channel, op, a, b, timestamp) => {
    if (!closed) output.sendCommand({ channel, op, a, b }, timestamp, owner);
  };
  return {
    family: "mts", ensureAwake, forceAudioRebuild,
    makeHex(coords, cents, steps, equaves, equivSteps, previous, next, notePlayed, velocityPlayed,
      bend, ratio) {
      if (closed) return silentOutputHex(coords, cents);
      const offset = 1200 * Math.log2((tuningContext.fundamental / ratio) / 261.6255653);
      const hex = {
        coords, cents, equaves, note_played: notePlayed, release: false,
        isMtsOutput: true, supportsMpeTimbre: true,
        bend_down: cents - previous, bend_up: next - cents,
        velocity: velocityPlayed > 0 ? velocityPlayed : outputMode.velocity,
        channel: null, sounding: false,
        noteOn(timestamp) {
          if (closed || this.release || this.sounding) return;
          let channel = pool.cursor;
          for (let i = 0; i < 128; i++) {
            const candidate = (pool.cursor + i) % 128;
            if (!pool.owners[candidate]) { channel = candidate; break; }
          }
          const stolen = pool.owners[channel];
          if (stolen) { this._stolenCoords = stolen.coords; stolen.noteOff(0, timestamp); }
          pool.cursor = (channel + 1) % 128;
          pool.owners[channel] = this;
          pool.lastOwners[channel] = owner;
          usedChannels.add(channel);
          this.channel = channel;
          this.attackTimestamp = timestamp;
          this.baseCents = this.cents;
          this.steps = clamp(60 + (this.cents + offset) / 100);
          // Silence old release tails before changing this channel's tuning or expression.
          send(channel, "cc", 120, 0, timestamp);
          send(channel, "cc", 121, 0, timestamp);
          for (const [cc, value] of [[101, 0], [100, 0], [6, Math.floor(rangeCents / 100)],
            [38, rangeCents % 100], [101, 127], [100, 127]]) {
            send(channel, "cc", cc, value, timestamp);
          }
          output.send([0xf0, 0x7f, 0x7f, 8, 2, channel, 1, this.steps,
            ...centsToMTS(60 + (this.cents + offset) / 100, 0), 0xf7], timestamp, owner);
          send(channel, "bend", 8192, 0, timestamp);
          this.lastBend = 8192;
          send(channel, "pressure", 0, 0, timestamp);
          for (const [cc, value] of Object.entries(controllerState.ccValues)) send(channel, "cc", Number(cc), value, timestamp);
          send(channel, "on", this.steps, this.velocity, timestamp);
          this.sounding = true;
          active.add(this);
        },
        retune(value) {
          if (this.release || !Number.isFinite(value)) return;
          this.cents = value;
          if (!this.sounding || pool.owners[this.channel] !== this) return;
          const pitch = clamp(8192 + (value - this.baseCents) / rangeCents * 8192, 16383);
          if (pitch !== this.lastBend) { send(this.channel, "bend", pitch); this.lastBend = pitch; }
        },
        sequenceRetune(value) {
          if (closed || this.release || !Number.isFinite(value)) return;
          this.cents = value;
          if (!this.sounding || pool.owners[this.channel] !== this) return;
          // Sequence tuning is exact MTS, not the quantized performance wheel.
          const timestamp = Number.isFinite(this.attackTimestamp) && this.attackTimestamp > performance.now()
            ? this.attackTimestamp : undefined;
          output.send([0xf0, 0x7f, 0x7f, 8, 2, this.channel, 1, this.steps,
            ...centsToMTS(60 + (value + offset) / 100, 0), 0xf7], timestamp, owner);
          this.baseCents = value;
          send(this.channel, "bend", 8192, 0, timestamp);
          this.lastBend = 8192;
        },
        noteOff(_velocity, timestamp) {
          if (this.release) return;
          if (this.sounding && pool.owners[this.channel] === this) {
            send(this.channel, "off", this.steps, 0, timestamp);
            pool.owners[this.channel] = null;
          }
          this.release = true; active.delete(this);
        },
      };
      for (const [method, op, cc] of [["aftertouch", "pressure"], ["pressure", "pressure"],
        ["cc74", "cc", 74], ["modwheel", "cc", 1], ["expression", "cc", 11]]) {
        hex[method] = (value) => {
          if (hex.sounding && !hex.release && pool.owners[hex.channel] === hex) {
            send(hex.channel, op, cc ?? clamp(value), cc == null ? 0 : clamp(value));
          }
        };
      }
      return hex;
    },
    releaseAll() { for (const hex of [...active]) hex.noteOff(0); },
    allSoundOff() {
      if (output.panic) output.panic();
      else for (let channel = 0; channel < 128; channel++) send(channel, "cc", 120, 0);
      for (const hex of pool.owners) if (hex) { hex.release = true; hex.sounding = false; }
      pool.owners.fill(null);
      pool.lastOwners.fill(null);
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
        for (const [cc, value] of Object.entries(values)) send(hex.channel, "cc", Number(cc), clamp(value));
        if (state.channelPressure != null) hex.pressure(state.channelPressure);
      }
    },
  };
}
