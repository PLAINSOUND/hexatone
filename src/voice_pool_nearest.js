/**
 * VoicePool — note-number-aware allocator for MTS synths.
 *
 * Allocates the carrier MIDI note nearest to the target pitch, preserving
 * the timbre character of physical-modelling synths where note number
 * affects body resonance, string tension, etc.
 *
 * When stealing is required it picks the active voice whose carrier note
 * is nearest to the incoming pitch, minimising retuning distance and the
 * audible artifact on the stolen note's tail.
 *
 * Changes from previous version:
 *  - Pre-built Set for O(1) membership test (was O(n) array.includes)
 *  - Spiral search works directly on the Set, no intermediate array per call
 *  - noteOn returns stolenSlot so caller can send noteOff to the right note
 *  - clear() returns victims array consistent with MPE VoicePool API
 */
export class VoicePool {
  /**
   * @param {number[]} slotIds  Available MIDI note numbers (0–127 for MTS1)
   */
  constructor(slotIds, releaseGuardMs = 0) {
    this._allSlots = [...slotIds];
    this._slotSet  = new Set(slotIds);    // O(1) membership — built once
    this._releaseGuardMs = Math.max(0, Number(releaseGuardMs) || 0);

    // Per-slot state: null = free, otherwise the coords currently playing
    this._coords   = new Map();           // slot → coords | null
    this._lastUsed = new Map();           // slot → timestamp (ms)
    this._releasedAt = new Map();         // slot → release timestamp (ms)
    for (const s of slotIds) {
      this._coords.set(s, null);
      this._lastUsed.set(s, 0);
      this._releasedAt.set(s, 0);
    }

    // Fast reverse lookup: coordsKey → slot
    this._active = new Map();
  }

  /**
   * Allocate a carrier note for a new note at `coords`.
   *
   * Searches outward from `targetMIDIFloat` for a free slot.
   * If none free, steals the active slot nearest to `targetMIDIFloat`
   * (smallest retuning distance), tiebroken by oldest lastUsed.
   *
   * @param {Object} coords          Hex coordinates
   * @param {number} targetMIDIFloat Target pitch as float MIDI note (e.g. 60.37)
   * @returns {{ slot, stolenSlot, stolen, distance, retrigger }}
   *   slot        — allocated carrier note number
   *   stolenSlot  — carrier note of the killed voice (null if no steal)
   *   stolen      — coords of the killed voice (null if no steal)
   *   distance    — semitones between target and allocated carrier
   *   retrigger   — true if coords was already active
   */
  noteOn(coords, targetMIDIFloat) {
    const key = coordsKey(coords);
    const now = Date.now();

    // Retrigger: already active, refresh timestamp
    if (this._active.has(key)) {
      const slot = this._active.get(key);
      this._lastUsed.set(slot, now);
      return { slot, stolenSlot: null, stolen: null, distance: 0, retrigger: true };
    }

    const target = Math.round(targetMIDIFloat);

    // Spiral outward from target: try target±0, target±1, target±2 …
    // Uses pre-built Set — no intermediate array, O(1) per probe.
    const allocateFreeSlot = (allowGuarded) => {
      for (let offset = 0; offset <= 127; offset++) {
        const candidates = offset === 0
          ? [target]
          : Math.abs(targetMIDIFloat - (target + offset)) <= Math.abs(targetMIDIFloat - (target - offset))
            ? [target + offset, target - offset]
            : [target - offset, target + offset];
        for (const candidate of candidates) {
          if (candidate < 0 || candidate > 127) continue;
          if (!this._slotSet.has(candidate)) continue;
          if (this._coords.get(candidate) !== null) continue;
          if (!allowGuarded && this._isSlotGuarded(candidate, now)) continue;

          this._coords.set(candidate, coords);
          this._lastUsed.set(candidate, now);
          this._active.set(key, candidate);
          return {
            slot: candidate,
            stolenSlot: null,
            stolen: null,
            distance: Math.abs(targetMIDIFloat - candidate),
            retrigger: false,
          };
        }
      }
      return null;
    };

    const freeSlot = allocateFreeSlot(false) ?? allocateFreeSlot(true);
    if (freeSlot) {
      return freeSlot;
    }

    // No free slot — steal the active note nearest to target (smallest retuning)
    // Tiebreak: prefer older notes (lower lastUsed)
    let victimSlot = null;
    let bestDist   = Infinity;
    let bestAge    = Infinity;

    for (const slot of this._allSlots) {
      if (this._coords.get(slot) === null) continue; // free (shouldn't happen here)
      const dist = Math.abs(targetMIDIFloat - slot);
      const age  = this._lastUsed.get(slot);
      if (dist < bestDist || (dist === bestDist && age < bestAge)) {
        bestDist = dist; bestAge = age; victimSlot = slot;
      }
    }

    if (victimSlot === null) {
      // Should never happen; defensive fallback
      console.warn('VoicePool: no slots available');
      return { slot: target, stolenSlot: null, stolen: null, distance: 0, retrigger: false };
    }

    const stolenCoords = this._coords.get(victimSlot);
    const stolenKey    = coordsKey(stolenCoords);

    this._active.delete(stolenKey);
    this._coords.set(victimSlot, coords);
    this._lastUsed.set(victimSlot, Date.now());
    this._active.set(key, victimSlot);

    return {
      slot: victimSlot,
      stolenSlot: victimSlot,  // same number — it IS the carrier note for noteOff
      stolen: stolenCoords,
      distance: bestDist,
      retrigger: false,
    };
  }

  /** Release the slot assigned to `coords`. */
  noteOff(coords) {
    const key  = coordsKey(coords);
    const slot = this._active.get(key);
    if (slot == null) return null;
    this._coords.set(slot, null);
    this._releasedAt.set(slot, Date.now());
    this._active.delete(key);
    return slot;
  }

  /** Return the carrier note number for `coords`, or null if not active. */
  getSlot(coords) {
    return this._active.get(coordsKey(coords)) ?? null;
  }

  /**
   * Release all voices and return an array of { coords, slot } for each,
   * so the caller can send noteOff messages.
   */
  clear() {
    const victims = [];
    for (const [key, slot] of this._active) {
      victims.push({ coords: this._coords.get(slot), slot });
    }
    for (const s of this._allSlots) {
      this._coords.set(s, null);
      this._releasedAt.set(s, 0);
    }
    this._active.clear();
    return victims;
  }

  _isSlotGuarded(slot, now) {
    if (this._releaseGuardMs <= 0) return false;
    return (now - (this._releasedAt.get(slot) ?? 0)) < this._releaseGuardMs;
  }

  get activeCount() { return this._active.size; }
  get freeCount()   { return this._allSlots.filter(s => this._coords.get(s) === null).length; }
}

function coordsKey(coords) {
  if (coords === null || coords === undefined) return 'null';
  if (Array.isArray(coords)) return coords.join(',');
  if (typeof coords === 'object' && 'x' in coords) return `${coords.x},${coords.y}`;
  return String(coords);
}
