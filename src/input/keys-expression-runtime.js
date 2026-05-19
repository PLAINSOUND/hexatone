// This module owns live expression handling after notes already exist.
// It applies pitch bend, aftertouch, CC74, and retune glides across the active
// note set and output backends. It does not resolve note addresses or maintain
// modulation history; callers provide the current Keys runtime state.

import { WebMidi } from "webmidi";
import { scalaToCents } from "../settings/scale/parse-scale";
import {
  applyTransferredCC74,
  applyTransferredPitchBend,
  applyTransferredSourceAftertouch,
  synchronizeTransferredPitchBend,
} from "../keyboard/note-transfer-runtime.js";

const RETUNE_GLIDE_TICK_MS = 4;
const RETUNE_GLIDE_TAU_MS = 40;
const RETUNE_GLIDE_MAX_CENTS_PER_SEC = 4800;
const RETUNE_GLIDE_SNAP_CENTS = 0.1;

export function passthroughCC(cc, value) {
  if (
    this.midiout_data &&
    this.settings.midi_device !== "OFF" &&
    this.settings.midi_channel >= 0
  ) {
    this.midiout_data.sendControlChange(cc, value, { channels: this.settings.midi_channel + 1 });
  }
  if (this.settings.output_mpe && this.settings.mpe_device !== "OFF") {
    const mpeOutput = WebMidi.getOutputById(this.settings.mpe_device);
    if (mpeOutput) {
      const managerCh = parseInt(this.settings.midiin_mpe_manager_ch, 10) || 1;
      mpeOutput.sendControlChange(cc, value, { channels: managerCh });
    }
  }
}

export function passthroughChannelPressure(value) {
  if (
    this.midiout_data &&
    this.settings.midi_device !== "OFF" &&
    this.settings.midi_channel >= 0
  ) {
    this.midiout_data.sendChannelAftertouch(value, {
      channels: this.settings.midi_channel + 1,
      rawValue: true,
    });
  }
  if (this.settings.output_mpe && this.settings.mpe_device !== "OFF") {
    const mpeOutput = WebMidi.getOutputById(this.settings.mpe_device);
    if (mpeOutput) {
      const managerCh = parseInt(this.settings.midiin_mpe_manager_ch, 10) || 1;
      mpeOutput.sendChannelAftertouch(value, { channels: managerCh, rawValue: true });
    }
  }
}

export function passthroughPitchBend(val14) {
  const normalized = val14 / 8192.0 - 1.0;
  if (
    this.midiout_data &&
    this.settings.midi_device !== "OFF" &&
    this.settings.midi_channel >= 0
  ) {
    this.midiout_data.sendPitchBend(normalized, { channels: this.settings.midi_channel + 1 });
  }
  if (
    !this.inputRuntime.mpeInput &&
    this.settings.output_mpe &&
    this.settings.mpe_device !== "OFF"
  ) {
    const mpeOutput = WebMidi.getOutputById(this.settings.mpe_device);
    if (mpeOutput) {
      const managerCh = parseInt(this.settings.midiin_mpe_manager_ch, 10) || 1;
      mpeOutput.sendPitchBend(normalized, { channels: managerCh });
    }
  }
}

export function applyPolyAftertouch(hex, value, value14 = null) {
  if (!hex || hex.release) return;
  const aftertouch = Math.max(0, Math.min(127, Number(value) || 0));
  const aftertouch14 = Number.isFinite(value14)
    ? Math.max(0, Math.min(16256, Number(value14)))
    : null;
  hex._lastAftertouch = aftertouch;
  hex._lastAftertouch14 = aftertouch14;
  hex._pressureSeenSinceOnset = true;
  if (applyTransferredSourceAftertouch(hex, aftertouch)) return;
  if (aftertouch14 != null) hex.aftertouch?.(aftertouch, aftertouch14);
  else hex.aftertouch?.(aftertouch);
}

