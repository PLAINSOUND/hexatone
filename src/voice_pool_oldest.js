/**
 * VoicePool — LRU polyphony manager with O(1) operations.
 * 
 * Reserved channel strategy for MPE:
 * - One channel is always reserved (clean, centered PB)
 * - Max polyphony = total channels - 1
 * - When stealing: use the clean channel, kill oldest
 * - Killed channel becomes "pending clean" for next steal
 * - On next steal: reset PB on pending, then use it
 */
export class VoicePool {
  constructor(slotIds) {
    // Reserve one channel (the first one) as the clean slot
    this._cleanSlot = slotIds[0];
    this._free = [...slotIds.slice(1)];  // remaining channels go to free pool
    this._active = new Map();  // coordsKey → { key, coords, slot, prev, next }
    this._head = null;  // oldest
    this._tail = null;  // newest
    this._lastBend = new Map();  // slot → last bend value
    this._lastNote = new Map();  // slot → last note number
    this._pendingClean = null;  // channel that was killed, needs PB reset before reuse
  }

  noteOn(coords) {
    const key = coordsKey(coords);
    
    // Debug: log current state
    this._logState("noteOn START");

    // Retrigger: move to tail (most recent)
    if (this._active.has(key)) {
      const entry = this._active.get(key);
      this._moveToTail(entry);
      console.log(`  → RETRIGGER on channel ${entry.slot}`);
      return { 
        slot: entry.slot, 
        stolen: null, 
        lastBend: this._lastBend.get(entry.slot) || 8192,
        lastNote: this._lastNote.get(entry.slot) || 60,
        cleanSlot: null,
        stolenSlot: null,
        stolenNote: null,
        retrigger: true 
      };
    }

    let stolen = null;
    let slot;
    let lastBend = 8192;
    let lastNote = 60;
    let cleanSlot = null;  // channel that needs PB reset before we use it
    let stolenSlot = null;  // channel of the killed voice
    let stolenNote = null;  // note number of the killed voice

    if (this._free.length > 0) {
      // Use free slot (FIFO for max time before reuse)
      slot = this._free.shift();
      lastBend = this._lastBend.get(slot) || 8192;
      lastNote = this._lastNote.get(slot) || 60;
      console.log(`  → ALLOC from free: channel ${slot}`);
    } else {
      // All free slots used - need to steal
      
      // Determine which slot to use
      if (this._pendingClean !== null) {
        // We have a pending clean channel from previous steal
        // Caller must reset PB on it, then use it
        cleanSlot = this._pendingClean;
        slot = this._pendingClean;
        lastBend = 8192;  // will be 8192 after reset
        lastNote = this._lastNote.get(slot) || 60;
        this._pendingClean = null;
        console.log(`  → STEAL using pendingClean: channel ${slot}`);
      } else if (this._cleanSlot !== null) {
        // First steal: use the reserved clean slot
        slot = this._cleanSlot;
        lastBend = 8192;  // guaranteed centered
        lastNote = this._lastNote.get(slot) || 60;
        this._cleanSlot = null;
        console.log(`  → STEAL using cleanSlot: channel ${slot}`);
      }
      
      // Kill oldest to make room
      const victim = this._head;
      this._remove(victim);
      stolen = victim.coords;
      stolenSlot = victim.slot;
      stolenNote = this._lastNote.get(victim.slot) || 60;
      
      // The killed channel becomes pending clean for next steal
      this._pendingClean = victim.slot;
      console.log(`  → KILL oldest: channel ${victim.slot} (now pendingClean)`);
    }

    // Add to tail
    const entry = { key, coords, slot, prev: this._tail, next: null };
    if (this._tail) this._tail.next = entry;
    this._tail = entry;
    if (!this._head) this._head = entry;
    
    this._active.set(key, entry);
    
    console.log(`  → RESULT: channel=${slot}, cleanSlot=${cleanSlot}, stolenSlot=${stolenSlot}`);
    this._logState("noteOn END");
    
    return { slot, stolen, lastBend, lastNote, cleanSlot, stolenSlot, stolenNote, retrigger: false };
  }

  noteOff(coords) {
    const key = coordsKey(coords);
    const entry = this._active.get(key);
    if (!entry) return null;

    console.log(`noteOff: channel ${entry.slot} released`);
    
    this._remove(entry);
    this._active.delete(key);
    
    // Return slot to free pool
    this._free.push(entry.slot);
    
    // If this was the pending clean channel, clear it
    if (this._pendingClean === entry.slot) {
      this._pendingClean = null;
      console.log(`  → Was pendingClean, cleared`);
    }
    
    this._logState("noteOff END");
    return entry.slot;
  }

  _logState(label) {
    const activeSlots = Array.from(this._active.values()).map(e => e.slot);
    console.log(`  [${label}] free=${JSON.stringify(this._free)} active=${JSON.stringify(activeSlots)} cleanSlot=${this._cleanSlot} pendingClean=${this._pendingClean}`);
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

  setLastNote(slot, note) {
    this._lastNote.set(slot, note);
  }

  getLastNote(slot) {
    return this._lastNote.get(slot) || 60;
  }

  clear() {
    const victims = Array.from(this._active.values()).map(e => ({ coords: e.coords, slot: e.slot }));

    this._cleanSlot = this._allSlots[0] || null;
    this._free = [...this._allSlots.slice(1)];  // fresh from original
    this._cleanSlot = allSlots[0] || null;
    this._free = allSlots.slice(1);
    
    this._active.clear();
    this._head = null;
    this._tail = null;
    this._pendingClean = null;
    return victims;
  }

  getSlot(coords) {
    const entry = this._active.get(coordsKey(coords));
    return entry ? entry.slot : null;
  }

  get activeCount() { return this._active.size; }
  get freeCount() { return this._free.length; }
  get cleanSlot() { return this._cleanSlot; }
  get pendingClean() { return this._pendingClean; }
}

function coordsKey(coords) {
  if (Array.isArray(coords)) return coords.join(',');
  if (coords !== null && typeof coords === 'object' && 'x' in coords && 'y' in coords) {
    return `${coords.x},${coords.y}`;
  }
  return String(coords);
}