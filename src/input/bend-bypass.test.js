import { afterEach, expect, it, vi } from "vitest";
import { applyInputBend, transitionBendBypass } from "./bend-bypass.js";
import { kickRetuneGlides, tickRetuneGlides, applyMpePitchBend, queueRetuneGlide, retuneHexFromBase,
  resetWheelInputState } from "./keys-expression-runtime.js";

afterEach(() => vi.useRealTimers());
function fixture(hexes = []) {
  const keys = {
    inputRuntime: { mpeInput: true, bypassBend: false, bendRange: "1200.", wheelPortamentoTime: 60 },
    _retuneGlides: new Map(), _mpeInputBendByChannel: new Map(),
    _normalizePitchBend14: value => value, _allActiveHexes: () => hexes,
    _passthroughPitchBend: vi.fn(),
  };
  keys._kickRetuneGlides = kickRetuneGlides.bind(keys);
  keys._tickRetuneGlides = tickRetuneGlides.bind(keys);
  return keys;
}
function note() {
  const hex = { cents: 6000, _baseCents: 6000, noteOn: vi.fn() };
  hex.retune = vi.fn(cents => { hex.cents = cents; });
  return hex;
}

it("preserves and composes a tuning glide while bend bypass fades independently", () => {
  vi.useFakeTimers();
  const hex = note(), keys = fixture([hex]), entry = { hex, baseCents: 6000 };
  hex._inputChannel = 2;
  keys.state = { activeMidiByChannel: new Map([[2, entry]]) };
  keys._applyMpePitchBend = applyMpePitchBend.bind(keys);
  keys._retuneHexFromBase = retuneHexFromBase.bind(keys);
  keys._refreshSoundingHexNeighbors = vi.fn();
  applyMpePitchBend.call(keys, entry, 2, 12288);
  queueRetuneGlide.call(keys, hex, 6500);
  const tuningGlide = keys._retuneGlides.get(hex);
  keys.inputRuntime.bypassBend = true;
  transitionBendBypass(keys);
  expect(keys._retuneGlides.get(hex)).toBe(tuningGlide);
  expect(tuningGlide.targetBase).toBe(6500);
  vi.advanceTimersByTime(70);
  expect(hex.cents).toBe(hex._baseCents);
  vi.advanceTimersByTime(800);
  expect(hex._baseCents).toBe(6500);
  expect(hex.cents).toBe(6500);
  keys.inputRuntime.bypassBend = false;
  transitionBendBypass(keys);
  vi.advanceTimersByTime(70);
  expect(hex.cents).toBe(7100);
  expect(keys._retuneGlides.size).toBe(0);
  expect(keys._bendBypassGlides.size).toBe(0);
});

it("panic/reset clears independent bypass glides and released voices leave no pending work", () => {
  vi.useFakeTimers();
  const hex = note(), keys = fixture([hex]);
  transitionBendBypass(keys);
  hex.release = true;
  vi.advanceTimersByTime(10);
  expect(keys._bendBypassGlides.size).toBe(0);
  hex.release = false;
  transitionBendBypass(keys);
  keys._wheelInputState = {};
  resetWheelInputState.call(keys, true);
  expect(keys._bendBypassGlides.size).toBe(0);
});

it("also preserves a tuning destination queued after the bypass-return glide starts", () => {
  vi.useFakeTimers();
  const hex = note(), keys = fixture([hex]), entry = { hex, baseCents: 6000 };
  hex._inputChannel = 2;
  keys.state = { activeMidiByChannel: new Map([[2, entry]]) };
  keys._applyMpePitchBend = applyMpePitchBend.bind(keys);
  keys._retuneHexFromBase = retuneHexFromBase.bind(keys);
  keys._refreshSoundingHexNeighbors = vi.fn();
  keys.inputRuntime.bypassBend = true;
  applyMpePitchBend.call(keys, entry, 2, 12288);
  keys.inputRuntime.bypassBend = false;
  transitionBendBypass(keys);
  queueRetuneGlide.call(keys, hex, 6500);
  expect(keys._bendBypassGlides.has(hex)).toBe(true);
  vi.advanceTimersByTime(900);
  expect(hex._baseCents).toBe(6500);
  expect(hex.cents).toBe(7100);
});

it("glides to neutral and back to the latest tracked MPE bend without retriggering", () => {
  vi.useFakeTimers();
  const hex = note(), keys = fixture([hex]), entry = { hex, baseCents: 6000 };
  applyMpePitchBend.call(keys, entry, 2, 12288);
  expect(hex.cents).toBe(6600);
  keys.inputRuntime.bypassBend = true;
  transitionBendBypass(keys);
  expect(hex.cents).toBe(6600);
  vi.advanceTimersByTime(30);
  expect(hex.cents).toBeGreaterThan(6000);
  expect(hex.cents).toBeLessThan(6600);
  applyMpePitchBend.call(keys, entry, 2, 14336);
  expect(keys._mpeInputBendByChannel.get(2)).toBe(14336);
  vi.advanceTimersByTime(40);
  expect(hex.cents).toBe(6000);
  expect(hex._inputBendTarget.cents).toBe(6900);
  expect(hex._lastPitchBend14).toBe(8192);
  keys.inputRuntime.bypassBend = false;
  transitionBendBypass(keys);
  vi.advanceTimersByTime(30);
  expect(hex.cents).toBeGreaterThan(6000);
  expect(hex.cents).toBeLessThan(6900);
  vi.advanceTimersByTime(40);
  expect(hex.cents).toBe(6900);
  expect(hex._baseCents).toBe(6000);
  expect(hex.noteOn).not.toHaveBeenCalled();
});

it("new attacks stay unbent while bypassed and follow base-pitch changes", () => {
  const hex = note(), keys = fixture([hex]);
  keys.inputRuntime.bypassBend = true;
  applyInputBend(keys, hex, 6700);
  expect(hex.cents).toBe(6000);
  hex._baseCents = 6100;
  applyInputBend(keys, hex, 6800);
  expect(hex.cents).toBe(6100);
  expect(hex._inputBendTarget.cents).toBe(6800);
});

it("glides standard raw MIDI bend even without internal voices, tracking changes during bypass", () => {
  vi.useFakeTimers();
  const keys = fixture();
  Object.assign(keys.inputRuntime, { mpeInput: false, wheelToRecent: false, bypassBend: true });
  keys._wheelValue14 = keys._wheelInputValue14 = 12288;
  transitionBendBypass(keys);
  vi.advanceTimersByTime(70);
  expect(keys._passthroughPitchBend).toHaveBeenLastCalledWith(8192);
  keys._wheelInputValue14 = 4096;
  keys.inputRuntime.bypassBend = false;
  transitionBendBypass(keys);
  vi.advanceTimersByTime(70);
  expect(keys._passthroughPitchBend).toHaveBeenLastCalledWith(4096);
});
