// This module owns WebMidi listener binding and low-level incoming MIDI event
// handling for Keys. It wires controller detection, note/expression listeners,
// and controller-specific behaviors such as LinnStrument UF X glide. It does
// not own harmonic frame derivation or canvas rendering directly.

import Point from "../keyboard/point.js";
import { WebMidi } from "webmidi";
import { keymap, notes } from "../midi_synth";
import { detectController, getAnchorNote, getControllerById } from "../controllers/registry.js";
import { debugLog } from "../debug/logging.js";

const MIDI_INPUT_EVENT_NAMES = [
  "noteon",
  "noteoff",
  "keyaftertouch",
  "controlchange",
  "channelaftertouch",
  "pitchbend",
  "sysex",
];
const LINNSTRUMENT_UF_X_OUTLIER_THRESHOLD = 10;
const LINNSTRUMENT_UF_X_CONFIRM_TOLERANCE = 4;
const LINNSTRUMENT_UF_LOW_PRESSURE_THRESHOLD = 40;
const LINNSTRUMENT_UF_MID_PRESSURE_THRESHOLD = 50;
const LINNSTRUMENT_UF_VERY_LOW_PRESSURE_THRESHOLD = 20;
const LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT = 25;
const LINNSTRUMENT_UF_X_INPUT_SMOOTHING_DEFAULT = 80;
const LINNSTRUMENT_UF_LSB_CENTER = 64;
const LINNSTRUMENT_UF_RELEASE_HOLD_THRESHOLD = 14;
const LINNSTRUMENT_UF_RELEASE_HOLD_ARM_THRESHOLD = 20;
const LINNSTRUMENT_UF_ONSET_RAMP_BASE_MS = 40;
const LINNSTRUMENT_UF_ONSET_RAMP_MAX_MS = 180;
const HAKEN_IGNORED_TEST_CCS = new Set([111, 114, 117, 118]);

function isLinnstrumentUfInputActive() {
  return (
    this.controller?.id === "linnstrument" &&
    this.inputRuntime.target !== "scale" &&
    this.inputRuntime.layoutMode === "controller_geometry"
  );
}

function linnstrumentUfGlideExponent(shapeSetting) {
  const shape = Math.max(0, Math.min(100, Number(shapeSetting) || 0));
  return shape / 100;
}

function linnstrumentUfGlideCurve(deviation, shapeSetting) {
  const t = Math.max(0, Math.min(1, Math.abs(deviation)));
  const shape = linnstrumentUfGlideExponent(shapeSetting);
  if (shape <= 0) return deviation;

  // 0 = fully linear across the pad, 1 = long centre hold with a short
  // boundary transition into the neighboring pad's shared seam pitch.
  const holdWidth = 0.82 * Math.pow(shape, 1.35);
  if (t <= holdWidth) return 0;

  const transition = (t - holdWidth) / Math.max(0.001, 1 - holdWidth);
  const transitionShape = 1 - 0.35 * shape;
  const curved = Math.pow(
    Math.max(0, Math.min(1, transition)),
    Math.max(0.25, transitionShape),
  );
  return Math.sign(deviation) * curved;
}

function linnstrumentUfRowNeighborCents(channel, col, fallbackCents) {
  const currentCoords = this._modulatedControllerCoords(
    this.controllerMap?.get(`${channel}.${col}`) ?? null,
  );
  const lookupCents = (targetCol, direction) => {
    const coords = this._modulatedControllerCoords(
      this.controllerMap?.get(`${channel}.${targetCol}`) ?? null,
    );
    if (coords) {
      const [cents] = this.hexCoordsToCents(coords);
      return cents;
    }

    // UF edge glide should continue one notional column beyond the hardware
    // surface so the outer pads can bend toward the adjacent off-grid pitch.
    if (currentCoords) {
      const [cents] = this.hexCoordsToCents(new Point(
        currentCoords.x + direction,
        currentCoords.y,
      ));
      return cents;
    }

    return fallbackCents;
  };
  return {
    prev: lookupCents(col - 1, -1),
    next: lookupCents(col + 1, 1),
  };
}

function linnstrumentUfSurfaceWidth(cols) {
  // Hardware testing on LinnStrument 128 shows the active X span across 16 pads
  // is about 2727, while the docs' 4265 figure matches the 25-pad surface.
  return cols <= 16 ? 2727 : 4265;
}

