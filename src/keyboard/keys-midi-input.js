import { notes } from "../midi_synth";
import { findNearestDegree } from "../input/scale-mapper.js";

function usesPerChannelExpression(runtime) {
  return !!(runtime?.mpeInput || runtime?.perChannelExpression);
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
  if (controllerPitchCents != null) return controllerPitchCents;

  const degree0toRefCents = this.tuning.degree0toRef_asArray[0];
  const degree0Hz = this.settings.fundamental / Math.pow(2, degree0toRefCents / 1200);
  return 1200 * Math.log2(fallbackPitchHz / degree0Hz);
}

function pitchHzForScaleInput(event) {
  if (this.inputRuntime.mpeInput) {
    const preBend = this._scaleModePreBend.get(event.message.channel) ?? 8192;
    const norm = (preBend - 8192) / 8192;
    const bendRange = this.inputRuntime.scaleBendRange ?? 48;
    const baseHz = 440 * Math.pow(2, (event.note.number - 69) / 12);
    return baseHz * Math.pow(2, (norm * bendRange) / 12);
  }
  return (
    this._mtsInputTable.get(event.note.number) ??
    440 * Math.pow(2, (event.note.number - 69) / 12)
  );
}

function coordsForKnownController(event) {
  const lookupChannel = this.controller.multiChannel ? event.message.channel : 1;
  const baseCoords = this.controllerMap.get(`${lookupChannel}.${event.note.number}`) ?? null;
  if (baseCoords === null) return null;
  return this.controller.applyChannelOffsetOnMap
    ? this._applyChannelOffset(baseCoords, event.message.channel)
    : baseCoords;
}

export function midinoteOn(event) {
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
    coords = this.coordResolver.coordForSteps(result.steps);
  } else if (this.inputRuntime.layoutMode === "sequential") {
    const normalized = this._normalizeInputAddress(event.message.channel, event.note.number);
    if (!normalized) return;
    liveInputAddress = {
      channel: normalized.channel,
      note: normalized.note,
      rawChannel: event.message.channel,
    };
    if (!this.settings.output_mts && this.midiout_data && this.settings.midi_channel >= 0) {
      this.midiout_data.sendNoteOn(event.note.number, {
        channels: this.settings.midi_channel + 1,
        rawAttack: velocityPlayed,
      });
    }
    coords = this.coordResolver.coordForSteps(
      this.coordResolver.noteToSteps(normalized.note, normalized.channel),
    );
  } else if (this.controllerMap) {
    const lookupChannel = this.controller.multiChannel ? event.message.channel : 1;
    liveInputAddress = {
      channel: lookupChannel,
      note: event.note.number,
      rawChannel: event.message.channel,
    };
    coords = coordsForKnownController.call(this, event);
  } else {
    liveInputAddress = {
      channel: event.message.channel,
      note: event.note.number,
      rawChannel: event.message.channel,
    };
    coords = this.coordResolver.coordForSteps(
      this.coordResolver.noteToSteps(event.note.number, event.message.channel),
    );
  }

  if (coords === null) return;
  if (this._midiLatchToggle(coords, velocityPlayed)) return;
  const hex = this.hexOn(coords, notePlayed, velocityPlayed, bend, { liveInputAddress });
  if (!hex) {
    if (this._lastHexOnSuppressed) this._suppressedMidiNotes?.add(notePlayed);
    return;
  }
  if (usesPerChannelExpression(this.inputRuntime)) hex._inputChannel = event.message.channel;
  this.state.activeMidi.set(notePlayed, hex);
  if (usesPerChannelExpression(this.inputRuntime)) {
    const entry = ensureActiveMidiChannelEntry.call(this, event.message.channel);
    entry.hex = hex;
    entry.baseCents = hex._baseCents ?? hex.cents;
    entry.hexes.add(hex);
    const bend14 = this._mpeInputBendByChannel.get(event.message.channel);
    if (bend14 != null && bend14 !== 8192) {
      this._applyMpePitchBend(entry, event.message.channel, bend14);
    }
  }
  this.coordResolver.lastMidiCoords = this.hexCoordsToScreen(coords);
}

export function midinoteOff(event) {
  const notePlayed = event.note.number + 128 * (event.message.channel - 1);
  if (this._suppressedMidiNotes?.has(notePlayed)) {
    this._suppressedMidiNotes.delete(notePlayed);
    return;
  }
  let coordsList;

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
      "accept",
    );
    coordsList = result === null ? [] : this.coordResolver.stepsToVisibleCoords(result.steps);
  } else if (this.inputRuntime.layoutMode === "sequential" || !this.controllerMap) {
    const normalized = this._normalizeInputAddress(event.message.channel, event.note.number);
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
    coordsList = normalized
      ? this.coordResolver.stepsToVisibleCoords(
          this.coordResolver.noteToSteps(normalized.note, normalized.channel),
        )
      : [];
  } else {
    const coords = coordsForKnownController.call(this, event);
    coordsList = coords ? [coords] : [];
  }

  const hex = this.state.activeMidi.get(notePlayed);
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
        }
      } else if (entry && entry.hexes?.size === 0) {
        this.state.activeMidiByChannel.delete(event.message.channel);
        this._mpeInputBendByChannel.delete(event.message.channel);
      }
    }
    this._settleModulationAfterActiveRelease();
  }
  for (const coords of coordsList) {
    if (!this.state.sustain) this.hexOff(coords);
  }
}

export function allnotesOff() {
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

    let coordsList;
    if (this.inputRuntime.layoutMode !== "sequential" && this.controllerMap) {
      const lookupChannel = this.controller.multiChannel ? channel : 1;
      const baseCoords = this.controllerMap.get(`${lookupChannel}.${note}`);
      if (!baseCoords) {
        coordsList = [];
      } else {
        const coords = this.controller.applyChannelOffsetOnMap
          ? this._applyChannelOffset(baseCoords, channel)
          : baseCoords;
        coordsList = [coords];
      }
    } else {
      const normalized = this._normalizeInputAddress(channel, note);
      coordsList = normalized
        ? this.coordResolver.stepsToVisibleCoords(
            this.coordResolver.noteToSteps(normalized.note, normalized.channel),
          )
        : [];
    }

    const hex = this.state.activeMidi.get(notePlayed);
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
}
