/* eslint-disable no-console */
import { formantPresetToOscArgs, pickRandomFormantPreset } from "./formant-table.js";

/**
 * osc_synth — sends note events directly to SuperCollider via WebSocket → OSC bridge.
 *
 * Implements the same interface as midi_synth and sample_synth:
 *   makeHex(coords, cents, ...) → { noteOn(), noteOff(), retune(), aftertouch() }
 *
 * Routing:
 *   /s_new, note /n_set (bend, filter, gate)  → directly to layer server (57101–57104)
 *   /n_set mod                                → broadcast to all four servers, node 1
 *   /n_set vol (fader)                        → node 1 on specific layer server (57101–57104)
 *
 * Node IDs: noteNumber * 4 + layerIndex + NODE_OFFSET, giving a unique stable ID per
 * note+layer without any state tracking. Requires the caller to pass note_played.
 *
 * Requires the osc-bridge Node.js process to be running locally:
 *   node osc-bridge/index.js
 */

const WS_URL_DEFAULT = "ws://localhost:8089";
const OSC_LAYER_PORTS = [57101, 57102, 57103, 57104];
const midiCcToScParam = (value) => 1 + value / 127;

// Monotonic node ID counter. scsynth reserves 0 (root) and 1 (default group).
// Start at 2000 to stay well clear of SC-allocated nodes.
let _nextNodeId = 2000;
const nextNodeId = () => _nextNodeId++;

/**
 * Shared WebSocket connection, lazily created and reused across all OscHex instances.
 * Reconnects automatically if the bridge is restarted.
 */
class OscSocket {
  constructor(url) {
    this._url = url;
    this._ws = null;
    this._queue = []; // messages buffered while connecting
    this._connect();
  }

