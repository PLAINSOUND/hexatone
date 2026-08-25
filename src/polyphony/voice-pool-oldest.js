/**
 * src/polyphony/voice-pool-oldest.js
 *
 * MPE voice allocator used by the per-channel synth outputs.
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
 * The optional musical-steal mode preserves chord structure when SOUNDING
 * voice stealing is unavoidable. It prefers an interior octave duplication,
 * then the voice nearest the chord's register centre. The upper two and lower
 * two distinct pitches form a protected register frame: this preserves a top
 * melody beneath a sustained discant as well as the bass line.
 *
 * No "clean channel" reservation is needed because the correct PB is always
 * sent synchronously before noteOn.
 */
export class VoicePool {
  /**
   * @param {number[]} slotIds          – 1-based MIDI channel numbers
   * @param {number}   releaseGuardMs   – ms to hold a channel in RELEASING
   *                                      state before it becomes IDLE again
   *                                      (should match synth release time; default 300)
   * @param {boolean}  closestPitchSteal – legacy option name; when true, use
   *                                       chord-aware musical stealing (default false)
   */
  constructor(slotIds, releaseGuardMs = 300, closestPitchSteal = false) {
    this._allSlots = [...slotIds];
    this._releaseGuardMs = releaseGuardMs;
    this._closestPitch = closestPitchSteal;

    // Per-channel state
    // state: 'IDLE' | 'SOUNDING' | 'RELEASING'
    this._state = new Map(); // slot → state
    this._noteOffAt = new Map(); // slot → timestamp (ms) when noteOff was sent
    this._releaseToken = new Map(); // slot → allocation token that entered RELEASING
    this._idleQueue = [...slotIds]; // FIFO: front = next to use, back = most recently released
    this._lastBend = new Map(); // slot → last bend value (14-bit unsigned)
    this._lastNote = new Map(); // slot → last MIDI note number
    this._lastPitch = new Map(); // slot → actual fractional MIDI pitch
    this._nextAllocationToken = 1;

    // Active voice linked list (oldest head → newest tail)
    this._active = new Map(); // coordsKey → entry { key, coords, slot, allocationToken, prev, next }
    this._head = null;
    this._tail = null;

    for (const s of slotIds) {
      this._state.set(s, "IDLE");
      this._lastBend.set(s, 8192);
      this._lastNote.set(s, 60);
      this._lastPitch.set(s, 60);
    }
  }

  /**
   * Allocate a channel for a new note at `coords`.
   *
   * Returns:
   *  { slot, allocationToken, stolen, stolenSlot, stolenNote, retrigger }
   *
   *  stolen     – coords of the killed note (null if no steal)
   *  stolenSlot – channel of the killed note (null if no steal)
   *  stolenNote – MIDI note of the killed note (null if no steal)
   *  retrigger  – true if coords was already active (moved to tail)
   *
   * The caller is responsible for sending PB(newBend) then noteOn to `slot`.
   * Do NOT send a PB reset to any channel — let releasing tails decay.
   */
  noteOn(coords, incomingBend = 8192, incomingNote = null, incomingPitch = null) {
    const key = coordsKey(coords);

    // Retrigger: note already active, just refresh its position in the LRU list
    if (this._active.has(key)) {
      const entry = this._active.get(key);
      entry.allocationToken = this._nextAllocationToken++;
      this._moveToTail(entry);
      return {
        slot: entry.slot,
        allocationToken: entry.allocationToken,
        stolen: null,
        stolenSlot: null,
        stolenNote: null,
        retrigger: true,
      };
    }

    // Expire any RELEASING channels that have passed the guard time
    this._expireReleasing();

    let slot = null;
    let stolen = null,
      stolenSlot = null,
      stolenNote = null;
    // 1. Take from front of idle queue — round-robin by release order.
    if (this._idleQueue.length > 0) slot = this._idleQueue.shift();

    // 2. Reuse the oldest RELEASING channel. Its tail is already decaying;
    // callers deliberately avoid CC120 so output patches can release naturally.
    if (slot === null) {
      let oldestTime = Infinity,
        oldestSlot = null;
      for (const [s, t] of this._noteOffAt) {
        if (this._state.get(s) === "RELEASING" && t < oldestTime) {
          oldestTime = t;
          oldestSlot = s;
        }
      }
      if (oldestSlot !== null) {
        slot = oldestSlot;
        stolenSlot = oldestSlot; // expose to caller
        this._noteOffAt.delete(oldestSlot);
        // Remove from idle queue if it somehow got re-queued
        const qi = this._idleQueue.indexOf(oldestSlot);
        if (qi !== -1) this._idleQueue.splice(qi, 1);
      }
    }

    // 3. Steal — prefer oldest RELEASING over SOUNDING to preserve live notes.
    if (slot === null) {
      let victim = null;

      // 3a. Prefer stealing oldest RELEASING (tail already decaying).
      //     After _expireReleasing() some RELEASING channels may still remain.
      let oldestRelTime = Infinity;
      for (const [s, t] of this._noteOffAt) {
        if (this._state.get(s) === "RELEASING" && t < oldestRelTime) {
          oldestRelTime = t;
          victim = { slot: s, coords: null, key: null };
        }
      }

      // 3b. Fall back to stealing a SOUNDING voice.
      if (victim === null || victim.coords === null) {
        victim = this._closestPitch
          ? this._musicalVictim(incomingPitch ?? incomingNote, incomingBend)
          : this._head;
        if (!victim) throw new Error("VoicePool: no channels available");
        stolen = victim.coords;
        stolenNote = this._lastNote.get(victim.slot) ?? 60;
        this._remove(victim);
        this._active.delete(victim.key);
      }

      stolenSlot = victim.slot;
      slot = victim.slot;
      this._noteOffAt.delete(slot); // clear RELEASING state
      this._releaseToken.delete(slot);
    }

    // Register the new voice
    const entry = {
      key,
      coords,
      slot,
      allocationToken: this._nextAllocationToken++,
      prev: this._tail,
      next: null,
    };
    if (this._tail) this._tail.next = entry;
    this._tail = entry;
    if (!this._head) this._head = entry;
    this._active.set(key, entry);
    this._state.set(slot, "SOUNDING");
    this._releaseToken.delete(slot);

    return {
      slot,
      allocationToken: entry.allocationToken,
      stolen,
      stolenSlot,
      stolenNote,
      retrigger: false,
    };
  }

