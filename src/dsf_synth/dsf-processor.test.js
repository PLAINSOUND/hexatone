import { afterEach, beforeEach, expect, it, vi } from "vitest";
let Processor;
const neutral = { partials: 1024, timbre: 0, attack: 0, decay: 0, sustain: 1, release: 80, volume: 0.2,
  velocity: false, pressure: false, timbreResponse: false, iso226: false };
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("sampleRate", 48000);
  vi.stubGlobal("currentFrame", 0);
  vi.stubGlobal("AudioWorkletProcessor", class { constructor() { this.port = { onmessage: null, postMessage: vi.fn() }; } });
  vi.stubGlobal("registerProcessor", (_name, type) => { Processor = type; });
  await import("./dsf-processor.js");
  const Base = Processor;
  Processor = class extends Base {
    constructor() { super(); this.controls = { ...neutral }; this.volume = neutral.volume; }
  };
});
afterEach(() => vi.unstubAllGlobals());
const send = (p, data) => p.port.onmessage({ data: data.command === "controls"
  ? { ...data, controls: { ...neutral, ...data.controls } } : data });
const render = (p, frames = 128) => {
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  expect(p.process([], [channels])).toBe(true);
  expect(channels[1]).toEqual(channels[0]);
  return channels[0];
};
it("starts silent and advances its diagnostic render clock", () => {
  const p = new Processor();
  for (let n = 0; n < 32; n++) expect(render(p).every(x => x === 0)).toBe(true);
  expect(p.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "stats", blocks: 32, frame: 4096 }));
});
it("renders independently releasable voices, with sample-counted attack/release", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 12, release: 80 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  send(p, { command: "start", id: 2, frequency: 660 });
  render(p, 288);
  expect(p.voices.get(1).gain).toBeCloseTo(.5, 10);
  render(p, 288);
  expect(p.voices.get(1).gain).toBe(1);
  send(p, { command: "stop", id: 1 });
  render(p, 1920);
  expect(p.voices.get(1).gain).toBeCloseTo(.5, 10);
  render(p, 1920);
  expect(p.voices.has(1)).toBe(false);
  expect(p.voices.get(2).gain).toBe(1);
});
it("allows an immediate zero-millisecond attack at phase zero", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  const samples = render(p, 2);
  expect(p.voices.get(1).gain).toBe(1);
  expect(p.voices.get(1).remaining).toBe(0);
  expect(samples[0]).toBe(0);
  expect(samples[1]).toBeCloseTo(.084375 * .2 * Math.sin(2 * Math.PI * 440 / 48000), 9);
});
it("allows an immediate zero-millisecond release", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 0, decay: 0, sustain: 1, release: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 2);
  send(p, { command: "stop", id: 1 });
  expect(render(p, 2).every(x => x === 0)).toBe(true);
  expect(p.voices.has(1)).toBe(false);
});
it("allows fixed level independent of velocity or chord size", () => {
  const quiet = new Processor(), loud = new Processor();
  send(quiet, { command: "start", id: 1, frequency: 440, velocity: 1 });
  send(loud, { command: "start", id: 1, frequency: 440, velocity: 127 });
  expect(render(quiet, 1000)).toEqual(render(loud, 1000));
  send(loud, { command: "start", id: 2, frequency: 660, velocity: 127 });
  render(loud);
  expect(loud.voices.get(1).gain).toBe(1);
});
it("can opt into velocity response and limits ISO bass gain", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { velocity: true, iso226: true } });
  send(p, { command: "start", id: 1, frequency: 50, velocity: 64 });
  render(p, 576);
  expect(p.voices.get(1).gain).toBeCloseTo(1, 10);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(0.1 * 64 / 127, 10);
  expect(p.voices.get(1).compensation).toBeCloseTo(.85 * 10 ** (12 / 20), 10);
});
it("softens ISO output at its reference frequency and restores ordinary gain when disabled", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { iso226: true } });
  send(p, { command: "start", id: 1, frequency: 1000 });
  render(p);
  expect(p.voices.get(1).compensation).toBeCloseTo(.85, 12);
  send(p, { command: "controls", controls: { iso226: false } });
  render(p, 480);
  expect(p.voices.get(1).compensation).toBe(1);
});
it("starts/releases at scheduled sample frames and cancels old epochs", () => {
  const p = new Processor();
  send(p, { command: "start", id: 1, frequency: 440, frame: 128 });
  expect(render(p).every(x => x === 0)).toBe(true);
  expect(p.voices.size).toBe(0);
  expect(render(p).some(x => x !== 0)).toBe(true);
  send(p, { command: "start", id: 2, frequency: 660, frame: 10000 });
  send(p, { command: "clear", epoch: 1, ack: 7 });
  send(p, { command: "start", id: 3, frequency: 880, epoch: 0 });
  expect(render(p, 11000).every(x => x === 0)).toBe(true);
  expect(p.queue).toEqual([]);
  expect(p.port.postMessage).toHaveBeenCalledWith({ type: "cleared", ack: 7 });
});
it("cancels a future voice without losing another note's release", () => {
  const p = new Processor();
  send(p, { command: "start", id: 1, frequency: 440 });
  send(p, { command: "start", id: 2, frequency: 660, frame: 10000 });
  send(p, { command: "cancel", id: 2 });
  send(p, { command: "stop", id: 1, frame: 1024 });
  render(p, 12000);
  expect(p.voices.size).toBe(0);
});
it("smooths integer partial/timbre changes and retains oscillator phase", () => {
  const p = new Processor();
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1000);
  const voice = p.voices.get(1), phase = voice.osc.phase;
  send(p, { command: "controls", controls: { partials: 17, timbre: .7 } });
  expect(voice.osc.phase).toBe(phase);
  expect(voice.osc.harmonics).toBe(17);
  expect(voice.transitionRemaining).toBe(480);
  expect([...render(p, 1000)].every(Number.isFinite)).toBe(true);
  expect(voice.previous).toBeNull();
});
it("bounds polyphony, smooths stolen tails, and cannot release a replacement by an old id", () => {
  const p = new Processor();
  for (let id = 1; id <= 80; id++) send(p, { command: "start", id, frequency: 220 });
  render(p);
  expect(p.voices.size).toBe(64);
  expect(p.stolenTails.length).toBeLessThanOrEqual(8);
  send(p, { command: "stop", id: 1 });
  render(p, 500);
  expect(p.voices.get(80).released).toBe(false);
});
it("bounds the queue and never drops a release when it is full", () => {
  const p = new Processor();
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p);
  for (let id = 2; id <= 4100; id++) send(p, { command: "start", id, frequency: 660, frame: 100000 });
  expect(p.queue).toHaveLength(4096);
  send(p, { command: "stop", id: 1 });
  expect(p.voices.get(1).released).toBe(true);
  expect(p.droppedEvents).toBeGreaterThan(0);
});
it("advances through attack, decay and sustain at exact sample boundaries", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 10, decay: 20, sustain: .25 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 480);
  const voice = p.voices.get(1);
  expect(voice.stage).toBe("decay");
  expect(voice.gain).toBe(1);
  render(p, 480);
  expect(voice.gain).toBeCloseTo(.625, 10);
  render(p, 480);
  expect(voice.stage).toBe("sustain");
  expect(voice.gain).toBe(.25);
  render(p, 960);
  expect(voice.gain).toBe(.25);
});
it.each([240, 960])("releases from the current attack/decay level at frame %i", frames => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 10, decay: 20, sustain: .25, release: 10 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, frames);
  const voice = p.voices.get(1), level = voice.gain;
  send(p, { command: "stop", id: 1 });
  render(p, 240);
  expect(voice.stage).toBe("release");
  expect(voice.gain).toBeCloseTo(level / 2, 10);
  render(p, 240);
  expect(p.voices.has(1)).toBe(false);
});
it("finishes a zero-sustain sound without waiting for note-off", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 0, decay: 10, sustain: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 240);
  expect(p.voices.get(1).gain).toBeCloseTo(.5, 10);
  render(p, 240);
  expect(p.voices.has(1)).toBe(false);
  expect(p.port.postMessage).toHaveBeenCalledWith({ type: "ended", id: 1 });
  send(p, { command: "stop", id: 1 });
  expect(render(p).every(value => value === 0)).toBe(true);
});
it("skips zero attack and decay and smoothly changes a held sustain level", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 0, decay: 0, sustain: .5 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1);
  const voice = p.voices.get(1);
  expect(voice.stage).toBe("sustain");
  expect(voice.gain).toBe(.5);
  send(p, { command: "controls", controls: { sustain: .25 } });
  expect(voice.gain).toBe(.5);
  render(p, 480);
  expect(voice.gain).toBe(.25);
});
it("allows decay to rise above the attack peak to 200% sustain", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 10, decay: 20, sustain: 2 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 480);
  const voice = p.voices.get(1);
  expect(voice.gain).toBe(1);
  render(p, 480);
  expect(voice.gain).toBeCloseTo(1.5, 10);
  render(p, 480);
  expect(voice.stage).toBe("sustain");
  expect(voice.gain).toBe(2);
});