export function applyTimbreCC74(hex, value, value14 = null) {
  if (!hex || hex.release) return;
  const cc74 = Math.max(0, Math.min(127, Number(value) || 0));
  const cc7414 = Number.isFinite(value14)
    ? Math.max(0, Math.min(16256, Number(value14)))
    : null;
  hex._lastCC74 = cc74;
  hex._lastCC7414 = cc7414;
  if (applyTransferredCC74(hex, cc74)) return;
  if (cc7414 != null) hex.cc74?.(cc74, cc7414);
  else hex.cc74?.(cc74);
}

export function normalizePitchBend14(value) {
  const bend = Number(value);
  if (!Number.isFinite(bend)) return 8192;
  return Math.max(0, Math.min(16383, bend));
}

function normalizePitchBend21(value) {
  const bend = Number(value);
  if (!Number.isFinite(bend)) return 1048576;
  return Math.max(0, Math.min(2097024, bend));
}

export function resolveHakenXGlideMode(inputRuntime) {
  const base = inputRuntime?.hakenXGlideMode ?? "pitch_bending";
  const flipped = !!inputRuntime?.hakenSpaceGlideFlip !== !!inputRuntime?.hakenPedalGlideFlip;
  if (!flipped) return base;
  if (base === "raster_to_notes") return "pitch_bending";
  if (base === "pitch_bending") return "raster_to_notes";
  return base;
}

export function applyContinuumPitchShape(stepOffset, inputRuntime) {
  const shapingControl = Math.max(
    0,
    Math.min(100, Number(inputRuntime.hakenXGlideShaping ?? 0) || 0),
  );
  if (shapingControl <= 0) return stepOffset;
  const amount = shapingControl / 100;
  const exponent = 1 + amount * 11;
  const absOffset = Math.abs(stepOffset);
  const wholeSteps = Math.floor(absOffset);
  const frac = absOffset - wholeSteps;
  const pocketedFrac =
    frac <= 0.5
      ? 0.5 * Math.pow(frac / 0.5, exponent)
      : 1 - 0.5 * Math.pow((1 - frac) / 0.5, exponent);
  return Math.sign(stepOffset) * (wholeSteps + pocketedFrac);
}

function continuumLiveFrameInfo(keys, hex) {
  const frame = keys._frameForSoundingHex?.(hex) ?? keys._activeFrame?.() ?? null;
  const geometryMode =
    keys._geometryModeForSoundingHex?.(hex) ??
    (frame?.strategy === "reinterpret_surface_from_target" ? "stable_surface" : "moveable_surface");
  const transpositionCents = Number(frame?.transpositionCents ?? 0) || 0;
  return { frame, geometryMode, transpositionCents };
}

function liveScaleDegreeIndex(keys, reducedStep, frame, geometryMode) {
  if (geometryMode === "moveable_surface") return reducedStep;
  if (typeof keys._labelDegreeFromFrame === "function") {
    return keys._labelDegreeFromFrame(reducedStep, frame);
  }
  return reducedStep;
}

function liveCentsForIntegerScaleStep(keys, scale, equivInterval, step, hex) {
  const scaleLength = Math.max(1, scale.length || 1);
  const octs = Math.floor(step / scaleLength);
  const reduced = ((step % scaleLength) + scaleLength) % scaleLength;
  const { frame, geometryMode, transpositionCents } = continuumLiveFrameInfo(keys, hex);
  const centsIndex = liveScaleDegreeIndex(keys, reduced, frame, geometryMode);
  return octs * equivInterval + (scale[centsIndex] ?? 0) + transpositionCents;
}

function liveCentsForFloatingScaleStep(keys, scale, equivInterval, stepFloat, hex) {
  const lowerStep = Math.floor(stepFloat);
  const frac = stepFloat - lowerStep;
  const lowerCents = liveCentsForIntegerScaleStep(keys, scale, equivInterval, lowerStep, hex);
  if (frac === 0) return lowerCents;
  const upperCents = liveCentsForIntegerScaleStep(keys, scale, equivInterval, lowerStep + 1, hex);
  return lowerCents + (upperCents - lowerCents) * frac;
}

