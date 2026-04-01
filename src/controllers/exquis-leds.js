/**
 * exquis-leds.js
 *
 * LED colour sync for the Exquis (Intuitive Instruments) using App Mode.
 *
 * ── Why App Mode instead of Dev Mode ─────────────────────────────────────────
 *
 * The previous Dev Mode implementation (CMD 0x7F 0x00 0x01) took over the pad
 * engine, disabling MPE — only note-on on ch16 survived. App Mode with
 * pad_remote=0 keeps the native expressive MPE engine fully active while the
 * host drives LED colors independently.
 *
 * ── Firmware requirement ─────────────────────────────────────────────────────
 *
 * App Mode requires firmware ≥ 3.0.0. On construction, CMD 0x00 (version) is
 * sent and the response is checked before entering App Mode. If the firmware is
 * too old, or if no response arrives within VERSION_TIMEOUT_MS, App Mode is not
 * entered and all subsequent calls are no-ops.
 *
 * ── Protocol ─────────────────────────────────────────────────────────────────
 *
 * All SysEx uses the Exquis manufacturer header:
 *   F0 00 21 7E <CMD> [...] F7
 *
 * Commands used:
 *
 *   0x00  version request / response
 *     H->E: F0 00 21 7E 00 F7
 *     E->H: F0 00 21 7E 00 <major> <minor> <patch> F7
 *
 *   Heartbeat (empty payload):
 *     F0 00 21 7E F7  — sent every ~500 ms. App Mode drops after ~10 s without
 *     valid App Mode SysEx traffic.
 *
 *   0x1E  pad_remote
 *     F0 00 21 7E 1E 00 F7  — keep pads on native expressive/MPE engine.
 *
 *   0x14  note_colour  (native path — pad_remote=0)
 *     F0 00 21 7E 14 <note_id> <r> <g> <b> F7
 *     note_id 0..60, RGB is rgb7 (0..127); firmware doubles internally → 0..254.
 *     Send as a contiguous burst; firmware auto-bulk monitor closes ~10 ms after
 *     inactivity.
 *
 *   0x03  quit
 *     F0 00 21 7E 03 F7  — exit App Mode cleanly on disconnect.
 *
 * ── note_id ordering ─────────────────────────────────────────────────────────
 *
 * In Rainbow Layout (Preset 6), note_id = MIDI note number (0–60).
 * buildExquisMap() in registry.js maps note numbers to hex-grid positions.
 * The color array passed to sendColors() is indexed by note number — the
 * note_id ordering matches directly.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 * Construction queries firmware version first. If ≥ 3.0.0, App Mode is entered:
 * pad_remote=0 is sent, initial colors are sent (if provided), and a heartbeat
 * interval starts. If the version check fails or times out, the instance stays
 * inert (all method calls are no-ops).
 *
 * destroy() sends quit, stops the heartbeat, and removes the input listener.
 */

const HDR = [0xF0, 0x00, 0x21, 0x7E]; // Exquis manufacturer bytes

// ── Inline okLab helpers for saturation boost ─────────────────────────────────

function _srgbToLinear(x) {
  return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
}
function _linearToSrgb(x) {
  return x >= 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x;
}
function _hexToOklab(hex) {
  const h = hex.replace('#', '');
  const r = _srgbToLinear(parseInt(h.slice(0, 2), 16) / 255);
  const g = _srgbToLinear(parseInt(h.slice(2, 4), 16) / 255);
  const b = _srgbToLinear(parseInt(h.slice(4, 6), 16) / 255);
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [
    0.2104542553*l + 0.793617785*m  - 0.0040720468*s,
    1.9779984951*l - 2.428592205*m  + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.808675766*s,
  ];
}
function _oklabToRgb255(L, a, b) {
  const l_ = L + 0.3963377774*a + 0.2158037573*b;
  const m_ = L - 0.1055613458*a - 0.0638541728*b;
  const s_ = L - 0.0894841775*a - 1.291485548*b;
  const lr = [l_**3, m_**3, s_**3];
  const r = _linearToSrgb( 4.0767416621*lr[0] - 3.3077115913*lr[1] + 0.2309699292*lr[2]);
  const g = _linearToSrgb(-1.2684380046*lr[0] + 2.6097574011*lr[1] - 0.3413193965*lr[2]);
  const bv = _linearToSrgb(-0.0041960863*lr[0] - 0.7034186147*lr[1] + 1.707614701*lr[2]);
  return [
    Math.min(255, Math.max(0, Math.round(r * 255))),
    Math.min(255, Math.max(0, Math.round(g * 255))),
    Math.min(255, Math.max(0, Math.round(bv * 255))),
  ];
}

