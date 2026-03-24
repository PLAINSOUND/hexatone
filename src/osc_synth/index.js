/**
 * osc_synth — sends note events directly to SuperCollider via WebSocket → OSC bridge.
 *
 * Implements the same interface as midi_synth and sample_synth:
 *   makeHex(coords, cents, ...) → { noteOn(), noteOff(), retune(), aftertouch() }
 *
 * Each note maps to a SC synth node. The browser owns node IDs (monotonic counter),
 * so no state-tracking arrays are needed on the SC side — just SynthDefs.
 *
 * Requires the osc-bridge Node.js process to be running locally:
 *   node osc-bridge/index.js
 *
 * Configuration (passed to create_osc_synth):
 *   wsUrl      — WebSocket URL of the bridge (default "ws://localhost:8089")
 *   synthNames — array of 4 SC synth names, one per layer e.g. ["pluck","string","formant","tone"]
 *   volumes    — Float32Array or array of 4 volume values 0–1, one per layer
 *   serverIds  — scsynth group/target node IDs for each layer (default [1,1,1,1])
 */

const WS_URL_DEFAULT = "ws://localhost:8089";

// Monotonic node ID counter. scsynth reserves 0 (root) and 1 (default group).
// We start at 2000 to stay well clear of any SC-allocated nodes.
let _nextNodeId = 2000;
const nextNodeId = () => _nextNodeId++;

/**
 * Shared WebSocket connection, lazily created and reused across all OscHex instances.
 * Reconnects automatically if the bridge is restarted.
 */
class OscSocket {
  constructor(url) {
    this._url      = url;
    this._ws       = null;
    this._queue    = [];   // messages buffered while connecting
    this._connect();
  }

  _connect() {
    const ws = new WebSocket(this._url);

    ws.onopen = () => {
      console.log("[osc_synth] Connected to osc-bridge:", this._url);
      this._ws = ws;
      // Flush any messages that arrived while we were connecting
      for (const msg of this._queue) ws.send(msg);
      this._queue = [];
    };

    ws.onclose = () => {
      console.warn("[osc_synth] osc-bridge disconnected. Reconnecting in 2s...");
      this._ws = null;
      setTimeout(() => this._connect(), 2000);
    };

    ws.onerror = (e) => {
      console.warn("[osc_synth] osc-bridge WebSocket error:", e.message ?? e);
    };
  }

  send(address, args) {
    const msg = JSON.stringify({ address, args });
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(msg);
    } else {
      // Buffer briefly during reconnect — avoids losing the first notes
      // after a bridge restart. Cap at 64 to avoid unbounded growth.
      if (this._queue.length < 64) this._queue.push(msg);
    }
  }
}

// One shared socket per WSUrl — avoids duplicate connections if create_osc_synth
// is called multiple times with the same bridge address.
const _sockets = new Map();
function getSocket(url) {
  if (!_sockets.has(url)) _sockets.set(url, new OscSocket(url));
  return _sockets.get(url);
}

/**
 * Factory — mirrors the async signature of create_midi_synth / create_mpe_synth
 * so it can be used identically in use-synth-wiring.js.
 *
 * @param {string}   wsUrl              - WebSocket bridge URL
 * @param {string[]} synthNames         - SC SynthDef names, one per layer [pluck, string, formant, tone]
 * @param {number[]} volumes            - Initial volume per layer, 0–1
 * @param {number}   fundamental        - Reference frequency in Hz (e.g. 440)
 * @param {number}   reference_degree   - Scale degree index that maps to fundamental
 * @param {number[]} scale              - Array of cent values for each scale degree
 * @param {number}   targetGroup        - SC node group to add synths to (default 1 = default group)
 */
export const create_osc_synth = async (
  wsUrl            = WS_URL_DEFAULT,
  synthNames       = ["pluck", "string", "formant", "tone"],
  volumes          = [0.5, 0.5, 0.5, 0.5],
  fundamental      = 440,
  reference_degree = 0,
  scale            = [0],
  targetGroup      = 1,
) => {
  const socket = getSocket(wsUrl);
  // Mutable volume array — updated by setVolume, read by each new OscHex
  const _volumes = [...volumes];
  // Shared mod state — updated by setMod, stamped onto each new note's /s_new
  const _mod = { value: 0.0 };

  return {
    makeHex: (coords, cents, steps, equaves, equivSteps, cents_prev, cents_next,
              note_played, velocity_played, bend, degree0toRef_ratio) => {
      return new OscHex(
        coords, cents, socket, synthNames, _volumes, targetGroup,
        fundamental, degree0toRef_ratio ?? 1, _mod,
      );
    },

    setMod(value) {
      _mod.value = value;
    },

    prepare() {
      // Nothing async needed; socket connects lazily.
      return Promise.resolve();
    },

    setVolume(value) {
      // Update all layers equally. Could be per-layer if needed later.
      for (let i = 0; i < _volumes.length; i++) _volumes[i] = value;
    },
  };
};

