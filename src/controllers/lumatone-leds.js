/* eslint-disable no-console */
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
 * ACK listening prefers the WebMidi.js input event emitter used by Keys. Raw
 * Web MIDI addEventListener/onmidimessage fallbacks remain available for tests
 * and direct integrations without replacing an existing message handler.
 */

const ACK_TIMEOUT_MS = 300;
const INITIAL_ACK_TIMEOUT_MS = 1200;
const PROBE_TIMEOUT_MS = 2000;
const INITIAL_SEND_DELAY_MS = 600;
const WAKE_SEND_DELAY_MS = 1500;
const SLEEP_GAP_GRACE_MS = 2000;

// Lumatone manufacturer ID (3 bytes after F0)
const MFR = [0x00, 0x21, 0x50];

export class LumatoneLEDs {
  /**
   * @param {MIDIOutput|import("webmidi").Output} outputPort – SysEx-capable output
   * @param {MIDIInput|import("webmidi").Input} inputPort – ACK input
   */
  constructor(outputPort, inputPort) {
    this._out = outputPort;
    this._in = inputPort;
    this._queue = []; // Array of { cmd, board:1-5, key:0-55, ... }
    this._latestColorQueue = []; // Latest complete colour state, replayed after wake.
    this._pending = false; // True while awaiting an ACK for queue[0]
    this._suspended = false;
    this._timer = null; // ACK-timeout handle (clearTimeout on ACK)
    this._readyTimer = null; // Initial reconnect delay before first send.
    this._readyAt = Date.now() + INITIAL_SEND_DELAY_MS;
    this._sentSinceConnect = false;
    this._hasReceivedAck = false;
    this._restoreOnMidiMessage = null;
    this._inputListenerHandle = null;
    this._probe = null;

    this._onMessage = this._onMessage.bind(this);
    this._attachInputListener();
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
    const nextQueue = entries.map(({ board, key, hexColor }) => ({
      cmd: 0x01,
      board,
      key,
      retries: 0,
      ...this._parseHex(hexColor),
    }));
    this._latestColorQueue = this._cloneQueue(nextQueue);
    if (this._suspended) return;
    if (this._isDuplicateFullColorQueue(nextQueue)) return;
    this._queue = this._pending ? [this._queue[0], ...nextQueue] : nextQueue;
    this._refreshInitialSendDelay();
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
   * @param {Array<{ board, key, note, channel, hexColor, keyType? }>} entries
   *   board    1–5  (1-indexed, matches sysex board byte)
   *   key      0–55
   *   note     0–127  MIDI note number
   *   channel  0–15   MIDI channel, 0-indexed (0 = MIDI ch 1)
   *   hexColor '#rrggbb'
   */
  /**
   * @param {Array<{ board, key, note, channel, hexColor, keyType? }>} entries
   * @param {Array<object>} [preamble]  Raw queue entries to send before the key data
   *   (e.g. [{ cmd: 0x0E, board: 0, value: 1 }] to enable aftertouch first).
   */
  sendLayout(entries, preamble = []) {
    this._latestColorQueue = entries.map(({ board, key, hexColor }) => ({
      cmd: 0x01,
      board,
      key,
      retries: 0,
      ...this._parseHex(hexColor),
    }));
    if (this._suspended) return;
    const nextQueue = [
      ...preamble,
      ...entries.flatMap(({ board, key, note, channel, hexColor, keyType = 0x01 }) => [
        { cmd: 0x00, board, key, note, channel, keyType, retries: 0 },
        { cmd: 0x01, board, key, retries: 0, ...this._parseHex(hexColor) },
      ]),
    ];
    this._queue = this._pending ? [this._queue[0], ...nextQueue] : nextQueue;
    this._refreshInitialSendDelay();
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
      retries: 0,
      ...this._parseHex(hexColor),
    }));

    for (const newEntry of parsed) {
      const desiredIndex = this._latestColorQueue.findIndex(
        (queued) => queued.board === newEntry.board && queued.key === newEntry.key,
      );
      if (desiredIndex >= 0) this._latestColorQueue[desiredIndex] = { ...newEntry };
      else this._latestColorQueue.push({ ...newEntry });
    }
    if (this._suspended) return;

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

    this._refreshInitialSendDelay();
    if (!this._pending) this._advance();
  }

  /** Drain the queue without sending anything further. */
  cancel() {
    this._latestColorQueue = [];
    this._clearActiveQueue();
    this._cancelProbe("cancelled");
  }

  /** Reproduce the Editor's non-mutating identity handshake, with no retries. */
  probeConnection() {
    if (!this._out || !this._in) {
      return Promise.resolve({ ok: false, reason: "disconnected", bytes: [] });
    }
    if (this._probe || this._pending || this._queue.length > 0) {
      return Promise.resolve({ ok: false, reason: "busy", bytes: [] });
    }

    const startedAt = Date.now();
    return new Promise((resolve) => {
      this._probe = {
        resolve,
        timer: null,
        startedAt,
        expectedCommand: 0x23,
        serialBytes: [],
      };
      console.info("[LumatoneLEDs:probe] output", {
        transport: typeof this._out?.sendSysex === "function" ? "webmidi-sendSysex" : "native-send",
        id: this._out?.id ?? null,
        name: this._out?.name ?? null,
        type: this._out?.constructor?.name ?? null,
      });
      // Exact first request observed from Lumatone Editor 1.0.2. The firmware
      // request (CMD 31h) is sent only after this identity response arrives.
      this._sendProbeMessage(
        new Uint8Array([0xf0, ...MFR, 0x00, 0x23, 0x7f, 0x00, 0x00, 0x00, 0xf7]),
      );
    });
  }

  /** Pause an in-flight transfer without retaining stale ACK state. */
  suspend() {
    if (this._suspended) return;
    this._suspended = true;
    this._clearActiveQueue();
  }

  /** Resume by sending one fresh copy of the latest complete colour state. */
  resume() {
    if (!this._suspended) return;
    this._suspended = false;
    this._restartLatestColorsAfterReconnect();
  }

  _clearActiveQueue() {
    this._queue = [];
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._readyTimer !== null) {
      clearTimeout(this._readyTimer);
      this._readyTimer = null;
    }
    this._pending = false;
  }

  /** Remove the ACK listener and release all resources. */
  destroy() {
    this.cancel();
    this._detachInputListener();
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
    if (this._out === null || this._suspended) return;
    if (this._queue.length === 0) {
      this._pending = false;
      return;
    }
    const waitMs = this._readyAt - Date.now();
    if (waitMs > 0) {
      if (this._readyTimer === null) {
        this._readyTimer = setTimeout(() => {
          this._readyTimer = null;
          this._advance();
        }, waitMs);
      }
      return;
    }

    this._pending = true;
    this._sentSinceConnect = true;
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
        entry.keyType ?? 0x01, // 0x01 = note on/off, 0x10 = disabled
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

    this._sendLumatoneMessage(msg);

    // Guard: if no ACK arrives within the timeout, skip this entry and continue.
    const timeoutMs = this._currentAckTimeoutMs();
    const timeoutStartedAt = Date.now();
    this._timer = setTimeout(() => {
      this._timer = null;
      this._pending = false;
      if (Date.now() - timeoutStartedAt > timeoutMs + SLEEP_GAP_GRACE_MS) {
        this._recoverFromLongTimerGap();
        return;
      }
      if (!this._hasReceivedAck && (entry.retries ?? 0) < 1) {
        entry.retries = (entry.retries ?? 0) + 1;
        this._advance();
        return;
      }
      let skipped = entry;
      if (this._queue[0] === entry) {
        this._queue.shift();
      } else {
        const fallbackIndex = this._queue.findIndex(
          (queued) =>
            queued?.cmd === entry?.cmd &&
            queued?.board === entry?.board &&
            queued?.key === entry?.key,
        );
        if (fallbackIndex >= 0) {
          skipped = this._queue.splice(fallbackIndex, 1)[0];
        }
      }
      console.warn(
        "[LumatoneLEDs] ACK timeout — skipping cmd",
        skipped?.cmd?.toString(16),
        "board",
        skipped?.board,
        "key",
        skipped?.key,
      );
      this._advance();
    }, timeoutMs);
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
    const d = event.data;
    if (this._probe && this._isLumatoneMessage(d)) {
      console.info("[LumatoneLEDs:probe] RX", this._formatBytes(d));
      if (d[5] === this._probe.expectedCommand) {
        if (d[6] !== 0x01) {
          const probe = this._probe;
          this._probe = null;
          clearTimeout(probe.timer);
          probe.resolve({
            ok: false,
            reason: "device-status",
            command: d[5],
            status: d[6],
            elapsedMs: Date.now() - probe.startedAt,
            bytes: Array.from(d),
          });
        } else if (d[5] === 0x23) {
          this._probe.serialBytes = Array.from(d);
          this._probe.expectedCommand = 0x31;
          // Exact second request observed from Lumatone Editor 1.0.2.
          this._sendProbeMessage(
            new Uint8Array([0xf0, ...MFR, 0x00, 0x31, 0x00, 0x00, 0x00, 0x00, 0xf7]),
          );
        } else {
          const probe = this._probe;
          this._probe = null;
          clearTimeout(probe.timer);
          probe.resolve({
            ok: true,
            reason: "response",
            status: d[6],
            elapsedMs: Date.now() - probe.startedAt,
            bytes: Array.from(d),
            serialBytes: probe.serialBytes,
          });
        }
      }
    }
    if (!this._pending || this._queue.length === 0) return;
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
    this._hasReceivedAck = true;
    this._queue.shift();
    this._pending = false;
    this._advance();
  }

  _isLumatoneMessage(data) {
    return (
      data?.length >= 7 &&
      data[0] === 0xf0 &&
      data[1] === MFR[0] &&
      data[2] === MFR[1] &&
      data[3] === MFR[2] &&
      data[data.length - 1] === 0xf7
    );
  }

  _formatBytes(data) {
    return Array.from(data ?? [])
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
      .join(" ");
  }

  _sendProbeMessage(message) {
    if (!this._probe) return;
    clearTimeout(this._probe.timer);
    const expectedCommand = this._probe.expectedCommand;
    this._probe.timer = setTimeout(() => {
      if (!this._probe || this._probe.expectedCommand !== expectedCommand) return;
      const probe = this._probe;
      this._probe = null;
      const result = {
        ok: false,
        reason: "timeout",
        command: expectedCommand,
        elapsedMs: Date.now() - probe.startedAt,
        bytes: [],
        serialBytes: probe.serialBytes,
      };
      console.warn("[LumatoneLEDs:probe] timeout", result);
      probe.resolve(result);
    }, PROBE_TIMEOUT_MS);
    console.info("[LumatoneLEDs:probe] TX", this._formatBytes(message));
    this._sendLumatoneMessage(message);
  }

  _sendLumatoneMessage(message) {
    // WebMidi.js owns the framing on its wrapper path. The stored Lumatone
    // packet is complete, so remove F0, the three manufacturer bytes, and F7
    // before handing over the command payload. The wrapper then performs the
    // normal single framing operation used by Hexatone's other SysEx outputs.
    if (typeof this._out?.sendSysex === "function") {
      this._out.sendSysex(MFR, Array.from(message.slice(4, -1)));
      return;
    }
    this._out.send(Array.from(message));
  }

  _cancelProbe(reason) {
    if (!this._probe) return;
    const probe = this._probe;
    this._probe = null;
    clearTimeout(probe.timer);
    probe.resolve({
      ok: false,
      reason,
      elapsedMs: Date.now() - probe.startedAt,
      bytes: [],
    });
  }

  _colorEntryKey(entry) {
    if (!entry || entry.cmd !== 0x01) return null;
    return `${entry.board}:${entry.key}:${entry.r}:${entry.g}:${entry.b}`;
  }

  _colorQueueSignature(queue) {
    if (!Array.isArray(queue) || queue.length === 0) return "";
    return queue
      .map((entry) => this._colorEntryKey(entry))
      .filter(Boolean)
      .join("|");
  }

  _isDuplicateFullColorQueue(nextQueue) {
    if (!Array.isArray(nextQueue) || nextQueue.length === 0) return false;
    const nextSignature = this._colorQueueSignature(nextQueue);
    if (!nextSignature) return false;
    const queuedSignature = this._pending
      ? this._colorQueueSignature(this._queue.slice(1))
      : this._colorQueueSignature(this._queue);
    return queuedSignature === nextSignature;
  }

  _refreshInitialSendDelay() {
    if (this._sentSinceConnect || this._pending) return;
    this._readyAt = Date.now() + INITIAL_SEND_DELAY_MS;
    if (this._readyTimer !== null) {
      clearTimeout(this._readyTimer);
      this._readyTimer = null;
    }
  }

  _currentAckTimeoutMs() {
    return this._hasReceivedAck ? ACK_TIMEOUT_MS : INITIAL_ACK_TIMEOUT_MS;
  }

  _cloneQueue(queue) {
    return queue.map((entry) => ({ ...entry, retries: 0 }));
  }

  _restartLatestColorsAfterReconnect() {
    this._clearActiveQueue();
    this._hasReceivedAck = false;
    this._sentSinceConnect = false;
    this._readyAt = Date.now() + WAKE_SEND_DELAY_MS;
    this._queue = this._cloneQueue(this._latestColorQueue);
    this._advance();
  }

  _recoverFromLongTimerGap() {
    const pageIsHidden =
      typeof document !== "undefined" &&
      document.visibilityState &&
      document.visibilityState !== "visible";
    if (pageIsHidden) {
      this._suspended = true;
      this._clearActiveQueue();
      return;
    }
    this._restartLatestColorsAfterReconnect();
  }

  _attachInputListener() {
    if (!this._in) return;
    // WebMidi.js owns the selected input's native onmidimessage callback and
    // redispatches every packet through its EventEmitter. Subscribe there when
    // available so notes and Lumatone SysEx replies share the proven path.
    if (typeof this._in.addListener === "function") {
      this._inputListenerHandle = this._in.addListener("midimessage", this._onMessage);
      return;
    }
    if (typeof this._in.addEventListener === "function") {
      this._in.addEventListener("midimessage", this._onMessage);
      return;
    }
    if ("onmidimessage" in this._in) {
      const previous = this._in.onmidimessage;
      this._restoreOnMidiMessage = previous;
      this._in.onmidimessage = (event) => {
        if (typeof previous === "function") previous.call(this._in, event);
        this._onMessage(event);
      };
    }
  }

  _detachInputListener() {
    if (!this._in) return;
    if (this._inputListenerHandle) {
      this._inputListenerHandle.remove?.();
      this._inputListenerHandle = null;
      return;
    }
    if (typeof this._in.removeEventListener === "function") {
      this._in.removeEventListener("midimessage", this._onMessage);
      return;
    }
    if ("onmidimessage" in this._in) {
      this._in.onmidimessage = this._restoreOnMidiMessage;
      this._restoreOnMidiMessage = null;
    }
  }
}
