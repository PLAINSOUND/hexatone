import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapshotHighlights } from "./snapshot-highlights.js";

const disposals = [];
afterEach(() => {
  disposals.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let time = 0, next = 0;
  const frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", vi.fn(callback => { frames.set(++next, callback); return next; }));
  vi.stubGlobal("cancelAnimationFrame", id => frames.delete(id));
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn() };
  const canvas = { width: 1, height: 1, style: {}, getContext: vi.fn(() => context) };
  const coords = [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 1 }, { x: 12, y: 0 }];
  const keys = {
    settings: { fundamental: 440 }, tuning: { degree0toRef_asArray: [0, 1] },
    state: { canvas: { width: 400, height: 300, style: { width: "400px", height: "300px", left: "0px", top: "0px" } }, pixelRatio: 1 },
    _visibleGridCoords: coords, _hexGeometryCache: new Map(),
    _canvasTransform: [1, 0, 0, 1, 0, 0], _soundingSnapshotHexes: new Set(),
    hexCoordsToCents: vi.fn(point => [point.x * 100]),
    _buildHexGeometry: point => ({ center: { x: point.x * 20, y: point.y * 20 },
      x: Array.from({ length: 6 }, (_, i) => point.x * 20 + Math.cos(i * Math.PI / 3) * 10),
      y: Array.from({ length: 6 }, (_, i) => point.y * 20 + Math.sin(i * Math.PI / 3) * 10) }),
  };
  const layer = createSnapshotHighlights(keys, canvas);
  disposals.push(() => layer.dispose());
  const tick = at => {
    const elapsed = at - time;
    time = at;
    vi.advanceTimersByTime(elapsed);
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(at));
  };
  const note = (pitch = 76) => ({ _snapshotMidicents: pitch, release: false,
    noteOn: vi.fn(), noteOff: vi.fn() });
  return { layer, keys, canvas, context, frames, tick, note };
}

