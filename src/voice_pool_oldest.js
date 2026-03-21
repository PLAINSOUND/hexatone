/**
 * VoicePool — polyphony manager for MPE.
 *
 * Channel states:
 *   IDLE      – free, no note, PB at whatever the last note left it (doesn't
 *               matter — the correct PB is always sent before every noteOn)
 *   SOUNDING  – note is held
 *   RELEASING – noteOff sent; release tail may still be audible
 *
 * Allocation priority:
 *   1. IDLE channels (FIFO — maximises time before reuse)
 *   2. RELEASING channels (oldest noteOff first — most likely decayed)
 *   3. SOUNDING channels (steal oldest — last resort)
 *
 * For microtonal use, an optional closestPitch mode selects the SOUNDING
 * channel whose current bend is nearest the incoming note's required bend,
 * minimising the audible pitch jump on the stolen note's release tail.
 *
 * No "clean channel" reservation is needed because the correct PB is always
 * sent before noteOn via the WebMIDI timestamp scheduler.
 */
export class VoicePool {
  /**
   * @param {number[]} slotIds          – 1-based MIDI channel numbers
   * @param {number}   releaseGuardMs   – ms to hold a channel in RELEASING
   *                                      state before it becomes IDLE again
   *                                      (should match synth release time; default 300)
   * @param {boolean}  closestPitchSteal – when stealing a SOUNDING voice, prefer
   *                                       the channel whose bend is nearest to
   *                                       the incoming note's bend (default false)
   */
  constructor(slotIds, releaseGuardMs = 300, closestPitchSteal = false) {
    this._allSlots        = [...slotIds];
    this._releaseGuardMs  = releaseGuardMs;
    this._closestPitch    = closestPitchSteal;

    // Per-channel state
    // state: 'IDLE' | 'SOUNDING' | 'RELEASING'
    this._state     = new Map(); // slot → state
    this._noteOffAt = new Map(); // slot → timestamp (ms) when noteOff was sent
    this._lastBend  = new Map(); // slot → last bend value (14-bit unsigned)
    this._lastNote  = new Map(); // slot → last MIDI note number

    // Active voice linked list (oldest head → newest tail)
    this._active = new Map(); // coordsKey → entry { key, coords, slot, prev, next }
    this._head   = null;
    this._tail   = null;

    for (const s of slotIds) {
      this._state.set(s, 'IDLE');
      this._lastBend.set(s, 8192);
      this._lastNote.set(s, 60);
    }
  }

  /**
   * Allocate a channel for a new note at `coords`.
   *
   * Returns:
   *  { slot, stolen, stolenSlot, stolenNote, retrigger }
   *
   *  stolen     – coords of the killed note (null if no steal)
   *  stolenSlot – channel of the killed note (null if no steal)
   *  stolenNote – MIDI note of the killed note (null if no steal)
   *  retrigger  – true if coords was already active (moved to tail)
   *
   * The caller is responsible for sending PB(newBend) then noteOn
   * to `slot` using the WebMIDI timestamp mechanism.
   * Do NOT send a PB reset to any channel — let releasing tails decay.
   */
  noteOn(coords, incomingBend = 8192) {
    const key = coordsKey(coords);

    // Retrigger: note already active, just refresh its position in the LRU list
    if (this._active.has(key)) {
      const entry = this._active.get(key);
      this._moveToTail(entry);
      return {
        slot: entry.slot,
        stolen: null, stolenSlot: null, stolenNote: null,
        retrigger: true,
      };
    }

    // Expire any RELEASING channels that have passed the guard time
    this._expireReleasing();

    let slot   = null;
    let stolen = null, stolenSlot = null, stolenNote = null;

    // 1. Try IDLE channel (FIFO: scan _allSlots in order)
    for (const s of this._allSlots) {
      if (this._state.get(s) === 'IDLE') { slot = s; break; }
    }

    // 2. Try oldest RELEASING channel
    if (slot === null) {
      let oldestTime = Infinity, oldestSlot = null;
      for (const [s, t] of this._noteOffAt) {
        if (this._state.get(s) === 'RELEASING' && t < oldestTime) {
          oldestTime = t; oldestSlot = s;
        }
      }
      if (oldestSlot !== null) slot = oldestSlot;
    }

    // 3. Steal a SOUNDING channel
    if (slot === null) {
      let victim;
      if (this._closestPitch) {
        // Find the SOUNDING voice whose bend is nearest to incomingBend
        victim = this._closestBendVictim(incomingBend);
      } else {
        // Oldest SOUNDING voice
        victim = this._head;
      }
      if (!victim) throw new Error('VoicePool: no channels available');

      stolen     = victim.coords;
      stolenSlot = victim.slot;
      stolenNote = this._lastNote.get(victim.slot) ?? 60;
      slot       = victim.slot;

      this._remove(victim);
      this._active.delete(victim.key);
      // Caller sends noteOff on stolenSlot; we set state to RELEASING
      // (caller will invoke noteOff() on the stolen hex, which calls pool.noteOff())
    }

    // Register the new voice
    const entry = { key, coords, slot, prev: this._tail, next: null };
    if (this._tail) this._tail.next = entry;
    this._tail = entry;
    if (!this._head) this._head = entry;
    this._active.set(key, entry);
    this._state.set(slot, 'SOUNDING');

    return { slot, stolen, stolenSlot, stolenNote, retrigger: false };
  }