function linnstrumentUfXFilterThresholds(pressure = 127, reductionSetting = LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT) {
  const strength = Math.max(0, Math.min(100, Number(reductionSetting) || 0));
  if (strength === 0) return null;

  let base;
  let strict;
  let permissive;
  if (pressure <= LINNSTRUMENT_UF_VERY_LOW_PRESSURE_THRESHOLD) {
    base = { outlierThreshold: 5, confirmTolerance: 0, confirmCount: 3 };
    strict = { outlierThreshold: 3, confirmTolerance: 0, confirmCount: 4 };
    permissive = { outlierThreshold: 9, confirmTolerance: 2, confirmCount: 2 };
  } else if (pressure <= LINNSTRUMENT_UF_LOW_PRESSURE_THRESHOLD) {
    base = { outlierThreshold: 6, confirmTolerance: 1, confirmCount: 2 };
    strict = { outlierThreshold: 4, confirmTolerance: 0, confirmCount: 3 };
    permissive = { outlierThreshold: 10, confirmTolerance: 3, confirmCount: 1 };
  } else if (pressure <= LINNSTRUMENT_UF_MID_PRESSURE_THRESHOLD) {
    base = { outlierThreshold: 8, confirmTolerance: 3, confirmCount: 2 };
    strict = { outlierThreshold: 5, confirmTolerance: 1, confirmCount: 3 };
    permissive = { outlierThreshold: 13, confirmTolerance: 5, confirmCount: 1 };
  } else {
    base = {
      outlierThreshold: LINNSTRUMENT_UF_X_OUTLIER_THRESHOLD,
      confirmTolerance: LINNSTRUMENT_UF_X_CONFIRM_TOLERANCE,
      confirmCount: 2,
    };
    strict = { outlierThreshold: 7, confirmTolerance: 2, confirmCount: 2 };
    permissive = { outlierThreshold: 15, confirmTolerance: 6, confirmCount: 1 };
  }

  if (strength === LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT) return base;

  const blend = strength > LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT
    ? (strength - LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT) / LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT
    : (LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT - strength) / LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT;
  const target = strength > LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT ? strict : permissive;
  const lerp = (start, end) => start + (end - start) * blend;

  return {
    outlierThreshold: Math.max(1, Math.round(lerp(base.outlierThreshold, target.outlierThreshold))),
    confirmTolerance: Math.max(0, Math.round(lerp(base.confirmTolerance, target.confirmTolerance))),
    confirmCount: Math.max(1, Math.round(lerp(base.confirmCount, target.confirmCount))),
  };
}

function linnstrumentUfNormalizeX14(msb, lsb, reductionSetting = LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT) {
  const strength = Math.max(0, Math.min(100, Number(reductionSetting) || 0));
  if (strength <= LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT) return (msb << 7) | lsb;

  const lsbBlend = Math.max(0, 1 - (
    (strength - LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT) /
    LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT
  ));
  const normalizedLsb = Math.round(
    LINNSTRUMENT_UF_LSB_CENTER + (lsb - LINNSTRUMENT_UF_LSB_CENTER) * lsbBlend,
  );
  return (msb << 7) | Math.max(0, Math.min(127, normalizedLsb));
}

function filterLinnstrumentUfX14(key, x14, pressure = 127) {
  const state = this._linnUfXFilterState.get(key);
  const thresholds = linnstrumentUfXFilterThresholds(
    pressure,
    this.settings.linnstrument_x_spike_reduction ?? LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT,
  );
  if (!thresholds) {
    this._linnUfXFilterState.set(key, {
      filtered: x14,
      pending: null,
      pendingCount: 0,
    });
    return x14;
  }
  const { outlierThreshold, confirmTolerance, confirmCount } = thresholds;
  if (!state) {
    this._linnUfXFilterState.set(key, {
      filtered: x14,
      pending: null,
      pendingCount: 0,
    });
    return x14;
  }

  if (Math.abs(x14 - state.filtered) <= outlierThreshold) {
    state.filtered = x14;
    state.pending = null;
    state.pendingCount = 0;
    return x14;
  }

  if (
    state.pending != null &&
    Math.abs(x14 - state.pending) <= confirmTolerance
  ) {
    state.pending = x14;
    state.pendingCount += 1;
    if (state.pendingCount >= confirmCount) {
      state.filtered = x14;
      state.pending = null;
      state.pendingCount = 0;
      return x14;
    }
    return null;
  }

  state.pending = x14;
  state.pendingCount = 1;
  return null;
}

function shouldHoldLinnstrumentUfReleasePitch(key, pressure = 127) {
  let state = this._linnUfXReleaseState.get(key);
  if (!state) {
    state = { lastPressure: pressure, peakPressure: pressure };
    this._linnUfXReleaseState.set(key, state);
    return false;
  }

  state.peakPressure = Math.max(state.peakPressure, pressure);
  const descending = pressure < state.lastPressure;
  state.lastPressure = pressure;

  return (
    state.peakPressure >= LINNSTRUMENT_UF_RELEASE_HOLD_ARM_THRESHOLD &&
    pressure <= LINNSTRUMENT_UF_RELEASE_HOLD_THRESHOLD &&
    descending
  );
}

function smoothLinnstrumentUfX14(key, x14, pressure = 127) {
  const strength = Math.max(
    0,
    Math.min(
      100,
      Number(this.settings.linnstrument_x_input_smoothing) || LINNSTRUMENT_UF_X_INPUT_SMOOTHING_DEFAULT,
    ),
  );
  if (strength === 0) {
    this._linnUfXSmoothingState.set(key, { smoothed: x14 });
    return x14;
  }

  const state = this._linnUfXSmoothingState.get(key);
  if (!state) {
    this._linnUfXSmoothingState.set(key, { smoothed: x14 });
    return x14;
  }

  const pressureNorm = Math.max(0, Math.min(1, pressure / 127));
  const strengthNorm = strength / 100;
  const shapedStrength = Math.pow(strengthNorm, 1.8);
  const baseAlpha = 1 - 0.96 * shapedStrength;
  const pressureBoost = 0.18 * pressureNorm;
  const alpha = Math.max(0.04, Math.min(1, baseAlpha + pressureBoost));
  state.smoothed += (x14 - state.smoothed) * alpha;
  return Math.round(state.smoothed);
}

