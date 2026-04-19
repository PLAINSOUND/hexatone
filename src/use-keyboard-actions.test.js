/**
 * Tests for src/use-keyboard-actions.js
 *
 * The hook is a collection of stable callbacks over a keysRef. Tests invoke
 * the hook directly (no Preact rendering needed) by supplying a plain ref-like
 * object { current: mockKeys }.
 *
 * Each test verifies three properties:
 *   1. The correct Keys method is called with the correct arguments.
 *   2. When keysRef.current is null the call is silently swallowed (no throw).
 *   3. When the Keys method does not exist (optional feature) it is not called.
 */

import { describe, it, expect, vi } from "vitest";
import useKeyboardActions from "./use-keyboard-actions.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock Keys instance with every method stubbed as a vi.fn(). */
const makeMockKeys = () => ({
  resizeHandler: vi.fn(),
  panic: vi.fn(),
  latchToggle: vi.fn(),
  sustainOn: vi.fn(),
  releaseAllKeyboardNotes: vi.fn(),
  previewFundamental: vi.fn(),
  snapshotForFundamentalPreview: vi.fn(),
  previewDegree0: vi.fn(),
  updateScaleDegree: vi.fn(),
  setTuneDragging: vi.fn(),
  state: { escHeld: false },
  updateFundamental: vi.fn(),
  mtsSendMap: vi.fn(),
  shiftOctave: vi.fn(),
  updateColors: vi.fn(),
  updateLabels: vi.fn(),
  setMidiLearnMode: vi.fn(),
  updateLiveOutputState: vi.fn(),
  exquisLEDs: null,
  syncExquisLEDs: vi.fn(),
  lumatoneLEDs: null,
  linnstrumentLEDs: null,
  syncLinnstrumentLEDs: vi.fn(),
  typing: false,
});

/** Invoke the hook synchronously — plain closures, no VDOM needed. */
const useInvoke = (ref) => useKeyboardActions(ref);

// ── Canvas lifecycle ──────────────────────────────────────────────────────────

describe("resizeHandler", () => {
  it("calls keysRef.current.resizeHandler()", () => {
    const keys = makeMockKeys();
    const {resizeHandler } = useInvoke({ current: keys });
    resizeHandler();
    expect(keys.resizeHandler).toHaveBeenCalledTimes(1);
  });

  it("does not throw when current is null", () => {
    const {resizeHandler } = useInvoke({ current: null });
    expect(() => resizeHandler()).not.toThrow();
  });
});

// ── Note / sound control ──────────────────────────────────────────────────────

describe("panic", () => {
  it("calls keysRef.current.panic()", () => {
    const keys = makeMockKeys();
    const {panic } = useInvoke({ current: keys });
    panic();
    expect(keys.panic).toHaveBeenCalledTimes(1);
  });

  it("does not throw when current is null", () => {
    const {panic } = useInvoke({ current: null });
    expect(() => panic()).not.toThrow();
  });
});

describe("latchToggle", () => {
  it("calls keysRef.current.latchToggle()", () => {
    const keys = makeMockKeys();
    const {latchToggle } = useInvoke({ current: keys });
    latchToggle();
    expect(keys.latchToggle).toHaveBeenCalledTimes(1);
  });
});

describe("sustainOn", () => {
  it("calls keysRef.current.sustainOn()", () => {
    const keys = makeMockKeys();
    const {sustainOn } = useInvoke({ current: keys });
    sustainOn();
    expect(keys.sustainOn).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when sustainOn is not present", () => {
    const keys = makeMockKeys();
    delete keys.sustainOn;
    const {sustainOn } = useInvoke({ current: keys });
    expect(() => sustainOn()).not.toThrow();
  });
});

describe("releaseAllKeyboardNotes", () => {
  it("calls keysRef.current.releaseAllKeyboardNotes()", () => {
    const keys = makeMockKeys();
    const {releaseAllKeyboardNotes } = useInvoke({ current: keys });
    releaseAllKeyboardNotes();
    expect(keys.releaseAllKeyboardNotes).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the method is absent", () => {
    const keys = makeMockKeys();
    delete keys.releaseAllKeyboardNotes;
    const {releaseAllKeyboardNotes } = useInvoke({ current: keys });
    expect(() => releaseAllKeyboardNotes()).not.toThrow();
  });
});

// ── Tuning preview ────────────────────────────────────────────────────────────

