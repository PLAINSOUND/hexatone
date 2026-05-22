// This module owns live MIDI note input handling for Keys.
// It translates incoming note/channel events into canvas coords, applies the
// current controller/sequential mapping rules, and drives note-on/note-off
// lifecycle updates. It does not derive tuning or modulation history state.

import { notes } from "../midi_synth";
import { findNearestDegree } from "../input/scale-mapper.js";
import { debugLog } from "../debug/logging.js";
import {
  applyContinuumPitchShape,
  computeContinuumPitchBendCents,
  resolveHakenXGlideMode,
} from "../input/keys-expression-runtime.js";
import {
  resolveNonScaleNoteOffCoords,
  resolveNonScaleNoteOn,
} from "./input-address-runtime.js";

function usesPerChannelExpression(runtime) {
  return !!(runtime?.mpeInput || runtime?.perChannelExpression);
}

function continuumRasterVelocity(originalVelocity, pressureValue, controlValue) {
  const attack = Math.max(1, Math.min(127, Number(originalVelocity) || 1));
  const pressure = Math.max(1, Math.min(127, Number(pressureValue) || 127));
  const amount = Math.max(0, Math.min(127, Number(controlValue) || 0)) / 127;
  return Math.max(1, Math.min(127, Math.round(attack * (1 - amount) + pressure * amount)));
}

function continuumRasterStabilityMargin(controlValue) {
  const amount = Math.max(0, Math.min(100, Number(controlValue) || 0)) / 100;
  return 0.45 * amount;
}

function continuumRasterTargetSteps(currentSteps, targetFloat, stabilityControl) {
  const current = Number.isFinite(currentSteps) ? currentSteps : Math.round(targetFloat);
  const margin = continuumRasterStabilityMargin(stabilityControl);
  if (targetFloat >= current + 0.5 + margin) {
    return Math.floor(targetFloat + 0.5 - margin);
  }
  if (targetFloat <= current - 0.5 - margin) {
    return Math.ceil(targetFloat - 0.5 + margin);
  }
  return current;
}

function continuumPendingRasterTargetStep(currentSteps, targetFloat) {
  if (!Number.isFinite(currentSteps) || !Number.isFinite(targetFloat)) return null;
  if (targetFloat > currentSteps) return Math.max(currentSteps + 1, Math.ceil(targetFloat));
  if (targetFloat < currentSteps) return Math.min(currentSteps - 1, Math.floor(targetFloat));
  return null;
}

function continuumRasterTargetFloat(keys, hex, channel, bend14, scaleMode) {
  const effectiveMode = resolveHakenXGlideMode(keys.inputRuntime);
  const useScaleFollowing =
    effectiveMode === "raster_to_notes" &&
    keys.inputRuntime.layoutMode !== "sequential";
  const bendRangeSemitones = keys.settings.midiin_scale_bend_range ?? 48;
  const semitoneFloatOffset = ((bend14 - 8192) * bendRangeSemitones) / 8192;

  if (scaleMode) {
    const midiNote = (hex._notePlayed ?? 0) % 128;
    const baseHz = 440 * Math.pow(2, (midiNote - 69) / 12);
    const bentHz = baseHz * Math.pow(2, (semitoneFloatOffset * 100) / 1200);
    const bentCents = keys._resolveScaleInputPitchCents(channel, midiNote, bentHz);
    const result = findNearestDegree(
      bentCents,
      keys.tuning.scale,
      keys.tuning.equivInterval,
      keys.inputRuntime.scaleTolerance ?? 50,
      "accept",
    );
    return result?.steps ?? null;
  }
  if (useScaleFollowing) {
    if (hex._rasterOnsetSteps == null) return null;
    const scaleStepOffset = continuumScaleTrackingStepOffset(keys, bend14, 8192, false);
    return hex._rasterOnsetSteps + scaleStepOffset;
  }
  if (hex._rasterOnsetSteps == null) return null;
  return hex._rasterOnsetSteps + semitoneFloatOffset;
}

export function primeHakenRasterModeEntry(entry, channel) {
  const hex = entry?.hex;
  if (!hex || hex.release) return;
  const bend14 = this._mpeInputBendByChannel.get(channel);
  const bend21 = this._hakenMpeBend21ByChannel.get(channel) ?? null;
  const currentCenterCents = hex.coords ? this.hexCoordsToCents(hex.coords)?.[0] : null;
  const currentBentCents = bend14 != null
    ? computeContinuumPitchBendCents(this, entry, channel, bend14, bend21)
    : (hex._lastPitchBendCents ?? hex.cents ?? currentCenterCents);
  const entrySide = Number.isFinite(currentBentCents) && Number.isFinite(currentCenterCents)
    ? Math.sign(currentBentCents - currentCenterCents)
    : 0;
  hex._continuumRasterPendingHandoff = true;
  hex._continuumRasterPendingTargetSteps = null;
  hex._continuumRasterEntrySide = entrySide;
  hex._continuumRasterClampedAtCenter = entrySide === 0;
}