function linnstrumentUfOnsetAssist(key, shapeSetting) {
  const smoothingStrength = Math.max(
    0,
    Math.min(
      100,
      Number(this.settings.linnstrument_x_input_smoothing) || LINNSTRUMENT_UF_X_INPUT_SMOOTHING_DEFAULT,
    ),
  );
  if (smoothingStrength <= 0) {
    return {
      effectiveShape: shapeSetting,
      bendBlend: 1,
    };
  }

  const state = this._linnUfXOnsetState.get(key);
  const startedAt = state?.startedAtMs ?? performance.now();
  if (!state) {
    this._linnUfXOnsetState.set(key, { startedAtMs: startedAt });
  }

  const smoothingNorm = smoothingStrength / 100;
  const rampMs = LINNSTRUMENT_UF_ONSET_RAMP_BASE_MS +
    smoothingNorm * (LINNSTRUMENT_UF_ONSET_RAMP_MAX_MS - LINNSTRUMENT_UF_ONSET_RAMP_BASE_MS);
  const elapsedMs = Math.max(0, performance.now() - startedAt);
  const bendBlend = Math.max(0, Math.min(1, elapsedMs / rampMs));
  const effectiveShape = Math.min(
    100,
    shapeSetting + (100 - shapeSetting) * smoothingNorm * (1 - bendBlend) * 0.45,
  );
  return { effectiveShape, bendBlend };
}

function applyLinnstrumentUfXBend(channel, col, msb, lsb) {
  const key = `${channel}.${col}`;
  const spikeReduction = this.settings.linnstrument_x_spike_reduction ?? LINNSTRUMENT_UF_SPIKE_REDUCTION_DEFAULT;
  const x14 = linnstrumentUfNormalizeX14(msb, lsb, spikeReduction);
  this._linnUfXCurrent.set(key, x14);
  const note_played = col + 128 * (channel - 1);
  const hex = this.state.activeMidi.get(note_played);
  const pressure = Math.max(0, Math.min(127, Number(hex?._lastAftertouch) || 0));
  if (shouldHoldLinnstrumentUfReleasePitch.call(this, key, pressure)) return;
  const filteredX14 = filterLinnstrumentUfX14.call(this, key, x14, pressure);
  if (filteredX14 == null) return;
  const smoothedX14 = smoothLinnstrumentUfX14.call(this, key, filteredX14, pressure);
  if ((this.settings.linnstrument_pitch_bend_mode || "off") !== "follow_scale_geometry") {
    return;
  }
  if (hex && !hex.release && hex.retune) {
    const appliedState = this._linnUfXAppliedState.get(key);
    if (appliedState?.smoothed === smoothedX14) {
      hex.retune(appliedState.targetCents, true);
      return;
    }

    const cols = this.controller?.defaultCols ?? 16;
    const surfaceWidth = linnstrumentUfSurfaceWidth(cols);
    const colWidth = surfaceWidth / cols;
    const cellCentre = (col - 0.5) * colWidth;
    const deviation = Math.max(-1, Math.min(1, (smoothedX14 - cellCentre) / (colWidth / 2)));
    const baseShape = this.settings.linnstrument_pitch_bend_shape ?? 50;
    const { effectiveShape, bendBlend } = linnstrumentUfOnsetAssist.call(this, key, baseShape);
    const curved = linnstrumentUfGlideCurve(deviation, effectiveShape) * bendBlend;
    const baseCents = hex._baseCents ?? hex.cents;
    const neighbors = linnstrumentUfRowNeighborCents.call(this, channel, col, baseCents);
    let targetCents = baseCents;
    if (curved < 0) {
      targetCents = baseCents + curved * (baseCents - neighbors.prev) * 0.5;
    } else if (curved > 0) {
      targetCents = baseCents + curved * (neighbors.next - baseCents) * 0.5;
    }
    this._linnUfXAppliedState.set(key, {
      smoothed: smoothedX14,
      targetCents,
    });
    hex.retune(targetCents, true);
  }
}

function maybeApplyLinnstrumentUfX(channel, col) {
  const key = `${channel}.${col}`;
  const msb = this._linnUfXMsb.get(key);
  const lsb = this._linnUfXLsb.get(key);

  if (this._linnUfXInitPending.has(key)) {
    if (msb === undefined || lsb === undefined) return;
    this._linnUfXInitPending.delete(key);
    applyLinnstrumentUfXBend.call(this, channel, col, msb, lsb);
    return;
  }

  const current = this._linnUfXCurrent.get(key) ?? 0;
  const effectiveMsb = msb ?? ((current >> 7) & 0x7f);
  const effectiveLsb = lsb ?? (current & 0x7f);
  applyLinnstrumentUfXBend.call(this, channel, col, effectiveMsb, effectiveLsb);
}