  /**
   * Release the channel assigned to `coords`.
   * Marks it RELEASING (not immediately available) to let the tail decay.
   * Returns the slot, or null if coords wasn't active.
   */
  noteOff(coords, allocationToken = null) {
    const key = coordsKey(coords);
    const entry = this._active.get(key);
    if (!entry) return null;
    if (allocationToken !== null && entry.allocationToken !== allocationToken) return null;

    const slot = entry.slot;
    this._remove(entry);
    this._active.delete(key);

    // Mark RELEASING — will become IDLE after releaseGuardMs
    this._state.set(slot, "RELEASING");
    this._noteOffAt.set(slot, performance.now());
    this._releaseToken.set(slot, entry.allocationToken);

    return slot;
  }

  /** Returns the current state of a slot: 'IDLE' | 'SOUNDING' | 'RELEASING'. */
  getChannelState(slot) {
    return this._state.get(slot) ?? "IDLE";
  }

  /**
   * Complete the exact release generation that scheduled deferred cleanup.
   * Returns false if the channel was reallocated or released again meanwhile.
   */
  completeRelease(slot, allocationToken) {
    const state = this._state.get(slot);
    if (
      (state !== "RELEASING" && state !== "IDLE") ||
      this._releaseToken.get(slot) !== allocationToken
    ) {
      return false;
    }
    this._state.set(slot, "IDLE");
    this._noteOffAt.delete(slot);
    this._releaseToken.delete(slot);
    if (!this._idleQueue.includes(slot)) this._idleQueue.push(slot);
    return true;
  }

  /** Called by the synth to record the bend that was sent to a channel. */
  setLastBend(slot, bend) {
    this._lastBend.set(slot, bend);
  }
  getLastBend(slot) {
    return this._lastBend.get(slot) ?? 8192;
  }

  /** Called by the synth to record the MIDI note sent to a channel. */
  setLastNote(slot, note) {
    this._lastNote.set(slot, note);
  }
  getLastNote(slot) {
    return this._lastNote.get(slot) ?? 60;
  }

  setLastPitch(slot, pitch) {
    if (Number.isFinite(Number(pitch))) this._lastPitch.set(slot, Number(pitch));
  }

  getLastPitch(slot) {
    return this._lastPitch.get(slot) ?? this.getLastNote(slot);
  }

  getSlot(coords) {
    const entry = this._active.get(coordsKey(coords));
    return entry ? entry.slot : null;
  }

  /**
   * True only for the exact allocation that currently owns this coordinate
   * and channel. The token distinguishes same-coordinate retriggers, where
   * channel and coordinate alone are not sufficient ownership identifiers.
   */
  owns(coords, slot, allocationToken) {
    const entry = this._active.get(coordsKey(coords));
    return entry?.slot === slot && entry?.allocationToken === allocationToken;
  }

