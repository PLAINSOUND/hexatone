/**
 * exquis-leds.js
 *
 * LED colour sync for the Exquis (Intuitive Instruments) using App Mode.
 *
 * ── Why App Mode instead of Dev Mode ─────────────────────────────────────────
 *
 * App Mode with pad_remote=0 keeps the native expressive MPE engine fully
 * active while the host drives LED colors independently.
 *
 * ── Protocol ─────────────────────────────────────────────────────────────────
 *
 * All SysEx uses the Exquis manufacturer header:
 *   F0 00 21 7E <CMD> [...] F7
 *
 *   0x00  version request / response
 *     H->E: F0 00 21 7E 00 F7
 *     E->H: F0 00 21 7E 00 <major> <minor> <patch> F7
 *
 *   Heartbeat (empty payload):
 *     F0 00 21 7E F7  — sent every ~500 ms.
 *     App Mode drops after ~10 s without valid App Mode SysEx traffic.
 *
 *   0x1E  pad_remote=0  — keep pads on native expressive/MPE engine.
 *   0x05  luminosity    — global brightness 0–100.
 *   0x14  note_colour   — F0 00 21 7E 14 <note_id> <r> <g> <b> F7, rgb7 (0..127).
 *   0x03  quit          — exit App Mode cleanly.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 * Construction sends a version request. On confirmed firmware ≥ 3.0.0,
 * _enterAppMode() fires: pad_remote=0, luminosity, blank all pads, heartbeat.
 * onReady(true) is called; callers can then push colors via sendColors().
 *
 * The instance is long-lived. During Keys reconstruction, keyboard/index.js
 * transfers it directly to the new Keys instance — App Mode never interrupted.
 *
 * exit() sends quit and stops the heartbeat. Called only on genuine exits:
 * scale mode switch or device disconnect.
 */

import { debugLog, warnLog } from "../debug/logging.js";
import { exquisOrientation, exquisLayoutFlags } from "./exquis-orientation.js";
import { exquisOctaveButtonRgb } from "../input/exquis-control-bindings.js";

const HDR = [0xf0, 0x00, 0x21, 0x7e];

// ── Inline okLab helpers for saturation boost ─────────────────────────────────

