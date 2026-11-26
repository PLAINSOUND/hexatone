import { afterEach, beforeEach, expect, it, vi } from "vitest";
let Processor;
const neutral = { partials: 1024, timbre: 0, attack: 0, decay: 0, sustain: 1, release: 80, volume: 0.2,
  velocity: false, releaseVelocity: false, pressure: false, timbreResponse: false, iso226: false };
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("sampleRate", 48000);
  vi.stubGlobal("currentFrame", 0);
  vi.stubGlobal("AudioWorkletProcessor", class { constructor() { this.port = { onmessage: null, postMessage: vi.fn() }; } });
  vi.stubGlobal("registerProcessor", (_name, type) => { Processor = type; });
  await import("./dsf-processor.js");
  const Base = Processor;
  Processor = class extends Base {
    constructor() { super(); this.controls = { ...neutral }; this.prepareControls(); this.volume = neutral.volume; }
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
  send(p, { command: "controls", controls: { velocity: true, releaseVelocity: true, iso226: true } });
  send(p, { command: "start", id: 1, frequency: 50, velocity: 64 });
  render(p, 576);
  expect(p.voices.get(1).gain).toBeCloseTo(1, 10);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(0, 10);
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
it("scales ISO compensation in decibels and smoothly updates held voices", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { iso226: 1 } });
  for (const frequency of [50, 1000, 4000]) {
    const full = p.compensationFor(frequency);
    send(p, { command: "controls", controls: { iso226: .5 } });
    expect(p.compensationFor(frequency)).toBeCloseTo(Math.sqrt(full), 12);
    send(p, { command: "controls", controls: { iso226: 0 } });
    expect(p.compensationFor(frequency)).toBe(1);
    send(p, { command: "controls", controls: { iso226: 1 } });
  }
  send(p, { command: "start", id: 1, frequency: 1000 });
  render(p);
  const voice = p.voices.get(1);
  send(p, { command: "controls", controls: { iso226: .5 } });
  expect(voice.compensation).toBe(.85);
  render(p, 480);
  expect(voice.compensation).toBeCloseTo(Math.sqrt(.85), 12);
});
it("keeps volume and envelope controls out of spectral and compensation updates", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: {} });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 100);
  const voice = p.voices.get(1);
  const configure = vi.spyOn(voice.osc, "configure");
  const transition = vi.spyOn(p, "transition");
  const compensation = vi.spyOn(p, "compensationFor");
  const expressiveGain = vi.spyOn(p, "expressiveGain");
  send(p, { command: "controls", controls: { volume: .4, attack: 40, decay: 80, release: 200 } });
  render(p, 480);
  expect(p.volume).toBe(.4);
  expect(transition).not.toHaveBeenCalled();
  expect(configure).not.toHaveBeenCalled();
  expect(compensation).not.toHaveBeenCalled();
  expect(expressiveGain).not.toHaveBeenCalled();
  send(p, { command: "controls", controls: { volume: .4, sustain: .5 } });
  render(p, 480);
  expect(voice.gain).toBe(.5);
  expect(transition).not.toHaveBeenCalled();
});
it("does not restart pressure ramps on timbre updates or repeated expression values", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { pressure: true, timbreResponse: true } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1);
  send(p, { command: "expression", id: 1, pressure: .8 });
  render(p, 120);
  const voice = p.voices.get(1);
  expect(voice.expressionRemaining).toBe(360);
  send(p, { command: "expression", id: 1, timbre: .5 });
  render(p, 120);
  expect(voice.expressionRemaining).toBe(240);
  send(p, { command: "expression", id: 1, timbre: .5, pressure: .8 });
  render(p, 240);
  expect(voice.expressionRemaining).toBe(0);
  expect(voice.expressionGain).toBeCloseTo(1 + 3 * .8 ** 3, 12);
});
it("reuses the crossfade oscillator and evaluates ISO only for pitch or ISO changes", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { iso226: 1, timbreResponse: true, timbre: .25 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1);
  const voice = p.voices.get(1), compensation = vi.spyOn(p, "compensationFor");
  send(p, { command: "expression", id: 1, timbre: .5 });
  render(p, 480);
  const spare = voice.spareOscillator;
  send(p, { command: "expression", id: 1, timbre: 1 });
  render(p, 480);
  expect(voice.spareOscillator).toBe(spare);
  expect(voice.osc.timbre).toBeCloseTo(.35);
  expect(compensation).not.toHaveBeenCalled();
  send(p, { command: "frequency", id: 1, frequency: 660 });
  render(p, 480);
  expect(compensation).toHaveBeenCalledTimes(1);
  expect(compensation).toHaveBeenLastCalledWith(660);
  send(p, { command: "controls", controls: { ...p.controls, iso226: .5 } });
  expect(compensation).toHaveBeenCalledTimes(2);
});
it("cancels a superseded pending spectral change when expression returns to the current target", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbreResponse: true, timbre: .25 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1);
  send(p, { command: "expression", id: 1, timbre: .5 });
  render(p, 1);
  const voice = p.voices.get(1);
  send(p, { command: "expression", id: 1, timbre: 1 });
  render(p, 1);
  expect(voice.pendingTransition).toBe(true);
  send(p, { command: "expression", id: 1, timbre: .5 });
  render(p, 478);
  expect(voice.pendingTransition).toBe(false);
  expect(voice.previous).toBeNull();
  expect(voice.osc.timbre).toBe(.25);
});
it("runs timbre ADSR independently of volume and releases from its current value", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbreAmount: .5, timbreAttack: 10,
    timbreDecay: 20, timbreSustain: .25, timbreRelease: 10, release: 80 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 480);
  const voice = p.voices.get(1), env = voice.timbreEnvelope;
  expect(env.stage).toBe("decay");
  expect(env.gain).toBe(.5);
  expect(voice.gain).toBe(1);
  render(p, 480);
  expect(env.gain).toBeGreaterThan(.25);
  expect(env.gain).toBeLessThan(.3);
  const level = env.gain;
  p.apply({ command: "stop", id: 1, frame: p.frame });
  expect(env.gain).toBe(level);
  expect(env.stage).toBe("release");
  render(p, 480);
  expect(env.gain).toBe(0);
  expect(voice.gain).toBeGreaterThan(0);
  expect(p.voices.has(1)).toBe(true);
  render(p, 3360);
  expect(p.voices.has(1)).toBe(false);
});
it.each([[.25, .5, .625], [.25, -.5, .125], [.75, .5, .875], [.75, -.5, .375], [.25, -1, 0], [.25, 1, 1]])(
  "maps base timbre %f and signed offset %f to %f", (base, amount, expected) => {
    const p = new Processor();
    send(p, { command: "controls", controls: { timbre: base, timbreAmount: amount,
      timbreAttack: 0, timbreDecay: 0, timbreSustain: amount } });
    send(p, { command: "start", id: 1, frequency: 440 });
    expect([...render(p, 1)].every(Number.isFinite)).toBe(true);
    const voice = p.voices.get(1);
    expect(voice.timbreEnvelope.stage).toBe("sustain");
    expect(voice.osc.timbre).toBe(expected);
    expect(voice.gain).toBe(1);
  },
);
it("leaves disabled timbre envelopes inert and smooths enabling/disabling on held notes", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbreAmount: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 480);
  const voice = p.voices.get(1), transition = vi.spyOn(p, "transition");
  expect(voice.timbreEnvelope).toBeUndefined();
  render(p, 1000);
  expect(transition).not.toHaveBeenCalled();
  send(p, { command: "controls", controls: { timbreAmount: .5, timbreAttack: 0,
    timbreDecay: 0, timbreSustain: .5 } });
  expect(voice.timbreEnvelope.gain).toBe(.5);
  expect(voice.transitionRemaining).toBe(480);
  render(p, 480);
  expect(voice.osc.timbre).toBe(.5);
  send(p, { command: "controls", controls: { timbreAmount: 0 } });
  expect(voice.timbreEnvelope).toBeNull();
  render(p, 480);
  expect(voice.osc.timbre).toBe(0);
  expect(voice.previous).toBeNull();
});
it("samples timbre targets at a bounded rate without touching ISO or pressure ramps", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbreAmount: .5, timbreAttack: 100,
    timbreDecay: 100, timbreSustain: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1);
  const voice = p.voices.get(1), compensation = vi.spyOn(p, "compensationFor");
  const expressiveGain = vi.spyOn(p, "expressiveGain"), configure = vi.spyOn(voice.osc, "configure");
  render(p, 4799);
  expect(voice.timbreEnvelope.gain).toBe(.5);
  expect(voice.timbreEnvelope.stage).toBe("decay");
  expect(configure.mock.calls.length).toBeGreaterThan(0);
  expect(configure.mock.calls.length).toBeLessThanOrEqual(12);
  expect(compensation).not.toHaveBeenCalled();
  expect(expressiveGain).not.toHaveBeenCalled();
});
it("updates timbre sustain without restarting volume or affecting other notes' envelope clocks", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbreAmount: .5, timbreAttack: 10,
    timbreDecay: 20, timbreSustain: 1 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1440);
  const first = p.voices.get(1);
  send(p, { command: "start", id: 2, frequency: 660 });
  render(p, 240);
  const second = p.voices.get(2);
  expect(second.timbreEnvelope.gain).toBeCloseTo(.375, 10);
  send(p, { command: "controls", controls: { ...p.controls, timbreSustain: .5 } });
  expect(second.timbreEnvelope.remaining).toBe(240);
  expect(first.gain).toBe(1);
  render(p, 480);
  expect(first.timbreEnvelope.gain).toBe(.5);
  expect(first.gain).toBe(1);
});
it("cleans up a voice at the volume endpoint even with a longer timbre release", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbreAmount: .5, timbreAttack: 0,
    timbreDecay: 0, timbreSustain: 1, timbreRelease: 4000, release: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1);
  send(p, { command: "stop", id: 1 });
  expect(render(p, 1)[0]).toBe(0);
  expect(p.voices.size).toBe(0);
  expect(p.port.postMessage).toHaveBeenCalledWith({ type: "ended", id: 1 });
});
it("bypasses volume ADSR without losing its saved settings or disabling timbre ADSR", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { volumeEnvelope: false, attack: 2000,
    decay: 4000, sustain: 0, release: 4000, timbreAmount: .5, timbreAttack: 10 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 24);
  const voice = p.voices.get(1);
  expect(voice.remaining).toBe(24);
  expect(voice.gain).toBeCloseTo(.5, 10);
  render(p, 216);
  expect(voice.gain).toBe(1);
  expect(voice.stage).toBe("sustain");
  expect(voice.timbreEnvelope.gain).toBeCloseTo(.375, 10);
  expect(p.controls.attack).toBe(2000);
  expect(p.controls.release).toBe(4000);
  send(p, { command: "stop", id: 1 });
  render(p, 1);
  expect(voice.remaining).toBe(191);
  expect(voice.gain).toBeGreaterThan(0);
  render(p, 191);
  expect(p.voices.size).toBe(0);
});
it("smoothly bypasses volume ADSR on a held note and restores it from the current level", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { sustain: .25, attack: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1);
  const voice = p.voices.get(1);
  expect(voice.gain).toBe(.25);
  send(p, { command: "controls", controls: { ...p.controls, volumeEnvelope: false } });
  expect(voice.gain).toBe(.25);
  render(p, 480);
  expect(voice.gain).toBe(1);
  send(p, { command: "controls", controls: { ...p.controls, volumeEnvelope: true } });
  render(p, 1);
  expect(voice.gain).toBe(.25);
});
it("bypasses timbre ADSR while preserving its amount and the volume envelope", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbreEnvelope: false, timbreAmount: .75,
    timbreAttack: 0, timbreDecay: 0, timbreSustain: .75, attack: 10 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 240);
  const voice = p.voices.get(1);
  expect(voice.timbreEnvelope).toBeUndefined();
  expect(voice.osc.timbre).toBe(0);
  expect(voice.gain).toBeCloseTo(.75, 10);
  send(p, { command: "controls", controls: { ...p.controls, timbreEnvelope: true } });
  render(p, 480);
  expect(voice.osc.timbre).toBe(.75);
  send(p, { command: "controls", controls: { ...p.controls, timbreEnvelope: false } });
  render(p, 480);
  expect(voice.osc.timbre).toBe(0);
  expect(p.controls.timbreAmount).toBe(.75);
});
it.each([[0, 19200], [64, 4800], [127, 1200]])(
  "scales timbre release with release velocity %i to %i samples", (velocity, samples) => {
    const p = new Processor();
    send(p, { command: "controls", controls: { velocity: true, releaseVelocity: true, release: 4000,
      timbreAmount: .5, timbreAttack: 0, timbreDecay: 0, timbreSustain: 1, timbreRelease: 100 } });
    send(p, { command: "start", id: 1, frequency: 440, velocity: 64 });
    render(p, 1);
    const voice = p.voices.get(1), env = voice.timbreEnvelope;
    p.apply({ command: "stop", id: 1, velocity, frame: p.frame });
    expect(env.remaining).toBe(samples);
    render(p, samples - 1);
    expect(env.remaining).toBe(1);
    expect(env.gain).toBeGreaterThan(0);
    render(p, 1);
    expect(env.remaining).toBe(0);
    expect(env.gain).toBe(0);
    expect(p.voices.has(1)).toBe(true);
  },
);
it("keeps timbre release independent of release velocity when velocity response is off", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { velocity: false,
    timbreAmount: .5, timbreAttack: 0, timbreDecay: 0, timbreSustain: 1, timbreRelease: 100 } });
  for (const [id, velocity] of [[1, 0], [2, 127]]) {
    send(p, { command: "start", id, frequency: 440 });
    render(p, 1);
    p.apply({ command: "stop", id, velocity, frame: p.frame });
    expect(p.voices.get(id).timbreEnvelope.remaining).toBe(4800);
  }
});
it("allows release velocity with note-on velocity disabled", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { velocity: false, releaseVelocity: true,
    attack: 10, release: 100, timbreRelease: 100, timbreAmount: .5,
    timbreAttack: 0, timbreDecay: 0, timbreSustain: 1 } });
  send(p, { command: "start", id: 1, frequency: 440, velocity: 0 });
  render(p, 480);
  const voice = p.voices.get(1);
  expect(voice.gain).toBe(1);
  p.apply({ command: "stop", id: 1, velocity: 127, frame: p.frame });
  expect(voice.remaining).toBe(1200);
  expect(voice.timbreEnvelope.remaining).toBe(1200);
});
it("allows note-on velocity with release velocity disabled", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { velocity: true, releaseVelocity: false,
    attack: 0, release: 100, timbreRelease: 100, timbreAmount: .5,
    timbreAttack: 0, timbreDecay: 0, timbreSustain: 1 } });
  send(p, { command: "start", id: 1, frequency: 440, velocity: 127 });
  render(p, 1);
  const voice = p.voices.get(1);
  expect(voice.gain).toBe(4);
  p.apply({ command: "stop", id: 1, velocity: 127, frame: p.frame });
  expect(voice.remaining).toBe(4800);
  expect(voice.timbreEnvelope.remaining).toBe(4800);
});