function liveFloatingScaleStepForCents(keys, scale, equivInterval, pitchCents, hex) {
  const { transpositionCents } = continuumLiveFrameInfo(keys, hex);
  return floatingScaleStepForCents(scale, equivInterval, pitchCents - transpositionCents);
}

function floatingScaleStepForCents(scale, equivInterval, pitchCents) {
  const scaleLength = Math.max(1, scale.length || 1);
  const octs = Math.floor(pitchCents / equivInterval);
  let reduced = pitchCents - octs * equivInterval;
  if (reduced >= equivInterval) reduced -= equivInterval;
  if (reduced < 0) reduced += equivInterval;

  for (let i = 0; i < scaleLength - 1; i++) {
    const lower = scale[i];
    const upper = scale[i + 1];
    if (reduced >= lower && reduced <= upper) {
      const span = upper - lower || 1;
      const frac = (reduced - lower) / span;
      return octs * scaleLength + i + frac;
    }
  }

  const lastIndex = scaleLength - 1;
  const lower = scale[lastIndex] ?? 0;
  const upper = equivInterval;
  const span = upper - lower || 1;
  const frac = (reduced - lower) / span;
  return octs * scaleLength + lastIndex + frac;
}

export function computeContinuumPitchBendCents(keys, entry, channel, value14, value21 = null) {
  if (!entry?.hex || entry.hex.release) return null;
  const bend14 = keys._normalizePitchBend14(value14);
  const bend21 = Number.isFinite(value21)
    ? normalizePitchBend21(value21)
    : Number.isFinite(keys._hakenMpeBend21ByChannel?.get(channel))
      ? normalizePitchBend21(keys._hakenMpeBend21ByChannel.get(channel))
      : null;
  const continuumStepFollowingMode =
    keys.inputRuntime.layoutMode !== "sequential" &&
    keys.inputRuntime.target === "hex_layout" &&
    !!entry.hex.coords;
  const anchor14 = entry.hex._continuumPitchAnchor14 != null
    ? keys._normalizePitchBend14(entry.hex._continuumPitchAnchor14)
    : (
      keys.inputRuntime.target === "scale" &&
      entry.hex._scaleModeBendAnchor14 != null
    )
      ? keys._normalizePitchBend14(entry.hex._scaleModeBendAnchor14)
      : 8192;
  const anchor21 = entry.hex._continuumPitchAnchor21 != null
    ? normalizePitchBend21(entry.hex._continuumPitchAnchor21)
    : (
      keys.inputRuntime.target === "scale" &&
      entry.hex._scaleModeBendAnchor21 != null
    )
      ? normalizePitchBend21(entry.hex._scaleModeBendAnchor21)
      : 1048576;
  let norm = bend21 != null
    ? (bend21 - anchor21) / 1048576
    : (bend14 - anchor14) / 8192;
  if (keys.inputRuntime.target !== "scale") norm = keys.inputRuntime.bendFlip ? -norm : norm;
  const baseCents = entry.hex._baseCents ?? entry.baseCents ?? entry.hex.cents;
  const runtime =
    keys._effectiveScaleRuntimeForFrame?.(keys._frameForSoundingHex?.(entry.hex)) ?? {
      scale: keys.tuning.scale,
      equivInterval: keys.tuning.equivInterval ?? 1200,
    };
  const runtimeScale = runtime.scale ?? keys.tuning.scale;
  const runtimeEquivInterval = runtime.equivInterval ?? keys.tuning.equivInterval ?? 1200;

  if (continuumStepFollowingMode && entry.hex.coords) {
    const [, , currentSteps] = keys.hexCoordsToCents(entry.hex.coords);
    const baseSteps = Number.isFinite(entry.hex._continuumPitchAnchorSteps)
      ? entry.hex._continuumPitchAnchorSteps
      : Number.isFinite(entry.hex._rasterOnsetSteps)
        ? entry.hex._rasterOnsetSteps
        : currentSteps;
    const degreeSpan = Math.max(0, Number(keys.inputRuntime.scaleBendRange ?? 48) || 0);
    const shapedStepOffset = applyContinuumPitchShape(norm * degreeSpan, keys.inputRuntime);
    return liveCentsForFloatingScaleStep(
      keys,
      runtimeScale,
      runtimeEquivInterval,
      baseSteps + shapedStepOffset,
      entry.hex,
    );
  }

  if (keys.inputRuntime.target === "scale") {
    const rangeCents = 100 * (keys.inputRuntime.scaleBendRange ?? 48);
    const anchorCents = entry.hex._continuumPitchAnchorCents ?? baseCents;
    const targetCents = anchorCents + norm * rangeCents;
    const floatSteps = liveFloatingScaleStepForCents(
      keys,
      runtimeScale,
      runtimeEquivInterval,
      targetCents,
      entry.hex,
    );
    const shapedSteps = applyContinuumPitchShape(floatSteps, keys.inputRuntime);
    return liveCentsForFloatingScaleStep(
      keys,
      runtimeScale,
      runtimeEquivInterval,
      shapedSteps,
      entry.hex,
    );
  }

  const rangeCents = 100 * (keys.inputRuntime.scaleBendRange ?? 48);
  return baseCents + norm * rangeCents;
}

