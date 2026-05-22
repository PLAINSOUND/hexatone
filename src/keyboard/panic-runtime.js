// This module owns the destructive "stop/clear everything" keyboard actions.
// It handles panic, keyboard-note release sweeps, and latch-reset cleanup for
// the live Keys runtime. It does not resolve new input or derive tuning; it
// only tears down current note/activity state in a consistent order.

import Point from "./point.js";
import { notes } from "../midi_synth";
import { cancelModulation } from "../tuning/modulation-runtime.js";

export function panic(keys) {
  keys._retuneGlides.clear();
  if (keys._retuneGlideTimer != null) {
    clearTimeout(keys._retuneGlideTimer);
    keys._retuneGlideTimer = null;
  }
  keys._resetWheelInputState(true);
  keys._retuneGlideLastTime = 0;
  if (keys.synth?.allSoundOff) keys.synth.allSoundOff();

  const activeHexes = [...keys._allActiveHexes()];
  const sustainedHexes = [...keys.state.sustainedNotes];

  for (const hex of activeHexes) {
    hex.noteOff(0);
    const [cents, pressed_interval] = keys.hexCoordsToCents(hex.coords);
    const [color, text_color] = keys.centsToColor(cents, false, pressed_interval);
    keys.drawHex(hex.coords, color, text_color);
  }
  keys.state.activeMouse = null;
  keys.state.activeTouch.clear();
  keys.state.activeKeyboard.clear();
  keys.state.activeMidi.clear();
  keys.state.activeMidiByChannel.clear();
  keys._mpeInputBendByChannel.clear();
  keys._mpeInputBendSmoothingByChannel.clear();
  keys.state.isMouseDown = false;
  keys.state.isTouchDown = false;
  keys.state.canvas.removeEventListener("mousemove", keys.mouseActive);

  for (let i = sustainedHexes.length - 1; i >= 0; i--) {
    const [hex, releaseVel] = sustainedHexes[i];
    hex.noteOff(releaseVel);
    const [cents, pressed_interval] = keys.hexCoordsToCents(hex.coords);
    const [color, text_color] = keys.centsToColor(cents, false, pressed_interval);
    keys.drawHex(hex.coords, color, text_color);
  }

  keys.state.sustainedNotes = [];
  keys.state.sustainedCoords.clear();
  keys.state.shiftSustainedKeys.clear();
  keys.state.pressedKeys.clear();
  keys.coordResolver.clearInputAddressMemory();
  notes.played = [];

  keys.recencyStack.clear();
  keys._wheelBend = 0;
  keys._wheelTarget = null;
  keys._wheelBaseCents = null;
  keys._wheelValue14 = 8192;
  keys._wheelInputValue14 = 8192;
  keys._wheelInputState.current = 8192;
  keys._wheelInputState.target = 8192;

  keys.state.sustain = false;
  keys.state.latch = false;
  if (keys.onLatchChange) keys.onLatchChange(false);
  keys._modulationState = cancelModulation(keys._modulationState, "panic");
  keys._emitModulationState();
  keys._emitLiveNoteDisplayState();
  keys.stopSnapshot();
}

export function releaseAllKeyboardNotes(keys) {
  for (const code of keys.state.pressedKeys) {
    const kbRaw = keys.settings.keyCodeToCoords[code];
    if (!kbRaw) continue;
    const kbOffset = keys.settings.centerHexOffset;
    const coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
    const hex = keys.state.activeKeyboard.get(code);
    if (hex) {
      keys.noteOff(hex, 0);
      keys.state.activeKeyboard.delete(code);
      keys._settleModulationAfterActiveRelease();
    }
    if (!keys.state.sustain) keys.hexOff(coords);
  }
  keys.state.pressedKeys.clear();
}

export function resetLatch(keys) {
  keys.state.sustain = false;
  keys.state.latch = false;
  if (keys.onLatchChange) keys.onLatchChange(false);
}
