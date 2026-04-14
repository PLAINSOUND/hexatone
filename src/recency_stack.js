/**
 * RecencyStack — tracks all currently sounding hex objects, most recent first.
 *
 * Rules:
 *   - noteOn  → push to front (deduplicates by coords — retrigger moves to front)
 *   - noteOff while sustain active → note stays in stack (still sounding)
 *   - noteOff while NOT sustained → remove (note going silent)
 *   - sustainOff for a note → remove (actually going silent now)
 *   - panic → clear
 *
 * The front entry is the target for wheel bend, MPE expression,
 * and future "snapshot" operations.
 */
export class RecencyStack {
  constructor() {
    this._entries = []; // hex objects, most recent at index 0
  }

  /**
   * Push a hex to the front.  Deduplicates by coords so a retrigger
   * simply moves the existing entry rather than duplicating it.
   */
  push(hex) {
    this._removeByCoords(hex.coords);
    this._entries.unshift(hex);
  }

  /** Remove the entry matching these coords (if present). */
  remove(hex) {
    this._removeByCoords(hex.coords);
  }

  /** Most recently played still-sounding note, or null. */
  get front() {
    return this._entries[0] ?? null;
  }

  /** Snapshot-ready: ordered list of all sounding notes, most recent first.
   *  Future "snapshot" feature reads this to capture current tuning state. */
  get all() {
    return [...this._entries];
  }

  get size() {
    return this._entries.length;
  }

  clear() {
    this._entries = [];
  }

  // ── private ─────────────────────────────────────────────────────────
  _removeByCoords(coords) {
    const x = coords.x,
      y = coords.y;
    this._entries = this._entries.filter((h) => h.coords.x !== x || h.coords.y !== y);
  }
}
