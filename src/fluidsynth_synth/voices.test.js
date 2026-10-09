import { expect, it, vi } from "vitest";
import { createInternalVoiceSynth, reattackFluidSynthSnapshots } from "./voices.js";
import { create_midi_synth } from "../midi_synth/index.js";
import { mtsToMidiFloat } from "../tuning/mts-format.js";

it("reattacks only held snapshots after program selection, preserving channels and queued releases", () => {
  const output = { send: vi.fn(), sendCommand: vi.fn(), cancelEvents: vi.fn() };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 72 },
    tuningContext: { fundamental: 261.6255653 } });
  const make = (sequence) => synth.makeHex(null, 0, 0, 0, 12, -100, 100, null, 77, null, 1,
    sequence ? { absoluteMidicents: 60 } : {});
  const held = make(true);
  const live = make(false);
  const pending = make(true);
  const released = make(true);
  const now = performance.now();
  held.noteOn(now);
  live.noteOn(now);
  pending.noteOn(now + 1000);
  released.noteOn(now);
  released.noteOff(0, now + 500);
  held.sequenceRetune(12);
  held.pressure(80);
  held.cc74(60);
  const channel = held.channel;
  output.sendCommand.mockClear();
  reattackFluidSynthSnapshots(output, now + 20);
  expect(output.sendCommand.mock.calls.map(([command]) => command)).toEqual([
    { channel, op: "off", a: held.steps, b: 0 },
    { channel, op: "on", a: held.steps, b: 77 },
  ]);
  expect(output.cancelEvents).not.toHaveBeenCalled();
  expect(held.channel).toBe(channel);
  expect(held.release).toBe(false);
  held.noteOff(0, now + 200);
  expect(output.sendCommand.mock.calls.at(-1)[0]).toMatchObject({ channel, op: "off" });
});

it("distinguishes pending attacks from voices invalidated by cleanup", () => {
  const output = { send: vi.fn(), sendCommand: vi.fn(), panic: vi.fn() };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 72 },
    tuningContext: { fundamental: 261.6255653 } });
  const hex = synth.makeHex("cue", 0, 0, 0, 12, -100, 100, null, 77, null, 1);
  expect(hex.needsRetainedVoiceRecovery()).toBe(false);
  hex.noteOn(performance.now() + 1000);
  expect(hex.needsRetainedVoiceRecovery()).toBe(false);
  synth.allSoundOff();
  expect(hex.needsRetainedVoiceRecovery()).toBe(true);
});

it("primes cue expression before attack and timestamps later expression with the pending attack", () => {
  const output = { send: vi.fn(), sendCommand: vi.fn(), cancelEvents: vi.fn() };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 72 },
    tuningContext: { fundamental: 261.6255653 } });
  const hex = synth.makeHex("cue", 0, 0, 0, 12, -100, 100, null, 77, null, 1, { absoluteMidicents: 60 });
  const timestamp = performance.now() + 1000;
  hex.prepareSnapshotExpression({ pressure: 100, timbre: 80 });
  hex.noteOn(timestamp);
  const commands = output.sendCommand.mock.calls;
  expect(commands.at(-3)[0]).toMatchObject({ op: "pressure", a: 100 });
  expect(commands.at(-2)[0]).toMatchObject({ op: "cc", a: 74, b: 80 });
  expect(commands.at(-1)[0]).toMatchObject({ op: "on", b: 77 });
  hex.pressure(90);
  hex.cc74(70);
  expect(commands.every(call => call[1] === timestamp)).toBe(true);
  expect(commands.every(call => call[3].scope === "sequence")).toBe(true);
  hex.noteOff();
  expect(output.cancelEvents).toHaveBeenCalledWith(expect.any(Number), null, null, expect.any(Number));
});

it("reserves a channel until its scheduled release instead of reusing it for an earlier live attack", () => {
  const output = { send: vi.fn(), sendCommand: vi.fn() };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 72 },
    tuningContext: { fundamental: 261.6255653 } });
  const voice = () => synth.makeHex("voice", 0, 0, 0, 12, -100, 100, null, 72, null, 1);
  const first = voice();
  first.noteOn();
  first.noteOff(0, performance.now() + 1000);
  const held = Array.from({ length: 127 }, voice);
  held.forEach(h => h.noteOn());
  const replacement = voice();
  replacement.noteOn();
  expect(replacement.channel).not.toBe(first.channel);
  expect(held[0].release).toBe(true);
});

it("retunes sequence voices with exact MTS rather than coarse ±48-semitone bend", () => {
  const output = { send: vi.fn(), sendCommand: vi.fn() };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 72 },
    tuningContext: { fundamental: 261.6255653 } });
  const hex = synth.makeHex("test", 0, 0, 0, 12, -100, 100, null, null, null, 1);
  hex.noteOn();
  output.send.mockClear();
  const shift = 1200 * Math.log2(441 / 440);
  hex.sequenceRetune(shift);
  const data = output.send.mock.calls[0][0];
  expect((mtsToMidiFloat(data.slice(8, 11)) - 60) * 100).toBeCloseTo(shift, 2);
  expect(output.sendCommand.mock.calls.at(-1)[0]).toMatchObject({ op: "bend", a: 8192 });
});

