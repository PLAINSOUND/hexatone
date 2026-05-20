import { VoicePool } from "../voice_pool_nearest";
import { formantPresetToOscArgs, pickRandomFormantPreset } from "./formant-table.js";
import { debugEnabled, debugLog, warnLog } from "../debug/logging.js";

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
 * Node IDs are derived from a shared 128-slot nearest-note voice pool, matching
 * the MTS1 real-time allocation model and keeping IDs stable and bounded.
 *
 * Requires the osc-bridge Node.js process to be running locally:
 *   node osc-bridge/index.js
 */

const WS_URL_DEFAULT = "ws://localhost:8089";
const SC_DISPATCH_PORT = 57100;
const OSC_LAYER_PORTS = [57101, 57102, 57103, 57104];
const NODE_ID_BASES = [100000, 300000, 500000, 700000];
const MAX_NOTE_SLOTS = 128;
const midiCcToScParam = (value) => 1 + value / 127;

const _nextLayerNodeIds = NODE_ID_BASES.map((base) => base);
const nextNodeId = (layerIndex) => {
  const next = _nextLayerNodeIds[layerIndex];
  _nextLayerNodeIds[layerIndex] += 1;
  return next;
};

const clampMidiValue = (value, fallback = 64) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(127, Math.round(value)));
};

const normalizeOffVelocity = (value, fallback = 64) => {
  if (!Number.isFinite(value)) return fallback;
  return value <= 1 ? clampMidiValue(value * 127, fallback) : clampMidiValue(value, fallback);
};

const releaseNode = (socket, port, nodeId, offVel) => {
  debugLog("osc", "releaseNode", { port, nodeId, offVel });
  socket.send(
    "/n_set",
    [
      { type: "i", value: nodeId },
      { type: "s", value: "off_vel" },
      { type: "f", value: offVel },
      { type: "s", value: "gate" },
      { type: "i", value: 0 },
    ],
    port,
  );
};

const freeTargetGroup = (socket, port, targetGroup) => {
  socket.send("/g_freeAll", [{ type: "i", value: targetGroup }], port);
};

const createOscJitterTracker = (socket) => {
  const enabled = debugEnabled("oscjitter");
  let seq = 0;
  let lastBrowserPerf = null;

  return (kind, voiceId = -1) => {
    if (!enabled) return;
    const now = performance.now();
    const delta = lastBrowserPerf == null ? 0 : now - lastBrowserPerf;
    lastBrowserPerf = now;
    seq += 1;
    socket.send(
      "/hex/jitter",
      [
        { type: "i", value: seq },
        { type: "s", value: kind },
        { type: "f", value: now },
        { type: "f", value: delta },
        { type: "i", value: voiceId },
      ],
      SC_DISPATCH_PORT,
    );
  };
};

/**
 * Shared WebSocket connection, lazily created and reused across all OscHex instances.
 * Reconnects automatically if the bridge is restarted.
 */
class OscSocket {
  constructor(url) {
    this._url = url;
    this._ws = null;
    this._queue = []; // messages buffered while connecting
    this._disposed = false;
    this._refCount = 0;
    this._reconnectTimer = null;
    this._connect();
  }

  retain() {
    if (!this._disposed) this._refCount += 1;
    return this;
  }

  release() {
    if (this._disposed) return;
    this._refCount = Math.max(0, this._refCount - 1);
    if (this._refCount === 0) this.shutdown();
  }

  clearQueue() {
    this._queue = [];
  }

  shutdown() {
    if (this._disposed) return;
    this._disposed = true;
    this.clearQueue();
    if (this._reconnectTimer != null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const ws = this._ws;
    this._ws = null;
    if (ws && typeof ws.close === "function") {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
    if (_sockets.get(this._url) === this) {
      _sockets.delete(this._url);
    }
  }

  _connect() {
    if (this._disposed) return;
    const ws = new WebSocket(this._url);

    ws.onopen = () => {
      if (this._disposed) {
        ws.close?.();
        return;
      }
      debugLog("osc", "Connected to osc-bridge:", this._url);
      this._ws = ws;
      for (const msg of this._queue) ws.send(msg);
      this._queue = [];
    };

    ws.onclose = () => {
      this._ws = null;
      if (this._disposed) return;
      warnLog("[osc_synth] osc-bridge disconnected. Reconnecting in 2s...");
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this._connect();
      }, 2000);
    };

    ws.onerror = (e) => {
      if (this._disposed) return;
      warnLog("[osc_synth] osc-bridge WebSocket error:", e.message ?? e);
    };

    if (this._disposed) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close?.();
      return;
    }
  }

  send(address, args, port = OSC_LAYER_PORTS[0]) {
    if (this._disposed) return;
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
  let socket = _sockets.get(url);
  if (!socket || socket._disposed) {
    socket = new OscSocket(url);
    _sockets.set(url, socket);
  }
  return socket.retain();
}

