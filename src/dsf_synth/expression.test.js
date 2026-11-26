import { afterEach, beforeEach, expect, it, vi } from "vitest";
let Processor;
const neutral = { partials: 1024, timbre: 0, attack: 0, decay: 0, sustain: 1, release: 80, volume: 0.2,
  velocity: false, releaseVelocity: false, pressure: false, timbreResponse: false, iso226: false };
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("sampleRate", 48000);
  vi.stubGlobal("currentFrame", 0);
  vi.stubGlobal("AudioWorkletProcessor", class { constructor() { this.port = { postMessage: vi.fn() }; } });
  vi.stubGlobal("registerProcessor", (_name, type) => { Processor = type; });
  await import("./dsf-processor.js");
  const Base = Processor;
  Processor = class extends Base {
    constructor() { super(); this.controls = { ...neutral }; this.prepareControls(); this.volume = neutral.volume; }
  };
});
afterEach(() => vi.unstubAllGlobals());
function send(p, event) { p.message(event.command === "controls"
  ? { ...event, controls: { ...neutral, ...event.controls } } : event); }
function render(p, length = 1000) { p.process([], [[new Float32Array(length)]]); }
it("adds a light-pressure bite that fades quickly and returns on falling pressure", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbre: 0.25, pressure: true } });
  send(p, { command: "start", id: 1, frequency: 440, pressure: 0.04 });
  render(p);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(0.31);
  send(p, { command: "expression", id: 1, pressure: 0.17 });
  render(p);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(0.28);
  send(p, { command: "expression", id: 1, pressure: 0.3 });
  render(p);
  expect(p.voices.get(1).osc.timbre).toBe(0.25);
  send(p, { command: "expression", id: 1, pressure: 0.04 });
  render(p);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(0.31);
  send(p, { command: "expression", id: 1, pressure: 0 });
  render(p);
  expect(p.voices.get(1).osc.timbre).toBe(0.25);
  send(p, { command: "controls", controls: { timbre: 0.25 } });
  send(p, { command: "expression", id: 1, pressure: 0.04 });
  render(p);
  expect(p.voices.get(1).osc.timbre).toBe(0.25);
});
it("reserves pressure boost for the end of the gesture at onset and during a held note", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { pressure: true } });
  send(p, { command: "start", id: 1, frequency: 440, pressure: 0.25 });
  render(p);
  expect(p.voices.get(1).expressionGain).toBeCloseTo(1.046875);
  send(p, { command: "expression", id: 1, pressure: 0.5 });
  render(p);
  expect(p.voices.get(1).expressionGain).toBe(1.375);
  send(p, { command: "expression", id: 1, pressure: 1 });
  render(p);
  expect(p.voices.get(1).expressionGain).toBe(4);
  send(p, { command: "expression", id: 1, pressure: 0 });
  render(p);
  expect(p.voices.get(1).expressionGain).toBe(1);
});
it("adds pressure gain and a small timbre boost independently per voice", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbre: 0.4, pressure: true, timbreResponse: true } });
  send(p, { command: "start", id: 1, frequency: 220 });
  send(p, { command: "start", id: 2, frequency: 440 });
  render(p);
  send(p, { command: "expression", id: 1, pressure: 1, timbre: 1 });
  render(p);
  expect(p.voices.get(1).expressionGain).toBe(4);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(0.5);
  expect(p.voices.get(2).expressionGain).toBe(1);
  expect(p.voices.get(2).osc.timbre).toBeCloseTo(0.35);
  send(p, { command: "controls", controls: { timbre: 0.4 } });
  render(p);
  expect(p.voices.get(1).expressionGain).toBe(1);
  expect(p.voices.get(1).osc.timbre).toBe(0.4);
});
it("remembers expression while disabled and caps brightness at one", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbre: 0.95 } });
  send(p, { command: "start", id: 1, frequency: 220, pressure: 1, timbre: 1 });
  render(p);
  expect(p.voices.get(1).expressionGain).toBe(1);
  expect(p.voices.get(1).osc.timbre).toBe(0.95);
  send(p, { command: "controls", controls: { timbre: 0.95, pressure: true, timbreResponse: true } });
  render(p);
  expect(p.voices.get(1).expressionGain).toBe(4);
  expect(p.voices.get(1).osc.timbre).toBe(1);
});
it("makes fast attacks and releases four times quicker only when velocity is enabled", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { attack: 100, release: 100, velocity: true, releaseVelocity: true } });
  send(p, { command: "start", id: 1, frequency: 440, velocity: 127 });
  render(p, 1);
  expect(p.voices.get(1).remaining).toBe(1199);
  render(p, 1199);
  expect(p.voices.get(1).gain).toBe(4);
  expect(p.voices.get(1).osc.timbre).toBe(0.25);
  send(p, { command: "stop", id: 1, velocity: 127 });
  render(p, 1199);
  expect(p.voices.has(1)).toBe(true);
  render(p, 1);
  expect(p.voices.has(1)).toBe(false);
  send(p, { command: "controls", controls: { attack: 100, release: 100 } });
  send(p, { command: "start", id: 2, frequency: 440, velocity: 127 });
  render(p, 1);
  expect(p.voices.get(2).remaining).toBe(4799);
});
it("curves velocity effects toward the extremes while retaining the central envelope times", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { velocity: true } });
  expect(p.envelopeTime(100, 0)).toBe(400);
  expect(p.envelopeTime(100, 64)).toBe(100);
  expect(p.envelopeTime(100, 127)).toBe(25);
  expect(p.envelopeTime(100, 32)).toBe(137.5);
  expect(p.envelopeTime(100, 96)).toBeGreaterThan(90);
  expect(p.attackLevel({ velocity: 0 })).toBeCloseTo(.25);
  expect(p.attackLevel({ velocity: 64 })).toBe(1);
  expect(p.attackLevel({ velocity: 127 })).toBe(4);
  expect(p.envelopeTime(0, 0)).toBe(0);
  send(p, { command: "controls", controls: { attack: 100, release: 100, velocity: true, releaseVelocity: true } });
  send(p, { command: "start", id: 1, frequency: 440, velocity: 0 });
  render(p, 19200);
  expect(p.voices.get(1).gain).toBeCloseTo(.25);
  send(p, { command: "stop", id: 1, velocity: 0 });
  render(p, 19199);
  expect(p.voices.has(1)).toBe(true);
  render(p, 1);
  expect(p.voices.has(1)).toBe(false);
});
it("generates YZ per voice on the audio clock, ignores raw timbre, and clears with panic", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { generateYZ: true, velocity: true, pressure: true, timbreResponse: true, timbre: 0.25 } });
  send(p, { command: "start", id: 1, frequency: 220, velocity: 100 });
  send(p, { command: "start", id: 2, frequency: 440, velocity: 127 });
  render(p, 2000);
  expect(p.voices.get(1).generatedValues.timbre).toBeCloseTo(69 / 127);
  expect(p.voices.get(2).generatedValues.timbre).toBeCloseTo(83 / 127);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(0.25 + 0.2 * 69 / 127 - 0.1 + 0.25 * ((100 - 64) / 63) * (.5 + .5 * (100 - 64) / 63));
  send(p, { command: "expression", id: 1, timbre: 1 });
  render(p, 2000);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(0.25 + 0.2 * 69 / 127 - 0.1 + 0.25 * ((100 - 64) / 63) * (.5 + .5 * (100 - 64) / 63));
  send(p, { command: "expression", id: 1, pressure: 1 });
  render(p, 4000);
  expect(p.voices.get(1).generatedValues.timbre).toBe(1);
  expect(p.voices.get(2).generatedValues.timbre).toBeCloseTo(83 / 127);
  send(p, { command: "controls", controls: { timbre: 0.25 } });
  render(p, 1000);
  expect(p.voices.get(1).generated).toBeNull();
  expect(p.voices.get(1).osc.timbre).toBe(0.25);
  send(p, { command: "clear", epoch: 1 });
  render(p);
  expect(p.voices.size).toBe(0);
});
it.each([[0, .2], [.25, .225], [.5, .25], [.75, .3], [1, .35]])(
  "maps Expression Y %f to timbre %f around a quarter-scale base", (timbre, expected) => {
    const p = new Processor();
    send(p, { command: "controls", controls: { timbre: .25, timbreResponse: true } });
    send(p, { command: "start", id: 1, frequency: 440, timbre });
    render(p);
    expect(p.voices.get(1).osc.timbre).toBeCloseTo(expected, 12);
  },
);
it.each([[0, .31], [.3, .535], [.6, .76], [-.1, .285]])(
  "retains full pressure bite during a held timbre envelope of amount %f", (amount, expected) => {
    const p = new Processor();
    send(p, { command: "controls", controls: { timbre: .25, pressure: true,
      timbreAmount: amount, timbreAttack: 0, timbreDecay: 0, timbreSustain: amount } });
    send(p, { command: "start", id: 1, frequency: 440, pressure: .04 });
    render(p);
    expect(p.voices.get(1).osc.timbre).toBeCloseTo(expected, 12);
    expect(p.voices.get(1).expressionGain).toBeCloseTo(1 + 3 * .04 ** 3, 12);
  },
);
it("retains the pressure bite as the held timbre envelope decays to zero", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbre: .25, pressure: true,
    timbreAmount: .6, timbreAttack: 0, timbreDecay: 100, timbreSustain: 0 } });
  send(p, { command: "start", id: 1, frequency: 440, pressure: .04 });
  render(p, 1);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(.76, 12);
  render(p, 6000);
  expect(p.voices.get(1).timbreEnvelope.gain).toBe(0);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(.31, 12);
});
it.each([-.2, .2])("retains additive pressure bite at release with timbre envelope amount %f", amount => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbre: .5, pressure: true, release: 300,
    timbreAmount: amount, timbreAttack: 0, timbreDecay: 0, timbreSustain: amount, timbreRelease: 100 } });
  send(p, { command: "start", id: 1, frequency: 440, pressure: .04 });
  render(p, 1);
  const voice = p.voices.get(1), pressureGain = voice.expressionGain;
  const held = .5 + amount * .5 + .06;
  expect(voice.osc.timbre).toBeCloseTo(held, 12);
  p.apply({ command: "stop", id: 1, velocity: 64, frame: p.frame });
  expect(voice.osc.timbre).toBeCloseTo(held, 12);
  render(p, 6000);
  expect(voice.timbreEnvelope.gain).toBe(0);
  expect(voice.osc.timbre).toBeCloseTo(.56, 12);
  expect(voice.expressionGain).toBe(pressureGain);
  expect(p.voices.has(1)).toBe(true);
});
it("keeps release pressure bite available when timbre ADSR is bypassed", () => {
  const p = new Processor();
  send(p, { command: "controls", controls: { timbre: .5, pressure: true,
    timbreAmount: -.2, timbreEnvelope: false, release: 300 } });
  send(p, { command: "start", id: 1, frequency: 440, pressure: .04 });
  render(p, 1);
  send(p, { command: "stop", id: 1 });
  render(p, 1000);
  expect(p.voices.get(1).osc.timbre).toBeCloseTo(.56, 12);
});