/**
 * Boost chroma (saturation) of a CSS hex colour in okLab space.
 * Multiplies the a and b axes by `factor`; L is unchanged.
 * Returns { r, g, b } in 0–255.
 */
function _boostSaturation(hex, factor) {
  if (!hex || hex.length < 6) return { r: 0, g: 0, b: 0 };
  const [L, a, b] = _hexToOklab(hex);
  const [r, g, bv] = _oklabToRgb255(L, a * factor, b * factor);
  return { r, g, b: bv };
}

const VERSION_REQUEST  = new Uint8Array([...HDR, 0x00, 0xF7]);
const HEARTBEAT        = new Uint8Array([...HDR, 0xF7]);
const PAD_REMOTE_0     = new Uint8Array([...HDR, 0x1E, 0x00, 0xF7]); // native MPE path
const QUIT             = new Uint8Array([...HDR, 0x03, 0xF7]);

const HEARTBEAT_INTERVAL_MS = 500;
const VERSION_TIMEOUT_MS    = 2000;
const MIN_FIRMWARE = { major: 3, minor: 0, patch: 0 };

export class ExquisLEDs {
  /**
   * @param {MIDIOutput}    outputPort    Raw Web MIDI API output port.
   * @param {MIDIInput}     inputPort     Raw Web MIDI API input port (for version response).
   * @param {string[]|null} initialColors  61 CSS hex colors to send once App Mode is confirmed,
   *                                       or null to send nothing until sendColors() is called.
   * @param {function}      onReady        Called with (true) when App Mode is entered, or
   *                                       (false, reason) if firmware is incompatible / no response.
   * @param {number}        luminosity     Initial global brightness (0–100, default 40).
   * @param {number}        saturation     Chroma multiplier in okLab space (default 1.5).
   */
  constructor(outputPort, inputPort, initialColors = null, onReady = null, luminosity = 40, saturation = 1.5) {
    this._out           = outputPort;
    this._in            = inputPort;
    this._lastColors    = initialColors;
    this._luminosity    = Math.max(0, Math.min(100, Math.round(luminosity)));
    this._saturation    = Math.max(0.75, Math.min(2.5, saturation));
    this._ready         = false;
    this._heartbeatTimer = null;
    this._onReady       = onReady;

    this._onMessage = this._onMessage.bind(this);
    if (this._in) this._in.addEventListener('midimessage', this._onMessage);

    // Query firmware version — App Mode requires ≥ 3.0.0.
    // _enterAppMode() is called from _onMessage once a valid response arrives.
    // If no response in VERSION_TIMEOUT_MS, abort silently.
    this._versionTimeout = setTimeout(() => {
      this._versionTimeout = null;
      if (!this._ready) {
        console.warn('[ExquisLEDs] No version response — firmware may be < 3.0.0 or device not ready. App Mode not entered.');
        if (this._onReady) this._onReady(false, 'timeout');
      }
    }, VERSION_TIMEOUT_MS);

    this._out.send(VERSION_REQUEST);
  }

  /**
   * Set global LED brightness via CMD 0x05 (luminosity).
   * @param {number} value  0–127 (firmware uses directly as luminosity factor)
   */
  /**
   * Set the chroma saturation multiplier and resend all colors.
   * @param {number} factor  0 = greyscale, 1 = unchanged, >1 = boosted
   */
  setSaturation(factor) {
    if (!this._ready || !this._out) return;
    this._saturation = Math.max(0.75, Math.min(2.5, factor));
    if (this._lastColors) this.sendColors(this._lastColors);
  }

  setLuminosity(value) {
    if (!this._ready || !this._out) return;
    const v = Math.max(0, Math.min(100, Math.round(value)));
    this._out.send(new Uint8Array([...HDR, 0x05, v, 0xF7]));
  }

  /**
   * Send all 61 pad colors via CMD 0x14 (note_colour), one frame per pad.
   * No-op if App Mode has not been confirmed yet (firmware check pending/failed).
   *
   * Frames are sent as a contiguous burst so the firmware's auto-bulk monitor
   * coalesces them into a single visual update.
   *
   * @param {string[]} colors  61 CSS hex colors ('#rrggbb'), indexed by
   *                           Rainbow Layout note number (0 = bottom-left pad).
   */
  sendColors(colors) {
    if (!this._ready || !this._out) return;
    this._lastColors = colors;
    for (let noteId = 0; noteId < 61; noteId++) {
      const { r, g, b } = _boostSaturation(colors[noteId] ?? '#000000', this._saturation);
      // rgb7: 0..127 — firmware doubles internally to 0..254
      this._out.send(new Uint8Array([
        ...HDR, 0x14, noteId, r >> 1, g >> 1, b >> 1, 0xF7,
      ]));
    }
  }

