// This module owns live note lifecycle on the keyboard surface.
// It handles note-on/off transitions after coords are already resolved,
// including visual pressed-state redraws, sustain/latch behavior, modulation
// takeover handoff, and wheel/bulk-refresh bookkeeping tied to those note
// lifecycles. It does not resolve raw input addresses or mutate modulation
// history directly; callers provide a Keys-like runtime object.

import {
  addSustainedHex,
  clearSustainedHexes,
  removeSustainedHex,
} from "./sounding-note-runtime.js";
import {
  createTransferredHex,
  releaseTransferredSourceExpression,
  shouldSuppressTransferredSourceRelease,
} from "./note-transfer-runtime.js";
import { frameForNewNotes } from "./modulation-runtime.js";
import { scalaToCents } from "../settings/scale/parse-scale";

export function midiLatchToggle(keys, coords, releaseVelocity = 0) {
  if (!keys.state.latch) return false;
  const removed = removeSustainedHex(keys.state, coords);
  if (!removed) return false;
  const [hex, vel] = removed.entry;
  hex.noteOff(releaseVelocity || vel);
  keys._scheduleDeferredBulkRefresh();
  hexOff(keys, coords);
  return true;
}

export function maybeTakeOverModulationTarget(keys, coords, cents, cents_prev, cents_next) {
  if (keys._modulationState.mode !== "pending_settlement") return null;
  if (keys._modulationState.lastDecision?.articulation !== "takeover") return null;
  if (keys._modulationState.takeoverConsumed) return null;
  const sourceHex = keys._modulationState.sourceHex;
  if (!sourceHex || !keys._isHexStillSounding(sourceHex)) return null;

  const onsetFrameId = frameForNewNotes(keys._modulationState)?.id ?? keys._harmonicFrame?.id ?? null;
  const proxy = createTransferredHex(sourceHex, {
    coords,
    cents,
    cents_prev,
    cents_next,
    onsetFrameId,
  });
  keys._modulationState.takeoverConsumed = true;
  keys.recencyStack.remove(sourceHex);
  keys.recencyStack.push(proxy);
  keys._updateWheelTarget();
  keys._applyCurrentWheelToHex(proxy);
  keys._syncTransferredWheelBend(proxy);
  return proxy;
}

export function hexOn(keys, coords, note_played, velocity_played, bend, options = null) {
  keys._markSoundActivity();
  keys._lastHexOnSuppressed = false;
  const modulationCommit = keys._commitPendingModulationTarget(coords, options ?? {});
  if (modulationCommit?.suppressNoteOn) {
    keys._lastHexOnSuppressed = true;
    return null;
  }
  if (keys._staticDeferredBulkActive && keys._deferredBulkMapRefresh) {
    keys._sendBulkDumpOctaveRefresh(keys._hasSoundingNotes(), false);
    keys._deferredBulkMapRefresh = false;
    if (!keys._hasSoundingNotes()) keys._staticDeferredBulkActive = false;
  }

  if (!bend) bend = 0;
  if (!velocity_played) velocity_played = keys.settings.midi_velocity;
  if (!velocity_played) velocity_played = 72;

  const [cents, pressed_interval, steps, equaves, equivSteps, cents_prev, cents_next] =
    keys.hexCoordsToCents(coords);
  keys._lastPlayedDegree = pressed_interval ?? keys._lastPlayedDegree;
  const [color, text_color] = keys.centsToColor(cents, true, pressed_interval);
  keys.drawHex(coords, color, text_color);

  const transferredHex = maybeTakeOverModulationTarget(keys, coords, cents, cents_prev, cents_next);
  if (transferredHex) return transferredHex;

  const degree0toRef_ratio = keys.tuning.degree0toRef_asArray[1];
  const hex = keys.synth.makeHex(
    coords,
    cents,
    steps,
    equaves,
    equivSteps,
    cents_prev,
    cents_next,
    note_played,
    velocity_played,
    bend,
    degree0toRef_ratio,
  );
  hex._baseCents = cents;
  if (options?.liveInputAddress) hex._liveInputAddress = { ...options.liveInputAddress };

  let mpePrimedBeforeNoteOn = false;
  const inputChannel = options?.liveInputAddress?.channel;
  if (
    inputChannel != null &&
    (keys.inputRuntime.mpeInput || keys.inputRuntime.perChannelExpression)
  ) {
    const bend14 = keys._mpeInputBendByChannel.get(inputChannel);
    if (
      keys.inputRuntime.mpeInput &&
      keys.inputRuntime.target === "scale" &&
      bend14 != null
    ) {
      hex._scaleModeBendAnchor14 = keys._normalizePitchBend14(bend14);
      hex._mpePrimedBeforeNoteOn = { channel: inputChannel, bend14, bentCents: cents };
      mpePrimedBeforeNoteOn = true;
    } else if (bend14 != null && bend14 !== 8192 && hex.retune) {
      let norm = (keys._normalizePitchBend14(bend14) - 8192) / 8192;
      if (keys.inputRuntime.bendFlip) norm = -norm;
      const bentCents = cents + norm * scalaToCents(keys.inputRuntime.bendRange ?? "9/8");
      hex.retune(bentCents, true);
      hex._mpePrimedBeforeNoteOn = { channel: inputChannel, bend14, bentCents };
      mpePrimedBeforeNoteOn = true;
    }
  }

  let wheelPrimedBeforeNoteOn = false;
  if (!keys.inputRuntime.wheelToRecent && keys._wheelValue14 !== 8192) {
    const wheelTargetCents = cents + keys._wheelBend;
    if (hex.standardWheelRetune) {
      hex.standardWheelRetune(wheelTargetCents);
      wheelPrimedBeforeNoteOn = !hex.standardWheelPassthroughOnly;
    } else if (hex.retune && !hex.standardWheelPassthroughOnly) {
      hex.retune(wheelTargetCents, true);
      wheelPrimedBeforeNoteOn = true;
    }
  }
  if (wheelPrimedBeforeNoteOn) hex._wheelPrimedBeforeNoteOn = true;
  hex.noteOn();
  hex._onsetFrameId = frameForNewNotes(keys._modulationState)?.id ?? keys._harmonicFrame?.id ?? null;
  hex.cents_prev = cents_prev;
  hex.cents_next = cents_next;
  keys.recencyStack.push(hex);
  if (
    keys._modulationState.mode === "awaiting_target" &&
    keys._modulationState.sourceCoordsKey === `${coords.x},${coords.y}`
  ) {
    keys._setAwaitingModulationSource(hex, pressed_interval, coords);
  }
  keys._updateWheelTarget();
  delete hex._wheelPrimedBeforeNoteOn;
  if (!wheelPrimedBeforeNoteOn) keys._applyCurrentWheelToHex(hex);
  if (!mpePrimedBeforeNoteOn) delete hex._mpePrimedBeforeNoteOn;
  return hex;
}

