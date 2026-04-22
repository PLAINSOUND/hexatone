import { debugLog, warnLog } from "../debug/logging.js";
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

// Layout flags for Rainbow Layout: isomorphic=1, twoPath=1, flipX/Y/XY=0.
const LAYOUT_FLAGS = [
  new Uint8Array([...HDR, 0x53, 1, 0xf7]), // isomorphic = 1
  new Uint8Array([...HDR, 0x54, 1, 0xf7]), // twoPath    = 1
  new Uint8Array([...HDR, 0x55, 0, 0xf7]), // flipX      = 0
  new Uint8Array([...HDR, 0x56, 0, 0xf7]), // flipY      = 0
  new Uint8Array([...HDR, 0x57, 0, 0xf7]), // flipXY     = 0
];

const HEARTBEAT_INTERVAL_MS = 500;
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
  ) {
    this._out = outputPort;
    this._in = inputPort;
    this._onReady = onReady;
    this._luminosity = Math.max(0, Math.min(100, Math.round(luminosity)));
    this._saturation = Math.max(0.75, Math.min(2.5, saturation));
    this._mpeEnabled = !!mpeEnabled;
    this._ready = false;
    this._heartbeatTimer = null;

    this._heldPadCount = 0; // raw note-on/off counter from device input
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

  /** Send 61 pad colors. No-op if not ready. */
  sendColors(colors) {
    if (!this._ready || !this._out) return;
    this._lastColors = colors;
    for (let noteId = 0; noteId < 61; noteId++) {
      const { r, g, b } = _boostSaturation(colors[noteId] ?? "#000000", this._saturation);
      this._out.send(new Uint8Array([...HDR, 0x14, noteId, r >> 1, g >> 1, b >> 1, 0xf7]));
    }
  }

  /** Send black to all 61 pads. No-op if not ready. */
  clearColors() {
    if (!this._ready || !this._out) return;
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

  /**
   * Exit App Mode cleanly. Sends quit, stops heartbeat, removes listener.
   * Call this on scale mode switch or device disconnect.
   */
  exit() {
    clearTimeout(this._versionTimeout);
    this._versionTimeout = null;
    this._mpeModePending = false;
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
    if (this._in) this._in.removeEventListener("midimessage", this._onMessage);
    const out = this._out;
    const wasReady = this._ready;
    this._out = null;
    this._in = null;
    this._ready = false;
    if (out && wasReady) out.send(QUIT);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _onMessage(event) {
    const d = event.data;
    if (!d || d.length < 1) return;

    // Track raw pad hold count so setMPEMode can defer until all pads released.
    const status = d[0] & 0xf0;
    if (status === 0x90 && d[2] > 0) {
      this._heldPadCount++;
    } else if (status === 0x80 || (status === 0x90 && d[2] === 0)) {
      this._heldPadCount = Math.max(0, this._heldPadCount - 1);
    }

    // If pads all released and a mode switch is pending, send it now.
    if (this._heldPadCount === 0 && this._mpeModePending) {
      clearTimeout(this._mpeModePending);
      this._mpeModePending = null;
      this._sendMPEMode();
    }

    if (d.length < 4) return;
    if (d[0] !== 0xf0 || d[d.length - 1] !== 0xf7) return;
    if (d[1] !== 0x00 || d[2] !== 0x21 || d[3] !== 0x7e) return;
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
      warnLog(
        `[ExquisLEDs] Firmware ${major}.${minor}.${patch} < 3.0.0 — App Mode not entered.`,
      );
      if (this._onReady) this._onReady(false, `firmware ${major}.${minor}.${patch}`);
      return;
    }

    debugLog("controllers", `Exquis firmware ${major}.${minor}.${patch} — entering App Mode.`);
    this._enterAppMode();
  }

  _enterAppMode() {
    if (!this._out) return;
    this._ready = true;

    this._out.send(PAD_REMOTE_0);
    this._out.send(new Uint8Array([...HDR, 0x05, this._luminosity, 0xf7]));
    this._out.send(new Uint8Array([...HDR, 0x07, this._mpeEnabled ? 1 : 0, 0xf7]));

    this._heartbeatTimer = setInterval(() => {
      if (this._out) this._out.send(HEARTBEAT);
    }, HEARTBEAT_INTERVAL_MS);

    // Delay note map + color commands to ensure App Mode is fully active on the
    // device before we send bulk note_number / note_colour frames.
    setTimeout(() => {
      if (!this._out) return;

      // Set layout flags to Rainbow Layout orientation.
      for (const frame of LAYOUT_FLAGS) this._out.send(frame);

      for (let noteId = 0; noteId < 61; noteId++) {
        this._out.send(new Uint8Array([...HDR, 0x14, noteId, 0, 0, 0, 0xf7]));
      }
      for (let noteId = 0; noteId < 61; noteId++) {
        this._out.send(new Uint8Array([...HDR, 0x15, noteId, noteId, 0xf7]));
      }

      if (this._onReady) this._onReady(true);
    }, 200);

    // onReady is called inside the timeout above, after note map is sent.
  }
}
