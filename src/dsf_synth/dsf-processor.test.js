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
  expect(p.voices.get(1).gain).toBeCloseTo(.75, 10);
  render(p, 288);
  expect(p.voices.get(1).gain).toBe(1);
  send(p, { command: "stop", id: 1 });
  render(p, 1920);
  expect(p.voices.get(1).gain).toBeGreaterThan(.1);
  expect(p.voices.get(1).gain).toBeLessThan(.15);
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
  expect(samples[1]).toBeCloseTo(.125 * .2 * Math.sin(2 * Math.PI * 440 / 48000), 9);
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
  expect(voice.gain).toBeGreaterThan(.25);
  expect(voice.gain).toBeLessThan(.4);
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
  expect(voice.gain / level).toBeGreaterThan(.1);
  expect(voice.gain / level).toBeLessThan(.15);
  render(p, 240);
  expect(p.voices.has(1)).toBe(false);
});
it("finishes a zero-sustain sound without waiting for note-off", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 0, decay: 10, sustain: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 240);
  expect(p.voices.get(1).gain).toBeGreaterThan(.06);
  expect(p.voices.get(1).gain).toBeLessThan(.07);
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
it.each([44100, 48000, 96000])("keeps curved envelope timing and output independent of block size at %i Hz", rate => {
  vi.stubGlobal("sampleRate", rate);
  const whole = new Processor(), split = new Processor();
  for (const p of [whole, split]) {
    send(p, { command: "controls", controls: { attack: 10, decay: 20, sustain: .3, release: 10 } });
    send(p, { command: "start", id: 1, frequency: 440, frame: 13 });
    send(p, { command: "stop", id: 1, frame: 13 + Math.round(rate * .015) });
  }
  const count = Math.round(rate * .03), expected = render(whole, count);
  const actual = new Float32Array(count);
  for (let offset = 0; offset < count; offset += 37)
    actual.set(render(split, Math.min(37, count - offset)), offset);
  expect(actual).toEqual(expected);
  expect(whole.voices.size).toBe(0);
  expect(split.voices.size).toBe(0);
});
it.each(["attack", "release", "decay", "swell"])("keeps the %s curve monotonic and rounds its endpoint", stage => {
  const p = new Processor();
  const rising = stage === "attack" || stage === "swell";
  const start = rising ? 0 : 1, target = rising ? 1 : 0;
  const voice = { gain: start, stage: stage === "swell" ? "sustain" : stage };
  p.envelope(voice, target, 10);
  const gains = [start];
  for (let n = 0; n < 479; n++) { p.advanceEnvelope(voice); gains.push(voice.gain); }
  // Check the curve's final approach before automatic ADSR stage advancement.
  const firstStep = Math.abs(gains[1] - gains[0]);
  const lastStep = Math.abs(target - gains.at(-1));
  expect(firstStep).toBeGreaterThan(0);
  expect(lastStep).toBeLessThan(Math.abs(gains[240] - gains[239]) * .02);
  for (let n = 1; n < gains.length; n++) {
    expect(gains[n]).toBeGreaterThanOrEqual(0);
    expect(gains[n]).toBeLessThanOrEqual(1);
    expect(rising ? gains[n] >= gains[n - 1] : gains[n] <= gains[n - 1]).toBe(true);
  }
  if (stage === "attack") expect(gains[240]).toBeCloseTo(.75, 10);
  if (stage === "swell") {
    expect(gains[240]).toBeCloseTo(.5, 10);
    expect(firstStep).toBeLessThan(1 / 480);
  }
});
it("starts release at the current gain and retains its endpoint when settings change", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 100, release: 20 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 480);
  const voice = p.voices.get(1), level = voice.gain;
  p.apply({ command: "stop", id: 1, frame: p.frame });
  expect(voice.gain).toBe(level);
  render(p, 480);
  const remaining = voice.remaining, current = voice.gain;
  send(p, { command: "controls", controls: { sustain: 2, release: 4000, velocity: true } });
  expect(voice.remaining).toBe(remaining);
  expect(voice.gain).toBe(current);
  render(p, remaining);
  expect(p.voices.has(1)).toBe(false);
});
it("gives falling decay a sharper initial drop than release without changing their durations", () => {
  const p = new Processor();
  const decay = { gain: 1, stage: "decay" };
  const release = { gain: 1, stage: "release" };
  p.envelope(decay, 0, 100);
  p.envelope(release, 0, 100);
  for (let n = 0; n < 1200; n++) {
    p.advanceEnvelope(decay);
    p.advanceEnvelope(release);
  }
  expect(decay.gain).toBeGreaterThan(.30);
  expect(decay.gain).toBeLessThan(.33);
  expect(release.gain).toBeGreaterThan(.38);
  expect(release.gain).toBeLessThan(.39);
  expect(decay.remaining).toBe(3600);
  expect(release.remaining).toBe(3600);
  for (let n = 0; n < 3600; n++) {
    p.advanceEnvelope(decay);
    p.advanceEnvelope(release);
  }
  expect(decay.gain).toBe(0);
  expect(release.gain).toBe(0);
});
it("rounds the falling decay at the peak without adding a hold stage", () => {
  const p = new Processor();
  const voice = { gain: 1, stage: "decay" };
  p.envelope(voice, 0, 100);
  p.advanceEnvelope(voice);
  expect(voice.gain).toBeLessThan(1);
  expect(1 - voice.gain).toBeLessThan(1 / 4800);
  for (let n = 1; n < 240; n++) p.advanceEnvelope(voice);
  expect(voice.gain).toBeGreaterThan(.85);
  expect(voice.gain).toBeLessThan(.95);
  expect(voice.remaining).toBe(4560);
});