const buildSNewArgs = (
  synthName,
  id,
  targetGroup,
  freq,
  bend,
  onVel,
  mod,
  filter,
  vol,
  quickRelease,
  quickReleaseTime,
) => {
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
    { type: "s", value: "quick_release" },
    { type: "f", value: quickRelease },
    { type: "s", value: "quick_release_time" },
    { type: "f", value: quickReleaseTime },
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
  quickRelease = 0,
  quickReleaseTime = 0.1,
  quickReleaseRasterOnly = false,
  fundamental = 440,
  _reference_degree = 0,
  _scale = [0],
  targetGroup = 1,
) => {
  const socket = getSocket(wsUrl);
  let shutdown = false;
  const sendJitter = createOscJitterTracker(socket);
  const _volumes = [...volumes];
  const _mod = { value: 1.0 };
  const _quickRelease = { value: Math.max(0, Math.min(1, quickRelease)) };
  const _quickReleaseTime = { value: Math.max(0.001, quickReleaseTime) };
  const _quickReleaseRasterOnly = { value: quickReleaseRasterOnly === true };
  const _pool = new VoicePool(Array.from({ length: MAX_NOTE_SLOTS }, (_, i) => i));
  const _knownNodeIds = new Set();
  const _slotState = synthNames.map(() =>
    Array.from({ length: MAX_NOTE_SLOTS }, () => ({
      token: 0,
      active: false,
      onVel: 64,
      nodeId: null,
      quickReleaseEnabled: false,
    })),
  );

  const slotQuickReleaseValue = (slot) =>
    _quickReleaseRasterOnly.value
      ? (slot?.quickReleaseEnabled ? _quickRelease.value : 0)
      : _quickRelease.value;

  const setLayerVolume = (index, value) => {
    if (index < 0 || index >= _volumes.length) return;
    const next = Math.max(0, Math.min(1, value));
    _volumes[index] = next;
    const layerState = _slotState[index];
    for (const slot of layerState) {
      if (!slot?.active || slot.nodeId == null) continue;
      socket.send(
        "/n_set",
        [
          { type: "i", value: slot.nodeId },
          { type: "s", value: "vol" },
          { type: "f", value: next },
        ],
        OSC_LAYER_PORTS[index],
      );
    }
    // Keep node 1 in sync as the default for future note-ons / server-side
    // layer state even when nothing is currently sounding.
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

  const setQuickRelease = (value) => {
    const next = Math.max(0, Math.min(1, value));
    _quickRelease.value = next;
    for (let i = 0; i < _slotState.length; i++) {
      for (const slot of _slotState[i]) {
        if (!slot?.active || slot.nodeId == null) continue;
        socket.send(
          "/n_set",
          [
            { type: "i", value: slot.nodeId },
            { type: "s", value: "quick_release" },
            { type: "f", value: slotQuickReleaseValue(slot) },
          ],
          OSC_LAYER_PORTS[i],
        );
      }
    }
  };

  const setQuickReleaseTime = (value) => {
    const next = Math.max(0.001, value);
    _quickReleaseTime.value = next;
    for (let i = 0; i < _slotState.length; i++) {
      for (const slot of _slotState[i]) {
        if (!slot?.active || slot.nodeId == null) continue;
        socket.send(
          "/n_set",
          [
            { type: "i", value: slot.nodeId },
            { type: "s", value: "quick_release_time" },
            { type: "f", value: next },
          ],
          OSC_LAYER_PORTS[i],
        );
      }
    }
  };

  const setQuickReleaseRasterOnly = (value) => {
    _quickReleaseRasterOnly.value = value === true;
    for (let i = 0; i < _slotState.length; i++) {
      for (const slot of _slotState[i]) {
        if (!slot?.active || slot.nodeId == null) continue;
        socket.send(
          "/n_set",
          [
            { type: "i", value: slot.nodeId },
            { type: "s", value: "quick_release" },
            { type: "f", value: slotQuickReleaseValue(slot) },
          ],
          OSC_LAYER_PORTS[i],
        );
      }
    }
  };

  const freeAllKnownNodes = () => {
    for (const nodeId of _knownNodeIds) {
      for (const port of OSC_LAYER_PORTS) {
        socket.send("/n_free", [{ type: "i", value: nodeId }], port);
      }
    }
    for (const port of OSC_LAYER_PORTS) {
      freeTargetGroup(socket, port, targetGroup);
    }
    _knownNodeIds.clear();
    for (const layerState of _slotState) {
      for (const slot of layerState) {
        slot.active = false;
        slot.nodeId = null;
      }
    }
    _pool.clear();
  };

  return {
    family: "osc",
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
        sendJitter,
        _quickRelease,
        _quickReleaseTime,
        _quickReleaseRasterOnly,
        _pool,
        _slotState,
        _knownNodeIds,
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

    setVolume(_value) {
      // No-op for the OSC synth — each layer has its own volume controlled by
      // setLayerVolume. The master synth volume (use-synth-wiring.js setVolume
      // call after rebuild) must not overwrite the per-layer fader values.
    },

    setLayerVolume(index, value) {
      setLayerVolume(index, value);
    },

    setQuickRelease(value) {
      setQuickRelease(value);
    },

    setQuickReleaseTime(value) {
      setQuickReleaseTime(value);
    },

    setQuickReleaseRasterOnly(value) {
      setQuickReleaseRasterOnly(value);
    },

    allSoundOff() {
      debugLog("osc", "osc_synth.allSoundOff", { knownNodeCount: _knownNodeIds.size });
      freeAllKnownNodes();
    },

    releaseAll() {
      debugLog("osc", "osc_synth.releaseAll", { knownNodeCount: _knownNodeIds.size });
      freeAllKnownNodes();
    },

    shutdown() {
      if (shutdown) return;
      shutdown = true;
      debugLog("osc", "osc_synth.shutdown", { knownNodeCount: _knownNodeIds.size });
      freeAllKnownNodes();
      socket.clearQueue();
      socket.release();
    },
  };
};

/**
 * OscHex — one instance per held note, one SC synth node per active layer.
 *
 * Voice slots are pooled like MTS real-time allocation, but SC node IDs are
 * always fresh so released tails cannot collide with a newly started note.
 */
function OscHex(
  coords,
  cents,
  notePlayed,
  socket,
  synthNames,
  volumes,
  targetGroup,
  fundamental,
  degree0toRef_ratio,
  modRef,
  sendJitter,
  quickReleaseRef,
  quickReleaseTimeRef,
  quickReleaseRasterOnlyRef,
  pool,
  slotState,
  knownNodeIds,
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
  this._sendJitter = sendJitter;
  this._quickReleaseRef = quickReleaseRef;
  this._quickReleaseTimeRef = quickReleaseTimeRef;
  this._quickReleaseRasterOnlyRef = quickReleaseRasterOnlyRef;
  this._pool = pool;
  this._slotState = slotState;
  this._knownNodeIds = knownNodeIds;
  this._slot = null;
  this._notePlayed = notePlayed;
  this._bend = Number.isFinite(bend) && bend > 0 ? bend : 1;
  this._onVel = clampMidiValue(velocity_played, 72);
  this._filter = 1;

  this._tokens = synthNames.map(() => null);
  this._nodeIds = synthNames.map((_, i) => nextNodeId(i));

  this._freq = this._centsToHz(cents);
}

OscHex.prototype.noteOn = function () {
  if (this.release) return;
  const { slot } = this._pool.noteOn(this.coords, this._targetMidiFloat());
  this._slot = slot;
  this._nodeIds = this._synthNames.map((_, i) => nextNodeId(i));
  debugLog("osc", "OscHex.noteOn", {
    coords: this.coords,
    notePlayed: this._notePlayed,
    slot,
    nodeIds: this._nodeIds,
    freq: this._freq,
    onVel: this._onVel,
    bend: this._bend,
  });
  this._sendJitter?.("noteOn", this._notePlayed ?? this._slot ?? -1);

  for (let i = 0; i < this._synthNames.length; i++) {
    const slotState = this._slotState[i][slot];
    if (slotState.active && slotState.nodeId != null) {
      releaseNode(this._socket, OSC_LAYER_PORTS[i], slotState.nodeId, slotState.onVel);
    }
    slotState.token += 1;
    slotState.active = true;
    slotState.onVel = this._onVel;
    slotState.nodeId = this._nodeIds[i];
    slotState.quickReleaseEnabled = this._quickReleaseRasterOnlyRef.value
      ? this._rasterGenerated === true
      : true;
    this._knownNodeIds.add(this._nodeIds[i]);
    this._tokens[i] = slotState.token;

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
        slotState.quickReleaseEnabled ? this._quickReleaseRef.value : 0,
        this._quickReleaseTimeRef.value,
      ),
      OSC_LAYER_PORTS[i],
    );
  }
};

