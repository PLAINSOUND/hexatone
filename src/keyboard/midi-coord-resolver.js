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
 *                        midiin_anchor_note, center_degree,
 *                        midiin_steps_per_channel, octave_offset)
 *   hexCoordsToCents   – Keys.hexCoordsToCents bound to the live instance
 *   hexCoordsToScreen  – Keys.hexCoordsToScreen bound to the live instance
 *   getCenterpoint     – returns the live canvas centerpoint Point
 */

import Point from "./point.js";

function extendedGcd(a, b) {
  let oldR = Math.trunc(a);
  let r = Math.trunc(b);
  let oldS = 1;
  let s = 0;
  let oldT = 0;
  let t = 1;

  while (r !== 0) {
    const q = Math.trunc(oldR / r);
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }

  if (oldR < 0) {
    oldR = -oldR;
    oldS = -oldS;
    oldT = -oldT;
  }

  return { gcd: oldR, x: oldS, y: oldT };
}

export class MidiCoordResolver {
  /**
   * @param {object}   settings
   * @param {function} hexCoordsToCents  - (Point) → [cents, reducedSteps, distance, ...]
   * @param {function} hexCoordsToScreen - (Point) → Point  (hex → canvas pixels)
   * @param {function} getCenterpoint    - () → Point  (canvas half-dimensions)
   * @param {object}   [inputRuntime]    - Optional inputRuntime object; when provided,
   *                                       its stepsPerChannel/channelGroupSize/
   *                                       legacyChannelMode/seqAnchorChannel take precedence
   *                                       over the matching settings fields.
   * @param {function} [getFullyVisibleCoords] - Optional callback returning the
   *                                       renderer's cached fully visible hex coords.
   * @param {function} [hexCoordsToDisplayScreen] - Optional callback returning
   *                                       the rendered screen position after
   *                                       canvas transforms/rotation.
   */
  constructor(
    settings,
    hexCoordsToCents,
    hexCoordsToScreen,
    getCenterpoint,
    inputRuntime = null,
    getFullyVisibleCoords = null,
    hexCoordsToDisplayScreen = null,
  ) {
    this.settings = settings;
    this.inputRuntime = inputRuntime;
    this._hexCoordsToCents = hexCoordsToCents;
    this._hexCoordsToScreen = hexCoordsToScreen;
    this._getCenterpoint = getCenterpoint;
    this._getFullyVisibleCoords = getFullyVisibleCoords;
    this._hexCoordsToDisplayScreen = hexCoordsToDisplayScreen ?? hexCoordsToScreen;

    // Populated by buildStepsTable() — Map<steps: number, coords: Point[]>
    this.stepsTable = null;
    this.fullyVisibleStepsTable = null;
    this.preferredFullyVisibleCoordByStep = null;

    // Screen-space Point of the most recently activated MIDI note.
    // Updated by the caller (Keys) after each successful note-on.
    this.lastMidiCoords = null;

    // Sticky placement memory for non-2D inputs. Keys updates this after each
    // successful note-on so repeated notes from the same live input address can
    // stay in a stable screen region instead of following the last global note.
    this.lastCoordsByInputAddress = new Map();
  }

  _displayScreen(coords) {
    return this._hexCoordsToDisplayScreen(coords);
  }

  // ── Step arithmetic ──────────────────────────────────────────────────────────