it("scales velocity volume and timbre independently and updates held voices", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { velocityVolume: 1, velocityTimbre: 0 } });
  expect(p.attackLevel({ velocity: 0 })).toBeCloseTo(.25, 12);
  expect(p.attackLevel({ velocity: 64 })).toBe(1);
  expect(p.attackLevel({ velocity: 127 })).toBe(4);
  send(p, { command: "start", id: 1, frequency: 440, velocity: 127 });
  render(p, 1);
  const voice = p.voices.get(1);
  expect(voice.gain).toBe(4);
  expect(voice.osc.timbre).toBe(0);
  const configure = vi.spyOn(voice.osc, "configure");
  send(p, { command: "controls", controls: { velocityVolume: .5, velocityTimbre: 0 } });
  render(p, 480);
  expect(voice.gain).toBe(2.5);
  expect(configure).not.toHaveBeenCalled();
  send(p, { command: "controls", controls: { velocityVolume: 0, velocityTimbre: .5 } });
  render(p, 480);
  expect(voice.gain).toBe(1);
  expect(voice.osc.timbre).toBe(.125);
  send(p, { command: "controls", controls: { velocityVolume: 0, velocityTimbre: 1 } });
  render(p, 480);
  expect(voice.osc.timbre).toBe(.25);
});

