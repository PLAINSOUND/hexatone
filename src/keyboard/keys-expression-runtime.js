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
      const managerCh = parseInt(this.settings.midiin_mpe_manager_ch ?? this.settings.mpe_manager_ch) || 1;
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
      const managerCh = parseInt(this.settings.midiin_mpe_manager_ch ?? this.settings.mpe_manager_ch) || 1;
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
      const managerCh = parseInt(this.settings.midiin_mpe_manager_ch ?? this.settings.mpe_manager_ch) || 1;
      mpeOutput.sendPitchBend(normalized, { channels: managerCh });
    }
  }
}

export function applyPolyAftertouch(hex, value) {
  if (!hex || hex.release) return;
  const aftertouch = Math.max(0, Math.min(127, Number(value) || 0));
  hex._lastAftertouch = aftertouch;
  if (applyTransferredSourceAftertouch(hex, aftertouch)) return;
  hex.aftertouch?.(aftertouch);
}

export function applyTimbreCC74(hex, value) {
  if (!hex || hex.release) return;
  const cc74 = Math.max(0, Math.min(127, Number(value) || 0));
  hex._lastCC74 = cc74;
  if (applyTransferredCC74(hex, cc74)) return;
  hex.cc74?.(cc74);
}

export function normalizePitchBend14(value) {
  const bend = Number(value);
  if (!Number.isFinite(bend)) return 8192;
  return Math.max(0, Math.min(16383, bend));
}

export function applyMpePitchBend(entry, channel, value14) {
  if (!entry?.hex || entry.hex.release) return;
  const bend14 = this._normalizePitchBend14(value14);
  this._mpeInputBendByChannel.set(channel, bend14);
  const continuumScaleMode =
    this.controller?.id === "hakenaudio" &&
    this.inputRuntime.mpeInput &&
    this.inputRuntime.target === "scale";
  const continuumHexMode =
    this.controller?.id === "hakenaudio" &&
    this.inputRuntime.mpeInput &&
    this.inputRuntime.target !== "scale";
  const rasterMode =
    (continuumScaleMode || continuumHexMode) &&
    this.inputRuntime.hakenXGlideMode === "raster_to_notes";

  if (rasterMode) {
    // Delegate to keys-midi-input.js where ensureActiveMidiChannelEntry is available.
    this._hakenRasterBend(entry, channel, bend14, continuumScaleMode);
    return;
  }

  const anchor14 = (
    continuumScaleMode &&
    entry.hex._scaleModeBendAnchor14 != null
  )
    ? this._normalizePitchBend14(entry.hex._scaleModeBendAnchor14)
    : 8192;
  let norm = (bend14 - anchor14) / 8192;
  if (!continuumScaleMode && this.inputRuntime.bendFlip) norm = -norm;
  if (continuumScaleMode) {
    const scaleFactor = Math.max(
      0.25,
      Math.min(2, Number(this.inputRuntime.hakenScaleBendFactor ?? 1) || 1),
    );
    const shapingControl = Math.max(
      0,
      Math.min(100, Number(this.inputRuntime.hakenXGlideShaping ?? 0) || 0),
    );
    const shaping = (shapingControl / 100) * 8;
    const exponent = 1 + shaping * 0.06;
    const absNorm = Math.min(1, Math.abs(norm));
    norm = Math.sign(norm) * Math.pow(absNorm, exponent) * scaleFactor;
  }
  const rangeCents = 100 * (this.settings.midiin_scale_bend_range ?? 48);
  const baseCents = entry.hex._baseCents ?? entry.baseCents ?? entry.hex.cents;
  const bentCents = baseCents + norm * rangeCents;
  entry.baseCents = baseCents;
  entry.hex._lastPitchBend14 = bend14;
  entry.hex._lastPitchBendCents = bentCents;
  if (applyTransferredPitchBend(entry.hex, { value14: bend14, cents: bentCents })) return;
  entry.hex.retune?.(bentCents, true);
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
    const [, , , , , centsPrev, centsNext] = this.hexCoordsToCents(hex.coords);
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