function pendingRasterReleases(keys) {
  if (!keys._pendingRasterAutoReleases) keys._pendingRasterAutoReleases = new Map();
  return keys._pendingRasterAutoReleases;
}

function registerPendingRasterRelease(keys, channel, notePlayed, entry) {
  const pending = pendingRasterReleases(keys);
  const channelEntries = pending.get(channel) ?? [];
  channelEntries.push({ notePlayed, ...entry });
  pending.set(channel, channelEntries);
}

function flushPendingRasterReleases(keys, channel, notePlayed = null) {
  const pending = keys._pendingRasterAutoReleases;
  if (!pending?.has(channel)) return;
  const channelEntries = pending.get(channel) ?? [];
  const keep = [];
  for (const entry of channelEntries) {
    if (notePlayed != null && entry.notePlayed !== notePlayed) {
      keep.push(entry);
      continue;
    }
    clearTimeout(entry.timeoutId);
    if (!entry.fired) {
      entry.fired = true;
      entry.flush();
    }
  }
  if (keep.length > 0) pending.set(channel, keep);
  else pending.delete(channel);
}

function flushAllPendingRasterReleases(keys) {
  const pending = keys._pendingRasterAutoReleases;
  if (!pending) return;
  for (const [channel] of pending) {
    flushPendingRasterReleases(keys, channel);
  }
}

function releaseContinuumRasterHex(keys, channel, hex, releaseVelocity, notePlayed) {
  const minDurationMs = Math.max(
    0,
    Math.min(100, Number(keys.inputRuntime.hakenNoteOffDelay ?? 0) || 0),
  );
  const startedAt = Number(hex?._rasterStartedAt);
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : minDurationMs;
  const remainingMs = Math.max(0, minDurationMs - elapsedMs);
  debugLog("osc", "releaseContinuumRasterHex", {
    channel,
    coords: hex?.coords,
    releaseVelocity,
    notePlayed,
    minDurationMs,
    elapsedMs,
    remainingMs,
    synthFamily: keys.synth?.family,
  });
  if (remainingMs <= 0) {
    keys.noteOff(hex, releaseVelocity);
    return;
  }

  const originalNoteOff = hex.noteOff;
  let timeoutEntry = null;
  const flush = () => {
    if (!originalNoteOff) return;
    originalNoteOff.call(hex, releaseVelocity);
    if (hex?.coords) keys.hexOff(hex.coords);
  };
  hex.noteOff = () => {
    timeoutEntry = {
      timeoutId: setTimeout(() => {
        timeoutEntry.fired = true;
        flush();
        const pending = keys._pendingRasterAutoReleases;
        const channelEntries = pending?.get(channel) ?? [];
        const keep = channelEntries.filter((entry) => entry !== timeoutEntry);
        if (keep.length > 0) pending.set(channel, keep);
        else pending?.delete(channel);
      }, remainingMs),
      flush,
      fired: false,
    };
    registerPendingRasterRelease(keys, channel, notePlayed, timeoutEntry);
  };
  keys.noteOff(hex, releaseVelocity);
  hex.noteOff = originalNoteOff;
}

export function acceptsMpeInputChannel(channel) {
  if (!this.inputRuntime.mpeInput) return true;
  const lo = this.settings.midiin_mpe_lo_ch ?? 2;
  const hi = this.settings.midiin_mpe_hi_ch ?? 15;
  return channel >= lo && channel <= hi;
}

function ensureActiveMidiChannelEntry(channel) {
  let entry = this.state.activeMidiByChannel.get(channel);
  if (!entry) {
    entry = {
      hex: null,
      baseCents: null,
      hexes: new Set(),
    };
    this.state.activeMidiByChannel.set(channel, entry);
  } else if (!entry.hexes) {
    entry.hexes = new Set(entry.hex ? [entry.hex] : []);
  }
  return entry;
}

function isHakenPitchBendingCollisionAvoidanceActive(keys) {
  return (
    keys.controller?.id === "hakenaudio" &&
    keys.inputRuntime?.mpeInput &&
    resolveHakenXGlideMode(keys.inputRuntime) === "pitch_bending"
  );
}

function activeHexAtCoords(keys, coords) {
  for (const hex of keys._allActiveHexes()) {
    if (!hex || hex.release || !hex.coords) continue;
    if (hex.coords.equals(coords)) return hex;
  }
  return null;
}

