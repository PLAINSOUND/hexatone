/**
 * VoicePool for MTS - note-number-aware allocation.
 * 
 * Prioritizes matching the carrier note number to the target pitch,
 * which preserves timbre characteristics of physical modeling synths.
 */
export class VoicePool {
  /**
   * @param {number[]} slotIds - Available MIDI note numbers (e.g., 0-127 for MTS1)
   * @param {Object} options - Configuration options, unused
   */
  constructor(slotIds, options = {}) {
    // Create slot objects
    this._slots = new Map();
    for (const id of slotIds) {
      this._slots.set(id, {
        id,
        coords: null,      // currently playing hex coords (null = free)
        lastUsed: 0
      });
    }
    
    // Fast lookup: coords → slot
    this._active = new Map();
  }

  /**
   * Generate search order: spiral outward from target note.
   * Returns array of note numbers in order of preference.
   */
  _generateSearchOrder(targetNote, availableNotes) {
    const order = [];
    const tried = new Set();
    
    for (let offset = 0; offset < 128; offset++) {
      // Try target + offset
      const up = targetNote + offset;
      if (up <= 127 && !tried.has(up) && availableNotes.includes(up)) {
        order.push(up);
        tried.add(up);
      }
      
      // Try target - offset
      if (offset > 0) {
        const down = targetNote - offset;
        if (down >= 0 && !tried.has(down) && availableNotes.includes(down)) {
          order.push(down);
          tried.add(down);
        }
      }
      
      // Stop if we've found all available notes
      if (order.length >= availableNotes.length) break;
    }
    
    return order;
  }

  /**
   * Request a slot for a note at target cents.
   * 
   * @param {Object} coords - Hex coordinates
   * @param {number} targetMIDIfloat - Target pitch as float MIDI value
   * @returns {Object} { slot, stolen, distance }
   */
  noteOn(coords, targetMIDIFloat) {
    const key = coordsKey(coords);
    
    // Already playing? Retrigger same slot
    if (this._active.has(key)) {
      const slot = this._active.get(key);
      slot.lastUsed = Date.now();
      console.log("voice_pool retriggered");
      return { slot: slot.id, stolen: null, distance: 0, retrigger: true };
    }
    
    // Calculate ideal MIDI note number for this pitch
    const targetNote = Math.floor(targetMIDIFloat);
    
    // Get list of available note numbers from this pool
    const availableNotes = Array.from(this._slots.keys());
    
    // Search spiral: target note first, then outward
    const searchOrder = this._generateSearchOrder(targetNote, availableNotes);
    
    // Find first available slot
    for (const noteNum of searchOrder) {
      const slot = this._slots.get(noteNum);
      if (slot.coords === null) {
        // Found available slot!
        slot.coords = coords;
        slot.lastUsed = Date.now();
        this._active.set(key, slot);
        
        const distance = Math.abs(targetMIDIFloat - noteNum);

        console.log("voice_pool first available: ", ["slot:", slot.id, "not stolen", "distance:", distance, "retrigger: false"]);

        return { slot: slot.id, stolen: null, distance, retrigger: false };
      }
    }
    
    // All slots in use - steal the one closest to our target
    // (it will need the smallest retuning anyway)
    let bestVictim = null;
    let bestDistance = Infinity;
    
    for (const slot of this._slots.values()) {
      if (slot.coords !== null) {
        const dist = Math.abs(targetMIDIFloat - slot.id);
        // Tie-breaker: prefer stealing older notes
        if (dist < bestDistance || 
            (dist === bestDistance && slot.lastUsed < bestVictim.lastUsed)) {
          bestDistance = dist;
          bestVictim = slot;
        }
      }
    }
    
    if (bestVictim) {
      const stolenKey = coordsKey(bestVictim.coords);
      this._active.delete(stolenKey);
      
      const stolen = bestVictim.coords;
      bestVictim.coords = coords;
      bestVictim.lastUsed = Date.now();
      this._active.set(key, bestVictim);

      console.log("voice_pool had to steal: ", ["slot:", bestVictimt.id, "stolen", "distance:", bestDistance, "retrigger: false"]);
      
      return { slot: bestVictim.id, stolen, distance: bestDistance, retrigger: false };
    }
    
    // Should never reach here
    return { slot: 0, stolen: null, distance: 0, retrigger: false };
  }

  /**
   * Release a slot.
   */
  noteOff(coords) {
    const key = coordsKey(coords);
    const slot = this._active.get(key);
    if (slot) {
      slot.coords = null;
      this._active.delete(key);
    }
  }

  /**
   * Clear all slots.
   */
  clear() {
    for (const slot of this._slots.values()) {
      slot.coords = null;
    }
    this._active.clear();
  }
}

function coordsKey(coords) {
  return `${coords.x},${coords.y}`;
}