export function applyMpePitchBend(entry, channel, value14, value21 = null) {
  if (!entry?.hex || entry.hex.release) return;
  const bend14 = this._normalizePitchBend14(value14);
  const bend21 = Number.isFinite(value21)
    ? normalizePitchBend21(value21)
    : Number.isFinite(this._hakenMpeBend21ByChannel?.get(channel))
      ? normalizePitchBend21(this._hakenMpeBend21ByChannel.get(channel))
      : null;
  this._mpeInputBendByChannel.set(channel, bend14);
  const hakenXGlideMode = resolveHakenXGlideMode(this.inputRuntime);
  const isContinuumMpe =
    this.controller?.id === "hakenaudio" &&
    this.inputRuntime.mpeInput;
  const continuumRasterMode =
    isContinuumMpe &&
    hakenXGlideMode === "raster_to_notes";
  if (continuumRasterMode) {
    this._hakenRasterBend(entry, channel, bend14, this.inputRuntime.target === "scale");
    return;
  }
  const continuumPitchBendingMode =
    isContinuumMpe &&
    hakenXGlideMode === "pitch_bending";
  const baseCents = entry.hex._baseCents ?? entry.baseCents ?? entry.hex.cents;
  const bentCents = continuumPitchBendingMode
    ? computeContinuumPitchBendCents(this, entry, channel, bend14, bend21)
    : baseCents + (((bend21 != null ? (bend21 - 1048576) / 1048576 : (bend14 - 8192) / 8192) *
      (this.inputRuntime.bendFlip && this.inputRuntime.target !== "scale" ? -1 : 1)) *
      (100 * (this.inputRuntime.scaleBendRange ?? 48)));
  entry.baseCents = baseCents;
  entry.hex._lastPitchBend14 = bend14;
  entry.hex._lastPitchBend21 = bend21;
  entry.hex._lastPitchBendCents = bentCents;
  if (applyTransferredPitchBend(entry.hex, { value14: bend14, value21: bend21, cents: bentCents })) return;
  if (bend21 != null) entry.hex.retune?.(bentCents, true, bend21);
  else entry.hex.retune?.(bentCents, true);
}

export function activeHexesForInputChannel(channel) {
  const entry = this.state.activeMidiByChannel.get(channel);
  if (!entry) return [];
  if (entry.hexes?.size) {
    return [...entry.hexes].filter((hex) => hex && !hex.release);
  }
  return entry.hex && !entry.hex.release ? [entry.hex] : [];
}

