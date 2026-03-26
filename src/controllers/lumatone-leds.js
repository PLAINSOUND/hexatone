/**
 * lumatone-leds.js
 *
 * ACK-gated sysex queue engine for Lumatone key LED colour control.
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
    this._out     = outputPort;
    this._in      = inputPort;
    this._queue   = [];      // Array of { board:1-5, key:0-55, r, g, b }
    this._pending = false;   // True while awaiting an ACK for queue[0]
    this._timer   = null;    // ACK-timeout handle (clearTimeout on ACK)

    this._onMessage = this._onMessage.bind(this);
    if (this._in) {
      this._in.addEventListener('midimessage', this._onMessage);
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
      board,
      key,
      ...this._parseHex(hexColor),
    }));
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
        this._queue[idx] = newEntry;   // replace existing queued entry
      } else {
        this._queue.push(newEntry);    // not yet queued — append
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
      this._in.removeEventListener('midimessage', this._onMessage);
    }
    this._out = null;
    this._in  = null;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Parse a CSS hex colour ('#rrggbb' or 'rrggbb') into { r, g, b } (0-255).
   * Silently returns { r:0, g:0, b:0 } for unrecognised input.
   */
  _parseHex(hex) {
    const h = hex.replace('#', '').toLowerCase();
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
    const { board, key, r, g, b } = this._queue[0]; // peek — shifted on ACK/timeout

    // CMD 01h: Set key LED colour
    // F0 00 21 50 [board] 01 [key] rHi rLo gHi gLo bHi bLo F7
    const msg = new Uint8Array([
      0xF0,
      ...MFR,
      board,        // board index 1–5 (= MIDI channel for Lumatone blocks)
      0x01,         // CMD 01h
      key,          // key index 0–55 within the block
      r >> 4,       // rHi  (high nibble of red,   0–15)
      r & 0x0F,     // rLo  (low  nibble of red,   0–15)
      g >> 4,       // gHi
      g & 0x0F,     // gLo
      b >> 4,       // bHi
      b & 0x0F,     // bLo
      0xF7,
    ]);

    this._out.send(msg);

    // Guard: if no ACK arrives within the timeout, skip this entry and continue.
    this._timer = setTimeout(() => {
      this._timer   = null;
      this._pending = false;
      const skipped = this._queue.shift();
      console.warn(
        '[LumatoneLEDs] ACK timeout — skipping board', skipped?.board,
        'key', skipped?.key,
      );
      this._advance();
    }, ACK_TIMEOUT_MS);
  }

  /**
   * Raw MIDI message handler — filters for Lumatone CMD 01h ACKs only.
   *
   * ACK format: F0 00 21 50 [board] 01 01 F7  (8 bytes)
   *   byte 0: F0  (sysex start)
   *   byte 1: 00  )
   *   byte 2: 21  ) manufacturer ID
   *   byte 3: 50  )
   *   byte 4: board (1–5, must match what we sent)
   *   byte 5: 01  (command echo = CMD 01h)
   *   byte 6: 01  (status = ACK / success)
   *   byte 7: F7  (sysex end)
   */
  _onMessage(event) {
    if (!this._pending) return;

    const d = event.data;
    if (
      d.length !== 8  ||
      d[0] !== 0xF0   || d[1] !== 0x00 || d[2] !== 0x21 || d[3] !== 0x50 ||
      /* d[4] = board — checked below */
      d[5] !== 0x01   || // command echo
      d[6] !== 0x01   || // ACK status
      d[7] !== 0xF7
    ) return;

    // Verify the board byte matches the entry we sent.
    const ackBoard = d[4];
    if (this._queue.length === 0 || this._queue[0].board !== ackBoard) return;

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