  /**
   * Translate a MIDI channel number to a scale-degree transposition offset,
   * relative to the anchor channel (midiin_anchor_channel, default 1).
   *
   * This means:
   *   - Single-channel devices (AXIS-49, etc.) always play on ch 1 = anchor ch 1
   *     → offset is always 0, regardless of stepsPerChannel setting.
   *   - Multi-channel devices or keyboard splits: each channel group above/below
   *     the anchor shifts by stepsPerChannel (default: one equave).
   *   - The anchor note on the anchor channel always maps to center_degree,
   *     making Learn work correctly however many channels the device uses.
   *
   * With midiin_steps_per_channel === 0 (default): no transposition (all groups identical).
   * With midiin_steps_per_channel === null: one equave per group step (legacy UI option).
   * With midiin_steps_per_channel === N > 0: N degrees per group step.
   *
   * @param {number} channel  1-indexed MIDI channel
   * @returns {number}        integer scale-degree offset
   */
  channelToStepsOffset(channel) {
    // Prefer inputRuntime values when available (set at Keys construction time from
    // derived inputRuntime); fall back to raw settings for backwards compatibility.
    const ir = this.inputRuntime;
    const explicitStepsPerChannel = ir
      ? ir.stepsPerChannel
      : this.settings.midiin_steps_per_channel;
    const defaultStepsPerChannel = ir?.stepsPerChannelDefault ?? this.settings.equivSteps;
    const stepsPerChannel = explicitStepsPerChannel ?? defaultStepsPerChannel;
    const anchorChannel = (ir ? ir.seqAnchorChannel : this.settings.midiin_anchor_channel) ?? 1;
    const channelGroupSize = Math.max(
      1,
      (ir ? ir.channelGroupSize : this.settings.midiin_channel_group_size) ?? 1,
    );
    // Legacy mode: wrap channel into 1–8 before computing offset.
    // Allows Lumatone mappings that use channels 9–16 to be treated
    // identically to channels 1–8 (mod 8).  Default is true for
    // backward compatibility with older presets.
    const legacyMode = ir ? ir.legacyChannelMode : this.settings.midiin_channel_legacy;
    const effectiveChannel = legacyMode ? ((channel - 1) % 8) + 1 : channel;
    const effectiveAnchorChannel = legacyMode ? ((anchorChannel - 1) % 8) + 1 : anchorChannel;
    const groupIndex = Math.floor((effectiveChannel - 1) / channelGroupSize);
    const anchorGroupIndex = Math.floor((effectiveAnchorChannel - 1) / channelGroupSize);
    return (groupIndex - anchorGroupIndex) * stepsPerChannel;
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
    const ir = this.inputRuntime;
    const anchorNote =
      (ir ? ir.seqAnchorNote : (this.settings.midiin_anchor_note ?? this.settings.midiin_central_degree)) ?? 60;
    return (
      noteNumber -
      anchorNote +
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
    const max = Math.floor(Math.max(centerpoint.x, centerpoint.y) / this.settings.hexSize);
    const ox = this.settings.centerHexOffset.x + (this.settings.runtime_display_offset_x ?? 0);
    const oy = this.settings.centerHexOffset.y + (this.settings.runtime_display_offset_y ?? 0);

    this.stepsTable = new Map();
    this.fullyVisibleStepsTable = new Map();
    const fullyVisibleKeys = new Set(
      (this._getFullyVisibleCoords?.() ?? []).map((coords) => `${coords.x},${coords.y}`),
    );
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
        if (
          fullyVisibleKeys.size > 0
            ? fullyVisibleKeys.has(`${coords.x},${coords.y}`)
            : this._isFullyVisibleCoord(coords)
        ) {
          if (!this.fullyVisibleStepsTable.has(steps)) {
            this.fullyVisibleStepsTable.set(steps, []);
          }
          this.fullyVisibleStepsTable.get(steps).push(coords);
        }
      }
    }
    this._rebuildPreferredFullyVisibleCoords();
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

  stepsToFullyVisibleCoords(steps) {
    return this.fullyVisibleStepsTable?.get(steps) ?? [];
  }