describe("Snap playback overlay", () => {
  it("does no canvas or animation work while disabled", () => {
    const { layer, note, canvas, frames } = setup();
    layer.noteOn(note(), 20);
    layer.invalidate();
    expect(frames.size).toBe(0);
    expect(canvas.getContext).not.toHaveBeenCalled();
    expect(layer.getDiagnostics().pending).toBe(0);
  });

  it("waits for onset, matches exact pitch/register and retains overlapping voices", () => {
    const { layer, tick, note, context, keys, frames } = setup();
    layer.setEnabled(true);
    const first = note(), second = note();
    layer.noteOn(first, 100);
    layer.noteOn(second, 100);
    layer.noteOff(first, 150);
    layer.noteOff(second, 200);
    tick(0);
    tick(99);
    expect(layer.getDiagnostics().outlinedHexes).toBe(0);
    tick(100);
    expect(layer.getDiagnostics()).toMatchObject({ voices: 2, outlinedHexes: 2 });
    const strokes = context.stroke.mock.calls.length;
    tick(150);
    expect(layer.getDiagnostics()).toMatchObject({ voices: 1, outlinedHexes: 2 });
    expect(context.stroke).toHaveBeenCalledTimes(strokes);
    tick(200);
    expect(layer.getDiagnostics().outlinedHexes).toBe(0);
    expect(frames.size).toBe(0); // no continuous idle painting
    expect(keys.hexCoordsToCents).toHaveBeenCalledTimes(4); // one cached grid lookup
    expect(first.noteOn).not.toHaveBeenCalled();
    expect(first.noteOff).not.toHaveBeenCalled();
  });

  it("does not approximate an off-grid pitch or substitute an octave", () => {
    const { layer, tick, note } = setup();
    layer.setEnabled(true);
    layer.noteOn(note(76.1));
    tick(0);
    expect(layer.getDiagnostics().outlinedHexes).toBe(0);
    layer.noteOn(note(81));
    tick(1);
    expect(layer.getDiagnostics().outlinedHexes).toBe(1);
  });

  it("cancels a released future attack and clears queued events on Stop", () => {
    const { layer, tick, note } = setup();
    layer.setEnabled(true);
    const cancelled = note();
    layer.noteOn(cancelled, 100);
    layer.noteOff(cancelled);
    tick(0);
    tick(100);
    expect(layer.getDiagnostics()).toMatchObject({ voices: 0, outlinedHexes: 0, pending: 0 });
    layer.noteOn(note(), 200);
    layer.clear();
    tick(300);
    expect(layer.getDiagnostics()).toMatchObject({ voices: 0, outlinedHexes: 0, pending: 0 });
  });

  it("retunes legato without flashing unchanged notes or lighting a queued note early", () => {
    const { layer, tick, note, context } = setup();
    layer.setEnabled(true);
    const held = note();
    layer.noteOn(held, 100);
    layer.retune(held);
    tick(50);
    expect(layer.getDiagnostics().outlinedHexes).toBe(0);
    tick(100);
    const strokes = context.stroke.mock.calls.length;
    layer.retune(held);
    tick(101);
    expect(context.stroke).toHaveBeenCalledTimes(strokes);
    held._snapshotMidicents = 69;
    layer.retune(held);
    tick(102);
    expect(layer.getDiagnostics()).toMatchObject({ voices: 1, outlinedHexes: 1 });
  });

  it("collapses a delayed animation frame to the latest state", () => {
    const { layer, tick, note, context } = setup();
    layer.setEnabled(true);
    const voice = note();
    layer.noteOn(voice, 10);
    layer.noteOff(voice, 20);
    tick(1000);
    expect(context.stroke).not.toHaveBeenCalled();
    expect(layer.getDiagnostics()).toMatchObject({ voices: 0, pending: 0 });
  });

  it("seeds active playback on enabling Snap and releases the backing store on disabling it", () => {
    const { layer, tick, note, keys, canvas } = setup();
    const voice = note();
    voice._snapshotAttackAt = 100;
    keys._soundingSnapshotHexes.add(voice);
    layer.setEnabled(true);
    tick(0);
    expect(layer.getDiagnostics().outlinedHexes).toBe(0);
    tick(100);
    expect(layer.getDiagnostics().outlinedHexes).toBe(2);
    layer.setEnabled(false);
    expect(layer.getDiagnostics()).toMatchObject({ voices: 0, pending: 0 });
    expect(canvas.width).toBe(1);
    layer.setEnabled(true);
    tick(101);
    expect(layer.getDiagnostics().outlinedHexes).toBe(2);
  });

  it("rebuilds cached pitch matches after a grid change and uses the main canvas transform", () => {
    const { layer, tick, note, keys, canvas, context } = setup();
    keys.state.pixelRatio = 2;
    keys._canvasTransform = [0, 1, -1, 0, 300, 0];
    layer.setEnabled(true);
    layer.noteOn(note());
    tick(0);
    expect(context.setTransform).toHaveBeenLastCalledWith(0, 2, -2, 0, 600, 0);
    expect(canvas.style.width).toBe("400px");
    keys._visibleGridCoords = [{ x: 0, y: 0 }];
    layer.invalidate();
    tick(1);
    expect(layer.getDiagnostics().outlinedHexes).toBe(0);
    expect(keys.hexCoordsToCents).toHaveBeenCalledTimes(5);
  });

  it("preserves pending playback across keyboard replacement and clears it when Snap is off", () => {
    const { layer, tick, note, keys, canvas } = setup();
    layer.setEnabled(true);
    layer.noteOn(note(), 100);
    layer.dispose();
    const next = createSnapshotHighlights({ ...keys }, canvas);
    disposals.push(() => next.dispose());
    next.setEnabled(true);
    tick(100);
    expect(next.getDiagnostics().outlinedHexes).toBe(2);
    next.dispose();
    const off = createSnapshotHighlights({ ...keys }, canvas);
    disposals.push(() => off.dispose());
    off.setEnabled(false);
    expect(off.getDiagnostics()).toMatchObject({ voices: 0, pending: 0 });
  });

  it("bounds visual backlog without calling audio methods", () => {
    const { layer, note } = setup();
    layer.setEnabled(true);
    for (let i = 0; i < 2100; i++) layer.noteOn(note(), 1000 + i);
    expect(layer.getDiagnostics().pending).toBeLessThanOrEqual(2048);
    expect(layer.getDiagnostics().dropped).toBeGreaterThan(0);
    layer.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