OscHex.prototype.noteOff = function (release_velocity) {
  if (this.release) return;
  this.release = true;
  const resolvedSlot = this._pool.noteOff(this.coords);
  const slot = resolvedSlot ?? this._slot;
  debugLog("osc", "OscHex.noteOff", {
    coords: this.coords,
    notePlayed: this._notePlayed,
    requestedSlot: this._slot,
    resolvedSlot,
    releaseSlot: slot,
    nodeIds: this._nodeIds,
    releaseVelocity: release_velocity,
  });
  this._sendJitter?.("noteOff", this._notePlayed ?? slot ?? -1);
  if (slot == null) return;
  for (let i = 0; i < this._synthNames.length; i++) {
    const slotState = this._slotState[i][slot];
    if (!slotState.active || slotState.token !== this._tokens[i]) continue;
    releaseNode(
      this._socket,
      OSC_LAYER_PORTS[i],
      this._nodeIds[i],
      normalizeOffVelocity(release_velocity, slotState.onVel),
    );
    slotState.active = false;
    slotState.nodeId = null;
    slotState.quickReleaseEnabled = false;
    this._knownNodeIds.delete(this._nodeIds[i]);
  }
};

OscHex.prototype.forceFree = function () {
  if (this.release) return;
  this.release = true;
  const resolvedSlot = this._pool.noteOff(this.coords);
  const slot = resolvedSlot ?? this._slot;
  debugLog("osc", "OscHex.forceFree", {
    coords: this.coords,
    requestedSlot: this._slot,
    resolvedSlot,
    releaseSlot: slot,
    nodeIds: this._nodeIds,
  });
  for (let i = 0; i < this._synthNames.length; i++) {
    const nodeId = this._nodeIds[i];
    if (nodeId == null) continue;
    this._socket.send("/n_free", [{ type: "i", value: nodeId }], OSC_LAYER_PORTS[i]);
    this._knownNodeIds.delete(nodeId);
    if (slot != null) {
      const slotState = this._slotState[i][slot];
      slotState.active = false;
      slotState.nodeId = null;
      slotState.quickReleaseEnabled = false;
    }
  }
};