function chooseAlternateCoordsForStep(keys, steps, inputAddress, preferredCoords) {
  const fullyVisible = keys.coordResolver.stepsToFullyVisibleCoords(steps);
  const candidates = fullyVisible.length > 0
    ? fullyVisible
    : keys.coordResolver.stepsToVisibleCoords(steps);
  if (candidates.length <= 1) return preferredCoords;

  const available = candidates.filter((coords) => !keys._isCoordActive(coords));
  if (available.length === 0) return preferredCoords;
  if (!keys._isCoordActive(preferredCoords)) return preferredCoords;

  const targetScreen = keys.coordResolver._displayScreen(preferredCoords);
  let best = available[0];
  let bestDist = Infinity;
  for (const coords of available) {
    const screen = keys.coordResolver._displayScreen(coords);
    const dx = screen.x - targetScreen.x;
    const dy = screen.y - targetScreen.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = coords;
    }
  }
  return best;
}

function maybeResolveDistinctHakenCoords(keys, coords, steps, inputAddress) {
  if (!isHakenPitchBendingCollisionAvoidanceActive(keys)) return coords;
  if (steps == null || !coords || !inputAddress) return coords;
  const occupyingHex = activeHexAtCoords(keys, coords);
  if (!occupyingHex) return coords;
  if (occupyingHex._inputChannel === inputAddress.channel) return coords;
  return chooseAlternateCoordsForStep(keys, steps, inputAddress, coords);
}

function findLatestActiveHexForChannel(channel) {
  const activeHexes = new Set(this.state.activeMidi.values());
  for (const hex of this.recencyStack.all) {
    if (hex?._inputChannel === channel && !hex.release && activeHexes.has(hex)) {
      return hex;
    }
  }
  return null;
}

export function applyChannelOffset(baseCoords, channel) {
  const stepsPerChannel = this.inputRuntime.stepsPerChannel ?? this.tuning.equivSteps;
  if (!stepsPerChannel) return baseCoords;
  const channelOffset = this.channelToStepsOffset(channel);
  if (channelOffset === 0) return baseCoords;
  const [, , baseSteps] = this.hexCoordsToCents(baseCoords);
  return this.bestVisibleCoord(baseSteps + channelOffset) ?? baseCoords;
}

export function normalizeInputAddress(channel, note) {
  return this.controller?.normalizeInput?.(channel, note, this.settings) ?? { channel, note };
}

export function resolveScaleInputPitchCents(channel, note, fallbackPitchHz) {
  const controllerPitchCents = this.controller?.resolveScaleInputPitchCents?.(
    channel,
    note,
    this.settings,
  );
  const absolutePitchCents =
    controllerPitchCents != null
      ? controllerPitchCents
      : (() => {
          const degree0toRefCents = this.tuning.degree0toRef_asArray[0];
          const degree0Hz = this.settings.fundamental / Math.pow(2, degree0toRefCents / 1200);
          return 1200 * Math.log2(fallbackPitchHz / degree0Hz);
        })();

  if (this.settings.modulation_style !== "fixed_do") return absolutePitchCents;

  const transpositionCents = Number(this._activeFrame?.()?.transpositionCents ?? 0);
  if (!Number.isFinite(transpositionCents) || transpositionCents === 0) {
    return absolutePitchCents;
  }

  return absolutePitchCents - transpositionCents;
}

function pitchHzForScaleInput(event) {
  if (this.inputRuntime.mpeInput) {
    const preBend21 = this._scaleModePreBend21.get(event.message.channel);
    const preBend = this._scaleModePreBend.get(event.message.channel) ?? 8192;
    const norm = Number.isFinite(preBend21)
      ? (preBend21 - 1048576) / 1048576
      : (preBend - 8192) / 8192;
    const bendRangeCents = (this.inputRuntime.scaleBendRange ?? 48) * 100;
    const baseHz = 440 * Math.pow(2, (event.note.number - 69) / 12);
    return baseHz * Math.pow(2, (norm * bendRangeCents) / 1200);
  }
  return (
    this._mtsInputTable.get(event.note.number) ??
    440 * Math.pow(2, (event.note.number - 69) / 12)
  );
}

function continuumScaleTrackingStepOffset(keys, bend14, anchor14 = 8192) {
  let norm = (bend14 - anchor14) / 8192;
  const degreeSpan = Math.max(0, Number(keys.inputRuntime.scaleBendRange ?? 48) || 0);
  return applyContinuumPitchShape(norm * degreeSpan, keys.inputRuntime);
}