  _rebuildPreferredFullyVisibleCoords() {
    this.preferredFullyVisibleCoordByStep = new Map();
    if (!this.fullyVisibleStepsTable || this.fullyVisibleStepsTable.size === 0) return;

    const centerpoint = this._getCenterpoint();
    const cx = centerpoint.x;
    const cy = centerpoint.y;
    const fullyVisibleSteps = [...this.fullyVisibleStepsTable.keys()].sort((a, b) => a - b);

    for (const step of fullyVisibleSteps) {
      const candidates = this.stepsToFullyVisibleCoords(step);
      if (candidates.length === 0) continue;
      if (candidates.length === 1) {
        this.preferredFullyVisibleCoordByStep.set(step, candidates[0]);
        continue;
      }

      let best = candidates[0];
      let bestVertical = Infinity;
      let bestHorizontal = Infinity;
      for (const coords of candidates) {
        const screen = this._displayScreen(coords);
        const vertical = Math.abs(screen.y - cy);
        const horizontal = Math.abs(screen.x - cx);
        if (
          vertical < bestVertical ||
          (vertical === bestVertical && horizontal < bestHorizontal)
        ) {
          bestVertical = vertical;
          bestHorizontal = horizontal;
          best = coords;
        }
      }
      this.preferredFullyVisibleCoordByStep.set(step, best);
    }
  }

  /**
   * When a step target is outside the currently visible grid, synthesize a
   * lattice coordinate for the exact step count instead of failing outright.
   * This is important for dense scales in Nearest Scale Degree mode, where the
   * visible register can be much smaller than the incoming MIDI range.
   *
   * @param {number} steps
   * @returns {Point|null}
   */
  _inputAddressKey(inputAddress) {
    if (!inputAddress) return null;
    const channel = inputAddress.channel ?? "";
    const note = inputAddress.note ?? "";
    const rawChannel = inputAddress.rawChannel ?? "";
    return `${channel}:${note}:${rawChannel}`;
  }

  _preferredAnchorPoint(inputAddress) {
    const key = this._inputAddressKey(inputAddress);
    const sticky = key ? this.lastCoordsByInputAddress.get(key) ?? null : null;
    return sticky ?? this.lastMidiCoords;
  }

  _stickyAnchorPoint(inputAddress) {
    const key = this._inputAddressKey(inputAddress);
    return key ? this.lastCoordsByInputAddress.get(key) ?? null : null;
  }

  rememberCoordsForInputAddress(inputAddress, coords) {
    const key = this._inputAddressKey(inputAddress);
    if (!key || !coords) return;
    this.lastCoordsByInputAddress.set(key, this._displayScreen(coords));
  }

  forgetCoordsForInputAddress(inputAddress) {
    const key = this._inputAddressKey(inputAddress);
    if (!key) return;
    this.lastCoordsByInputAddress.delete(key);
  }

  clearInputAddressMemory() {
    this.lastCoordsByInputAddress.clear();
  }

  _canvasBounds() {
    const centerpoint = this._getCenterpoint();
    return {
      left: 0,
      top: 0,
      right: centerpoint.x * 2,
      bottom: centerpoint.y * 2,
    };
  }

  _hexExtents() {
    const hexSize = Number(this.settings.hexSize) || 0;
    const hexWidth = Number(this.settings.hexWidth) || Math.sqrt(3) * hexSize;
    return {
      halfWidth: hexWidth / 2,
      halfHeight: hexSize,
    };
  }

  _isFullyVisibleCoord(coords) {
    const screen = this._displayScreen(coords);
    const bounds = this._canvasBounds();
    const extents = this._hexExtents();
    return (
      screen.x - extents.halfWidth >= bounds.left &&
      screen.x + extents.halfWidth <= bounds.right &&
      screen.y - extents.halfHeight >= bounds.top &&
      screen.y + extents.halfHeight <= bounds.bottom
    );
  }

