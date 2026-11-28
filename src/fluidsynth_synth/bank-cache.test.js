import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { soundfontCacheBudget } from "./cache-budget.js";

function setup(budget = 1000) {
  let Processor, voices = 0, id = 0;
  const scope = { currentFrame: 0, sampleRate: 48000, AudioWorkletProcessor: class {},
    registerProcessor: (_, type) => { Processor = type; } };
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), scope);
  const heap = new Float32Array(256);
  const module = { HEAPF32: heap, FS: { writeFile: vi.fn(), unlink: vi.fn() },
    stringToNewUTF8: () => 4, _free: vi.fn(), _ps_load_soundfont: vi.fn(() => ++id),
    _ps_select_program: vi.fn(() => 0), _ps_active_voice_count: () => voices,
    _ps_unload_soundfont: vi.fn(() => 0), _ps_note_on: vi.fn(() => { voices++; }),
    _ps_note_off: vi.fn(() => { voices = Math.max(0, voices - 1); }),
    _ps_cc: vi.fn((_synth, _channel, cc) => { if (cc === 120) voices = 0; }),
    _ps_render: () => { heap.fill(voices ? 1 : 0); return 0; } };
  const p = Object.create(Processor.prototype);
  Object.assign(p, { module, synth: 1, blockSize: 128, leftPointer: 0, rightPointer: 512,
    midiQueue: [], midiSequence: 0, soundfontCacheBudget: budget,
    readPresets: () => [{ bank: 0, program: 0 }, { bank: 2, program: 3 }],
    port: { postMessage: vi.fn() } });
  const load = (key, extra = {}) => p.handleMessage({ type: p.soundfontId == null ? "load-soundfont" : "replace-soundfont",
    cacheKey: key, bytes: new ArrayBuffer(100), ...extra });
  const render = () => {
    const channels = [new Float32Array(128), new Float32Array(128)];
    p.process([], [channels]);
    scope.currentFrame += 128;
    expect(p.port.postMessage.mock.calls.filter(([m]) => m.type === "error")).toEqual([]);
    return channels[0];
  };
  return { p, module, load, render, setVoices: n => { voices = n; } };
}

it("returns to a resident bank without loading bytes, fading or reattacking", () => {
  const { p, module, load, setVoices } = setup();
  load("A"); load("B"); setVoices(1);
  p.handleMessage({ type: "select-cached-soundfont", cacheKey: "A", requestId: 9, preferredPreset: "2:3" });
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(2);
  expect(p.soundfontId).toBe(1);
  expect(p.selectedProgram).toEqual({ bank: 2, program: 3 });
  expect(module._ps_note_on).not.toHaveBeenCalled();
  expect(p.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "soundfont-cache-result", hit: true, requestId: 9 }));
});

it("evicts least recently used banks by estimated bytes while keeping the selected bank", () => {
  const { p, module, load } = setup(450);
  load("A"); load("B");
  p.handleMessage({ type: "select-cached-soundfont", cacheKey: "A" });
  load("C");
  expect([...p.soundfontCache.keys()].sort()).toEqual(["A", "C"]);
  expect(module._ps_unload_soundfont).toHaveBeenCalledExactlyOnceWith(1, 2);
  expect(p.soundfontId).toBe(3);
});

it("does not evict banks with active voices, then trims them when idle", () => {
  const { p, module, load, setVoices } = setup();
  load("A"); setVoices(1); load("B");
  p.soundfontCacheBudget = 0;
  p.collectRetiredSoundfonts(true);
  expect(module._ps_unload_soundfont).not.toHaveBeenCalled();
  setVoices(0); p.collectRetiredSoundfonts(true);
  expect([...p.soundfontCache.keys()]).toEqual(["B"]);
});

