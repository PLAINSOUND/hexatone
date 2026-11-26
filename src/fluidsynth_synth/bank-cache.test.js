import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

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
  expect(p.bankSwitchFade).toBeNull();
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

it("waits for a new attack, renders the full 40 ms fade, then installs and plays the requested bank", () => {
  const { p, module, load, render, setVoices } = setup();
  load("A"); setVoices(1);
  load("B", { deferWhenPlaying: true, requestId: 10, preferredPreset: "2:3" });
  expect(p.pendingSoundfont.cacheKey).toBe("B");
  expect(render().every(value => value === 1)).toBe(true);
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(1);
  p.handleMessage({ type: "midi-batch", events: [{ command: { channel: 1, op: "on", a: 64, b: 90 } }] });
  const fade = [];
  for (let i = 0; i < 15; i++) fade.push(...render());
  expect(fade).toHaveLength(1920);
  expect(fade[0]).toBeCloseTo(1919 / 1920);
  expect(fade.at(-1)).toBe(0);
  for (let i = 1; i < fade.length; i++) expect(fade[i]).toBeLessThanOrEqual(fade[i - 1]);
  expect(module._ps_note_on).not.toHaveBeenCalled();
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(1);
  render();
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(2);
  expect(module._ps_note_on).toHaveBeenCalledExactlyOnceWith(1, 1, 64, 90);
  expect(p.selectedProgram).toEqual({ bank: 2, program: 3 });
  expect(p.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "soundfont-loaded", requestId: 10, deferredCommit: true }));
});

it("can replace a pending cold bank or cancel its fade by returning to a resident bank", () => {
  const { p, module, load, render, setVoices } = setup();
  load("A"); setVoices(1);
  load("B", { deferWhenPlaying: true });
  load("C", { deferWhenPlaying: true });
  expect(p.pendingSoundfont.cacheKey).toBe("C");
  p.handleMessage({ type: "midi-batch", events: [{ command: { channel: 1, op: "on", a: 64, b: 90 } }] });
  render();
  const gain = p.bankOutputGain;
  p.handleMessage({ type: "select-cached-soundfont", cacheKey: "A" });
  expect(p.pendingSoundfont).toBeNull();
  const samples = render();
  expect(samples[0]).toBeGreaterThan(gain);
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(1);
});

it("prepares the pending bank without a fade if the old voices naturally finish first", () => {
  const { p, module, load, render, setVoices } = setup();
  load("A"); setVoices(1); load("B", { deferWhenPlaying: true });
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
  load("B", { deferWhenPlaying: true });
  render();
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(1);
  expect(p.pendingSoundfont.cacheKey).toBe("B");
  module._ps_render = () => { module.HEAPF32.fill(0); return 0; };
  render(); render();
  expect(module._ps_load_soundfont).toHaveBeenCalledTimes(2);
});