it("centres velocity timbre at MIDI 64 and scales both signed endpoints", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbre: .5, velocityVolume: 0, velocityTimbre: 1 } });
  for (const [velocity, expected] of [[0, .25], [32, .40625], [64, .5], [95.5, .59375], [127, .75]])
    expect(p.timbreFor({ velocity, pressure: 0, timbre: .5 })).toBeCloseTo(expected, 12);
  send(p, { command: "controls", controls: { timbre: .5, velocityVolume: 0, velocityTimbre: .5 } });
  expect(p.timbreFor({ velocity: 0, pressure: 0, timbre: .5 })).toBeCloseTo(.375, 12);
  expect(p.timbreFor({ velocity: 127, pressure: 0, timbre: .5 })).toBeCloseTo(.625, 12);
});

it.each([[0, 1, 4], [64, 1, 1], [127, 1, .25], [0, .5, 2.5], [127, .5, .625], [0, 0, 1], [127, 0, 1]])(
  "scales both enabled ADSR attacks at velocity %i and amount %f by %f", (velocity, amount, factor) => {
    const p = new Processor();
    send(p, { command: "controls", controls: { velocityVolume: 0, velocityTimbre: 0,
      velocityAttack: amount, attack: 10, timbreAttack: 20, timbreAmount: .5 } });
    send(p, { command: "start", id: 1, frequency: 440, velocity });
    render(p, 1);
    const voice = p.voices.get(1);
    expect(voice.remaining).toBe(480 * factor - 1);
    expect(voice.timbreEnvelope.remaining).toBe(960 * factor - 1);
    expect(p.attackLevel(voice)).toBe(1);
  },
);
it("keeps zero attacks immediate and envelope bypass attacks fixed with velocity attack enabled", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { velocityAttack: 1, attack: 0,
    timbreAttack: 0, timbreDecay: 0, timbreSustain: 1, timbreAmount: .5 } });
  send(p, { command: "start", id: 1, frequency: 440, velocity: 0 });
  render(p, 1);
  expect(p.voices.get(1).stage).toBe("sustain");
  expect(p.voices.get(1).timbreEnvelope.stage).toBe("sustain");
  send(p, { command: "controls", controls: { velocityAttack: 1, volumeEnvelope: false,
    timbreEnvelope: false } });
  send(p, { command: "start", id: 2, frequency: 440, velocity: 0 });
  render(p, 1);
  expect(p.voices.get(2).remaining).toBe(47);
  expect(p.voices.get(2).timbreEnvelope).toBeFalsy();
});