OscHex.prototype.retune = function (newCents) {
  if (this.release) return;
  this.cents = newCents;
  this._freq = this._centsToHz(newCents);
  this._sendJitter?.("retune", this._notePlayed ?? this._slot ?? -1);
  for (let i = 0; i < this._synthNames.length; i++) {
    if (this._slot == null) continue;
    const slotState = this._slotState[i][this._slot];
    if (!slotState.active || slotState.token !== this._tokens[i]) continue;
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

OscHex.prototype.aftertouch = function (value, value14 = null) {
  if (this.release) return;
  const filter = 1 + (
    Number.isFinite(value14)
      ? Math.max(0, Math.min(16256, value14)) / 16256
      : value / 127
  );
  this._filter = filter;
  this._sendJitter?.("aftertouch", this._notePlayed ?? this._slot ?? -1);
  for (let i = 0; i < this._synthNames.length; i++) {
    if (this._slot == null) continue;
    const slotState = this._slotState[i][this._slot];
    if (!slotState.active || slotState.token !== this._tokens[i]) continue;
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

OscHex.prototype.pressure = function (value, value14 = null) {
  this.aftertouch(value, value14);
};

OscHex.prototype.pitchbend = function (value) {
  if (this.release) return;
  this._bend = value;
  this._sendJitter?.("pitchbend", this._notePlayed ?? this._slot ?? -1);
  for (let i = 0; i < this._synthNames.length; i++) {
    if (this._slot == null) continue;
    const slotState = this._slotState[i][this._slot];
    if (!slotState.active || slotState.token !== this._tokens[i]) continue;
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

// CC74 / timbre → mod on individual nodes
OscHex.prototype.cc74 = function (value, value14 = null) {
  if (this.release) return;
  const mod = 1 + (
    Number.isFinite(value14)
      ? Math.max(0, Math.min(16256, value14)) / 16256
      : value / 127
  );
  this._sendJitter?.("cc74", this._notePlayed ?? this._slot ?? -1);
  for (let i = 0; i < this._synthNames.length; i++) {
    if (this._slot == null) continue;
    const slotState = this._slotState[i][this._slot];
    if (!slotState.active || slotState.token !== this._tokens[i]) continue;
    this._socket.send(
      "/n_set",
      [
        { type: "i", value: this._nodeIds[i] },
        { type: "s", value: "mod" },
        { type: "f", value: mod },
      ],
      OSC_LAYER_PORTS[i],
    );
  }
};

// Modwheel → broadcast /n_set \mod to node 1 on all four servers
OscHex.prototype.modwheel = function (value) {
  const mod = midiCcToScParam(value);
  this._modRef.value = mod;
  this._sendJitter?.("modwheel");
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

OscHex.prototype._targetMidiFloat = function () {
  const ref = this._fundamental / this._degree0toRef;
  const refOffset = 1200 * Math.log2(ref / 261.6255653);
  const refCents = this.cents + refOffset;
  return refCents * 0.01 + 60;
};
