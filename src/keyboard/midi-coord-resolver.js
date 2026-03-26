/**
 * midi-coord-resolver.js
 *
 * Maps incoming MIDI note/channel pairs to hex-grid coordinates.
 *
 * Two resolution paths:
 *
 *   Step arithmetic  — for sequential / bypass mode and unknown controllers.
 *     noteToSteps(note, channel) → scale-degree distance from origin (integer).
 *     bestVisibleCoord(steps)    → the on-screen Point closest to the recent anchor.
 *     stepsToVisibleCoords(steps)→ all on-screen Points at that distance (for note-off).
 *
 *   Controller map   — for known 2D isomorphic controllers (pre-built in Keys constructor).
 *     Lookup is O(1) via a Map<"ch.note", Point>; no arithmetic needed.
 *     Callers do the lookup directly; this module only covers the arithmetic path.
 *
 * buildStepsTable() must be called once after the canvas is sized (via resizeHandler)
 * and again whenever the layout changes.  It pre-computes a Map<steps, Point[]>
 * covering all on-screen hexes — the same range as drawGrid() — so every lit hex
 * is guaranteed to have an entry.
 *
 * Dependencies injected at construction time (no direct import of Keys):
 *   settings           – layout snapshot (rSteps, drSteps, scale, equivSteps,
 *                        equivInterval, hexSize, centerHexOffset,
 *                        midiin_central_degree, center_degree,
 *                        midiin_steps_per_channel, octave_offset)
 *   hexCoordsToCents   – Keys.hexCoordsToCents bound to the live instance
 *   hexCoordsToScreen  – Keys.hexCoordsToScreen bound to the live instance
 *   getCenterpoint     – returns the live canvas centerpoint Point
 */

import Point from "./point.js";

export class MidiCoordResolver {
  /**
   * @param {object}   settings
   * @param {function} hexCoordsToCents  - (Point) → [cents, reducedSteps, distance, ...]
   * @param {function} hexCoordsToScreen - (Point) → Point  (hex → canvas pixels)
   * @param {function} getCenterpoint    - () → Point  (canvas half-dimensions)
   */
  constructor(settings, hexCoordsToCents, hexCoordsToScreen, getCenterpoint) {
    this.settings         = settings;
    this._hexCoordsToCents  = hexCoordsToCents;
    this._hexCoordsToScreen = hexCoordsToScreen;
    this._getCenterpoint    = getCenterpoint;

    // Populated by buildStepsTable() — Map<steps: number, coords: Point[]>
    this.stepsTable = null;

    // Screen-space Point of the most recently activated MIDI note.
    // Updated by the caller (Keys) after each successful note-on.
    this.lastMidiCoords = null;
  }

  // ── Step arithmetic ──────────────────────────────────────────────────────────

  /**
   * Translate a MIDI channel number to a scale-degree transposition offset,
   * relative to the anchor channel (midiin_anchor_channel, default 1).
   *
   * This means:
   *   - Single-channel devices (AXIS-49, etc.) always play on ch 1 = anchor ch 1
   *     → offset is always 0, regardless of stepsPerChannel setting.
   *   - Multi-channel devices or keyboard splits: each channel above/below the
   *     anchor shifts by stepsPerChannel (default: one equave).
   *   - The anchor note on the anchor channel always maps to center_degree,
   *     making Learn work correctly however many channels the device uses.
   *
   * With midiin_steps_per_channel === null (default): one equave per channel step.
   * With midiin_steps_per_channel === 0: no transposition (all channels identical).
   * With midiin_steps_per_channel === N: N degrees per channel step.
   *
   * @param {number} channel  1-indexed MIDI channel
   * @returns {number}        integer scale-degree offset
   */
  channelToStepsOffset(channel) {
    const stepsPerChannel =
      this.settings.midiin_steps_per_channel ?? this.settings.equivSteps;
    const anchorChannel = this.settings.midiin_anchor_channel ?? 1;
    // Legacy mode: wrap channel into 1–8 before computing offset.
    // Allows Lumatone mappings that use channels 9–16 to be treated
    // identically to channels 1–8 (mod 8).  Default is true for
    // backward compatibility with older presets.
    const effectiveChannel = this.settings.midiin_channel_legacy
      ? ((channel - 1) % 8) + 1
      : channel;
    return (effectiveChannel - anchorChannel) * stepsPerChannel;
  }