  fallbackCoordForSteps(steps, inputAddress = null) {
    const rSteps = Math.trunc(this.settings.rSteps);
    const drSteps = Math.trunc(this.settings.drSteps);
    const { gcd, x, y } = extendedGcd(rSteps, drSteps);
    if (!gcd || steps % gcd !== 0) return null;

    const scale = steps / gcd;
    const baseX = x * scale;
    const baseY = y * scale;
    const shiftX = drSteps / gcd;
    const shiftY = -rSteps / gcd;

    const centerpoint = this._getCenterpoint();
    const cx = centerpoint.x;
    const cy = centerpoint.y;
    const DECAY = 0.15;
    const last = this._preferredAnchorPoint(inputAddress);
    const anchorX = last ? last.x + DECAY * (cx - last.x) : cx;
    const anchorY = last ? last.y + DECAY * (cy - last.y) : cy;

    const basePoint = new Point(baseX, baseY);
    const baseScreen = this._displayScreen(basePoint);
    const deltaPoint = new Point(baseX + shiftX, baseY + shiftY);
    const deltaScreen = this._displayScreen(deltaPoint);
    const stepX = deltaScreen.x - baseScreen.x;
    const stepY = deltaScreen.y - baseScreen.y;
    const denom = stepX * stepX + stepY * stepY;

    if (denom === 0) return basePoint;

    const kReal =
      ((anchorX - baseScreen.x) * stepX + (anchorY - baseScreen.y) * stepY) / denom;
    const kBase = Math.round(kReal);

    let best = null;
    let bestDist = Infinity;
    for (let dk = -1; dk <= 1; dk++) {
      const k = kBase + dk;
      const coords = new Point(baseX + shiftX * k, baseY + shiftY * k);
      const screen = this._displayScreen(coords);
      const dx = screen.x - anchorX;
      const dy = screen.y - anchorY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = coords;
      }
    }
    return best;
  }

  coordForSteps(steps, inputAddress = null) {
    return this.bestVisibleCoord(steps, inputAddress) ?? this.fallbackCoordForSteps(steps, inputAddress);
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
  bestVisibleCoord(steps, inputAddress = null) {
    const fullyVisibleCandidates = this.stepsToFullyVisibleCoords(steps);
    const candidates = fullyVisibleCandidates.length > 0
      ? fullyVisibleCandidates
      : this.stepsToVisibleCoords(steps);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const centerpoint = this._getCenterpoint();
    const cx = centerpoint.x;
    const cy = centerpoint.y;

    // Decay anchor 15% back toward centre each note.
    const DECAY = 0.15;
    const last = this._preferredAnchorPoint(inputAddress);
    const anchorX = last ? last.x + DECAY * (cx - last.x) : cx;
    const anchorY = last ? last.y + DECAY * (cy - last.y) : cy;
    const stickyScreen = this._stickyAnchorPoint(inputAddress);

    if (stickyScreen) {
      const exactSticky = candidates.find((coords) => {
        const s = this._displayScreen(coords);
        return s.x === stickyScreen.x && s.y === stickyScreen.y;
      });
      if (exactSticky) return exactSticky;
    }

    if (fullyVisibleCandidates.length > 0) {
      const preferred = this.preferredFullyVisibleCoordByStep?.get(steps) ?? null;
      if (preferred) {
        const exactPreferred = fullyVisibleCandidates.find((coords) => coords.equals(preferred));
        if (exactPreferred) return exactPreferred;
      }
    }

    // Prefer a stable central band so non-2D controllers tend to stay on-screen
    // and avoid drifting to edge registers when central choices exist.
    const centralBandCandidates = (fraction) => {
      const gate = fraction * Math.min(cx, cy);
      const gate2 = gate * gate;
      return candidates.filter((coords) => {
        const s = this._displayScreen(coords);
        const dx = s.x - cx;
        const dy = s.y - cy;
        return dx * dx + dy * dy <= gate2;
      });
    };

    let pool = centralBandCandidates(0.6);
    if (pool.length === 0) pool = centralBandCandidates(0.8);
    if (pool.length === 0) pool = candidates;

    // Pick the pool member nearest the preferred sticky anchor, with a light
    // center bias so the placement stays in the main on-screen register band.
    let best = null;
    let bestDist = Infinity;
    for (const coords of pool) {
      const s = this._displayScreen(coords);
      const anchorDx = s.x - anchorX;
      const anchorDy = s.y - anchorY;
      const centerDx = s.x - cx;
      const centerDy = s.y - cy;
      const anchorDist = anchorDx * anchorDx + anchorDy * anchorDy;
      const centerDist = centerDx * centerDx + centerDy * centerDy;
      const score = anchorDist + centerDist * 0.08;
      if (score < bestDist) {
        bestDist = score;
        best = coords;
      }
    }
    return best;
  }
}
