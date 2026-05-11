// This module owns browser-native keyboard, mouse, and touch input for Keys.
// It translates DOM events into already-resolved hex coords and calls the live
// note lifecycle methods on Keys. It does not derive MIDI/controller mappings
// or harmonic frames.

import Point from "./point";

function isModulationToggleKeyCode(code) {
  return code === "Backquote" || code === "IntlBackslash";
}

function keyboardCoordsForCode(keys, code) {
  const kbOffset = keys.settings.centerHexOffset;
  const kbRaw = keys.settings.keyCodeToCoords[code];
  return new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
}

function canMomentarilyFlipHakenGlide(keys) {
  if (keys.inputIsFocused()) return false;
  if (keys.controller?.id !== "hakenaudio") return false;
  if (!keys.inputRuntime?.mpeInput) return false;
  const mode = keys.inputRuntime.hakenXGlideMode ?? "pitch_bending";
  return mode === "raster_to_notes" || mode === "pitch_bending";
}

function findSustainedIndexAt(state, coords) {
  return state.sustainedNotes.findIndex(
    ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
  );
}

function releaseSustainedAt(keys, coords) {
  const hexIndex = findSustainedIndexAt(keys.state, coords);
  if (hexIndex === -1) return false;
  const [hex, vel] = keys.state.sustainedNotes[hexIndex];
  keys.state.sustainedNotes.splice(hexIndex, 1);
  keys.state.sustainedCoords.delete(`${coords.x},${coords.y}`);
  hex.noteOff(vel);
  keys.hexOff(coords);
  return true;
}