  /** True once firmware version is confirmed ≥ 3.0.0 and App Mode is active. */
  get ready() { return this._ready; }

  /**
   * Full teardown: clear LEDs, send quit, stop heartbeat.
   * Use this when genuinely leaving App Mode (scale mode, device disconnect).
   * For Keys reconstruction use destroy() which skips quit to avoid the
   * Rainbow flash caused by the device briefly exiting App Mode.
   */
  destroyFinal() {
    clearTimeout(this._versionTimeout);
    this._versionTimeout = null;
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
    if (this._in) {
      this._in.removeEventListener('midimessage', this._onMessage);
    }
    const out = this._out;
    const wasReady = this._ready;
    this._out   = null;
    this._in    = null;
    this._ready = false;
    if (out && wasReady) {
      for (let noteId = 0; noteId < 61; noteId++) {
        out.send(new Uint8Array([...HDR, 0x14, noteId, 0, 0, 0, 0xF7]));
      }
      setTimeout(() => out.send(QUIT), 150);
    }
  }

  /** Send black to all 61 pads, turning off all LEDs. */
  clearColors() {
    if (!this._ready || !this._out) return;
    for (let noteId = 0; noteId < 61; noteId++) {
      this._out.send(new Uint8Array([...HDR, 0x14, noteId, 0, 0, 0, 0xF7]));
    }
  }

  /** Clear all LEDs, exit App Mode cleanly, and stop the heartbeat. */
  destroy() {
    clearTimeout(this._versionTimeout);
    this._versionTimeout = null;
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
    if (this._in) {
      this._in.removeEventListener('midimessage', this._onMessage);
    }
    // Capture port before nulling so the deferred sends still have a reference.
    const out = this._out;
    const wasReady = this._ready;
    this._out   = null;
    this._in    = null;
    this._ready = false;
    if (out && wasReady) {
      // Black all 61 pads. Do NOT send quit — the device would briefly revert
      // to its own Rainbow display before the new ExquisLEDs instance takes over,
      // causing a visible flash. Instead let the new instance's heartbeat keep
      // App Mode alive continuously. Quit is only sent on explicit disconnect
      // (scale mode switch or device removal) via destroyFinal().
      for (let noteId = 0; noteId < 61; noteId++) {
        out.send(new Uint8Array([...HDR, 0x14, noteId, 0, 0, 0, 0xF7]));
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _onMessage(event) {
    const d = event.data;
    if (!d || d.length < 4) return;
    if (d[0] !== 0xF0 || d[d.length - 1] !== 0xF7) return;
    if (d[1] !== 0x00 || d[2] !== 0x21 || d[3] !== 0x7E) return;

    const cmd = d[4];

    // CMD 0x00: version response — F0 00 21 7E 00 <major> <minor> <patch> F7
    if (cmd === 0x00 && d.length === 9) {
      clearTimeout(this._versionTimeout);
      this._versionTimeout = null;

      const major = d[5], minor = d[6], patch = d[7];
      const ok = major > MIN_FIRMWARE.major
        || (major === MIN_FIRMWARE.major && minor > MIN_FIRMWARE.minor)
        || (major === MIN_FIRMWARE.major && minor === MIN_FIRMWARE.minor && patch >= MIN_FIRMWARE.patch);

      if (!ok) {
        console.warn(`[ExquisLEDs] Firmware ${major}.${minor}.${patch} is below minimum 3.0.0. App Mode not entered.`);
        if (this._onReady) this._onReady(false, `firmware ${major}.${minor}.${patch}`);
        return;
      }

      console.log(`[ExquisLEDs] Firmware ${major}.${minor}.${patch} — entering App Mode.`);
      this._enterAppMode();
    }
  }

  _enterAppMode() {
    if (!this._out) return;
    this._ready = true;

    // pad_remote=0: keep pads on native MPE engine.
    this._out.send(PAD_REMOTE_0);

    // Set initial brightness.
    this._out.send(new Uint8Array([...HDR, 0x05, this._luminosity, 0xF7]));

    // Always blank all pads first — pad_remote=0 alone does not clear the
    // Rainbow display, it only keeps MPE running. Without this, the device
    // shows its own colours until sendColors() is called.
    for (let noteId = 0; noteId < 61; noteId++) {
      this._out.send(new Uint8Array([...HDR, 0x14, noteId, 0, 0, 0, 0xF7]));
    }

    // Send initial colors on top if auto-send is enabled.
    if (this._lastColors) this.sendColors(this._lastColors);

    // Heartbeat loop — keeps App Mode alive for the session.
    this._heartbeatTimer = setInterval(() => {
      if (this._out) this._out.send(HEARTBEAT);
    }, HEARTBEAT_INTERVAL_MS);

    if (this._onReady) this._onReady(true);
  }

}