/**
 * OscHex — one instance per held note, one SC synth node per active layer.
 */
function OscHex(coords, cents, socket, synthNames, volumes, targetGroup, fundamental, degree0toRef_ratio, modRef) {
  this.coords  = coords;
  this.cents   = cents;
  this.release = false;

  this._socket          = socket;
  this._synthNames      = synthNames;
  this._volumes         = volumes;
  this._targetGroup     = targetGroup;
  this._fundamental     = fundamental;
  this._degree0toRef    = degree0toRef_ratio;
  this._modRef          = modRef; // shared { value } object so noteOn sees current mod level

  // One node ID per layer; null = layer has vol 0 so no node created
  this._nodeIds = synthNames.map(() => null);

  this._freq = this._centsToHz(cents);
}

OscHex.prototype.noteOn = function () {
  if (this.release) return;
  for (let i = 0; i < this._synthNames.length; i++) {
    const vol = this._volumes[i];
    if (vol <= 0) continue; // skip silent layers — no node needed

    const nodeId = nextNodeId();
    this._nodeIds[i] = nodeId;

    // /s_new synthName nodeId addAction targetID [args...]
    // addAction 1 = add to tail of targetGroup
    this._socket.send("/s_new", [
      { type: "s", value: this._synthNames[i] },
      { type: "i", value: nodeId },
      { type: "i", value: 1 },          // addAction: addToTail
      { type: "i", value: this._targetGroup },
      { type: "s", value: "freq" },  { type: "f", value: this._freq },
      { type: "s", value: "gate" },  { type: "i", value: 1 },
      { type: "s", value: "vol" },   { type: "f", value: 1.0 }, // SC faders control vol via /n_set
      { type: "s", value: "mod" },   { type: "f", value: this._modRef.value },
    ]);
  }
};

OscHex.prototype.noteOff = function (release_velocity) {
  if (this.release) return;
  this.release = true;
  const offVel = release_velocity != null ? release_velocity / 127 : 0.5;
  for (let i = 0; i < this._nodeIds.length; i++) {
    const id = this._nodeIds[i];
    if (id === null) continue;
    this._socket.send("/n_set", [
      { type: "i", value: id },
      { type: "s", value: "off_vel" }, { type: "f", value: offVel },
      { type: "s", value: "gate" },    { type: "i", value: 0 },
    ]);
    this._nodeIds[i] = null;
  }
};

OscHex.prototype.retune = function (newCents) {
  if (this.release) return;
  this.cents = newCents;
  const freq = this._centsToHz(newCents);
  this._freq = freq;
  for (const id of this._nodeIds) {
    if (id === null) continue;
    this._socket.send("/n_set", [
      { type: "i", value: id },
      { type: "s", value: "freq" }, { type: "f", value: freq },
    ]);
  }
};

OscHex.prototype.aftertouch = function (value) {
  if (this.release) return;
  // Map 0–127 to 1–2 (same scale as the SC filter parameter)
  const filter = 1 + (value / 127);
  for (const id of this._nodeIds) {
    if (id === null) continue;
    this._socket.send("/n_set", [
      { type: "i", value: id },
      { type: "s", value: "filter" }, { type: "f", value: filter },
    ]);
  }
};

/**
 * Convert scale-relative cents to Hz using the same formula as midi_synth.
 * cents = interval from scale root; fundamental + degree0toRef_ratio anchor
 * it to an absolute frequency, matching how SC's ~tuningMap is built.
 *
 *   ref        = fundamental / degree0toRef_ratio   (Hz of scale degree 0)
 *   ref_offset = 1200 * log2(ref / C4_440)          (cents from C4@A440)
 *   abs_cents  = cents + ref_offset                  (absolute cents from C4)
 *   Hz         = C4_440 * 2^(abs_cents / 1200)
 *
 * C4 at A=440 ≈ 261.6255653 Hz (equal temperament).
 */
OscHex.prototype._centsToHz = function (cents) {
  const C4_440 = 261.6255653;
  const ref = this._fundamental / this._degree0toRef;
  const ref_offset = 1200 * Math.log2(ref / C4_440);
  return C4_440 * Math.pow(2, (cents + ref_offset) / 1200);
};