export function currentWheelPitchStateForHex(hex) {
  if (!hex || this.inputRuntime.mpeInput || this._wheelValue14 === 8192) return null;
  if (!this.inputRuntime.wheelToRecent || this.inputRuntime.pitchBendMode === "all") {
    const baseCents = hex._baseCents ?? hex.cents ?? 0;
    return {
      value14: this._wheelValue14,
      cents: baseCents + this._wheelBend,
    };
  }
  if (this.inputRuntime.pitchBendMode === "recency") {
    const { bentCents } = this._resolveRecencyWheelTarget(hex, this._wheelValue14);
    return {
      value14: this._wheelValue14,
      cents: bentCents,
    };
  }
  return null;
}

export function syncTransferredWheelBend(hex) {
  const state = this._currentWheelPitchStateForHex(hex);
  if (!state) return false;
  return synchronizeTransferredPitchBend(hex, state);
}

export function syncTransferredWheelBends() {
  if (this.inputRuntime.mpeInput || this._wheelValue14 === 8192) return;
  const syncedSources = new Set();
  for (const hex of this._allActiveHexes()) {
    const sourceHex = hex?._transferredSource ?? hex;
    if (!sourceHex?._transferProxy || syncedSources.has(sourceHex)) continue;
    syncedSources.add(sourceHex);
    this._syncTransferredWheelBend(sourceHex);
  }
}

export function getControllerState() {
  return {
    ccValues: Object.fromEntries(this._controllerCCValues),
    channelPressure: this._channelPressureValue,
    pitchBend14: this._wheelValue14,
  };
}

export function pushControllerStateToSynth() {
  if (this.synth?.rememberControllerState) {
    this.synth.rememberControllerState(this._getControllerState());
  }
  if (this.synth?.applyControllerState) {
    this.synth.applyControllerState(this._getControllerState());
  }
}

export function rememberControllerStateInSynth() {
  if (this.synth?.rememberControllerState) {
    this.synth.rememberControllerState(this._getControllerState());
  }
}

export function handleWheelBend(val14) {
  this._wheelValue14 = val14;
  if (!this.inputRuntime.wheelToRecent) {
    const norm = (val14 - 8192) / 8192;
    const rangeCents = this.inputRuntime.wheelUsesInterval
      ? scalaToCents(this.inputRuntime.wheelRange ?? "64/63")
      : (this.inputRuntime.wheelSemitones ?? 2) * 100;
    const offsetCents = norm * rangeCents;
    this._wheelBend = offsetCents;
    for (const hex of this._allActiveHexes()) {
      if (hex.standardWheelPassthroughOnly) continue;
      if (hex.standardWheelRetune) {
        hex.standardWheelRetune((hex._baseCents ?? hex.cents) + offsetCents);
      } else if (hex.retune) {
        hex.retune((hex._baseCents ?? hex.cents) + offsetCents, true);
      }
    }
    this._syncTransferredWheelBends();
    return;
  }

  const norm = (val14 - 8192) / 8192;

  if (this.inputRuntime.pitchBendMode === "all") {
    const rangeCents = scalaToCents(this.inputRuntime.wheelRange ?? "64/63");
    const offsetCents = norm * rangeCents;
    this._wheelBend = offsetCents;
    for (const hex of this._allActiveHexes()) {
      hex.retune((hex._baseCents ?? hex.cents) + offsetCents, true);
    }
    this._syncTransferredWheelBends();
    return;
  }

  const target = this.recencyStack.front;
  if (!target) return;

  if (this._wheelTarget !== target) {
    this._wheelTarget = target;
  }
  const { baseCents, bentCents } = this._resolveRecencyWheelTarget(target, val14);
  this._wheelBaseCents = baseCents;
  this._wheelBend = bentCents - baseCents;
  target.retune(bentCents, true);
  this._syncTransferredWheelBend(target);
}

export function handleIncomingWheelBend(val14) {
  this._wheelInputValue14 = val14;
  this._resetWheelInputState(false);
  this._wheelInputState.current = val14;
  this._wheelInputState.target = val14;
  this._handleWheelBend(val14);
}

export function applyWheelInputNow(val14) {
  this._wheelInputState.current = val14;
  this._wheelInputState.target = val14;
  this._handleWheelBend(val14);
}