it("can replace a pending cold bank or cancel it by returning to a resident bank", () => {
  const { p, module, load, render, setVoices } = setup();
  load("A"); setVoices(1);
  load("B", { waitForSilence: true });
  load("C", { waitForSilence: true });
  expect(p.pendingSoundfont.cacheKey).toBe("C");
  p.handleMessage({ type: "midi-batch", events: [{ command: { channel: 1, op: "on", a: 64, b: 90 } }] });
  render();
  p.handleMessage({ type: "select-cached-soundfont", cacheKey: "A" });
  expect(p.pendingSoundfont).toBeNull();
  const samples = render();
  expect(samples.every(sample => sample === 1)).toBe(true);
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(1);
});

it("prepares the pending bank without a fade if the old voices naturally finish first", () => {
  const { p, module, load, render, setVoices } = setup();
  load("A"); setVoices(1); load("B", { waitForSilence: true });
  setVoices(0); render();
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(2);
  expect(p.soundfontId).toBe(2);
  expect(module._ps_note_on).not.toHaveBeenCalled();
});

it("waits for audible reverb tails even when the native voice count is zero", () => {
  const { p, module, load, render } = setup();
  load("A");
  module._ps_render = () => { module.HEAPF32.fill(1); return 0; };
  render();
  load("B", { waitForSilence: true });
  render();
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(1);
  expect(p.pendingSoundfont.cacheKey).toBe("B");
  module._ps_render = () => { module.HEAPF32.fill(0); return 0; };
  render(); render();
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(2);
});

it("keeps the held bank sounding and honors the patch attached to each new attack", () => {
  const { p, module, load, render, setVoices } = setup();
  load("Organ");
  setVoices(1);
  module._ps_cc.mockClear();
  load("Harpsichord", { retainSoundingVoices: true, preferredPreset: "2:3" });
  expect(p.soundfontId).toBe(2);
  expect(p.pendingSoundfont).toBeNull();
  expect(render()[0]).toBe(1);
  expect(module._ps_cc).not.toHaveBeenCalled();
  module._ps_select_program.mockClear();

  p.dispatchCommand({ channel: 1, op: "on", a: 60, b: 64,
    patchProgram: { soundfontId: 1, bank: 0, program: 0 } });
  p.dispatchCommand({ channel: 192, op: "on", a: 64, b: 64,
    patchProgram: { soundfontId: 2, bank: 2, program: 3 } });
  expect(module._ps_select_program.mock.calls).toEqual([[1, 1, 1, 0, 0], [1, 192, 2, 2, 3]]);
  expect(module._ps_note_on).toHaveBeenCalledTimes(2);
});

it("keeps playing the old bank until a cold patch finds silence without an imminent attack", () => {
  const { p, module, load, render, setVoices } = setup();
  load("Organ");
  setVoices(1);
  load("Harpsichord", { requestId: 7, waitForSilence: true, retainSoundingVoices: true });
  expect(p.soundfontId).toBe(1);
  expect(p.pendingSoundfont.requestId).toBe(7);
  expect(render()[0]).toBe(1);

  setVoices(0);
  render();
  p.handleMessage({ type: "midi-batch", events: [{ command: { channel: 0, op: "on", a: 60, b: 70 } }] });
  expect(render()[0]).toBe(1);
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(1);

  setVoices(0);
  render();
  render();
  expect(p.soundfontId).toBe(2);
  expect(p.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "soundfont-loaded", requestId: 7, deferredCommit: true,
  }));
  expect(p.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "soundfont-switch-fade" }));
});