  _connect() {
    const ws = new WebSocket(this._url);

    ws.onopen = () => {
      console.log("[osc_synth] Connected to osc-bridge:", this._url);
      this._ws = ws;
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

  send(address, args, port = OSC_LAYER_PORTS[0]) {
    const msg = JSON.stringify({ port, address, args });
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(msg);
    } else {
      if (this._queue.length < 64) this._queue.push(msg);
    }
  }
}

// One shared socket per wsUrl.
const _sockets = new Map();
function getSocket(url) {
  if (!_sockets.has(url)) _sockets.set(url, new OscSocket(url));
  return _sockets.get(url);
}

const buildSNewArgs = (synthName, id, targetGroup, freq, bend, onVel, mod, filter, vol) => {
  const args = [
    { type: "s", value: synthName },
    { type: "i", value: id },
    { type: "i", value: 1 }, // addAction: addToTail
    { type: "i", value: targetGroup },
    { type: "s", value: "freq" },
    { type: "f", value: freq },
    { type: "s", value: "on_vel" },
    { type: "f", value: onVel },
    { type: "s", value: "bend" },
    { type: "f", value: bend },
    { type: "s", value: "filter" },
    { type: "f", value: filter },
    { type: "s", value: "mod" },
    { type: "f", value: mod },
    { type: "s", value: "vol" },
    { type: "f", value: vol },
    { type: "s", value: "gate" },
    { type: "i", value: 1 },
  ];

  if (synthName === "formant") {
    args.push(...formantPresetToOscArgs(pickRandomFormantPreset()));
  }

  return args;
};

/**
 * Factory — mirrors the async signature of create_midi_synth / create_mpe_synth.
 */
export const create_osc_synth = async (
  wsUrl = WS_URL_DEFAULT,
  synthNames = ["pluck", "string", "formant", "tone"],
  volumes = [0.5, 0.5, 0.5, 0.5],
  fundamental = 440,
  _reference_degree = 0,
  _scale = [0],
  targetGroup = 1,
) => {
  const socket = getSocket(wsUrl);
  const _volumes = [...volumes];
  const _mod = { value: 1.0 };

  const setLayerVolume = (index, value) => {
    if (index < 0 || index >= _volumes.length) return;
    const next = Math.max(0, Math.min(1, value));
    _volumes[index] = next;
    // /n_set \vol to node 1 (default group) on this layer's scsynth server directly.
    socket.send(
      "/n_set",
      [
        { type: "i", value: 1 },
        { type: "s", value: "vol" },
        { type: "f", value: next },
      ],
      OSC_LAYER_PORTS[index],
    );
  };

  return {
    makeHex: (
      coords,
      cents,
      _steps,
      _equaves,
      _equivSteps,
      _cents_prev,
      _cents_next,
      note_played,
      velocity_played,
      bend,
      degree0toRef_ratio,
    ) => {
      return new OscHex(
        coords,
        cents,
        note_played,
        socket,
        synthNames,
        _volumes,
        targetGroup,
        fundamental,
        degree0toRef_ratio ?? 1,
        _mod,
        bend,
        velocity_played,
      );
    },

    setMod(value) {
      _mod.value = value;
    },

    rememberControllerState(state) {
      const mod = state?.ccValues?.[1];
      if (Number.isFinite(mod)) _mod.value = midiCcToScParam(mod);
    },

    applyControllerState(state) {
      const mod = state?.ccValues?.[1];
      if (Number.isFinite(mod)) _mod.value = midiCcToScParam(mod);
    },

    prepare() {
      return Promise.resolve();
    },

    setVolume(value) {
      for (let i = 0; i < _volumes.length; i++) setLayerVolume(i, value);
    },

    setLayerVolume(index, value) {
      setLayerVolume(index, value);
    },
  };
};

/**
 * OscHex — one instance per held note, one SC synth node per active layer.
 *
 * Node IDs are derived from note_played + layer index — stable and predictable,
 * no state tracking required on the SC side.
 */
function OscHex(
  coords,
  cents,
  _notePlayed,
  socket,
  synthNames,
  volumes,
  targetGroup,
  fundamental,
  degree0toRef_ratio,
  modRef,
  bend,
  velocity_played,
) {
  this.coords = coords;
  this.cents = cents;
  this.release = false;

  this._socket = socket;
  this._synthNames = synthNames;
  this._volumes = volumes;
  this._targetGroup = targetGroup;
  this._fundamental = fundamental;
  this._degree0toRef = degree0toRef_ratio;
  this._modRef = modRef;
  this._bend = Number.isFinite(bend) && bend > 0 ? bend : 1;
  this._onVel = Math.max(1, Math.min(127, velocity_played || 72));
  this._filter = 1;

  // One unique node ID per layer, assigned at construction time
  this._nodeIds = synthNames.map(() => nextNodeId());

  this._freq = this._centsToHz(cents);
}

OscHex.prototype.noteOn = function () {
  if (this.release) return;
  for (let i = 0; i < this._synthNames.length; i++) {
    this._socket.send(
      "/s_new",
      buildSNewArgs(
        this._synthNames[i],
        this._nodeIds[i],
        this._targetGroup,
        this._freq,
        this._bend,
        this._onVel,
        this._modRef.value,
        this._filter,
        this._volumes[i],
      ),
      OSC_LAYER_PORTS[i],
    );
  }
};

OscHex.prototype.noteOff = function (release_velocity) {
  if (this.release) return;
  this.release = true;
  const offVel = release_velocity != null ? release_velocity / 127 : 0.5;
  for (let i = 0; i < this._synthNames.length; i++) {
    this._socket.send(
      "/n_set",
      [
        { type: "i", value: this._nodeIds[i] },
        { type: "s", value: "off_vel" },
        { type: "f", value: offVel },
        { type: "s", value: "gate" },
        { type: "i", value: 0 },
      ],
      OSC_LAYER_PORTS[i],
    );
  }
};

OscHex.prototype.retune = function (newCents) {
  if (this.release) return;
  this.cents = newCents;
  this._freq = this._centsToHz(newCents);
  for (let i = 0; i < this._synthNames.length; i++) {
    this._socket.send(
      "/n_set",
      [
        { type: "i", value: this._nodeIds[i] },
        { type: "s", value: "freq" },
        { type: "f", value: this._freq },
      ],
      OSC_LAYER_PORTS[i],
    );
  }
};

OscHex.prototype.aftertouch = function (value) {
  if (this.release) return;
  const filter = 1 + value / 127;
  this._filter = filter;
  for (let i = 0; i < this._synthNames.length; i++) {
    this._socket.send(
      "/n_set",
      [
        { type: "i", value: this._nodeIds[i] },
        { type: "s", value: "filter" },
        { type: "f", value: filter },
      ],
      OSC_LAYER_PORTS[i],
    );
  }
};

OscHex.prototype.pressure = function (value) {
  this.aftertouch(value);
};

OscHex.prototype.pitchbend = function (value) {
  if (this.release) return;
  this._bend = value;
  for (let i = 0; i < this._synthNames.length; i++) {
    this._socket.send(
      "/n_set",
      [
        { type: "i", value: this._nodeIds[i] },
        { type: "s", value: "bend" },
        { type: "f", value },
      ],
      OSC_LAYER_PORTS[i],
    );
  }
};

// CC74 → filter on individual nodes
OscHex.prototype.cc74 = function (value) {
  this.aftertouch(value);
};

// Modwheel → broadcast /n_set \mod to node 1 on all four servers
OscHex.prototype.modwheel = function (value) {
  const mod = midiCcToScParam(value);
  this._modRef.value = mod;
  for (const port of OSC_LAYER_PORTS) {
    this._socket.send(
      "/n_set",
      [
        { type: "i", value: 1 },
        { type: "s", value: "mod" },
        { type: "f", value: mod },
      ],
      port,
    );
  }
};

OscHex.prototype.expression = function () {};

/**
 * Convert scale-relative cents to Hz.
 *   ref        = fundamental / degree0toRef_ratio   (Hz of scale degree 0)
 *   ref_offset = 1200 * log2(ref / C4_440)
 *   Hz         = C4_440 * 2^((cents + ref_offset) / 1200)
 */
OscHex.prototype._centsToHz = function (cents) {
  const C4_440 = 261.6255653;
  const ref = this._fundamental / this._degree0toRef;
  const ref_offset = 1200 * Math.log2(ref / C4_440);
  return C4_440 * Math.pow(2, (cents + ref_offset) / 1200);
};
