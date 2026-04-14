/**
 * lumatone-leds.js
 *
 * ACK-gated sysex queue engine for Lumatone key configuration and LED colour.
 *
 * ── Protocol: CMD 00h — Set key function (note + channel) ────────────────────
 *
 *   Send:  F0 00 21 50 [board 1-5] 00 [key 0-55] [note 0-127] [ch 0-15] 01 F7
 *   ACK:   F0 00 21 50 [board]     00 01                                  F7
 *
 *   ch is 0-indexed (0 = MIDI ch 1).  Last byte (0x01) is keyType = note on/off.
 *
 * ── Protocol: CMD 01h — Set key LED colour ───────────────────────────────────
 *
 *   Send:  F0 00 21 50 [board 1-5] 01 [key 0-55] rHi rLo gHi gLo bHi bLo F7
 *   ACK:   F0 00 21 50 [board]     01 01                              F7
 *
 *   Colour encoding: high nibble first.
 *     rHi = r >> 4,  rLo = r & 0x0F   (likewise g, b)
 *   All nibble values are 0–15 (fit in a single MIDI data byte).
 *
 * ── Queue discipline ─────────────────────────────────────────────────────────
 *
 * The Lumatone firmware processes one sysex per ACK.  This class serialises
 * sends via an internal FIFO:
 *   1. Dequeue front entry, send sysex.
 *   2. Wait for matching ACK (board byte must match).
 *   3. On ACK (or ACK_TIMEOUT_MS timeout), advance to the next entry.
 *
 * Two public send paths are provided:
 *
 *   sendAll(entries)        – Replace the entire queue.  Use on full layout
 *                             rebuilds (Keys reconstruction / "Sync now").
 *
 *   updateDegree(entries)   – Only update keys in the supplied list.
 *                             Replaces matching (board, key) entries already
 *                             queued; appends new ones.  Preserves the
 *                             in-flight entry (index 0 while pending).
 *                             Use when a single scale-degree colour changes.
 *
 * ── Sandboxing ───────────────────────────────────────────────────────────────
 *
 * ACK listening uses addEventListener('midimessage', …) on the raw Web MIDI
 * input port — it does NOT replace the port's onmidimessage handler, so the
 * existing WebMidi note-input path in keys.js is unaffected.
 */

const ACK_TIMEOUT_MS = 300;

// Lumatone manufacturer ID (3 bytes after F0)
const MFR = [0x00, 0x21, 0x50];