function recentPerChannelExpressionValue(map, channel, maxAgeMs = 50) {
  const entry = map?.get(channel);
  if (!entry) return null;
  const ageMs = Date.now() - (entry.time ?? 0);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) return null;
  return entry.value;
}

export function midinoteOn(event) {
  if (!this._acceptsMpeInputChannel(event.message.channel)) return;
  const bend = this.bend || 0;
  const notePlayed = event.note.number + 128 * (event.message.channel - 1);
  const velocityPlayed = event.note.rawAttack;
  this._suppressedMidiNotes?.delete(notePlayed);

  const existingHex = this.state.activeMidi.get(notePlayed);
  if (existingHex) {
    this.state.activeMidi.delete(notePlayed);
    if (
      usesPerChannelExpression(this.inputRuntime) &&
      this.state.activeMidiByChannel.get(event.message.channel)?.hex === existingHex
    ) {
      this.state.activeMidiByChannel.delete(event.message.channel);
    }
    this.recencyStack.remove(existingHex);
    existingHex.noteOff(0);
    this._trackRecentlyReleasedHex(existingHex);
    this._updateWheelTarget(false);
  }

  let coords;
  let liveInputAddress = null;

  if (this.inputRuntime.target === "scale") {
    const pitchCents = this._resolveScaleInputPitchCents(
      event.message.channel,
      event.note.number,
      pitchHzForScaleInput.call(this, event),
    );
    const result = findNearestDegree(
      pitchCents,
      this.tuning.scale,
      this.tuning.equivInterval,
      this.inputRuntime.scaleTolerance ?? 50,
      this.inputRuntime.scaleFallback || "discard",
    );
    if (result === null) return;
    if (!this.coordResolver.stepsTable) this.coordResolver.buildStepsTable();
    const inputAddress = {
      channel: event.message.channel,
      note: event.note.number,
    };
    coords = this.coordResolver.coordForSteps(result.steps, inputAddress);
    coords = maybeResolveDistinctHakenCoords(this, coords, result.steps, inputAddress);
    if (usesPerChannelExpression(this.inputRuntime)) {
      liveInputAddress = inputAddress;
    }
  } else {
    const resolved = resolveNonScaleNoteOn(this, event);
    if (!resolved) return;
    ({ coords, liveInputAddress } = resolved);
    if (
      isHakenPitchBendingCollisionAvoidanceActive(this) &&
      liveInputAddress &&
      !this.controllerMap
    ) {
      const steps = this.coordResolver.noteToSteps(liveInputAddress.note, liveInputAddress.channel);
      coords = maybeResolveDistinctHakenCoords(this, coords, steps, liveInputAddress);
    }
    if (
      this.inputRuntime.layoutMode === "sequential" &&
      !this.settings.output_mts &&
      this.midiout_data &&
      this.settings.midi_channel >= 0
    ) {
      this.midiout_data.sendNoteOn(event.note.number, {
        channels: this.settings.midi_channel + 1,
        rawAttack: velocityPlayed,
      });
    }
  }

  if (coords === null) return;
  if (this._midiLatchToggle(coords, velocityPlayed)) return;
  const hex = this.hexOn(coords, notePlayed, velocityPlayed, bend, { liveInputAddress });
  if (!hex) {
    if (this._lastHexOnSuppressed) this._suppressedMidiNotes?.add(notePlayed);
    return;
  }
  if (usesPerChannelExpression(this.inputRuntime)) hex._inputChannel = event.message.channel;
  hex._notePlayed = notePlayed;
  // Store the original attack velocity so raster retriggers can scale by Z pressure.
  hex._velocityPlayed = velocityPlayed;
  // Real note-ons always start from their raw attack. Raster-generated
  // velocity shaping only begins once this touch has received fresh Z data.
  hex._pressureSeenSinceOnset = false;
  if (this.inputRuntime.mpeInput) {
    const recentAftertouch = recentPerChannelExpressionValue(
      this._mpeInputAftertouchByChannel,
      event.message.channel,
    );
    const recentAftertouchEntry = this._mpeInputAftertouchByChannel.get(event.message.channel);
    if (recentAftertouch != null) {
      if (recentAftertouchEntry?.value14 != null) {
        this._applyPolyAftertouch(hex, recentAftertouch, recentAftertouchEntry.value14);
      } else {
        this._applyPolyAftertouch(hex, recentAftertouch);
      }
    }
    const recentCC74 = recentPerChannelExpressionValue(this._mpeInputCC74ByChannel, event.message.channel);
    const recentCC74Entry = this._mpeInputCC74ByChannel.get(event.message.channel);
    if (recentCC74 != null) {
      if (recentCC74Entry?.value14 != null) {
        this._applyTimbreCC74(hex, recentCC74, recentCC74Entry.value14);
      } else {
        this._applyTimbreCC74(hex, recentCC74);
      }
    }
  }
  // Raster mode initialisation: store the onset step so hakenRasterBend can
  // compute offsets from it, and seed _rasterSteps (the last-triggered position)
  // to semitone offset 0 so the first bend event doesn't cause a spurious retrigger.
  if (
    this.controller?.id === "hakenaudio" &&
    this.inputRuntime.mpeInput
  ) {
    hex._rasterStartedAt = Date.now();
    hex._rasterLastTriggerAt = hex._rasterStartedAt;
    if (this.inputRuntime.target === "scale" && coords !== null) {
      // Scale mode: onset is the distance (full step offset from origin) of the
      // snapped hex — the same space findNearestDegree.steps uses.
      const [, , distance] = this.hexCoordsToCents(coords);
      hex._rasterOnsetSteps = distance ?? 0;
    } else {
      // Hex-layout mode: onset step via noteToSteps which includes channel offset.
      // Subsequent bends add a semitoneOffset to this value directly, avoiding
      // any double-application of the channel offset.
      hex._rasterOnsetSteps = this.coordResolver.noteToSteps(
        notePlayed % 128,
        event.message.channel,
      );
    }
    // _rasterSteps tracks the last triggered step (semitoneOffset = 0 at onset).
    hex._rasterSteps = hex._rasterOnsetSteps;
  }
  this.state.activeMidi.set(notePlayed, hex);
  if (usesPerChannelExpression(this.inputRuntime)) {
    const entry = ensureActiveMidiChannelEntry.call(this, event.message.channel);
    entry.hex = hex;
    entry.baseCents = hex._baseCents ?? hex.cents;
    entry.hexes.add(hex);
    const bend14 = this._mpeInputBendByChannel.get(event.message.channel);
    if (bend14 != null && bend14 !== 8192) {
      const primed = hex._mpePrimedBeforeNoteOn;
      if (primed?.channel === event.message.channel && primed?.bend14 === bend14) {
        hex._lastPitchBend14 = bend14;
        hex._lastPitchBend21 = primed?.bend21 ?? null;
        hex._lastPitchBendCents = primed.bentCents;
        delete hex._mpePrimedBeforeNoteOn;
      } else {
        this._applyMpePitchBend(
          entry,
          event.message.channel,
          bend14,
          this._hakenMpeBend21ByChannel.get(event.message.channel) ?? null,
        );
      }
    }
  }
  this.coordResolver.lastMidiCoords = this.hexCoordsToScreen(coords);
  if (liveInputAddress) this.coordResolver.rememberCoordsForInputAddress(liveInputAddress, coords);
}