  /**
   * Release the channel assigned to `coords`.
   * Marks it RELEASING (not immediately available) to let the tail decay.
   * Returns the slot, or null if coords wasn't active.
   */
  noteOff(coords) {
    const key   = coordsKey(coords);
    const entry = this._active.get(key);
    if (!entry) return null;

    const slot = entry.slot;
    this._remove(entry);
    this._active.delete(key);

    // Mark RELEASING — will become IDLE after releaseGuardMs
    this._state.set(slot, 'RELEASING');
    this._noteOffAt.set(slot, performance.now());

    return slot;
  }

  /** Called by the synth to record the bend that was sent to a channel. */
  setLastBend(slot, bend)  { this._lastBend.set(slot, bend);  }
  getLastBend(slot)        { return this._lastBend.get(slot) ?? 8192; }

  /** Called by the synth to record the MIDI note sent to a channel. */
  setLastNote(slot, note)  { this._lastNote.set(slot, note);  }
  getLastNote(slot)        { return this._lastNote.get(slot) ?? 60;   }

  getSlot(coords) {
    const entry = this._active.get(coordsKey(coords));
    return entry ? entry.slot : null;
  }

  get activeCount()  { return this._active.size; }
  get freeCount()    { return this._allSlots.filter(s => this._state.get(s) === 'IDLE').length; }

  /**
   * Kill all active voices. Returns array of {coords, slot} for each.
   * Caller is responsible for sending noteOff to each slot.
   */
  clear() {
    const victims = Array.from(this._active.values()).map(e => ({
      coords: e.coords, slot: e.slot,
    }));
    this._active.clear();
    this._head = null;
    this._tail = null;
    for (const s of this._allSlots) {
      this._state.set(s, 'IDLE');
      this._noteOffAt.delete(s);
    }
    return victims;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  _expireReleasing() {
    const now = performance.now();
    for (const [s, t] of this._noteOffAt) {
      if (this._state.get(s) === 'RELEASING' && now - t >= this._releaseGuardMs) {
        this._state.set(s, 'IDLE');
        this._noteOffAt.delete(s);
      }
    }
  }

  _closestBendVictim(targetBend) {
    // Walk the active LRU list, find SOUNDING voice with bend nearest to targetBend
    let best = null, bestDist = Infinity;
    let node = this._head;
    while (node) {
      if (this._state.get(node.slot) === 'SOUNDING') {
        const dist = Math.abs((this._lastBend.get(node.slot) ?? 8192) - targetBend);
        if (dist < bestDist) { bestDist = dist; best = node; }
      }
      node = node.next;
    }
    return best;
  }

  _remove(entry) {
    if (entry.prev) entry.prev.next = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    if (this._head === entry) this._head = entry.next;
    if (this._tail === entry) this._tail = entry.prev;
  }

  _moveToTail(entry) {
    this._remove(entry);
    entry.prev = this._tail;
    entry.next = null;
    if (this._tail) this._tail.next = entry;
    this._tail = entry;
    if (!this._head) this._head = entry;
  }
}

function coordsKey(coords) {
  if (Array.isArray(coords)) return coords.join(',');
  if (coords !== null && typeof coords === 'object' && 'x' in coords && 'y' in coords)
    return `${coords.x},${coords.y}`;
  return String(coords);
}