export class LumatoneLEDs {
  /**
   * @param {MIDIOutput} outputPort  – raw Web MIDI API output port for sysex sends
   * @param {MIDIInput}  inputPort   – raw Web MIDI API input port for ACK listening
   */
  constructor(outputPort, inputPort) {
    this._out = outputPort;
    this._in = inputPort;
    this._queue = []; // Array of { cmd, board:1-5, key:0-55, ... }
    this._pending = false; // True while awaiting an ACK for queue[0]
    this._timer = null; // ACK-timeout handle (clearTimeout on ACK)

    this._onMessage = this._onMessage.bind(this);
    if (this._in) {
      this._in.addEventListener("midimessage", this._onMessage);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Replace the entire pending queue with a new batch and restart sending.
   * Any in-flight entry (currently awaiting its ACK) will be superseded once
   * the ACK arrives — the new queue's version will follow immediately after.
   *
   * @param {Array<{ board: number, key: number, hexColor: string }>} entries
   */
  sendAll(entries) {
    this._queue = entries.map(({ board, key, hexColor }) => ({
      cmd: 0x01,
      board,
      key,
      ...this._parseHex(hexColor),
    }));
    if (!this._pending) this._advance();
  }

  /**
   * Send a full Lumatone layout: CMD 00h (note + channel) followed immediately
   * by CMD 01h (colour) for each of the 280 keys, interleaved per key so the
   * board fills in visually as the transfer progresses (~10–15 s total).
   *
   * This is a one-time setup operation.  Subsequent colour-only updates should
   * use sendAll() or updateDegree() which only queue CMD 01h messages.
   *
   * @param {Array<{ board, key, note, channel, hexColor }>} entries
   *   board    1–5  (1-indexed, matches sysex board byte)
   *   key      0–55
   *   note     0–127  MIDI note number
   *   channel  0–15   MIDI channel, 0-indexed (0 = MIDI ch 1)
   *   hexColor '#rrggbb'
   */
  /**
   * @param {Array<{ board, key, note, channel, hexColor }>} entries
   * @param {Array<object>} [preamble]  Raw queue entries to send before the key data
   *   (e.g. [{ cmd: 0x0E, board: 0, value: 1 }] to enable aftertouch first).
   */
  sendLayout(entries, preamble = []) {
    this._queue = [
      ...preamble,
      ...entries.flatMap(({ board, key, note, channel, hexColor }) => [
        { cmd: 0x00, board, key, note, channel },
        { cmd: 0x01, board, key, ...this._parseHex(hexColor) },
      ]),
    ];
    if (!this._pending) this._advance();
  }

  /**
   * Update only the Lumatone keys in the supplied list.
   *
   * Replaces matching (board, key) entries already waiting in the queue;
   * appends entries not yet queued.  The entry currently in flight (index 0
   * while this._pending is true) is never touched — its ACK will arrive
   * shortly and the queue will advance naturally.
   *
   * This keeps the total queue length bounded to ~280 entries (one per key)
   * even with rapid colour-picker drags.
   *
   * @param {Array<{ board: number, key: number, hexColor: string }>} entries
   */
  updateDegree(entries) {
    const parsed = entries.map(({ board, key, hexColor }) => ({
      cmd: 0x01,
      board,
      key,
      ...this._parseHex(hexColor),
    }));

    // If an entry is in flight, leave index 0 alone — start replacement from 1.
    const startIdx = this._pending ? 1 : 0;

    for (const newEntry of parsed) {
      const idx = this._queue.findIndex(
        (q, i) => i >= startIdx && q.board === newEntry.board && q.key === newEntry.key,
      );
      if (idx >= 0) {
        this._queue[idx] = newEntry; // replace existing queued entry
      } else {
        this._queue.push(newEntry); // not yet queued — append
      }
    }

    if (!this._pending) this._advance();
  }

  /** Drain the queue without sending anything further. */
  cancel() {
    this._queue = [];
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pending = false;
  }

  /** Remove the ACK listener and release all resources. */
  destroy() {
    this.cancel();
    if (this._in) {
      this._in.removeEventListener("midimessage", this._onMessage);
    }
    this._out = null;
    this._in = null;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Parse a CSS hex colour ('#rrggbb' or 'rrggbb') into { r, g, b } (0-255).
   * Silently returns { r:0, g:0, b:0 } for unrecognised input.
   */
  _parseHex(hex) {
    const h = hex.replace("#", "").toLowerCase();
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(h.slice(0, 2), 16) || 0,
      g: parseInt(h.slice(2, 4), 16) || 0,
      b: parseInt(h.slice(4, 6), 16) || 0,
    };
  }

  /**
   * Dequeue and send the next entry.  Starts the ACK-timeout guard.
   * No-op if the queue is empty or a send is already in flight.
   */
  _advance() {
    if (this._queue.length === 0) {
      this._pending = false;
      return;
    }

    this._pending = true;
    const entry = this._queue[0]; // peek — shifted on ACK/timeout
    const { cmd, board, key } = entry;

    let msg;
    if (cmd === 0x00) {
      // CMD 00h: Set key function (note + channel)
      // F0 00 21 50 [board 1-5] 00 [key] [note] [ch 0-indexed] 01 F7
      msg = new Uint8Array([
        0xf0,
        ...MFR,
        board, // board 1–5
        0x00, // CMD 00h
        key, // key 0–55
        entry.note, // MIDI note 0–127
        entry.channel, // MIDI channel 0-indexed (0–15)
        0x01, // keyType = 1 (note on/off)
        0xf7,
      ]);
    } else if (cmd === 0x0e) {
      // CMD 0Eh: Global toggle (e.g. aftertouch activation)
      // F0 00 21 50 [section] 0E [value] 00 00 00 F7
      msg = new Uint8Array([
        0xf0,
        ...MFR,
        board, // section (0 = global)
        0x0e,
        entry.value, // 1 = on, 0 = off
        0x00,
        0x00,
        0x00,
        0xf7,
      ]);
    } else {
      // CMD 01h: Set key LED colour
      // F0 00 21 50 [board 1-5] 01 [key] rHi rLo gHi gLo bHi bLo F7
      const { r, g, b } = entry;
      msg = new Uint8Array([
        0xf0,
        ...MFR,
        board, // board 1–5
        0x01, // CMD 01h
        key, // key 0–55
        r >> 4,
        r & 0x0f,
        g >> 4,
        g & 0x0f,
        b >> 4,
        b & 0x0f,
        0xf7,
      ]);
    }

    this._out.send(msg);

    // Guard: if no ACK arrives within the timeout, skip this entry and continue.
    this._timer = setTimeout(() => {
      this._timer = null;
      this._pending = false;
      const skipped = this._queue.shift();
      console.warn(
        "[LumatoneLEDs] ACK timeout — skipping cmd",
        skipped?.cmd?.toString(16),
        "board",
        skipped?.board,
        "key",
        skipped?.key,
      );
      this._advance();
    }, ACK_TIMEOUT_MS);
  }

  /**
   * Raw MIDI message handler — filters for Lumatone CMD 00h and CMD 01h ACKs.
   *
   * ACK format: F0 00 21 50 [board] [cmd] 01 F7  (8 bytes)
   *   byte 0: F0  (sysex start)
   *   byte 1: 00  )
   *   byte 2: 21  ) manufacturer ID
   *   byte 3: 50  )
   *   byte 4: board (1–5, must match what we sent)
   *   byte 5: cmd  (command echo — 00h or 01h, must match pending entry)
   *   byte 6: 01   (status = ACK / success)
   *   byte 7: F7   (sysex end)
   */
  _onMessage(event) {
    if (!this._pending || this._queue.length === 0) return;

    const d = event.data;
    if (
      d.length !== 8 ||
      d[0] !== 0xf0 ||
      d[1] !== 0x00 ||
      d[2] !== 0x21 ||
      d[3] !== 0x50 ||
      /* d[4] = board, d[5] = cmd — checked below */
      d[6] !== 0x01 || // ACK status
      d[7] !== 0xf7
    )
      return;

    // Command echo and board byte must both match the in-flight entry.
    const pending = this._queue[0];
    if (d[5] !== pending.cmd || d[4] !== pending.board) return;

    // Valid ACK received — clear timeout and advance.
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._queue.shift();
    this._pending = false;
    this._advance();
  }
}