  /**
   * Convert a MIDI note + channel to the scale-degree distance from the origin
   * (the "steps" key used in stepsTable).
   *
   * The anchor note on the anchor channel maps exactly to center_degree.
   *
   * @param {number} noteNumber  0–127
   * @param {number} channel     1-indexed MIDI channel
   * @returns {number}           integer scale-degree distance
   */
  noteToSteps(noteNumber, channel) {
    return (
      (noteNumber - this.settings.midiin_central_degree) +
      (this.settings.center_degree || 0) +
      this.channelToStepsOffset(channel)
    );
  }

  // ── Steps table ──────────────────────────────────────────────────────────────

  /**
   * Pre-compute a Map<steps, Point[]> covering all visible hexes.
   * Must be called after the canvas is sized (resizeHandler) and whenever
   * the layout changes.  Keys calls this via resizeHandler.
   */
  buildStepsTable() {
    const centerpoint = this._getCenterpoint();
    const max = Math.floor(
      Math.max(centerpoint.x, centerpoint.y) / this.settings.hexSize,
    );
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;

    this.stepsTable = new Map();
    for (let r = -max + ox; r < max + ox; r++) {
      for (let dr = -max + oy; dr < max + oy; dr++) {
        const coords = new Point(r, dr);
        // hexCoordsToCents returns [cents, reducedSteps, distance, ...];
        // 'distance' (index 2) is the raw step count from the origin — our key.
        const [, , steps] = this._hexCoordsToCents(coords);
        if (!this.stepsTable.has(steps)) {
          this.stepsTable.set(steps, []);
        }
        this.stepsTable.get(steps).push(coords);
      }
    }
  }

  /**
   * Returns all visible coords for a given steps value, or [] if none on screen.
   * Used by midinoteOff / allnotesOff to find which coord was activated.
   *
   * @param {number} steps
   * @returns {Point[]}
   */
  stepsToVisibleCoords(steps) {
    return this.stepsTable?.get(steps) ?? [];
  }

  // ── Best-coord selection ─────────────────────────────────────────────────────

  /**
   * Returns the single best on-screen coord for a note-on.
   *
   * Strategy: decaying anchor + radius gate.
   *
   * The anchor starts at lastMidiCoords and is pulled 15% back toward screen
   * centre on every call, so a melodic run stays local while an edge drift is
   * continuously corrected.  Candidates outside 75% of the screen half-dimension
   * are filtered out first (gate); if every candidate is outside the gate we
   * fall back to the full set so there is always a result.  Among survivors,
   * pick the one nearest the anchor.
   *
   * Returns null only when no candidates exist at all (steps off-screen).
   *
   * @param {number} steps
   * @returns {Point|null}
   */
  bestVisibleCoord(steps) {
    const candidates = this.stepsToVisibleCoords(steps);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const centerpoint = this._getCenterpoint();
    const cx = centerpoint.x;
    const cy = centerpoint.y;

    // Decay anchor 15% back toward centre each note.
    const DECAY = 0.15;
    const last = this.lastMidiCoords;
    const anchorX = last ? last.x + DECAY * (cx - last.x) : cx;
    const anchorY = last ? last.y + DECAY * (cy - last.y) : cy;

    // Gate: exclude candidates beyond 75% of the smaller half-dimension.
    const GATE_FRACTION = 0.75;
    const gate = GATE_FRACTION * Math.min(cx, cy);
    const gate2 = gate * gate;

    let pool = candidates.filter((coords) => {
      const s = this._hexCoordsToScreen(coords);
      const dx = s.x - cx;
      const dy = s.y - cy;
      return dx * dx + dy * dy <= gate2;
    });

    // Safety fallback: if every candidate is outside the gate use them all.
    if (pool.length === 0) pool = candidates;

    // Pick the pool member nearest the decayed anchor.
    let best = null;
    let bestDist = Infinity;
    for (const coords of pool) {
      const s = this._hexCoordsToScreen(coords);
      const dx = s.x - anchorX;
      const dy = s.y - anchorY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = coords;
      }
    }
    return best;
  }
}