export function midinoteOff(event) {
  if (!this._acceptsMpeInputChannel(event.message.channel)) return;
  const notePlayed = event.note.number + 128 * (event.message.channel - 1);
  flushPendingRasterReleases(this, event.message.channel, notePlayed);
  if (this._suppressedMidiNotes?.has(notePlayed)) {
    this._suppressedMidiNotes.delete(notePlayed);
    return;
  }
  const hex = this.state.activeMidi.get(notePlayed);
  let coordsList;

  if (hex?.coords) {
    coordsList = [hex.coords];
  } else if (this.inputRuntime.target === "scale") {
    const pitchCents = this._resolveScaleInputPitchCents(
      event.message.channel,
      event.note.number,
      pitchHzForScaleInput.call(this, event),
    );
    const result = findNearestDegree(
      pitchCents,
      this.tuning.scale,
      this.tuning.equivInterval,
      this.inputRuntime.scaleTolerance ?? 50,
      "accept",
    );
    coordsList = result === null ? [] : this.coordResolver.stepsToVisibleCoords(result.steps);
  } else {
    if (
      this.inputRuntime.layoutMode === "sequential" &&
      !this.settings.output_mts &&
      this.midiout_data &&
      this.settings.midi_channel >= 0
    ) {
      this.midiout_data.sendNoteOff(event.note.number, {
        channels: this.settings.midi_channel + 1,
        rawRelease: event.note.rawRelease,
      });
    }
    coordsList = resolveNonScaleNoteOffCoords(
      this,
      event.message.channel,
      event.note.number,
      event.message.channel,
    );
  }

  if (hex) {
    this.noteOff(hex, event.note.rawRelease);
    this.state.activeMidi.delete(notePlayed);
    if (usesPerChannelExpression(this.inputRuntime)) {
      const entry = this.state.activeMidiByChannel.get(event.message.channel);
      if (entry?.hexes) entry.hexes.delete(hex);
      if (entry?.hex === hex) {
        const replacementHex = findLatestActiveHexForChannel.call(this, event.message.channel);
        if (replacementHex) {
          entry.hex = replacementHex;
          entry.baseCents = replacementHex._baseCents ?? replacementHex.cents;
        } else {
          this.state.activeMidiByChannel.delete(event.message.channel);
          this._mpeInputBendByChannel.delete(event.message.channel);
          this._mpeInputBendSmoothingByChannel.delete(event.message.channel);
          this._mpeInputAftertouchByChannel.delete(event.message.channel);
          this._mpeInputCC74ByChannel.delete(event.message.channel);
          this._hakenMpeBend21ByChannel.delete(event.message.channel);
          this._hakenMpePressure14ByChannel.delete(event.message.channel);
          this._hakenMpeCC7414ByChannel.delete(event.message.channel);
          this._hakenMpePlusLsbByChannel.delete(event.message.channel);
          this._scaleModePreBend21.delete(event.message.channel);
        }
      } else if (entry && entry.hexes?.size === 0) {
        this.state.activeMidiByChannel.delete(event.message.channel);
        this._mpeInputBendByChannel.delete(event.message.channel);
        this._mpeInputBendSmoothingByChannel.delete(event.message.channel);
        this._mpeInputAftertouchByChannel.delete(event.message.channel);
        this._mpeInputCC74ByChannel.delete(event.message.channel);
        this._hakenMpeBend21ByChannel.delete(event.message.channel);
        this._hakenMpePressure14ByChannel.delete(event.message.channel);
        this._hakenMpeCC7414ByChannel.delete(event.message.channel);
        this._hakenMpePlusLsbByChannel.delete(event.message.channel);
        this._scaleModePreBend21.delete(event.message.channel);
      }
    }
    this._settleModulationAfterActiveRelease();
  }
  for (const coords of coordsList) {
    if (!this.state.sustain) this.hexOff(coords);
  }
}