it("closes a disabled output, cancels its queued attacks, and silences sustained tails", () => {
  const output = { send: vi.fn(), sendCommand: vi.fn(), cancelEvents: vi.fn() };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 72 },
    tuningContext: { fundamental: 261.6255653 } });
  const hex = synth.makeHex("test", 0, 0, 0, 12, -100, 100, null, null, null, 1);
  hex.noteOn(performance.now() + 500);
  hex.noteOff(); // The channel is free, but sustain/release tails may still sound.
  output.cancelEvents.mockClear();
  output.sendCommand.mockClear();
  synth.shutdown();
  expect(output.cancelEvents).toHaveBeenCalledOnce();
  expect(output.sendCommand.mock.calls.map(([command]) => command)).toEqual([
    { channel: 0, op: "cc", a: 64, b: 0 },
    { channel: 0, op: "cc", a: 66, b: 0 },
    { channel: 0, op: "cc", a: 120, b: 0 },
  ]);
  output.sendCommand.mockClear();
  synth.makeHex("late", 0).noteOn();
  expect(output.sendCommand).not.toHaveBeenCalled();
});

it("does not silence channels already handed to a replacement output", () => {
  const output = { send: vi.fn(), sendCommand: vi.fn(), cancelEvents: vi.fn() };
  const options = { outputMode: { output, velocity: 72 }, tuningContext: { fundamental: 261.6255653 } };
  const old = createInternalVoiceSynth(options);
  const voice = old.makeHex("old", 0, 0, 0, 12, -100, 100, null, null, null, 1);
  voice.noteOn(); voice.noteOff();
  const replacement = createInternalVoiceSynth(options);
  for (let i = 0; i < 128; i++) {
    replacement.makeHex(String(i), 0, 0, 0, 12, -100, 100, null, null, null, 1).noteOn();
  }
  output.sendCommand.mockClear();
  old.shutdown();
  expect(output.sendCommand).not.toHaveBeenCalled();
  expect(output.cancelEvents).toHaveBeenCalledOnce();
  replacement.shutdown();
});

it.each([48, 96, 12.5])("matches the channel RPN and bend conversion for ±%s semitones", (range) => {
  const output = { send: vi.fn(), sendCommand: vi.fn() };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 72, pitchBendRange: range },
    tuningContext: { fundamental: 261.6255653 } });
  const hex = synth.makeHex("test", 0, 0, 0, 12, -100, 100, null, null, null, 1);
  hex.noteOn();
  const commands = output.sendCommand.mock.calls.map(([command]) => command);
  expect(commands).toContainEqual({ channel: 0, op: "cc", a: 6, b: Math.floor(range) });
  expect(commands).toContainEqual({ channel: 0, op: "cc", a: 38, b: Math.round(range * 100) % 100 });
  output.send.mockClear();
  hex.retune(range * 50);
  expect(output.sendCommand.mock.calls.at(-1)[0]).toMatchObject({ op: "bend", a: 12288 });
  hex.retune(-range * 100);
  expect(output.sendCommand.mock.calls.at(-1)[0]).toMatchObject({ op: "bend", a: 0 });
  expect(output.send).not.toHaveBeenCalled();
});

it("gives 128 voices independent channels/maps, then bends without further MTS", () => {
  const output = { send: vi.fn(), sendCommand: vi.fn() };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 72 },
    tuningContext: { fundamental: 261.6255653 } });
  const voices = Array.from({ length: 128 }, (_, i) => {
    const hex = synth.makeHex(String(i), 0, 0, 0, 12, -100, 100, null, null, null, 1);
    hex.noteOn(); return hex;
  });
  expect(voices.map(hex => hex.channel)).toEqual(Array.from({ length: 128 }, (_, i) => i));
  expect(output.send.mock.calls.map(([data]) => data[5])).toEqual(voices.map(hex => hex.channel));
  output.send.mockClear(); output.sendCommand.mockClear();
  voices[127].retune(100);
  voices[126].pressure(70);
  voices[127].cc74(90);
  expect(output.send).not.toHaveBeenCalled();
  expect(output.sendCommand.mock.calls.map(([command]) => command)).toEqual([
    { channel: 127, op: "bend", a: 8363, b: undefined },
    { channel: 126, op: "pressure", a: 70, b: 0 },
    { channel: 127, op: "cc", a: 74, b: 90 },
  ]);
  const replacement = synth.makeHex("replacement", 0, 0, 0, 12, -100, 100, null, null, null, 1);
  replacement.noteOn();
  expect(voices[0].release).toBe(true);
  output.sendCommand.mockClear(); voices[0].retune(200); voices[0].pressure(100);
  expect(output.sendCommand).not.toHaveBeenCalled();
  synth.releaseAll();
  expect(replacement.release).toBe(true);
});

it("external MTS suppresses the post-attack duplicate but keeps changed real-time tunings", async () => {
  const output = { send: vi.fn() };
  const synth = await create_midi_synth({
    outputMode: { output, channel: 0, midiMapping: "MTS1", velocity: 72 },
    tuningContext: { fundamental: 261.6255653, degree0toRefAsArray: [1, 1], scale: [], equivInterval: "2/1" },
    legacyInput: {},
  });
  const hex = synth.makeHex("test", 0, 0, 0, 12, -100, 100, null, null, null, 1);
  output.send.mockClear(); hex.noteOn(); hex.retune(0); hex.sequenceRetune(0);
  expect(output.send.mock.calls.map(([data]) => data[0])).toEqual([0xf0, 0x90]);
  hex.retune(20);
  expect(output.send.mock.calls.at(-1)[0].slice(0, 2)).toEqual([0xf0, 0x7f]);
  expect(output.send).toHaveBeenCalledTimes(3);
});
