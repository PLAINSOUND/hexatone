/**
 * exquis-leds.js
 *
 * LED colour sync for the Exquis (Intuitive Instruments) in Rainbow Layout.
 *
 * ── Protocol ─────────────────────────────────────────────────────────────────
 *
 * All SysEx uses the Dualo manufacturer header:
 *   F0 00 21 7E 7F <cmd> [...] F7
 *
 * Relevant commands:
 *
 *   00 — Setup Developer Mode
 *     Enter (pads only):  F0 00 21 7E 7F 00 01 F7
 *     Exit:               F0 00 21 7E 7F 00 00 F7
 *
 *   03 — Refresh
 *     Sent by device when returning from settings menu. Host should resend
 *     all LED colors on receipt.
 *
 *   04 — Set LED Color (direct RGB, bypasses palette)
 *     F0 00 21 7E 7F 04 start_id  r g b fx  [r g b fx ...]  F7
 *     - start_id: first LED ID (0–60 = pads in Rainbow Layout)
 *     - r, g, b:  0–127 each (7-bit — halve from 0–255)
 *     - fx:       LED effect byte (00 = static)
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 * Dev mode is entered once on connect and held for the entire session.
 * LED colors are runtime-only on the device — they cannot be saved to flash.
 * Staying in dev mode (pads only, mask 01) keeps colors visible continuously.
 * MPE expression on ch 2–15 continues to work normally alongside dev mode.
 *
 * The device sends a Refresh (03h) SysEx when the user exits the settings menu.
 * We listen for this and resend all colors, matching the Lumatone ACK pattern.
 *
 * ── Pad ID mapping ───────────────────────────────────────────────────────────
 *
 * In Rainbow Layout (Preset 6), pad ID = MIDI note number (0–60).
 * buildExquisMap() in registry.js maps note numbers to hex-grid positions.
 * The color array passed here is indexed by note number (same ordering).
 */

const DUALO    = [0xF0, 0x00, 0x21, 0x7E, 0x7F];
const DUALO_U8 = new Uint8Array(DUALO);

// Pads only (mask 01) — holds pad LEDs under Hexatone control while leaving
// encoders, slider, and buttons operating normally for the user.
const ENTER_DEV = new Uint8Array([...DUALO, 0x00, 0x01, 0xF7]);
const EXIT_DEV  = new Uint8Array([...DUALO, 0x00, 0x00, 0xF7]);

export class ExquisLEDs {
  /**
   * @param {MIDIOutput} outputPort  Raw Web MIDI API output port for SysEx sends.
   * @param {MIDIInput}  inputPort   Raw Web MIDI API input port for Refresh (03h) listening.
   */
  constructor(outputPort, inputPort) {
    this._out = outputPort;
    this._in  = inputPort;
    this._lastColors = null; // cached for Refresh resend

    this._onMessage = this._onMessage.bind(this);
    if (this._in) this._in.addEventListener('midimessage', this._onMessage);

    // Enter dev mode immediately — pads go under Hexatone LED control.
    this._out.send(ENTER_DEV);
  }

  /**
   * Send all 61 pad colors via CMD 04.
   * Dev mode is already active; this just updates the LED state.
   * Safe to call repeatedly — each call replaces all pad colors atomically.
   *
   * @param {string[]} colors  61 CSS hex colors ('#rrggbb'), indexed by
   *                           Rainbow Layout note number (0 = bottom-left pad).
   */
  sendColors(colors) {
    if (!this._out) return;
    this._lastColors = colors;
    this._out.send(this._buildColorMsg(colors));
  }

  /** Release resources and exit dev mode, restoring the device's own display. */
  destroy() {
    if (this._in) {
      this._in.removeEventListener('midimessage', this._onMessage);
    }
    if (this._out) this._out.send(EXIT_DEV);
    this._out = null;
    this._in  = null;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Build CMD 04 SysEx message for all 61 pads.
   * Exquis RGB is 7-bit (0–127); halve from 8-bit (0–255).
   */
  _buildColorMsg(colors) {
    const payload = [...DUALO, 0x04, 0x00]; // cmd=04, start_id=0
    for (let i = 0; i < 61; i++) {
      const { r, g, b } = this._parseHex(colors[i] ?? '#000000');
      payload.push(r >> 1, g >> 1, b >> 1, 0x00); // fx=00 (static)
    }
    payload.push(0xF7);
    return new Uint8Array(payload);
  }

  /**
   * Listen for Refresh (03h) from the device — sent when the user returns
   * from the settings menu. Resend all colors so they reappear correctly.
   *
   * Refresh format: F0 00 21 7E 7F 03 [settings_page] F7
   */
  _onMessage(event) {
    const d = event.data;
    if (d.length < 7 || d[0] !== 0xF0 || d[d.length - 1] !== 0xF7) return;
    // Match Dualo header + cmd 03
    if (d[1] !== 0x00 || d[2] !== 0x21 || d[3] !== 0x7E || d[4] !== 0x7F) return;
    if (d[5] !== 0x03) return;
    // Refresh received — resend colors if we have them.
    if (this._lastColors && this._out) {
      this._out.send(this._buildColorMsg(this._lastColors));
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Parse a CSS hex color ('#rrggbb' or 'rrggbb') into { r, g, b } (0–255).
   * Returns black for unrecognised input.
   */
  _parseHex(hex) {
    const h = (hex ?? '').replace('#', '').toLowerCase();
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(h.slice(0, 2), 16) || 0,
      g: parseInt(h.slice(2, 4), 16) || 0,
      b: parseInt(h.slice(4, 6), 16) || 0,
    };
  }
}