export function allnotesOff() {
  flushAllPendingRasterReleases(this);
  this._retuneGlides.clear();
  this._suppressedMidiNotes?.clear();
  if (this._retuneGlideTimer != null) {
    clearTimeout(this._retuneGlideTimer);
    this._retuneGlideTimer = null;
  }
  this._resetWheelInputState(true);
  this._retuneGlideLastTime = 0;
  for (const notePlayed of notes.played) {
    const note = notePlayed % 128;
    const channel = Math.floor(notePlayed / 128) + 1;
    const hex = this.state.activeMidi.get(notePlayed);

    let coordsList;
    if (hex?.coords) {
      coordsList = [hex.coords];
    } else {
      coordsList = resolveNonScaleNoteOffCoords(this, channel, note, channel);
    }

    if (hex) {
      this.noteOff(hex, 64);
      this.state.activeMidi.delete(notePlayed);
      this._settleModulationAfterActiveRelease();
    }
    for (const coords of coordsList) {
      if (!this.state.sustain) this.hexOff(coords);
    }
  }
  notes.played = [];
  this.state.activeMidiByChannel.clear();
  this._mpeInputBendByChannel.clear();
  this._mpeInputBendSmoothingByChannel.clear();
  this._mpeInputAftertouchByChannel.clear();
  this._mpeInputCC74ByChannel.clear();
  this._hakenMpeBend21ByChannel.clear();
  this._hakenMpePressure14ByChannel.clear();
  this._hakenMpeCC7414ByChannel.clear();
  this._hakenMpePlusLsbByChannel.clear();
  this._scaleModePreBend21.clear();
}

/**
 * Haken Continuum "Raster to Notes" bend handler.
 *
 * Called from applyMpePitchBend (keys-expression-runtime.js) when the
 * controller is a Haken Continuum and hakenXGlideMode === "raster_to_notes".
 *
 * Translates continuous X-axis pitch bend into discrete note retriggering:
 * each time the bend crosses into a new MIDI step (hex-layout mode) or new
 * scale degree (scale mode), a note-off is fired on the outgoing hex and a
 * note-on on the incoming one. Velocity for the new note equals the original
 * attack velocity scaled by the current Z (aftertouch/channel pressure), so
 * lighter touches produce quieter retriggers.
 *
 * Lives in keys-midi-input.js so it can use ensureActiveMidiChannelEntry and
 * share the same state-management logic as midinoteOn / midinoteOff.
 */