export function resetWheelInputState(resetToCurrent = false) {
  if (resetToCurrent) {
    this._wheelInputState.current = this._wheelValue14;
    this._wheelInputState.target = this._wheelValue14;
  }
}

export function resolveRecencyWheelTarget(target, val14 = this._wheelValue14) {
  const baseCents = target?._baseCents ?? target?.cents ?? 0;
  const norm = (val14 - 8192) / 8192;

  let bentCents;
  if (
    this.inputRuntime.wheelScaleAware &&
    target?.cents_prev != null &&
    target?.cents_next != null
  ) {
    if (norm < 0) {
      bentCents = baseCents + norm * (baseCents - target.cents_prev);
    } else {
      bentCents = baseCents + norm * (target.cents_next - baseCents);
    }
  } else {
    const rangeCents = scalaToCents(this.inputRuntime.wheelRange ?? "64/63");
    bentCents = baseCents + norm * rangeCents;
  }

  return { baseCents, bentCents };
}

export function applyCurrentWheelToHex(hex) {
  if (!hex || this._wheelValue14 === 8192) return;
  if (hex.standardWheelPassthroughOnly) return;
  if (this.inputRuntime.wheelToRecent && this.inputRuntime.pitchBendMode === "recency") {
    return;
  }
  const baseCents = hex._baseCents ?? hex.cents;
  if (!this.inputRuntime.wheelToRecent) {
    hex.retune(baseCents + this._wheelBend, true);
    return;
  }
  if (this.inputRuntime.pitchBendMode === "all") {
    hex.retune(baseCents + this._wheelBend, true);
  }
}

export function reapplyCurrentWheelBend() {
  if (this.inputRuntime.mpeInput) return;
  if (this._wheelValue14 === 8192) return;
  if (this.inputRuntime.wheelToRecent && this.inputRuntime.pitchBendMode === "recency") {
    this._wheelTarget = null;
    this._wheelBaseCents = null;
  }
  this._handleWheelBend(this._wheelValue14);
}

export function retuneHexFromBase(hex, baseCents, bendOnly = false) {
  if (!hex?.retune || hex.release) return;
  hex._baseCents = baseCents;
  if ((this.inputRuntime.mpeInput || this.inputRuntime.perChannelExpression) && hex._inputChannel != null) {
    const channel = hex._inputChannel;
    const entry = this.state.activeMidiByChannel.get(channel) ?? { hex, baseCents };
    entry.baseCents = baseCents;
    this._applyMpePitchBend(entry, channel, this._mpeInputBendByChannel.get(channel) ?? 8192);
    return;
  }
  hex.retune(baseCents, bendOnly);
}

export function queueRetuneGlide(hex, targetBase, bendOnly = false) {
  if (!hex?.retune || hex.release) return;
  const currentBase = this._retuneGlides.get(hex)?.currentBase ?? hex._baseCents ?? hex.cents;
  this._retuneGlides.set(hex, { currentBase, targetBase, bendOnly });
}

export function kickRetuneGlides() {
  if (this._retuneGlides.size === 0) return;
  if (this._retuneGlideTimer == null) {
    this._retuneGlideLastTime = performance.now() - RETUNE_GLIDE_TICK_MS;
    this._retuneGlideTimer = setTimeout(this._tickRetuneGlides, 0);
  }
}