it.each([[0, 1, 4, 4], [64, 1, 1, 1], [127, 1, .25, .25],
  [0, .5, 2.5, 2.5], [127, .5, .625, .625], [0, 0, 1, 1], [127, 0, 1, 1]])(
  "scales both releases at velocity %i and amount %f", (velocity, amount, volumeFactor, timbreFactor) => {
    const p = new Processor();
    send(p, { command: "controls", controls: { releaseVelocityRelease: amount,
      release: 100, timbreRelease: 100, timbreAttack: 0, timbreDecay: 0,
      timbreSustain: 1, timbreAmount: .5 } });
    send(p, { command: "start", id: 1, frequency: 440 });
    render(p, 1);
    p.apply({ command: "stop", id: 1, velocity, frame: p.frame });
    const voice = p.voices.get(1);
    expect(voice.remaining).toBe(Math.round(4800 * volumeFactor));
    expect(voice.timbreEnvelope.remaining).toBe(Math.round(4800 * timbreFactor));
  },
);

it.each([[-1, 1, 0, 1], [1, -1, 1, 0], [-.5, .5, .125, .625]])(
  "runs signed timbre peak %f and independent sustain %f back to base", (peak, sustain, peakTimbre, sustainTimbre) => {
    const p = new Processor();
    send(p, { command: "controls", controls: { timbre: .25, timbreAmount: peak,
      timbreSustain: sustain, timbreAttack: 10, timbreDecay: 20, timbreRelease: 10, release: 100 } });
    send(p, { command: "start", id: 1, frequency: 440 });
    render(p, 1);
    const voice = p.voices.get(1);
    expect(voice.osc.timbre).toBe(.25);
    render(p, 479);
    expect(voice.timbreEnvelope.gain).toBe(peak);
    expect(p.timbreFor(voice)).toBeCloseTo(peakTimbre, 12);
    render(p, 960);
    expect(voice.timbreEnvelope.stage).toBe("sustain");
    expect(p.timbreFor(voice)).toBeCloseTo(sustainTimbre, 12);
    p.apply({ command: "stop", id: 1, frame: p.frame });
    expect(voice.timbreEnvelope.gain).toBe(sustain);
    render(p, 480);
    expect(voice.timbreEnvelope.gain).toBe(0);
    expect(p.timbreFor(voice)).toBe(.25);
    expect(p.voices.has(1)).toBe(true);
  },
);
it("allows sustain movement with a zero peak and enabling it on a held note", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbre: .25, timbreAmount: 0, timbreSustain: 0 } });
  send(p, { command: "start", id: 1, frequency: 440 });
  render(p, 1);
  const voice = p.voices.get(1);
  expect(voice.timbreEnvelope).toBeUndefined();
  send(p, { command: "controls", controls: { timbre: .25, timbreAmount: 0,
    timbreSustain: -1, timbreAttack: 0, timbreDecay: 10 } });
  expect(voice.timbreEnvelope).toBeTruthy();
  render(p, 480);
  expect(voice.timbreEnvelope.gain).toBe(-1);
  expect(p.timbreFor(voice)).toBe(0);
  expect(voice.gain).toBe(1);
});

it("keeps time-route amount changes independent of active envelope and spectrum clocks", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { velocityVolume: 0, velocityTimbre: 0,
    velocityAttack: 0, releaseVelocityRelease: 0, attack: 100, timbreAttack: 100, timbreAmount: .5 } });
  send(p, { command: "start", id: 1, frequency: 440, velocity: 127 });
  render(p, 128);
  const voice = p.voices.get(1), volumeRemaining = voice.remaining;
  const timbreRemaining = voice.timbreEnvelope.remaining;
  const envelope = vi.spyOn(p, "envelope"), configure = vi.spyOn(voice.osc, "configure");
  send(p, { command: "controls", controls: { ...p.controls, velocityAttack: 1, releaseVelocityRelease: 1 } });
  expect(voice.remaining).toBe(volumeRemaining);
  expect(voice.timbreEnvelope.remaining).toBe(timbreRemaining);
  expect(envelope).not.toHaveBeenCalled();
  expect(configure).not.toHaveBeenCalled();
});