it("prepares another bank without activating it and protects both prepared banks from eviction", () => {
  const { p, module, load, render, setVoices } = setup(400);
  load("Organ");
  p.handleMessage({ type: "select-cached-soundfont", cacheKey: "Organ", prepareOnly: true });
  module._ps_select_program.mockClear();
  load("Harpsichord", { prepareOnly: true, waitForSilence: true });
  render();
  expect(p.soundfontId).toBe(1);
  expect(module._ps_select_program).not.toHaveBeenCalled();
  expect(p.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "soundfont-cache", preparedKeys: ["Organ", "Harpsichord"],
  }));

  load("Oversize", { prepareOnly: true, waitForSilence: true });
  render();
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(2);
  expect(p.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "soundfont-switch-error", message: expect.stringContaining("memory budget"),
  }));
  setVoices(1);
  p.handleMessage({ type: "select-cached-soundfont", cacheKey: "Harpsichord",
    retainSoundingVoices: true, preferredPreset: "2:3" });
  expect(p.soundfontId).toBe(2);
  expect(render()[0]).toBe(1);
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(2);
  expect(module._ps_select_program).not.toHaveBeenCalled();
  expect(module._ps_note_off).not.toHaveBeenCalled();

  p.handleMessage({ type: "unpin-soundfonts" });
  expect(p.port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    type: "soundfont-cache", preparedKeys: [],
  }));
});

it("admits the 400, 400 and 80 MiB performance banks within the desktop budget", () => {
  const { p, load, render } = setup(soundfontCacheBudget({ userAgent: "Macintosh" }));
  const banks = [["Organ", 400], ["Harpsichord", 400], ["Srutibox", 80]];
  for (const [name, mib] of banks) {
    // Only the admission check needs large byte counts. Native loading and
    // the virtual file system are mocked here, so no large buffers are made.
    load(name, { prepareOnly: true, waitForSilence: true, bytes: { byteLength: mib * 1024 * 1024 } });
    render();
  }
  expect(p.port.postMessage).toHaveBeenNthCalledWith(p.port.postMessage.mock.calls.length - 1, expect.objectContaining({
    type: "soundfont-cache", preparedKeys: ["Organ", "Harpsichord", "Srutibox"],
    estimatedBytes: 1760 * 1024 * 1024, budgetBytes: 2048 * 1024 * 1024,
  }));
  expect(p.port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "soundfont-loaded", cacheKey: "Srutibox" }));
});

it("makes room for an on-demand bank after silence while keeping the current bank until the new load succeeds", () => {
  const { p, load, render } = setup(400);
  load("Playing");
  load("Prepared", { prepareOnly: true, waitForSilence: true });
  render();
  expect(p.soundfontCache.has("Prepared")).toBe(true);
  load("Next", { waitForSilence: true, bytes: new ArrayBuffer(165) });
  expect(p.soundfontId).toBe(1);
  render();
  expect(p.soundfontId).toBe(3);
  expect([...p.soundfontCache.keys()]).toEqual(["Next"]);
});

it("updates prepared memory immediately and releases unpinned resident bytes once idle", () => {
  const { p, module, load, render, setVoices } = setup();
  load("Playing");
  load("Prepared", { prepareOnly: true, waitForSilence: true });
  render();
  expect(p.port.postMessage).toHaveBeenNthCalledWith(p.port.postMessage.mock.calls.length - 1,
    expect.objectContaining({ preparedBytes: 200, estimatedBytes: 400 }));
  setVoices(1);
  p.handleMessage({ type: "unpin-soundfonts", cacheKey: "Prepared" });
  expect(p.port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ preparedBytes: 0, estimatedBytes: 400 }));
  expect(module._ps_unload_soundfont).not.toHaveBeenCalled();
  setVoices(0);
  p.collectRetiredSoundfonts(true);
  expect(p.port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ preparedBytes: 0, estimatedBytes: 200 }));
  expect(module._ps_unload_soundfont).toHaveBeenCalledExactlyOnceWith(1, 2);
  expect(p.soundfontId).toBe(1);
});

it("unloads the current bank after release and keeps another prepared bank resident", () => {
  const { p, load, setVoices } = setup();
  load("A");
  load("B", { prepareOnly: true });
  setVoices(1);
  p.handleMessage({ type: "unpin-soundfonts", cacheKey: "A" });
  expect(p.soundfontId).toBe(1);
  setVoices(0);
  p.collectRetiredSoundfonts(true);
  expect(p.soundfontId).toBeNull();
  expect([...p.soundfontCache.keys()]).toEqual(["B"]);
});