  get activeCount() {
    return this._active.size;
  }
  get freeCount() {
    return this._idleQueue.length;
  }

  /**
   * Whether a new allocation can use an IDLE or RELEASING channel without
   * evicting a currently sounding voice. Buffered sequencer continuations use
   * this before attempting recovery so a recovered note can never suppress a
   * newly attacked note.
   */
  canAllocateWithoutSoundingSteal() {
    this._expireReleasing();
    if (this._idleQueue.length > 0) return true;
    for (const [slot, state] of this._state) {
      if (state === "RELEASING" && this._noteOffAt.has(slot)) return true;
    }
    return false;
  }

  /**
   * Kill all active voices. Returns array of {coords, slot} for each.
   * Caller is responsible for sending noteOff to each slot.
   */
  clear() {
    const victims = Array.from(this._active.values()).map((e) => ({
      coords: e.coords,
      slot: e.slot,
    }));
    this._active.clear();
    this._head = null;
    this._tail = null;
    for (const s of this._allSlots) {
      this._state.set(s, "IDLE");
      this._noteOffAt.delete(s);
      this._releaseToken.delete(s);
    }
    this._idleQueue = [...this._allSlots];
    return victims;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  _expireReleasing() {
    const now = performance.now();
    for (const [s, t] of this._noteOffAt) {
      if (this._state.get(s) === "RELEASING" && now - t >= this._releaseGuardMs) {
        this._state.set(s, "IDLE");
        this._noteOffAt.delete(s);
        // Keep the generation token until its deferred cleanup runs. A later
        // allocation removes it, preventing that old cleanup from resetting a
        // channel that has already begun another note.
        this._idleQueue.push(s); // back of queue — used last, true round-robin
      }
    }
  }

  _musicalVictim(incomingNote, targetBend) {
    const sounding = [];
    let node = this._head;
    while (node) {
      if (this._state.get(node.slot) === "SOUNDING") sounding.push(node);
      node = node.next;
    }
    if (!sounding.length) return null;

    const safeIncoming = Number.isFinite(Number(incomingNote)) ? Number(incomingNote) : null;
    if (safeIncoming == null) return this._closestBendVictim(targetBend, sounding);

    const entries = sounding.map((candidate) => ({
      candidate,
      note: this.getLastPitch(candidate.slot),
    }));
    const allNotes = entries.map(({ note }) => note).concat(safeIncoming);
    const low = Math.min(...allNotes);
    const high = Math.max(...allNotes);
    const centre = (low + high) / 2;
    const samePitch = (a, b) => Math.abs(a - b) < 0.01;
    const samePitchClass = (a, b) => {
      const octaves = (a - b) / 12;
      return Math.abs(octaves - Math.round(octaves)) < 0.001;
    };
    const distinctNotes = [...allNotes]
      .sort((a, b) => a - b)
      .filter((note, index, sorted) => index === 0 || !samePitch(note, sorted[index - 1]));
    const protectedRegister = new Set([
      ...distinctNotes.slice(0, 2),
      ...distinctNotes.slice(-2),
    ]);

    let best = null;
    let bestRank = Infinity;
    let bestDistance = Infinity;
    for (const { candidate, note } of entries) {
      // Protect two distinct voices at either register boundary. This keeps a
      // moving melody immediately below a long discant, rather than treating
      // that melody as disposable interior harmony. Removing one of several
      // identical boundary notes is still safe because the pitch remains.
      const protectedOuter =
        [...protectedRegister].some((boundary) => samePitch(note, boundary)) &&
        allNotes.filter((other) => samePitch(note, other)).length === 1;
      const duplicatedPitchClass =
        allNotes.filter((other) => samePitchClass(note, other)).length > 1;
      const rank = !protectedOuter
        ? duplicatedPitchClass
          ? 0
          : 1
        : duplicatedPitchClass
          ? 2
          : 3;
      const distance = Math.abs(note - centre);
      if (rank < bestRank || (rank === bestRank && distance < bestDistance)) {
        best = candidate;
        bestRank = rank;
        bestDistance = distance;
      }
    }
    return best;
  }

  _closestBendVictim(targetBend, candidates = null) {
    const pool = candidates ?? Array.from(this._active.values());
    let best = null;
    let bestDist = Infinity;
    for (const candidate of pool) {
      if (this._state.get(candidate.slot) !== "SOUNDING") continue;
      const dist = Math.abs((this._lastBend.get(candidate.slot) ?? 8192) - targetBend);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
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
  if (Array.isArray(coords)) return coords.join(",");
  if (coords !== null && typeof coords === "object" && "x" in coords && "y" in coords)
    return `${coords.x},${coords.y}`;
  return String(coords);
}