export function inputIsFocused() {
  const tag = document.activeElement && document.activeElement.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function setTuneDragging(active) {
  this.state.isTuneDragging = active;
}

export function onKeyDown(e) {
  if (
    e.code === "Space" &&
    !e.repeat &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    canMomentarilyFlipHakenGlide(this)
  ) {
    e.preventDefault();
    this._setHakenSpaceGlideFlip?.(true);
    return;
  }

  if ((e.code === "Delete" && !e.repeat) || (e.code === "Backspace" && !e.repeat)) {
    this.panic();
    return;
  }

  if (e.code === "Escape" && !e.repeat) {
    this.state.escHeld = true;
    this.latchToggle();
    return;
  }

  if (e.code === "Enter" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const hasNotes =
      this.state.activeMouse !== null ||
      this.state.activeTouch.size > 0 ||
      this.state.activeKeyboard.size > 0 ||
      this.state.activeMidi.size > 0 ||
      this.state.sustainedNotes.length > 0;
    if (hasNotes && this.onTakeSnapshot) {
      this.onTakeSnapshot();
      return;
    }
  }

  if (
    isModulationToggleKeyCode(e.code) &&
    !e.repeat &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey
  ) {
    e.preventDefault();
    this.toggleModulationArm();
    return;
  }

  if (!this.typing) return;
  if (this.inputIsFocused()) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  e.preventDefault();
  if (e.repeat) return;

  if (!(e.code in this.settings.keyCodeToCoords)) return;

  if (e.shiftKey) {
    const coords = keyboardCoordsForCode(this, e.code);
    if (this.state.shiftSustainedKeys.has(e.code)) {
      this.state.shiftSustainedKeys.delete(e.code);
      releaseSustainedAt(this, coords);
      this.state.activeKeyboard.delete(e.code);
      return;
    }

    this.state.pressedKeys.add(e.code);
    this.state.shiftSustainedKeys.add(e.code);
    const hex = this.hexOn(coords);
    this.state.activeKeyboard.set(e.code, hex);
    this.state.sustainedNotes.push([hex, 0]);
    this.state.sustainedCoords.add(`${coords.x},${coords.y}`);
    return;
  }

  if (this.state.shiftSustainedKeys.has(e.code)) {
    this.state.shiftSustainedKeys.delete(e.code);
    const coords = keyboardCoordsForCode(this, e.code);
    releaseSustainedAt(this, coords);
    this.state.activeKeyboard.delete(e.code);
    return;
  }

  if (this.state.pressedKeys.has(e.code)) return;

  const coords = keyboardCoordsForCode(this, e.code);
  if (this.state.latch && releaseSustainedAt(this, coords)) return;

  this.state.pressedKeys.add(e.code);
  const hex = this.hexOn(coords);
  this.state.activeKeyboard.set(e.code, hex);
}

export function onKeyUp(e) {
  if (
    e.code === "Space" &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    canMomentarilyFlipHakenGlide(this)
  ) {
    e.preventDefault();
    this._setHakenSpaceGlideFlip?.(false);
    return;
  }

  if (e.code === "Escape") {
    this.state.escHeld = false;
    return;
  }

  if (isModulationToggleKeyCode(e.code)) return;
  if (!this.typing) return;
  if (this.inputIsFocused()) return;

  if (!(e.code in this.settings.keyCodeToCoords)) return;
  if (this.state.shiftSustainedKeys.has(e.code)) {
    this.state.pressedKeys.delete(e.code);
    return;
  }
  if (!this.state.pressedKeys.has(e.code)) return;

  this.state.pressedKeys.delete(e.code);
  const coords = keyboardCoordsForCode(this, e.code);
  const hex = this.state.activeKeyboard.get(e.code);
  if (hex) {
    this.noteOff(hex, 0);
    this.state.activeKeyboard.delete(e.code);
    this._settleModulationAfterActiveRelease();
  }
  if (!this.state.sustain) this.hexOff(coords);
}

export function mouseUp(_e) {
  if (!this.state.isMouseDown) return;
  this.state.isMouseDown = false;
  this.state.mouseDownToggledCoord = null;
  this.state.canvas.removeEventListener("mousemove", this.mouseActive);

  if (this.state.activeMouse) {
    const coords = this.state.activeMouse.coords;
    this.noteOff(this.state.activeMouse, 0);
    this.state.activeMouse = null;
    this._settleModulationAfterActiveRelease();
    if (!this.state.sustain) this.hexOff(coords);
  }

  if (!this.state.escHeld && this.state.sustain && !this.state.isTuneDragging) {
    this.sustainOff();
  }
}

export function mouseDown(e) {
  if (this._onFirstInteraction) this._onFirstInteraction();

  if (this.state.activeMouse) {
    this.state.activeMouse.noteOff(0);
    this.state.activeMouse = null;
  }

  this.state.mouseDownToggledCoord = null;
  this.state.isMouseDown = true;
  this.state.canvas.addEventListener("mousemove", this.mouseActive, false);
  this.mouseActive(e);
}

export function mouseActive(e) {
  let coords = this.getPointerPosition(e);
  coords = this.getHexCoordsAt(coords);

  if (this.state.activeMouse === null) {
    if (this.state.latch) {
      const key = `${coords.x},${coords.y}`;
      if (releaseSustainedAt(this, coords)) {
        this.state.mouseDownToggledCoord = key;
        return;
      }
      if (this.state.mouseDownToggledCoord === key) return;
    }
    this.state.activeMouse = this.hexOn(coords);
    return;
  }

  const first = this.state.activeMouse;
  if (coords.equals(first.coords)) return;

  if (this.state.latch) {
    const key = `${coords.x},${coords.y}`;
    if (findSustainedIndexAt(this.state, coords) !== -1) {
      const oldCoords = first.coords;
      this.noteOff(first, 0);
      this.state.activeMouse = null;
      this._settleModulationAfterActiveRelease();
      this.hexOff(oldCoords);
      releaseSustainedAt(this, coords);
      this.state.mouseDownToggledCoord = key;
      return;
    }
  }

  const oldCoords = first.coords;
  this.noteOff(first, 0);
  this.state.activeMouse = null;
  this._settleModulationAfterActiveRelease();
  this.hexOff(oldCoords);
  this.state.activeMouse = this.hexOn(coords);
}

export function getPointerPosition(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  return new Point(e.clientX - rect.left, e.clientY - rect.top);
}

export function getPosition(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

export function handleTouch(e) {
  e.preventDefault();
  if (this._onFirstInteraction) this._onFirstInteraction();

  this.state.isTouchDown = e.targetTouches.length !== 0;

  const currentIds = new Set();
  for (let i = 0; i < e.targetTouches.length; i++) {
    currentIds.add(e.targetTouches[i].identifier);
  }

  for (const [id, hex] of this.state.activeTouch) {
    if (!currentIds.has(id)) {
      const coords = hex.coords;
      this.noteOff(hex, 0);
      this.state.activeTouch.delete(id);
      this._settleModulationAfterActiveRelease();
      if (!this.state.sustain) this.hexOff(coords);
    }
  }

  const rect = this.state.canvas.getBoundingClientRect();
  for (let i = 0; i < e.targetTouches.length; i++) {
    const touch = e.targetTouches[i];
    const id = touch.identifier;
    const coords = this.getHexCoordsAt(
      new Point(touch.clientX - rect.left, touch.clientY - rect.top),
    );
    const existing = this.state.activeTouch.get(id);
    if (existing) {
      if (!existing.coords.equals(coords)) {
        const oldCoords = existing.coords;
        this.noteOff(existing, 0);
        this.state.activeTouch.delete(id);
        this._settleModulationAfterActiveRelease();
        if (!this.state.sustain) this.hexOff(oldCoords);
        this._touchStartOnCoords(id, coords);
      }
    } else {
      this._touchStartOnCoords(id, coords);
    }
  }
}

export function touchStartOnCoords(id, coords) {
  if (this.state.latch && releaseSustainedAt(this, coords)) return;
  const newHex = this.hexOn(coords);
  this.state.activeTouch.set(id, newHex);
}

export function handleTouchCancel(_e) {
  this.state.isTouchDown = false;
  const entries = [...this.state.activeTouch.entries()];
  this.state.activeTouch.clear();
  for (const [, hex] of entries) {
    const coords = hex.coords;
    this.noteOff(hex, 0);
    this._settleModulationAfterActiveRelease();
    if (!this.state.sustain) this.hexOff(coords);
  }
}