describe("previewFundamental", () => {
  it("forwards deltaCents and clearSnapshot arguments", () => {
    const keys = makeMockKeys();
    const {previewFundamental } = useInvoke({ current: keys });
    previewFundamental(50, true);
    expect(keys.previewFundamental).toHaveBeenCalledWith(50, true);
  });

  it("defaults clearSnapshot to false", () => {
    const keys = makeMockKeys();
    const {previewFundamental } = useInvoke({ current: keys });
    previewFundamental(12);
    expect(keys.previewFundamental).toHaveBeenCalledWith(12, false);
  });

  it("does not throw when current is null", () => {
    const {previewFundamental } = useInvoke({ current: null });
    expect(() => previewFundamental(0)).not.toThrow();
  });
});

describe("snapshotForFundamentalPreview", () => {
  it("calls the method on the canvas instance", () => {
    const keys = makeMockKeys();
    const {snapshotForFundamentalPreview } = useInvoke({ current: keys });
    snapshotForFundamentalPreview();
    expect(keys.snapshotForFundamentalPreview).toHaveBeenCalledTimes(1);
  });
});

describe("previewDegree0", () => {
  it("forwards cents to keysRef.current.previewDegree0", () => {
    const keys = makeMockKeys();
    const {previewDegree0 } = useInvoke({ current: keys });
    previewDegree0(702);
    expect(keys.previewDegree0).toHaveBeenCalledWith(702);
  });
});

describe("updateScaleDegree", () => {
  it("forwards degree and targetCents", () => {
    const keys = makeMockKeys();
    const {updateScaleDegree } = useInvoke({ current: keys });
    updateScaleDegree(5, 700.5);
    expect(keys.updateScaleDegree).toHaveBeenCalledWith(5, 700.5);
  });
});

describe("setTuneDragging", () => {
  it("sets dragging true", () => {
    const keys = makeMockKeys();
    const {setTuneDragging } = useInvoke({ current: keys });
    setTuneDragging(true);
    expect(keys.setTuneDragging).toHaveBeenCalledWith(true);
  });

  it("sets dragging false", () => {
    const keys = makeMockKeys();
    const {setTuneDragging } = useInvoke({ current: keys });
    setTuneDragging(false);
    expect(keys.setTuneDragging).toHaveBeenCalledWith(false);
  });
});

describe("isEscHeld", () => {
  it("returns true when state.escHeld is true", () => {
    const keys = makeMockKeys();
    keys.state.escHeld = true;
    const {isEscHeld } = useInvoke({ current: keys });
    expect(isEscHeld()).toBe(true);
  });

  it("returns false when escHeld is false", () => {
    const keys = makeMockKeys();
    const {isEscHeld } = useInvoke({ current: keys });
    expect(isEscHeld()).toBe(false);
  });

  it("returns false when current is null", () => {
    const {isEscHeld } = useInvoke({ current: null });
    expect(isEscHeld()).toBe(false);
  });
});

// ── Fundamental / MTS ─────────────────────────────────────────────────────────

describe("updateFundamental", () => {
  it("forwards frequency value", () => {
    const keys = makeMockKeys();
    const {updateFundamental } = useInvoke({ current: keys });
    updateFundamental(432);
    expect(keys.updateFundamental).toHaveBeenCalledWith(432);
  });
});

describe("mtsSendMap", () => {
  it("forwards output and optional flags", () => {
    const keys = makeMockKeys();
    const {mtsSendMap } = useInvoke({ current: keys });
    const port = {};
    mtsSendMap(port, false, false);
    expect(keys.mtsSendMap).toHaveBeenCalledWith(port, false, false);
  });

  it("defaults sendAll and sendRT to true", () => {
    const keys = makeMockKeys();
    const {mtsSendMap } = useInvoke({ current: keys });
    const port = {};
    mtsSendMap(port);
    expect(keys.mtsSendMap).toHaveBeenCalledWith(port, true, true);
  });
});

describe("shiftOctave", () => {
  it("forwards dir and deferred args", () => {
    const keys = makeMockKeys();
    const {shiftOctave } = useInvoke({ current: keys });
    shiftOctave(1, false);
    expect(keys.shiftOctave).toHaveBeenCalledWith(1, false);
  });
});

// ── Appearance ────────────────────────────────────────────────────────────────