function _srgbToLinear(x) {
  return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
}
function _linearToSrgb(x) {
  return x >= 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x;
}
function _hexToOklab(hex) {
  const h = hex.replace("#", "");
  const r = _srgbToLinear(parseInt(h.slice(0, 2), 16) / 255);
  const g = _srgbToLinear(parseInt(h.slice(2, 4), 16) / 255);
  const b = _srgbToLinear(parseInt(h.slice(4, 6), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function _oklabToRgb255(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const lr = [l_ ** 3, m_ ** 3, s_ ** 3];
  const r = _linearToSrgb(4.0767416621 * lr[0] - 3.3077115913 * lr[1] + 0.2309699292 * lr[2]);
  const g = _linearToSrgb(-1.2684380046 * lr[0] + 2.6097574011 * lr[1] - 0.3413193965 * lr[2]);
  const bv = _linearToSrgb(-0.0041960863 * lr[0] - 0.7034186147 * lr[1] + 1.707614701 * lr[2]);
  return [
    Math.min(255, Math.max(0, Math.round(r * 255))),
    Math.min(255, Math.max(0, Math.round(g * 255))),
    Math.min(255, Math.max(0, Math.round(bv * 255))),
  ];
}

function _boostSaturation(hex, factor) {
  if (!hex || hex.length < 6) return { r: 0, g: 0, b: 0 };
  const [L, a, b] = _hexToOklab(hex);
  const [r, g, bv] = _oklabToRgb255(L, a * factor, b * factor);
  return { r, g, b: bv };
}

const VERSION_REQUEST = new Uint8Array([...HDR, 0x00, 0xf7]);
const HEARTBEAT = new Uint8Array([...HDR, 0xf7]);
const PAD_REMOTE_0 = new Uint8Array([...HDR, 0x1e, 0x00, 0xf7]);
const QUIT = new Uint8Array([...HDR, 0x03, 0xf7]);

const HEARTBEAT_INTERVAL_MS = 500;
const HEARTBEAT_STALE_MS = 3000;
const VERSION_TIMEOUT_MS = 2000;
const MIN_FIRMWARE = { major: 3, minor: 0, patch: 0 };

export class ExquisLEDs {
  /**
   * @param {MIDIOutput} outputPort
   * @param {MIDIInput}  inputPort
   * @param {function}   onReady   Called with (true) when App Mode is confirmed,
   *                               or (false, reason) on failure.
   * @param {number}     luminosity  0–100, default 40.
   * @param {number}     saturation  okLab chroma multiplier, default 1.5.
   * @param {boolean}    mpeEnabled  Initial MPE mode state sent on App Mode entry.
   */
  constructor(
    outputPort,
    inputPort,
    onReady = null,
    luminosity = 40,
    saturation = 1.5,
    mpeEnabled = true,
    orientation = 90,
    arpeggiatorPattern = 1,
    heldPads = [],
    controls = null,
  ) {
    this._out = outputPort;
    this._in = inputPort;
    this._onReady = onReady;
    this._luminosity = Math.max(0, Math.min(100, Math.round(luminosity)));
    this._saturation = Math.max(0.75, Math.min(2.5, saturation));
    this._mpeEnabled = !!mpeEnabled;
    this._orientation = exquisOrientation(orientation);
    this._arpeggiatorPattern = Math.max(0, Math.min(5, Math.round(arpeggiatorPattern ?? 1)));
    this._orientationPending = null;
    this._orientationTimer = null;
    this._ready = false;
    this._heartbeatTimer = null;
    this._appModeInitTimer = null;
    this._lastHeartbeatSentAt = 0;
    this._recoveryPending = false;
    this._heldPads = new Set(heldPads);
    this._controls = controls;
    this._pressedButtons = new Set();
    this._buttonCcs = new Map([[2, 32], [3, 33], [4, 34]]);
    this._knobButtonCcs = new Map([[0, 21], [1, 22], [2, 23]]);
    this._controlValues = new Map();
    this._buttonLedValues = new Map();
    this._controlChannel = 0;
    this._lastPlayedNote = null;
    const octave = controls?.getOctaveOffset?.();
    this._octaveOffset = Number.isFinite(octave) ? Math.trunc(octave) : 0;
    this._octaveFlashes = new Map();

    this._heldPadCount = this._heldPads.size; // includes presses before driver creation
    this._mpeModePending = null; // deferred CMD 0x07 send timer

    this._onMessage = this._onMessage.bind(this);
    if (this._in) this._in.addEventListener("midimessage", this._onMessage);

    this._versionTimeout = setTimeout(() => {
      this._versionTimeout = null;
      if (!this._ready) {
        warnLog("[ExquisLEDs] No version response — App Mode not entered.");
        if (this._onReady) this._onReady(false, "timeout");
      }
    }, VERSION_TIMEOUT_MS);

    this._out.send(VERSION_REQUEST);
  }

  /** True once firmware ≥ 3.0.0 is confirmed and App Mode is active. */
  get ready() {
    return this._ready;
  }

  /** Re-enter after a timer lapse, or an explicit recovery gesture. A recent
   * send only proves host activity: the device may have missed the message.
   * Forced recovery still waits for held pads before changing their mapping.
   */
  recoverIfHeartbeatStale({ force = false } = {}) {
    if (!this._ready || !this._out) return false;
    const last = this._lastHeartbeatSentAt;
    const stale = !Number.isFinite(last) || performance.now() - last > HEARTBEAT_STALE_MS;
    if (!force && !stale && !this._recoveryPending) return false;
    debugLog("controllers", force
      ? "Exquis App Mode restore requested — re-entering App Mode."
      : "Exquis App Mode heartbeat stale — re-entering App Mode.");
    this._enterAppMode();
    return true;
  }

  /** Send 61 pad colors. No-op if not ready. */
  sendColors(colors) {
    if (!this._ready || !this._out) return;
    this._lastColors = colors;
    if (this._recoveryPending) return;
    for (let noteId = 0; noteId < 61; noteId++) {
      const { r, g, b } = _boostSaturation(colors[noteId] ?? "#000000", this._saturation);
      this._out.send(new Uint8Array([...HDR, 0x14, noteId, r >> 1, g >> 1, b >> 1, 0xf7]));
    }
  }

  /** Send black to all 61 pads. No-op if not ready. */
  clearColors() {
    if (!this._ready || !this._out) return;
    this._lastColors = Array(61).fill("#000000");
    if (this._recoveryPending) return;
    for (let noteId = 0; noteId < 61; noteId++) {
      this._out.send(new Uint8Array([...HDR, 0x14, noteId, 0, 0, 0, 0xf7]));
    }
  }

  /** Update luminosity and send CMD 0x05. No-op if not ready. */
  setLuminosity(value) {
    if (!this._ready || !this._out) return;
    this._luminosity = Math.max(0, Math.min(100, Math.round(value)));
    this._out.send(new Uint8Array([...HDR, 0x05, this._luminosity, 0xf7]));
  }

  /** Remember the selected pattern even before the firmware handshake. */
  setArpeggiatorPattern(value) {
    const pattern = Math.max(0, Math.min(5, Math.round(value) || 0));
    if (pattern === this._arpeggiatorPattern) return;
    this._arpeggiatorPattern = pattern;
    if (this._ready && this._out) this._sendArpeggiatorPattern();
  }

  _sendArpeggiatorPattern() {
    // Native slider performs the arpeggiation; remote mode only reports touch.
    this._out.send(new Uint8Array([...HDR, 0x3c, 0, 0xf7]));
    this._out.send(new Uint8Array([...HDR, 0x40, this._arpeggiatorPattern, 0xf7]));
  }

  /** Apply device flags and commit the matching host geometry only with no pads held. */
  setOrientation(value, onApplied = null) {
    this._orientationPending = { value: exquisOrientation(value), onApplied };
    this._applyPendingOrientation();
  }

  _applyPendingOrientation() {
    if (this._heldPadCount || !this._orientationPending || !this._out) return;
    const { value, onApplied } = this._orientationPending;
    this._orientationPending = null;
    const changed = value !== this._orientation;
    this._orientation = value;
    if (changed && this._ready && !this._appModeInitTimer) this._sendLayoutFlags();
    onApplied?.(value);
  }

  _sendLayoutFlags() {
    if (!this._out) return;
    for (const [command, value] of exquisLayoutFlags(this._orientation)) {
      this._out.send(new Uint8Array([...HDR, command, value, 0xf7]));
    }
  }

  /** Update saturation multiplier and resend last colors if available. No-op if not ready. */
  setSaturation(factor) {
    if (!this._ready || !this._out) return;
    this._saturation = Math.max(0.75, Math.min(2.5, factor));
    if (this._lastColors) this.sendColors(this._lastColors);
  }

  /** Schedule a CMD 0x07 MPE mode switch, deferred until all pads are released.
   *  Sending while a pad is held triggers an Exquis firmware bug where that pad
   *  stops sending note-on until power-cycled. */
  setMPEMode(enabled) {
    if (this._mpeEnabled === !!enabled) return;
    this._mpeEnabled = !!enabled;
    if (!this._ready || !this._out) return;
    clearTimeout(this._mpeModePending);
    this._mpeModePending = null;
    if (this._heldPadCount === 0) {
      this._sendMPEMode();
    } else {
      // Mark as pending — _onMessage will fire it when heldPadCount reaches 0.
      this._mpeModePending = true;
    }
  }

  _sendMPEMode() {
    if (!this._out) return;
    for (let ch = 0; ch < 16; ch++) this._out.send([0xb0 | ch, 123, 0]);
    this._out.send(new Uint8Array([...HDR, 0x07, this._mpeEnabled ? 1 : 0, 0xf7]));
  }

  /** Remote ownership includes LEDs: keep assigned CC buttons visible, and
   * distinguish their current value from the neutral, inactive state. */
  refreshControlLeds() {
    if (!this._ready || !this._out || !this._controls) return;
    for (const [id, cc] of this._buttonCcs) {
      const value = this._controls.getControlValue?.(cc) ?? this._controlValues.get(cc) ?? 0;
      const anchorReady = id === 4 && !!this._controls.onAnchor && !!this._lastPlayedNote;
      const active = id === 4 ? anchorReady && this._pressedButtons.has(`${0x2a}.4`) : value >= 64;
      const state = `${cc}:${active}:${anchorReady}`;
      if (this._buttonLedValues.get(id) === state) continue;
      this._buttonLedValues.set(id, state);
      // CC32 enables *bypass*: its asserted state means bend is OFF.
      // Anchor is available only after this input has supplied a playable pad.
      const rgb = id === 4 ? (anchorReady ? (active ? [0, 70, 20] : [20, 20, 20]) : [0, 0, 0]) : cc === 32
        ? (active ? [40, 0, 0] : [0, 40, 0])
        : (active ? [0, 70, 20] : [20, 20, 20]);
      this._out.send(new Uint8Array([...HDR, 0x29, id, ...rgb, 0xf7]));
    }
  }

  setOctaveOffset(offset) {
    if (!Number.isFinite(offset)) return;
    this._octaveOffset = Math.trunc(offset);
    this._refreshOctaveLeds();
  }

  _refreshOctaveLeds() {
    if (!this._ready || !this._out || !this._controls) return;
    for (const [id, direction] of [[6, -1], [7, 1]]) {
      const rgb = exquisOctaveButtonRgb(this._octaveOffset, direction, this._octaveFlashes.has(id));
      const state = rgb.join(",");
      if (this._buttonLedValues.get(id) === state) continue;
      this._buttonLedValues.set(id, state);
      this._out.send(new Uint8Array([...HDR, 0x29, id, ...rgb, 0xf7]));
    }
  }

  _clearOctaveFlashes() {
    for (const timer of this._octaveFlashes.values()) clearTimeout(timer);
    this._octaveFlashes.clear();
  }

  _flashOctaveButton(id) {
    clearTimeout(this._octaveFlashes.get(id));
    this._octaveFlashes.set(id, setTimeout(() => {
      this._octaveFlashes.delete(id);
      this._refreshOctaveLeds();
    }, 120));
    this._refreshOctaveLeds();
  }

  /** Reclaim buttons after App-mode sleep, even if a returning heartbeat
   * already made its host timestamp look fresh. No pad routing or MPE writes:
   * this is safe while a full layout recovery is waiting for held pads. */
  restoreControls({ queryAssignments = false } = {}) {
    if (!this._ready || !this._out || !this._controls) return;
    this._out.send(new Uint8Array([...HDR, 0x28, 1, 0xf7]));
    this._out.send(new Uint8Array([...HDR, 0x32, 0, 0xf7]));
    if (queryAssignments) this._out.send(new Uint8Array([...HDR, 0x02, 0xf7]));
    this._clearOctaveFlashes();
    this._buttonLedValues.clear();
    this._refreshOctaveLeds();
    this.refreshControlLeds();
  }

  /**
   * Exit App Mode cleanly. Sends quit, stops heartbeat, removes listener.
   * Call this on scale mode switch or device disconnect.
   */
  exit() {
    this._clearOctaveFlashes();
    clearTimeout(this._orientationTimer);
    this._orientationPending = null;
    clearTimeout(this._versionTimeout);
    this._versionTimeout = null;
    this._mpeModePending = false;
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
    clearTimeout(this._appModeInitTimer);
    this._appModeInitTimer = null;
    if (this._in) this._in.removeEventListener("midimessage", this._onMessage);
    const out = this._out;
    const wasReady = this._ready;
    this._out = null;
    this._in = null;
    this._ready = false;
    this._recoveryPending = false;
    this._heldPads.clear();
    // Release host-side momentary controls before detaching their event path.
    for (const key of [...this._pressedButtons]) {
      const [command, id] = key.split(".").map(Number);
      this._handleRemoteButton(command, id, false);
    }
    this._pressedButtons.clear();
    this._controls = null;
    this._lastHeartbeatSentAt = 0;
    if (out && wasReady) out.send(QUIT);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _onMessage(event) {
    const d = event.data;
    if (!d || d.length < 1) return;

    // Repeated note-ons for one channel/key are not additional held pads.
    const status = d[0] & 0xf0;
    if (status === 0xb0 && d.length === 3) {
      this._controlValues.set(d[1], d[2]);
      this.refreshControlLeds();
    }
    if (!this._mpeEnabled && status === 0x90 && d[2] > 0) this._controlChannel = d[0] & 15;
    if (this._ready && status === 0x90 && d.length === 3 && d[2] > 0 && d[1] <= 60) {
      this._lastPlayedNote = { note: d[1], channel: (d[0] & 15) + 1 };
      this.refreshControlLeds();
    }
    const padKey = `${d[0] & 0x0f}.${d[1]}`;
    if (status === 0x90 && d[2] > 0) {
      this._heldPads.add(padKey);
      this._heldPadCount = this._heldPads.size;
    } else if (status === 0x80 || (status === 0x90 && d[2] === 0)) {
      this._heldPads.delete(padKey);
      this._heldPadCount = this._heldPads.size;
      if (!this._heldPadCount && this._recoveryPending) {
        clearTimeout(this._appModeInitTimer);
        this._appModeInitTimer = setTimeout(() => {
          this._appModeInitTimer = null;
          if (this._out && this._recoveryPending) this._enterAppMode();
        }, 0);
      }
      if (!this._heldPadCount && this._orientationPending) {
        // Let all input listeners release using the old map first.
        clearTimeout(this._orientationTimer);
        this._orientationTimer = setTimeout(() => this._applyPendingOrientation(), 0);
      }
    }

    // If pads all released and a mode switch is pending, send it now.
    if (this._heldPadCount === 0 && this._mpeModePending && !this._recoveryPending) {
      clearTimeout(this._mpeModePending);
      this._mpeModePending = null;
      this._sendMPEMode();
    }

    if (d.length < 4) return;
    if (d[0] !== 0xf0 || d[d.length - 1] !== 0xf7) return;
    if (d[1] !== 0x00 || d[2] !== 0x21 || d[3] !== 0x7e) return;
    if (this._ready && this._controls && d.length === 8) {
      // Flush replies preserve the user's native CC assignments without
      // changing or saving any firmware settings.
      if ([0x2b, 0x38].includes(d[4]) && d[6] <= 127) {
        const assignments = d[4] === 0x2b ? this._buttonCcs : this._knobButtonCcs;
        if ((d[4] === 0x2b && [2, 3, 4].includes(d[5])) ||
            (d[4] === 0x38 && d[5] < 4)) assignments.set(d[5], d[6]);
        this.refreshControlLeds();
        return;
      }
      if ([0x2a, 0x34].includes(d[4]) && (d[6] === 0 || d[6] === 1)) {
        this._handleRemoteButton(d[4], d[5], d[6] === 1);
        return;
      }
    }
    if (d[4] !== 0x00 || d.length !== 9) return; // only handle version response

    clearTimeout(this._versionTimeout);
    this._versionTimeout = null;

    const major = d[5],
      minor = d[6],
      patch = d[7];
    const ok =
      major > MIN_FIRMWARE.major ||
      (major === MIN_FIRMWARE.major && minor > MIN_FIRMWARE.minor) ||
      (major === MIN_FIRMWARE.major && minor === MIN_FIRMWARE.minor && patch >= MIN_FIRMWARE.patch);

    if (!ok) {
      warnLog(`[ExquisLEDs] Firmware ${major}.${minor}.${patch} < 3.0.0 — App Mode not entered.`);
      if (this._onReady) this._onReady(false, `firmware ${major}.${minor}.${patch}`);
      return;
    }

    debugLog("controllers", `Exquis firmware ${major}.${minor}.${patch} — entering App Mode.`);
    this._enterAppMode();
  }

  _enterAppMode() {
    if (!this._out) return;
    this._ready = true;
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
    clearTimeout(this._appModeInitTimer);
    this._appModeInitTimer = null;

    // Keepalive can resume immediately. Routing/MPE/map writes must wait for
    // physical pad releases; they can disturb the firmware's held-note state.
    this._sendHeartbeat(false);
    this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.restoreControls({ queryAssignments: true });
    if (this._heldPadCount) { this._recoveryPending = true; return; }
    this._recoveryPending = false;
    this._mpeModePending = null;

    this._out.send(PAD_REMOTE_0);
    if (!this._controls) {
      this._out.send(new Uint8Array([...HDR, 0x28, 0, 0xf7]));
      this._out.send(new Uint8Array([...HDR, 0x32, 0, 0xf7]));
    }
    this._sendArpeggiatorPattern();
    this._out.send(new Uint8Array([...HDR, 0x05, this._luminosity, 0xf7]));
    this._out.send(new Uint8Array([...HDR, 0x07, this._mpeEnabled ? 1 : 0, 0xf7]));

    // Delay note map + color commands to ensure App Mode is fully active on the
    // device before we send bulk note_number / note_colour frames.
    this._appModeInitTimer = setTimeout(() => {
      this._appModeInitTimer = null;
      if (!this._out) return;
      if (this._heldPadCount) { this._recoveryPending = true; return; }

      this._sendLayoutFlags();

      for (let noteId = 0; noteId < 61; noteId++) {
        this._out.send(new Uint8Array([...HDR, 0x14, noteId, 0, 0, 0, 0xf7]));
      }
      for (let noteId = 0; noteId < 61; noteId++) {
        this._out.send(new Uint8Array([...HDR, 0x15, noteId, noteId, 0xf7]));
      }
      if (this._lastColors) this.sendColors(this._lastColors);

      // MPE/layout setup can overwrite panel feedback during device wake-up.
      // Reassert ownership and LEDs after that burst, bypassing LED deduplication.
      this.restoreControls();

      if (this._onReady) this._onReady(true);
    }, 200);

    // onReady is called inside the timeout above, after note map is sent.
  }

  _sendHeartbeat(checkRecovery = true) {
    if (!this._out) return;
    // Detect the missed interval BEFORE updating last-sent time. This also
    // handles the timer firing before focus/visibility events on return.
    if (checkRecovery && this._ready) {
      if (performance.now() - this._lastHeartbeatSentAt > HEARTBEAT_STALE_MS)
        this._recoveryPending = true;
      if (this._recoveryPending && !this._heldPadCount) {
        this._enterAppMode();
        return;
      }
    }
    this._out.send(HEARTBEAT);
    this._lastHeartbeatSentAt = performance.now();
  }

  _handleRemoteButton(command, id, pressed) {
    const panel = command === 0x2a;
    if (id > (panel ? 9 : 3)) return;
    const key = `${command}.${id}`;
    if (pressed === this._pressedButtons.has(key)) return;
    if (pressed) this._pressedButtons.add(key);
    else this._pressedButtons.delete(key);
    if (panel && [6, 7].includes(id)) {
      if (pressed) {
        const direction = id === 6 ? -1 : 1;
        this._octaveOffset += direction;
        this._flashOctaveButton(id);
        this._controls.onOctave?.(direction);
      }
      return;
    }
    if (panel && id === 4 && this._controls.onAnchor) {
      if (pressed && this._lastPlayedNote) {
        this._controls.onAnchor(this._lastPlayedNote.note, this._lastPlayedNote.channel);
      }
      this.refreshControlLeds();
      return;
    }
    const cc = (panel ? this._buttonCcs : this._knobButtonCcs).get(id);
    if (cc == null) return;
    let value = pressed ? 127 : 0;
    if (panel && id === 2) {
      if (!pressed) return; // Record's native CC32 behavior is a toggle.
      const previous = this._controls.getControlValue?.(cc) ?? this._controlValues.get(cc) ?? 0;
      value = previous >= 64 ? 0 : 127;
    }
    this._controlValues.set(cc, value);
    this._controls.onMidi?.([0xb0 | (this._mpeEnabled ? 0 : this._controlChannel), cc, value]);
    this.refreshControlLeds();
  }
}