export function rebuildControllerMap() {
  if (!this.midiin_data && this.settings.midiin_device === "OFF") {
    this.controller = null;
    this.controllerMap = null;
    this._controllerMapImpactKey = null;
    return true;
  }

  const mapKey = JSON.stringify({
    deviceName: this.midiin_data?.name ?? null,
    override: this.settings.midiin_controller_override || "auto",
    passthrough: !!this.settings.midi_passthrough,
    anchorNote: this.settings.midiin_anchor_note ?? this.settings.midiin_central_degree,
    anchorChannel: this.settings.midiin_anchor_channel,
    virtualAnchorX: this.settings.controller_virtual_anchor_x ?? null,
    virtualAnchorY: this.settings.controller_virtual_anchor_y ?? null,
    tonalplexusMode: this.settings.tonalplexus_input_mode,
    rSteps: this.settings.rSteps,
    drSteps: this.settings.drSteps,
    centerHexOffsetX: this.settings.centerHexOffset?.x,
    centerHexOffsetY: this.settings.centerHexOffset?.y,
  });
  if (this._controllerMapImpactKey === mapKey) return false;
  this._controllerMapImpactKey = mapKey;

  const overrideId = this.settings.midiin_controller_override || "auto";
  const deviceName = this.midiin_data?.name?.toLowerCase() ?? "";
  const entry = overrideId !== "auto" ? getControllerById(overrideId) : detectController(deviceName);

  if (!entry) {
    this.controller = null;
    this.controllerMap = null;
    return true;
  }

  this.controller = entry;
  if (typeof entry.buildMap !== "function") {
    this.controllerMap = null;
    return true;
  }

  const isSequential = this.settings.midi_passthrough;
  const useGeometryMap = !isSequential || !entry.multiChannel;

  if (!useGeometryMap) {
    this.controllerMap = null;
    return true;
  }

  let anchorNote;
  let anchorChannel;

  if (entry.multiChannel) {
    const constraints = entry.learnConstraints;
    anchorNote = this.settings.midiin_anchor_note ?? this.settings.midiin_central_degree ?? entry.anchorDefault;
    anchorChannel = this.settings.midiin_anchor_channel ?? entry.anchorChannelDefault;

    if (constraints?.noteRange) {
      const { min, max } = constraints.noteRange;
      if (anchorNote == null || anchorNote < min || anchorNote > max) {
        anchorNote = entry.anchorDefault ?? 26;
      }
    }
    if (!entry.supportsVirtualAnchor && constraints?.channelRange) {
      const { min, max } = constraints.channelRange;
      if (anchorChannel == null || anchorChannel < min || anchorChannel > max) {
        anchorChannel = entry.anchorChannelDefault ?? 3;
      }
    }
  } else {
    anchorNote = getAnchorNote(entry, this.settings);
    anchorChannel = 1;
  }

  const rawOffsets = entry.multiChannel
    ? entry.buildMap(anchorNote, anchorChannel, entry.defaultCols)
    : entry.buildMap(anchorNote, anchorChannel, this.settings.rSteps, this.settings.drSteps);
  const anchorAddress = entry.multiChannel
    ? {
      channel: anchorChannel ?? entry.anchorChannelDefault ?? 1,
      note: anchorNote ?? entry.anchorDefault ?? 26,
    }
    : {
      channel: 1,
      note: anchorNote ?? entry.anchorDefault ?? 60,
    };
  const virtualAnchorCoords = (
    Number.isFinite(this.settings.controller_virtual_anchor_x) &&
    Number.isFinite(this.settings.controller_virtual_anchor_y)
  )
    ? new Point(this.settings.controller_virtual_anchor_x, this.settings.controller_virtual_anchor_y)
    : null;
  const actualAnchorCoords = rawOffsets.get(`${anchorAddress.channel}.${anchorAddress.note}`) ?? null;
  const virtualDx = virtualAnchorCoords && actualAnchorCoords
    ? virtualAnchorCoords.x - actualAnchorCoords.x
    : 0;
  const virtualDy = virtualAnchorCoords && actualAnchorCoords
    ? virtualAnchorCoords.y - actualAnchorCoords.y
    : 0;
  const ox = this.settings.centerHexOffset.x;
  const oy = this.settings.centerHexOffset.y;
  this.controllerMap = new Map();
  for (const [key, { x, y }] of rawOffsets) {
    this.controllerMap.set(key, new Point(x + virtualDx + ox, y + virtualDy + oy));
  }
  return true;
}

export function teardownMidiInput() {
  if (this.midiin_data) {
    for (const eventName of MIDI_INPUT_EVENT_NAMES) {
      try {
        this.midiin_data.removeListener(eventName);
      } catch {
        // WebMidi.disable() may already have torn down this input's internal
        // listener tables. Cleanup should remain best-effort.
      }
    }
  }
  this.midiin_data = null;
  this.controller = null;
  this.controllerMap = null;
  this._controllerMapImpactKey = null;
  this._linnUfXLsb = new Map();
  this._linnUfXMsb = new Map();
  this._linnUfXCurrent = new Map();
  this._linnUfXFilterState = new Map();
  this._linnUfXAppliedState = new Map();
  this._linnUfXInitPending = new Set();
}

export function syncControllerAutoColors() {
  if (
    this.controller?.id === "lumatone" &&
    this.settings.lumatone_led_sync &&
    this._canAutoSendLumatoneColors?.()
  ) {
    this.autoSyncLumatoneLEDs?.();
  }
  if (
    this.controller?.id === "exquis" &&
    this.settings.exquis_led_sync &&
    this._canAutoSendExquisColors?.()
  ) {
    this.syncExquisLEDs();
  }
  if (
    this.controller?.id === "linnstrument" &&
    this.settings.linnstrument_led_sync &&
    this._canAutoSendLinnstrumentColors?.()
  ) {
    this.syncLinnstrumentLEDs();
  }
}