export function hakenRasterBend(entry, channel, bend14, scaleMode) {
  const hex = entry.hex;
  if (!hex || hex.release) return;
  const targetStepFloat = continuumRasterTargetFloat(this, hex, channel, bend14, scaleMode);
  if (!Number.isFinite(targetStepFloat)) return;

  const currentSteps = Number.isFinite(hex._rasterSteps)
    ? hex._rasterSteps
    : Math.round(targetStepFloat);
  let newSteps = continuumRasterTargetSteps(
    currentSteps,
    targetStepFloat,
    this.inputRuntime.hakenRasterStability ?? 25,
  );

  if (hex._continuumRasterPendingHandoff) {
    let pendingTarget = Number.isFinite(hex._continuumRasterPendingTargetSteps)
      ? hex._continuumRasterPendingTargetSteps
      : continuumPendingRasterTargetStep(currentSteps, targetStepFloat);
    hex._continuumRasterPendingTargetSteps = pendingTarget;
    const bend21 = this._hakenMpeBend21ByChannel.get(channel) ?? null;
    const bentCents = computeContinuumPitchBendCents(this, entry, channel, bend14, bend21);
    const currentCenterCents = hex.coords ? this.hexCoordsToCents(hex.coords)?.[0] : null;
    const retuneDuringHandoff = () => {
      if (!Number.isFinite(bentCents)) return;
      let outputCents = bentCents;
      if (Number.isFinite(currentCenterCents)) {
        if (hex._continuumRasterClampedAtCenter) {
          outputCents = currentCenterCents;
        } else if (hex._continuumRasterEntrySide < 0 && bentCents >= currentCenterCents) {
          outputCents = currentCenterCents;
          hex._continuumRasterClampedAtCenter = true;
        } else if (hex._continuumRasterEntrySide > 0 && bentCents <= currentCenterCents) {
          outputCents = currentCenterCents;
          hex._continuumRasterClampedAtCenter = true;
        }
      }
      hex._lastPitchBend14 = bend14;
      hex._lastPitchBend21 = bend21;
      hex._lastPitchBendCents = outputCents;
      if (bend21 != null) hex.retune?.(outputCents, true, bend21);
      else hex.retune?.(outputCents, true);
    };
    if (!Number.isFinite(pendingTarget) || pendingTarget === currentSteps) {
      retuneDuringHandoff();
      return;
    }
    const currentDirection = Math.sign(targetStepFloat - currentSteps);
    const pendingDirection = Math.sign(pendingTarget - currentSteps);
    if (currentDirection !== 0 && currentDirection !== pendingDirection) {
      pendingTarget = continuumPendingRasterTargetStep(currentSteps, targetStepFloat);
      hex._continuumRasterPendingTargetSteps = pendingTarget;
    }
    const liveInputAddress = { channel, note: hex._notePlayed ?? 0 };
    const pendingCoords = Number.isFinite(pendingTarget)
      ? this.coordResolver.coordForSteps(pendingTarget, liveInputAddress)
      : null;
    const pendingCenterCents = pendingCoords ? this.hexCoordsToCents(pendingCoords)?.[0] : null;
    if (
      Number.isFinite(pendingTarget) &&
      Number.isFinite(bentCents) &&
      Number.isFinite(pendingCenterCents) &&
      ((pendingTarget > currentSteps && bentCents < pendingCenterCents) ||
        (pendingTarget < currentSteps && bentCents > pendingCenterCents))
    ) {
      retuneDuringHandoff();
      return;
    }
    if (Number.isFinite(pendingTarget)) {
      newSteps = pendingTarget;
      hex._continuumRasterPendingHandoff = false;
      hex._continuumRasterPendingTargetSteps = null;
      hex._continuumRasterEntrySide = 0;
      hex._continuumRasterClampedAtCenter = false;
    }
  }

  // No crossing yet — nothing to retrigger.
  if (currentSteps === newSteps) return;

  const throttleMs = Math.max(
    0,
    Math.min(100, Number(this.inputRuntime.hakenRasterThrottleMs ?? 10) || 0),
  );
  const lastTriggerAt = Number(hex._rasterLastTriggerAt ?? hex._rasterStartedAt ?? 0);
  const now = Date.now();
  if (throttleMs > 0 && now - lastTriggerAt < throttleMs) return;

  const notePlayed = hex._notePlayed ?? null;

  // --- Resolve target coordinates ---
  const liveInputAddress = { channel, note: notePlayed ?? 0 };
  const newCoords = this.coordResolver.coordForSteps(newSteps, liveInputAddress);
  if (!newCoords) return;

  // --- Velocity: blend original attack with current Z pressure according to
  // the Continuum-specific pressure→velocity control.
  const originalVelocity =
    hex._velocityPlayed ?? hex.velocity_played ?? hex.velocity ?? this.settings.midi_velocity ?? 72;
  const zPressure = hex._pressureSeenSinceOnset
    ? (hex._lastAftertouch ?? originalVelocity)
    : originalVelocity;
  const pressureVelocity = this.inputRuntime.hakenPressureVelocity ?? 0;
  const newVelocity = continuumRasterVelocity(originalVelocity, zPressure, pressureVelocity);

  debugLog("osc", "hakenRasterBend crossing", {
    channel,
    scaleMode,
    oldCoords: hex.coords,
    oldSteps: currentSteps,
    newSteps,
    targetStepFloat,
    newCoords,
    bend14,
    notePlayed,
    newVelocity,
    throttleMs,
    pressureSeenSinceOnset: hex._pressureSeenSinceOnset,
    lastAftertouch: hex._lastAftertouch,
    synthFamily: this.synth?.family,
  });

  // --- Note-off on the outgoing hex ---
  // noteOff() handles sustain pedal logic, recencyStack, and synth MIDI output.
  releaseContinuumRasterHex(this, channel, hex, newVelocity, notePlayed);
  // Clean state maps so the channel slot is free for the new hex.
  if (notePlayed != null) this.state.activeMidi.delete(notePlayed);
  // Remove old hex from the channel entry but keep the entry object alive —
  // we will update it in-place below so the outer activeMidiByChannel reference
  // held by the pitchbend listener remains valid.
  const channelEntry = this.state.activeMidiByChannel.get(channel);
  if (channelEntry) {
    channelEntry.hexes?.delete(hex);
  }

  // Redraw released hex in its unpressed colour.
  if (hex.coords) this.hexOff(hex.coords);

  // --- Note-on at new coords ---
  // Temporarily set the channel's bend to 8192 so hexOn's MPE pre-bend
  // priming block doesn't apply an extra offset on the new note's centre pitch.
  this._mpeInputBendByChannel.set(channel, 8192);

  const newHex = this.hexOn(newCoords, notePlayed, newVelocity, 0, {
    liveInputAddress,
    rasterGenerated: true,
  });
  if (!newHex) return;

  // Restore the live bend value so subsequent bend events route correctly.
  this._mpeInputBendByChannel.set(channel, bend14);

  // --- Propagate metadata to the new hex ---
  newHex._inputChannel = channel;
  newHex._notePlayed = notePlayed;
  newHex._velocityPlayed = originalVelocity;
  newHex._rasterStartedAt = now;
  newHex._rasterOnsetSteps = hex._rasterOnsetSteps; // fixed onset — never changes during a hold
  newHex._rasterSteps = newSteps;                   // current triggered position
  newHex._rasterLastTriggerAt = now;
  newHex._continuumRasterPendingHandoff = false;
  newHex._continuumRasterPendingTargetSteps = null;
  newHex._continuumRasterEntrySide = 0;
  newHex._continuumRasterClampedAtCenter = false;
  newHex._scaleModeBendAnchor14 = hex._scaleModeBendAnchor14;
  newHex._scaleModeBendAnchor21 = hex._scaleModeBendAnchor21;
  newHex._lastPitchBend14 = hex._lastPitchBend14;
  newHex._lastPitchBend21 = hex._lastPitchBend21;
  newHex._lastPitchBendCents = hex._lastPitchBendCents;
  newHex._lastAftertouch = hex._lastAftertouch;
  newHex._lastAftertouch14 = hex._lastAftertouch14;
  newHex._lastCC74 = hex._lastCC74;
  newHex._lastCC7414 = hex._lastCC7414;
  newHex._pressureSeenSinceOnset = !!hex._pressureSeenSinceOnset;

  // --- Update state maps (mirrors midinoteOn post-hexOn block) ---
  if (notePlayed != null) this.state.activeMidi.set(notePlayed, newHex);
  this.coordResolver.rememberCoordsForInputAddress(liveInputAddress, newCoords);

  const updatedEntry = ensureActiveMidiChannelEntry.call(this, channel);
  updatedEntry.hex = newHex;
  updatedEntry.baseCents = newHex._baseCents ?? newHex.cents;
  updatedEntry.hexes.add(newHex);

  // Continuum raster retriggers should inherit the current expressive state
  // immediately at onset so the rebuilt note does not jump in timbre or
  // pressure response while waiting for the next incoming Y/Z update.
  if (hex._lastAftertouch != null) {
    if (hex._lastAftertouch14 != null) this._applyPolyAftertouch(newHex, hex._lastAftertouch, hex._lastAftertouch14);
    else this._applyPolyAftertouch(newHex, hex._lastAftertouch);
  }
  if (hex._lastCC74 != null) {
    if (hex._lastCC7414 != null) this._applyTimbreCC74(newHex, hex._lastCC74, hex._lastCC7414);
    else this._applyTimbreCC74(newHex, hex._lastCC74);
  }
}