describe("updateColors", () => {
  it("forwards colorUpdate object", () => {
    const keys = makeMockKeys();
    const {updateColors } = useInvoke({ current: keys });
    const update = { noteColors: ["#ff0000"] };
    updateColors(update);
    expect(keys.updateColors).toHaveBeenCalledWith(update);
  });
});

describe("updateLabels", () => {
  it("forwards labelSettings object", () => {
    const keys = makeMockKeys();
    const {updateLabels } = useInvoke({ current: keys });
    const settings = { key_labels: "heji" };
    updateLabels(settings);
    expect(keys.updateLabels).toHaveBeenCalledWith(settings);
  });
});

// ── MIDI / controller ─────────────────────────────────────────────────────────

describe("setMidiLearnMode", () => {
  it("forwards active flag and callback", () => {
    const keys = makeMockKeys();
    const {setMidiLearnMode } = useInvoke({ current: keys });
    const cb = vi.fn();
    setMidiLearnMode(true, cb);
    expect(keys.setMidiLearnMode).toHaveBeenCalledWith(true, cb);
  });
});

describe("updateLiveOutputState", () => {
  it("forwards liveOutputSettings and synth", () => {
    const keys = makeMockKeys();
    const {updateLiveOutputState } = useInvoke({ current: keys });
    const live = {};
    const synth = {};
    updateLiveOutputState(live, synth);
    expect(keys.updateLiveOutputState).toHaveBeenCalledWith(live, synth);
  });
});

// ── Hardware LED sync ─────────────────────────────────────────────────────────

describe("setExquisLEDs", () => {
  it("assigns leds to keysRef.current.exquisLEDs", () => {
    const keys = makeMockKeys();
    const {setExquisLEDs } = useInvoke({ current: keys });
    const leds = { data: [1, 2, 3] };
    setExquisLEDs(leds);
    expect(keys.exquisLEDs).toBe(leds);
  });

  it("accepts null to detach", () => {
    const keys = makeMockKeys();
    keys.exquisLEDs = { data: [] };
    const {setExquisLEDs } = useInvoke({ current: keys });
    setExquisLEDs(null);
    expect(keys.exquisLEDs).toBeNull();
  });
});

describe("syncExquisLEDs", () => {
  it("calls the method on the canvas instance", () => {
    const keys = makeMockKeys();
    const {syncExquisLEDs } = useInvoke({ current: keys });
    syncExquisLEDs();
    expect(keys.syncExquisLEDs).toHaveBeenCalledTimes(1);
  });
});

describe("setLumatoneLEDs", () => {
  it("assigns leds to keysRef.current.lumatoneLEDs", () => {
    const keys = makeMockKeys();
    const {setLumatoneLEDs } = useInvoke({ current: keys });
    const leds = { rows: [] };
    setLumatoneLEDs(leds);
    expect(keys.lumatoneLEDs).toBe(leds);
  });
});

describe("setLinnstrumentLEDs", () => {
  it("assigns leds to keysRef.current.linnstrumentLEDs", () => {
    const keys = makeMockKeys();
    const {setLinnstrumentLEDs } = useInvoke({ current: keys });
    const leds = { data: [] };
    setLinnstrumentLEDs(leds);
    expect(keys.linnstrumentLEDs).toBe(leds);
  });

  it("accepts null to detach", () => {
    const keys = makeMockKeys();
    keys.linnstrumentLEDs = { data: [] };
    const {setLinnstrumentLEDs } = useInvoke({ current: keys });
    setLinnstrumentLEDs(null);
    expect(keys.linnstrumentLEDs).toBeNull();
  });
});

describe("syncLinnstrumentLEDs", () => {
  it("calls the method on the canvas instance", () => {
    const keys = makeMockKeys();
    const {syncLinnstrumentLEDs } = useInvoke({ current: keys });
    syncLinnstrumentLEDs();
    expect(keys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1);
  });
});

// ── Keyboard input flag ───────────────────────────────────────────────────────

describe("setTyping", () => {
  it("sets keysRef.current.typing to true", () => {
    const keys = makeMockKeys();
    const {setTyping } = useInvoke({ current: keys });
    setTyping(true);
    expect(keys.typing).toBe(true);
  });

  it("sets keysRef.current.typing to false", () => {
    const keys = makeMockKeys();
    keys.typing = true;
    const {setTyping } = useInvoke({ current: keys });
    setTyping(false);
    expect(keys.typing).toBe(false);
  });
});