export function rebindMidiInput() {
  teardownMidiInput.call(this);
  setupMidiInput.call(this);
  syncControllerAutoColors.call(this);
}

export function setupMidiInput() {
    //console.log('[Keys] MIDI init — device:', JSON.stringify(this.settings.midiin_device), 'passthrough:', this.settings.midi_passthrough);
    if (this.settings.midiin_device !== "OFF") {
      // get the MIDI noteons and noteoffs to play the internal sounds

      try {
        this.midiin_data = WebMidi.getInputById(this.settings.midiin_device);
      } catch {
        this.midiin_data = null;
      }
      if (!this.midiin_data) {
      } else {
        // this.midiin_data exists

        this._midiLearnCallback = null; // set by setMidiLearnMode()
        this._midiLearnCcCallback = null; // set by setMidiCcLearnMode()

        this.midiin_data.addListener("noteon", (e) => {
          // MIDI learn: capture the next note-on as the new anchor, don't play it.
          if (this._midiLearnCallback) {
            // Pass both note number and channel so multi-channel controllers
            // (e.g. Lumatone) can identify which block/channel the anchor is on.
            this._midiLearnCallback(e.note.number, e.message.channel);
            this._midiLearnCallback = null;
            return;
          }
          debugLog("MIDImonitoring", "noteon", {
            channel: e.message.channel,
            note: e.note.number,
            velocity: e.note.rawAttack,
          });
          if (isLinnstrumentUfInputActive.call(this)) {
            const key = `${e.message.channel}.${e.note.number}`;
            this._linnUfXLsb.delete(key);
            this._linnUfXMsb.delete(key);
            this._linnUfXCurrent.delete(key);
            this._linnUfXFilterState.delete(key);
            this._linnUfXAppliedState.delete(key);
            this._linnUfXSmoothingState.delete(key);
            this._linnUfXOnsetState.delete(key);
            this._linnUfXReleaseState.delete(key);
            this._linnUfXOnsetState.set(key, { startedAtMs: performance.now() });
            this._linnUfXInitPending.add(key);
          }
          this.midinoteOn(e);
          notes.played.unshift(e.note.number + 128 * (e.message.channel - 1));
        });

        this.midiin_data.addListener("noteoff", (e) => {
          debugLog("MIDImonitoring", "noteoff", {
            channel: e.message.channel,
            note: e.note.number,
            velocity: e.note.rawRelease,
          });
          this.midinoteOff(e);
          if (isLinnstrumentUfInputActive.call(this)) {
            const key = `${e.message.channel}.${e.note.number}`;
            this._linnUfXLsb.delete(key);
            this._linnUfXMsb.delete(key);
            this._linnUfXCurrent.delete(key);
            this._linnUfXFilterState.delete(key);
            this._linnUfXAppliedState.delete(key);
            this._linnUfXSmoothingState.delete(key);
            this._linnUfXOnsetState.delete(key);
            this._linnUfXReleaseState.delete(key);
            this._linnUfXInitPending.delete(key);
          }
          let index = notes.played.lastIndexOf(e.note.number + 128 * (e.message.channel - 1)); // eliminate note_played from array of played notes when using internal synth
          if (index >= 0) {
            let first_half = [];
            first_half = notes.played.slice(0, index);
            let second_half = [];
            second_half = notes.played.slice(index);
            second_half.shift();
            let newarray = [];
            notes.played = newarray.concat(first_half, second_half);
          }
        });

        this.midiin_data.addListener("keyaftertouch", (e) => {
          debugLog("MIDImonitoring", "keyaftertouch", {
            channel: e.message.channel,
            note: e.message.dataBytes[0],
            value: e.message.dataBytes[1],
          });
          // Polyphonic aftertouch for built-in synth — find the matching active hex
          // by matching note + channel encoding, then ramp its gain smoothly
          const note_played = e.message.dataBytes[0] + 128 * (e.message.channel - 1);
          const hex = this.state.activeMidi.get(note_played);
          this._applyPolyAftertouch(hex, e.message.dataBytes[1]);
        });

        // Universal CC listener — runs for all output modes.
        // 1. Passes all CCs through to the configured output channel(s).
        // 2. Consumes CC64/66/67 (sustain/sostenuto/soft) internally AND forwards.
        // 3. Consumes CC120/121/123 (all-sound-off/reset/all-notes-off) internally.
        // 4. Routes CC1/CC11 (modwheel/expression) to all active hexes (global broadcast).
        // 5. Routes CC74 (brightness) to the front-of-recency-stack hex (non-MPE mode).
        //    In MPE input mode (Step 3.5) CC74 will be routed per-channel instead.
        // LinnStrument User Firmware Mode: 14-bit X data buffer.
        // Key: `ch.col`, value: pending MSB/LSB halves awaiting pairing.
        // The docs describe CC 0-25 + 32-57, but some observed hardware streams
        // have arrived as 1-25 + 33-57 and/or LSB-first, so accept both.
        this._linnUfXLsb = new Map();
        this._linnUfXMsb = new Map();
        this._linnUfXCurrent = new Map(); // latest x14 per "ch.col" — snapshot at note-on for zero-point
        this._linnUfXFilterState = new Map(); // outlier-confirmation state per "ch.col"
        this._linnUfXAppliedState = new Map(); // last accepted smoothed X and retune target per "ch.col"
        this._linnUfXSmoothingState = new Map(); // accepted X smoothing state per "ch.col"
        this._linnUfXOnsetState = new Map(); // note-on timing for smoothing-aware attack quantization
        this._linnUfXReleaseState = new Map(); // low-pressure release tracking to avoid snap-back before note-off
        this._linnUfXInitPending = new Set();
        this.midiin_data.addListener("controlchange", (e) => {
          const cc = e.message.dataBytes[0];
          const value = e.message.dataBytes[1];
          const linnstrumentUfInputActive = isLinnstrumentUfInputActive.call(this);
          if (this.controller?.id === "hakenaudio" && HAKEN_IGNORED_TEST_CCS.has(cc)) return;
          if (this._midiLearnCcCallback) {
            this._midiLearnCcCallback(cc, e.message.channel, value);
            this._midiLearnCcCallback = null;
            return;
          }
          if (
            this.controller?.id === "hakenaudio" &&
            this.inputRuntime?.mpeInput &&
            Number.isFinite(this.settings.hakenaudio_glide_flip_cc) &&
            this.settings.hakenaudio_glide_flip_cc >= 0 &&
            cc === this.settings.hakenaudio_glide_flip_cc
          ) {
            this._setHakenPedalGlideFlip?.(value >= 64);
            return;
          }
          if (this.inputRuntime.mpeInput && !this._acceptsMpeInputChannel(e.message.channel)) return;
          debugLog("MIDImonitoring", "controlchange", { channel: e.message.channel, cc, value });

          // ── LinnStrument User Firmware Mode X data ────────────────────────
          // CC 0-25 / 1-25 = X MSB, CC 32-57 / 33-57 = X LSB.
          // Combine to 14-bit value (0-4265 across the full pad width).
          if (linnstrumentUfInputActive) {
            const isDocumentedMsb = cc >= 0 && cc <= 25;
            const isDocumentedLsb = cc >= 32 && cc <= 57;
            const isObservedMsb = cc >= 1 && cc <= 25;
            const isObservedLsb = cc >= 33 && cc <= 57;

            if (isDocumentedLsb || isObservedLsb) {
              const col = cc >= 32 ? cc - 32 : cc - 32;
              const key = `${e.message.channel}.${col}`;
              this._linnUfXLsb.set(key, value);
              maybeApplyLinnstrumentUfX.call(this, e.message.channel, col);
              return;
            } else if (isDocumentedMsb || isObservedMsb) {
              const col = cc;
              const key = `${e.message.channel}.${col}`;
              this._linnUfXMsb.set(key, value);
              maybeApplyLinnstrumentUfX.call(this, e.message.channel, col);
              return;
            }
          }

          if (cc === 121) {
            this._controllerCCValues.clear();
            for (const resetCC of [1, 11, 64, 66, 67, 74]) {
              this._controllerCCValues.set(resetCC, 0);
            }
          } else if (cc !== 120 && cc !== 123) {
            this._controllerCCValues.set(cc, value);
          }

          // ── Passthrough to all active outputs ─────────────────────────────
          // CC74 is not forwarded in MTS mode — no meaningful mapping exists.
          const isMTSOutput =
            this.settings.midi_mapping === "MTS1" || this.settings.midi_mapping === "MTS2";
          if (!(cc === 74 && isMTSOutput)) this._passthroughCC(cc, value);

          // ── Internal consumption ──────────────────────────────────────────
          if (cc >= 65 && cc <= 89 && linnstrumentUfInputActive) {
            // LinnStrument User Firmware Mode Y data:
            // CC 65-89 = per-cell Y position, ch=row(1-8), cc-64=col(1-25).
            // This range overlaps sostenuto/soft pedal CCs — must be checked
            // first so those generic handlers don't swallow LinnStrument Y messages.
            const col = cc - 64;                                   // 1-indexed column
            const note_played = col + 128 * (e.message.channel - 1);
            const hex = this.state.activeMidi.get(note_played);
            this._applyTimbreCC74(hex, value); // Y → timbre/slide
          } else if (cc === 64) {
            // Sustain pedal
            if (value > 0) {
              this.sustainOn();
            } else {
              this.sustainOff();
            }
          } else if (cc === 66) {
            // Sostenuto — stub; full implementation in a later step
          } else if (cc === 67) {
            // Soft pedal — stub; full implementation in a later step
          } else if (cc === 120 || cc === 123) {
            // All Sound Off / All Notes Off
            this.allnotesOff();
          } else if (cc === 121) {
            // Reset All Controllers
            this.sustainOff();
          } else if (cc === 1) {
            // Mod wheel — broadcast to all active hexes (zone-wide)
            if (this.settings.midiin_device && this.settings.midiin_device !== "OFF") {
              sessionStorage.setItem("midiin_modwheel_value", String(value));
              sessionStorage.setItem("midiin_modwheel_source", this.settings.midiin_device);
            }
            for (const hex of this._allActiveHexes()) {
              if (hex.modwheel) hex.modwheel(value);
            }
          } else if (cc === 11) {
            // Expression — broadcast to all active hexes (zone-wide)
            for (const hex of this._allActiveHexes()) {
              if (hex.expression) hex.expression(value);
            }
          } else if (cc === 74) {
            // CC74 (timbre/slide): always routed to active hexes (sample synth filter,
            // MPE voice expression, etc.) regardless of output mode.
            // Passthrough to MTS output is suppressed above — no meaningful MTS mapping.
            if (this.inputRuntime.mpeInput) {
              this._mpeInputCC74ByChannel.set(e.message.channel, { value, time: Date.now() });
              // Per-channel expression mode: CC74 targets the latest sounding note
              // on the input channel (MPE voice, or LinnStrument row in channel-per-row mode).
              const entry = this.state.activeMidiByChannel.get(e.message.channel);
              if (entry && !entry.hex.release) this._applyTimbreCC74(entry.hex, value);
            } else if (this.inputRuntime.perChannelExpression) {
              for (const hex of this._activeHexesForInputChannel(e.message.channel)) {
                this._applyTimbreCC74(hex, value);
              }
            } else {
              // Non-MPE: brightness to front of recency stack (global target).
              const front = this.recencyStack.front;
              if (front && front.cc74) front.cc74(value);
            }
          }

          this._rememberControllerStateInSynth();
        });

        // Universal channel-pressure (aftertouch) listener.
        this.midiin_data.addListener("channelaftertouch", (e) => {
          const value = e.message.dataBytes[0];
          if (this.inputRuntime.mpeInput && !this._acceptsMpeInputChannel(e.message.channel)) return;
          debugLog("MIDImonitoring", "channelaftertouch", { channel: e.message.channel, value });
          this._channelPressureValue = value;

          if (this.inputRuntime.mpeInput) {
            this._mpeInputAftertouchByChannel.set(e.message.channel, { value, time: Date.now() });
            // Per-channel expression mode: channel pressure targets the latest sounding
            // note on the input channel.
            // We've resolved which note it belongs to, so route as polyphonic aftertouch
            // (hex.aftertouch) rather than channel pressure (hex.pressure) — this lets
            // MTS output send 0xAn poly-AT with the correct carrier note number.
            const entry = this.state.activeMidiByChannel.get(e.message.channel);
            if (entry && !entry.hex.release) {
              this._applyPolyAftertouch(entry.hex, value);
            }
            return;
          }

          if (this.inputRuntime.perChannelExpression) {
            for (const hex of this._activeHexesForInputChannel(e.message.channel)) {
              this._applyPolyAftertouch(hex, value);
            }
            return;
          }

          // Non-MPE: passthrough then dispatch by pressureMode.
          this._passthroughChannelPressure(value);

          if (this.inputRuntime.pressureMode === "all") {
            for (const hex of this._allActiveHexes()) {
              if (hex.pressure) hex.pressure(value);
            }
          } else {
            // 'recency' mode (default): target front of recency stack
            const front = this.recencyStack.front;
            if (front && front.pressure) front.pressure(value);
          }

          this._rememberControllerStateInSynth();
        });

        if (
          this.settings.output_mts &&
          this.settings.midi_device !== "OFF" &&
          this.settings.midi_channel >= 0
        ) {
          // forward other MIDI data through to output (only when MTS is enabled)
          this.midiout_data = WebMidi.getOutputById(this.settings.midi_device);

          // CC and channel-pressure passthrough is now handled by the universal
          // controlchange / channelaftertouch listeners above (_passthroughCC /
          // _passthroughChannelPressure).  Only per-mode pitchbend and keyaftertouch
          // passthrough with note-remapping logic are kept here.

          // Pitchbend passthrough is now handled universally by _passthroughPitchBend
          // (called from the universal 'pitchbend' listener below).
          // Only keyaftertouch listeners with note-remapping logic are kept here.

          if (this.settings.midi_mapping == "multichannel") {
            // Multichannel output — currently NOT USED, to be replaced by MTS bulk dump mode.
            this.midiin_data.addListener("keyaftertouch", (e) => {
              let note = e.message.dataBytes[0] + 128 * (e.message.channel - 1); // finds index of stored MTS data
              this.midiout_data.sendKeyAftertouch(keymap[note][0], e.message.dataBytes[1], {
                channels: keymap[note][6] + 1,
                rawValue: true,
              });
            });
          } else {
            // Single-channel output.
            if (this.settings.midi_mapping == "sequential") {
              // Sequential — inactive, to be replaced by MTS bulk dump mode.
              // Note-remapping: channel offset → equave shift → remapped output note.
              // Note that the channels-to-equave-transposition logic here will need
              // overhaul once static mapping per MIDI control surface is implemented.
              this.midiin_data.addListener("keyaftertouch", (e) => {
                // equaveShift: how many equaves this channel is transposed relative to
                // the anchor channel. Range -4...+3, wrapping at 8 channels.
                let equaveShift = e.message.channel - (this.settings.midiin_anchor_channel ?? 1);
                equaveShift = ((equaveShift + 20) % 8) - 4;
                // scaleStepShift: the same transposition expressed as scale degrees
                // (equaveShift × equivSteps), used to remap the output note number.
                const scaleStepShift = equaveShift * this.tuning.equivSteps;
                let note = (e.message.dataBytes[0] + scaleStepShift + 16 * 128) % 128;
                this.midiout_data.sendKeyAftertouch(note, e.message.dataBytes[1], {
                  channels: this.settings.midi_channel + 1,
                  rawValue: true,
                });
              });
            } else if (
              this.settings.midi_mapping == "MTS1" ||
              this.settings.midi_mapping == "MTS2"
            ) {
              this.midiin_data.addListener("keyaftertouch", (e) => {
                let note = e.message.dataBytes[0] + 128 * (e.message.channel - 1);
                this.midiout_data.sendKeyAftertouch(keymap[note][0], e.message.dataBytes[1], {
                  channels: this.settings.midi_channel + 1,
                  rawValue: true,
                });
              });
            }
          }
        } // end if (output_mts)
        // Detect controller geometry and build a direct coordinate lookup map.
        if (!this.coordResolver.stepsTable) this.coordResolver.buildStepsTable();
        rebuildControllerMap.call(this);

        // Universal pitch-wheel listener — runs for ALL midi_mapping modes.
        this.midiin_data.addListener("pitchbend", (e) => {
          const val14 = e.message.dataBytes[0] + e.message.dataBytes[1] * 128;
          if (this.inputRuntime.mpeInput && !this._acceptsMpeInputChannel(e.message.channel)) return;
          debugLog("MIDImonitoring", "pitchbend", {
            channel: e.message.channel,
            value14: val14,
          });

          if (this.inputRuntime.mpeInput) {
            // Per-channel expression mode: pitch bend is carried on the input channel.
            // Route to the latest sounding note registered on this channel.
            this._mpeInputBendByChannel.set(e.message.channel, val14);
            const entry = this.state.activeMidiByChannel.get(e.message.channel);
            if (entry && !entry.hex.release) this._applyMpePitchBend(entry, e.message.channel, val14);
            // In per-channel expression modes we do NOT pass through to the output here —
            // each hex's retune() call handles expression for its own output engine.
            // Scale mode pre-bend capture: record bend per channel so note-on can
            // use it to resolve the exact intended pitch.
            if (this.inputRuntime.mpeInput && this.inputRuntime.target === "scale") {
              this._scaleModePreBend.set(e.message.channel, val14);
            }
            return;
          }

          if (this.inputRuntime.perChannelExpression) {
            this._mpeInputBendByChannel.set(e.message.channel, val14);
            for (const hex of this._activeHexesForInputChannel(e.message.channel)) {
              this._applyMpePitchBend(
                { hex, baseCents: hex._baseCents ?? hex.cents },
                e.message.channel,
                val14,
              );
            }
            return;
          }

          // Non-MPE: dispatch to wheel bend handler, then optionally passthrough.
          //
          // wheelToRecent (recency/all mode): pitch is realized by hex.retune()
          // against the active target notes, so raw PB passthrough must stay OFF
          // for all outputs or the bend is applied twice.
          //
          // Standard mode (!wheelToRecent): raw PB passes through to all outputs,
          // including MTS, while the internal sample engine is retuned directly.
          const val14f = this.inputRuntime.bendFlip ? 16383 - val14 : val14;
          this._handleIncomingWheelBend(val14f);
          if (!this.inputRuntime.wheelToRecent) {
            // Standard mode: raw PB to all outputs (MTS included).
            this._passthroughPitchBend(val14f);
          }
          this._rememberControllerStateInSynth();
        });

        // MTS Single Note Tuning Change sysex listener — non-MPE scale mode only.
        // Sysex format (Universal Real-Time, 0xF0 0x7F):
        //   F0 7F <device_id> 08 02 <count> [<note> <xx> <yy> <zz>] ... F7
        // Hz per note: 440 * 2^((note + semiFrac - 69) / 12)
        //   where semiFrac = xx + (yy*128 + zz) / 16384 (xx = semitone, yy:zz = fraction)
        // Reference: MIDI Tuning Standard (MTS), CA-020.
        this.midiin_data.addListener("sysex", (e) => {
          if (this.inputRuntime.target !== "scale" || this.inputRuntime.mpeInput) return;
          const d = e.message.data;
          // Minimum: F0 7F dev 08 02 count note xx yy zz F7 = 11 bytes, count >= 1
          if (d.length < 11) return;
          // d[0]=0xF0, d[1]=0x7F (Universal Real-Time), d[2]=device id, d[3]=0x08, d[4]=0x02
          if (d[1] !== 0x7f || d[3] !== 0x08 || d[4] !== 0x02) return;
          const count = d[5];
          for (let i = 0; i < count; i++) {
            const offset = 6 + i * 4;
            if (offset + 3 >= d.length) break; // guard against truncated message
            const noteNum = d[offset];
            const semis = d[offset + 1]; // semitone (0–127)
            const fracHi = d[offset + 2]; // MSB of 14-bit fraction
            const fracLo = d[offset + 3]; // LSB of 14-bit fraction
            const semiFrac = semis + (fracHi * 128 + fracLo) / 16384;
            const hz = 440 * Math.pow(2, (semiFrac - 69) / 12);
            this._mtsInputTable.set(noteNum, hz);
          }
        });
      } // end else (midiin_data exists)
    } // end if midiin_data guard

    if (this.midiin_data == null && this.settings.midiin_device !== "OFF") {
      rebuildControllerMap.call(this);
    }
}