export function hexOff(keys, coords) {
  const [cents, pressed_interval] = keys.hexCoordsToCents(coords);
  const key = coords.x + "," + coords.y;
  const isSustained = keys.state.sustainedCoords.has(key);
  const isActiveElsewhere = keys._isCoordActive(coords);
  const [color, text_color] = keys.centsToColor(
    cents,
    isSustained || isActiveElsewhere,
    pressed_interval,
  );
  // Release redraw should be immediate and local: repaint the released hex in
  // its current unpressed/held state rather than restoring a cached rectangle
  // and then repairing overlapping sounding-note overlays.
  keys.drawHex(coords, color, text_color);
}

export function noteOff(keys, hex, release_velocity) {
  keys._markSoundActivity();
  if (shouldSuppressTransferredSourceRelease(hex)) {
    releaseTransferredSourceExpression(hex);
    keys.recencyStack.remove(hex);
    keys._updateWheelTarget(true);
    keys._syncAwaitingModulationSource();
    return;
  }
  if (keys.state.sustain) {
    const result = addSustainedHex(keys.state, hex, release_velocity);
    if (result.added) {
      const [cents, pressed_interval] = keys.hexCoordsToCents(hex.coords);
      const [color, text_color] = keys.centsToColor(cents, true, pressed_interval);
      keys.drawHex(hex.coords, color, text_color);
    }
    return;
  }

  if (keys._deferredBulkMapRefresh && !keys._staticDeferredBulkActive) {
    keys._sendBulkDumpOctaveRefresh(true);
  }
  hex.noteOff(release_velocity);
  keys._trackRecentlyReleasedHex(hex);
  keys.recencyStack.remove(hex);
  keys._updateWheelTarget(true);
  keys._syncAwaitingModulationSource();
  if (keys._staticDeferredBulkActive) {
    keys._deferredBulkMapRefresh = keys._hasSoundingNotes();
    if (!keys._deferredBulkMapRefresh) keys._staticDeferredBulkActive = false;
  } else {
    keys._scheduleDeferredBulkRefresh();
  }
  keys._settleModulationAfterActiveRelease();
}

export function sustainOff(keys, force = false) {
  if (keys.state.latch && !force) return;
  if (keys.state.latch) keys.state.latch = false;
  keys.state.sustain = false;
  const notesToRelease = clearSustainedHexes(keys.state);
  if (
    keys._deferredBulkMapRefresh &&
    !keys._staticDeferredBulkActive &&
    notesToRelease.length > 0
  ) {
    keys._sendBulkDumpOctaveRefresh(true);
  }
  for (let note = 0; note < notesToRelease.length; note++) {
    const hex = notesToRelease[note][0];
    const [cents, pressed_interval] = keys.hexCoordsToCents(hex.coords);
    if (keys._isHexActivelyHeld(hex)) {
      const [color, text_color] = keys.centsToColor(cents, true, pressed_interval);
      keys.drawHex(hex.coords, color, text_color);
      continue;
    }
    const [color, text_color] = keys.centsToColor(cents, false, pressed_interval);
    keys.drawHex(hex.coords, color, text_color);
    hex.noteOff(notesToRelease[note][1]);
    keys._trackRecentlyReleasedHex(hex);
    keys.recencyStack.remove(hex);
  }
  keys._updateWheelTarget(true);
  keys._syncAwaitingModulationSource();
  if (keys._staticDeferredBulkActive) {
    keys._deferredBulkMapRefresh = keys._hasSoundingNotes();
    if (!keys._deferredBulkMapRefresh) keys._staticDeferredBulkActive = false;
  } else {
    keys._scheduleDeferredBulkRefresh();
  }
  keys._settleModulationAfterActiveRelease();
  if (keys.onLatchChange) keys.onLatchChange(false);
}

export function sustainOn(keys) {
  keys.state.sustain = true;
}

export function latchToggle(keys) {
  if (keys.state.latch) {
    keys.state.latch = false;
    sustainOff(keys, true);
    return;
  }
  keys.state.latch = true;
  keys.state.sustain = true;
  if (keys.onLatchChange) keys.onLatchChange(true);
  for (const hex of keys._allActiveHexes()) {
    if (!keys.state.sustainedNotes.find(([h]) => h === hex)) {
      keys.state.sustainedNotes.push([hex, 0]);
      keys.state.sustainedCoords.add(hex.coords.x + "," + hex.coords.y);
    }
  }
}
