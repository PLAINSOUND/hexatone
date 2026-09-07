import { describe, expect, it, vi } from "vitest";
import Point from "./point.js";
import { createSoundingNoteState } from "./sounding-note-runtime.js";
import * as input from "./keys-browser-input.js";

function makeKeys() {
  const canvas = document.createElement("canvas");
  const keys = {
    state: { ...createSoundingNoteState(), canvas },
    getHexCoordsAt: (point) => new Point(Math.floor(point.x / 10), Math.floor(point.y / 10)),
    hexOn: vi.fn((coords) => ({ coords, noteOff: vi.fn() })),
    noteOff: vi.fn((hex) => hex.noteOff(0)),
    hexOff: vi.fn(),
    _settleModulationAfterActiveRelease: vi.fn(),
    _onFirstInteraction: vi.fn(),
    sustainOff: vi.fn(),
  };
  keys._touchStartOnCoords = input.touchStartOnCoords.bind(keys);
  keys.mouseActive = input.mouseActive.bind(keys);
  keys.getPointerPosition = input.getPointerPosition.bind(keys);
  return keys;
}

const touch = (identifier, clientX = 5, clientY = 5) => ({ identifier, clientX, clientY });
const event = (...touches) => ({ preventDefault: vi.fn(), targetTouches: touches });

function sustain(keys, shift = false) {
  const hex = { coords: new Point(0, 0), noteOff: vi.fn() };
  keys.state.sustainedNotes.push([hex, 0]);
  keys.state.sustainedCoords.add("0,0");
  keys.state.latch = !shift;
  if (shift) {
    keys.state.activeKeyboard.set("KeyA", hex);
    keys.state.shiftSustainedKeys.add("KeyA");
  }
  return hex;
}

describe("canvas touch input", () => {
  it.each([false, true])("keeps a toggled-off note off through movement and other contacts (shift=%s)", async (shift) => {
    const keys = makeKeys();
    const hex = sustain(keys, shift);
    await input.handleTouch.call(keys, event(touch(1)));
    await input.handleTouch.call(keys, event(touch(1, 6)));
    await input.handleTouch.call(keys, event(touch(1, 6), touch(2, 25)));
    await input.handleTouch.call(keys, event(touch(1, 6)));
    expect(hex.noteOff).toHaveBeenCalledTimes(1);
    expect(keys.hexOn).toHaveBeenCalledTimes(1);
    expect(keys.hexOn).toHaveBeenCalledWith(new Point(2, 0));
    expect(keys.state.sustainedNotes).toHaveLength(0);
    expect(keys.state.activeKeyboard.size).toBe(0);

    await input.handleTouch.call(keys, event());
    await input.handleTouch.call(keys, event(touch(1)));
    expect(keys.hexOn).toHaveBeenCalledTimes(2);
    expect(keys.state.activeTouch.get(1).coords).toEqual(new Point(0, 0));
  });

  it("allows a toggling finger to slide to another key and back", async () => {
    const keys = makeKeys();
    sustain(keys);
    await input.handleTouch.call(keys, event(touch(1)));
    await input.handleTouch.call(keys, event(touch(1, 15)));
    const first = keys.state.activeTouch.get(1);
    await input.handleTouch.call(keys, event(touch(1, 5)));
    expect(first.noteOff).toHaveBeenCalledTimes(1);
    expect(keys.hexOn).toHaveBeenCalledTimes(2);
    expect(keys.state.activeTouch.get(1).coords).toEqual(new Point(0, 0));
  });

  it("triggers once per key and releases each finger exactly once", async () => {
    const keys = makeKeys();
    await input.handleTouch.call(keys, event(touch(1), touch(2, 25)));
    const first = keys.state.activeTouch.get(1);
    const second = keys.state.activeTouch.get(2);
    await input.handleTouch.call(keys, event(touch(1, 6), touch(2, 26)));
    await input.handleTouch.call(keys, event(touch(2, 26)));
    expect(first.noteOff).toHaveBeenCalledTimes(1);
    expect(second.noteOff).not.toHaveBeenCalled();
    await input.handleTouch.call(keys, event());
    await input.handleTouch.call(keys, event());
    expect(second.noteOff).toHaveBeenCalledTimes(1);
    expect(keys.hexOn).toHaveBeenCalledTimes(2);
    expect(keys.state.activeTouch.size).toBe(0);
    expect(keys.state.touchCoords.size).toBe(0);
    expect(keys.state.isTouchDown).toBe(false);
  });

  it("cancels only the affected contact without retriggering the remaining finger", async () => {
    const keys = makeKeys();
    await input.handleTouch.call(keys, event(touch(1), touch(2, 25)));
    const first = keys.state.activeTouch.get(1);
    const second = keys.state.activeTouch.get(2);
    input.handleTouchCancel.call(keys, { changedTouches: [touch(1)] });
    expect(first.noteOff).toHaveBeenCalledTimes(1);
    expect(second.noteOff).not.toHaveBeenCalled();
    expect(keys.state.isTouchDown).toBe(true);
    await input.handleTouch.call(keys, event(touch(2, 26)));
    expect(keys.hexOn).toHaveBeenCalledTimes(2);
    input.handleTouchCancel.call(keys, { changedTouches: [touch(2)] });
    expect(second.noteOff).toHaveBeenCalledTimes(1);
    expect(keys.state.touchCoords.size).toBe(0);
    expect(keys.state.isTouchDown).toBe(false);
  });

  it("clears a cancelled toggle contact so its identifier can be reused", async () => {
    const keys = makeKeys();
    sustain(keys);
    await input.handleTouch.call(keys, event(touch(1)));
    input.handleTouchCancel.call(keys, { changedTouches: [touch(1)] });
    await input.handleTouch.call(keys, event(touch(1)));
    expect(keys.hexOn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a suppressed note-on or store a null voice", async () => {
    const keys = makeKeys();
    keys.hexOn.mockReturnValue(null);
    await input.handleTouch.call(keys, event(touch(1)));
    await input.handleTouch.call(keys, event(touch(1, 6)));
    await input.handleTouch.call(keys, event());
    expect(keys.hexOn).toHaveBeenCalledTimes(1);
    expect(keys.noteOff).not.toHaveBeenCalled();
    expect(keys.state.activeTouch.size).toBe(0);
  });

  it("ignores touch-generated mouse events while allowing a real mouse", async () => {
    const keys = makeKeys();
    const mouse = { currentTarget: keys.state.canvas, clientX: 5, clientY: 5 };
    const synthetic = { ...mouse, sourceCapabilities: { firesTouchEvents: true } };
    await input.mouseDown.call(keys, synthetic);
    expect(keys.hexOn).not.toHaveBeenCalled();
    expect(keys._onFirstInteraction).not.toHaveBeenCalled();
    await input.mouseDown.call(keys, mouse);
    const hex = keys.state.activeMouse;
    input.mouseActive.call(keys, { ...synthetic, clientX: 25 });
    input.mouseUp.call(keys, synthetic);
    expect(keys.hexOn).toHaveBeenCalledTimes(1);
    expect(hex.noteOff).not.toHaveBeenCalled();
    input.mouseUp.call(keys, mouse);
    expect(hex.noteOff).toHaveBeenCalledTimes(1);
  });
});
