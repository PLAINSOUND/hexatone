/**
 * VoicePool — LRU polyphony manager for MTS and MPE slot assignment.
 *
 * Given a set of slot IDs (MIDI notes for MTS, channel numbers for MPE),
 * allocates one slot per noteOn and frees it on noteOff.  When all slots
 * are in use, steals the oldest active slot ("steal oldest" policy, same
 * as MaxMSP poly~).
 *
 * Usage:
 *   const pool = new VoicePool([0,1,2,...,127]);
 *   const slot = pool.noteOn(coords);   // returns slot ID
 *   pool.noteOff(coords);               // frees the slot
 *   pool.clear();                       // all-notes-off
 */
export class VoicePool {
  constructor(slotIds) {
    // free: available slot IDs, front = most-recently-freed (reuse soon)
    this._free   = [...slotIds];
    // active: { coords, slot } in order oldest → newest
    this._active = [];
    // fast lookup: coords key → active entry
    this._map    = new Map();
  }

  /**
   * Allocate a slot for coords.  Returns { slot, stolen } where stolen is
   * the coords key that was evicted (so the caller can send a noteOff).
   */
  noteOn(coords) {
    const key = coordsKey(coords);

    // Retrigger: already has a slot — move to back (most recent), keep slot
    if (this._map.has(key)) {
      const entry = this._map.get(key);
      this._active = this._active.filter(e => e !== entry);
      this._active.push(entry);
      return { slot: entry.slot, stolen: null };
    }

    let stolen = null;
    let slot;

    if (this._free.length > 0) {
      // Take from free pool
      slot = this._free.shift();
    } else {
      // Steal oldest active voice
      const victim = this._active.shift();
      this._map.delete(coordsKey(victim.coords));
      stolen = victim.coords;
      slot   = victim.slot;
    }

    const entry = { coords, slot };
    this._active.push(entry);
    this._map.set(key, entry);
    return { slot, stolen };
  }

  /**
   * Free the slot assigned to coords.  Returns the slot ID so the caller
   * can send noteOff on it, or null if coords wasn't active.
   */
  noteOff(coords) {
    const key = coordsKey(coords);
    const entry = this._map.get(key);
    if (!entry) return null;

    this._map.delete(key);
    this._active = this._active.filter(e => e !== entry);
    // Return freed slot to front of free list (LIFO within free — minimises
    // slot churn for synths that have per-slot state like reverb tails)
    this._free.unshift(entry.slot);
    return entry.slot;
  }

  /** Release all active voices.  Returns array of { coords, slot } to noteOff. */
  clear() {
    const victims = [...this._active];
    this._free   = [...this._free, ...victims.map(e => e.slot)];
    this._active = [];
    this._map.clear();
    return victims;
  }

  /** Look up the slot currently assigned to coords without allocating. */
  getSlot(coords) {
    const entry = this._map.get(coordsKey(coords));
    return entry ? entry.slot : null;
  }

  get activeCount() { return this._active.length; }
  get freeCount()   { return this._free.length; }
}

/** Stable string key for a coords value (array or primitive). */
function coordsKey(coords) {
  return Array.isArray(coords) ? coords.join(',') : String(coords);
}