export function tickRetuneGlides() {
  this._retuneGlideTimer = null;
  if (this._retuneGlides.size === 0) {
    this._retuneGlideLastTime = 0;
    return;
  }

  const now = performance.now();
  const dt = this._retuneGlideLastTime
    ? Math.min(Math.max(now - this._retuneGlideLastTime, 1), 50)
    : RETUNE_GLIDE_TICK_MS;
  this._retuneGlideLastTime = now;

  let hasPending = false;
  for (const [hex, glide] of this._retuneGlides) {
    if (!hex?.retune || hex.release) {
      this._retuneGlides.delete(hex);
      continue;
    }
    const factor = 1 - Math.exp(-dt / RETUNE_GLIDE_TAU_MS);
    const desiredStep = (glide.targetBase - glide.currentBase) * factor;
    const maxStep = (RETUNE_GLIDE_MAX_CENTS_PER_SEC * dt) / 1000;
    const step = Math.sign(desiredStep) * Math.min(Math.abs(desiredStep), maxStep);
    let nextBase = glide.currentBase + step;
    if (Math.abs(glide.targetBase - nextBase) < RETUNE_GLIDE_SNAP_CENTS) {
      nextBase = glide.targetBase;
    } else {
      hasPending = true;
    }
    glide.currentBase = nextBase;
    this._retuneHexFromBase(hex, nextBase, glide.bendOnly);
    if (nextBase === glide.targetBase) this._retuneGlides.delete(hex);
  }

  this._refreshSoundingHexNeighbors();
  if (!this.inputRuntime.mpeInput && this._wheelValue14 !== 8192) {
    this._reapplyCurrentWheelBend();
  }

  if (hasPending || this._retuneGlides.size > 0) {
    this._retuneGlideTimer = setTimeout(this._tickRetuneGlides, RETUNE_GLIDE_TICK_MS);
  } else {
    this._retuneGlideLastTime = 0;
  }
}

export function reapplyCurrentInputBends() {
  if (this.inputRuntime.mpeInput) {
    for (const [channel, entry] of this.state.activeMidiByChannel) {
      if (!entry || entry.hex.release) continue;
      this._applyMpePitchBend(entry, channel, this._mpeInputBendByChannel.get(channel) ?? 8192);
    }
    return;
  }
  if (this.inputRuntime.perChannelExpression) {
    for (const [channel] of this.state.activeMidiByChannel) {
      const bend14 = this._mpeInputBendByChannel.get(channel) ?? 8192;
      for (const hex of this._activeHexesForInputChannel(channel)) {
        this._applyMpePitchBend(
          { hex, baseCents: hex._baseCents ?? hex.cents },
          channel,
          bend14,
        );
      }
    }
    return;
  }
  this._reapplyCurrentWheelBend();
}

export function refreshSoundingHexNeighbors() {
  const refresh = (hex) => {
    const pitchAtCoords = typeof this.hexCoordsToLiveCents === "function"
      ? this.hexCoordsToLiveCents(hex.coords)
      : this.hexCoordsToCents(hex.coords);
    const [, , , , , centsPrev, centsNext] = pitchAtCoords;
    hex.cents_prev = centsPrev;
    hex.cents_next = centsNext;
  };
  for (const hex of this._allActiveHexes()) refresh(hex);
  for (const [hex] of this.state.sustainedNotes) refresh(hex);
}

export function updateWheelTarget(smoothReturn = false) {
  if (this.inputRuntime.mpeInput || this.inputRuntime.perChannelExpression) {
    this._wheelTarget = null;
    this._wheelBaseCents = null;
    return;
  }

  const newFront = this.recencyStack.front;
  if (newFront === this._wheelTarget) return;

  this._wheelTarget = newFront;

  if (newFront) {
    this._wheelBaseCents = newFront._baseCents ?? newFront.cents;
    if (this.inputRuntime.wheelToRecent && this.inputRuntime.pitchBendMode === "recency") {
      const { baseCents, bentCents } = this._resolveRecencyWheelTarget(newFront, this._wheelValue14);
      this._wheelBaseCents = baseCents;
      this._wheelBend = bentCents - baseCents;
      if (smoothReturn && this._wheelValue14 !== 8192 && newFront?.retune) {
        this._queueRetuneGlide(newFront, baseCents, true);
        this._kickRetuneGlides();
      } else {
        newFront.retune(bentCents, true);
      }
    } else if (
      this._wheelBend !== 0 &&
      !newFront.standardWheelPassthroughOnly &&
      !newFront._wheelPrimedBeforeNoteOn
    ) {
      newFront.retune(this._wheelBaseCents + this._wheelBend);
    }
  } else {
    this._wheelBaseCents = null;
  }
}
