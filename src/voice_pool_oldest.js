/**
 * VoicePool — LRU polyphony manager with O(1) operations.
 * Includes dedicated "clean" slot for glitch-free MPE voice assignment.
 */
export class VoicePool {
  constructor(slotIds) {
    this._free = [...slotIds];
    this._active = new Map();  // coordsKey → { slot, prev, next }
    this._head = null;  // oldest
    this._tail = null;  // newest
    this._lastBend = new Map();  // slot → last bend value
    this._cleanSlot = null;  // slot with known-centered pitch bend
  }

  noteOn(coords) {
    const key = coordsKey(coords);

    // Retrigger: move to tail (most recent)
    if (this._active.has(key)) {
      const entry = this._active.get(key);
      this._moveToTail(entry);
      return { 
        slot: entry.slot, 
        stolen: null, 
        lastBend: this._lastBend.get(entry.slot) || 8192,
        retrigger: true 
      };
    }

    let stolen = null;
    let slot;
    let lastBend = 8192;

    // Priority: clean slot > free pool > steal oldest
    if (this._cleanSlot !== null) {
      // Use the dedicated clean slot (guaranteed centered pitch bend)
      slot = this._cleanSlot;
      this._cleanSlot = null;  // consumed
      lastBend = 8192;  // guaranteed centered
    } else if (this._free.length > 0) {
      slot = this._free.pop();
      lastBend = this._lastBend.get(slot) || 8192;
    } else {
      // Steal oldest (head of linked list) - O(1)
      const victim = this._head;
      this._remove(victim);
      stolen = victim.coords;
      slot = victim.slot;
      lastBend = this._lastBend.get(slot) || 8192;
    }

    // Add to tail
    const entry = { key, coords, slot, prev: this._tail, next: null };
    if (this._tail) this._tail.next = entry;
    this._tail = entry;
    if (!this._head) this._head = entry;
    
    this._active.set(key, entry);
    
    return { slot, stolen, lastBend, retrigger: false };
  }

  noteOff(coords) {
    const key = coordsKey(coords);
    const entry = this._active.get(key);
    if (!entry) return null;

    this._remove(entry);
    this._active.delete(key);
    this._free.push(entry.slot);
    
    return entry.slot;
  }

  /**
   * Mark a slot as having centered pitch bend.
   * Call this after resetting pitch bend on a freed voice.
   */
  markClean(slot) {
    // Only mark if slot is currently free (not active)
    if (!this._isActive(slot)) {
      this._cleanSlot = slot;
      // Remove from free pool if present (clean slot is reserved)
      const idx = this._free.indexOf(slot);
      if (idx !== -1) {
        this._free.splice(idx, 1);
      }
    }
  }

  _isActive(slot) {
    for (const entry of this._active.values()) {
      if (entry.slot === slot) return true;
    }
    return false;
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

  setLastBend(slot, bend) {
    this._lastBend.set(slot, bend);
  }

  getLastBend(slot) {
    return this._lastBend.get(slot) || 8192;
  }

  clear() {
    const victims = Array.from(this._active.values()).map(e => ({ coords: e.coords, slot: e.slot }));
    this._free = [...this._free, ...victims.map(v => v.slot)];
    this._active.clear();
    this._head = null;
    this._tail = null;
    this._cleanSlot = null;
    return victims;
  }

  getSlot(coords) {
    const entry = this._active.get(coordsKey(coords));
    return entry ? entry.slot : null;
  }

  get activeCount() { return this._active.size; }
  get freeCount() { return this._free.length; }
  get cleanSlot() { return this._cleanSlot; }
}

function coordsKey(coords) {
  if (Array.isArray(coords)) return coords.join(',');
  if (coords !== null && typeof coords === 'object' && 'x' in coords && 'y' in coords) {
    return `${coords.x},${coords.y}`;
  }
  return String(coords);
}