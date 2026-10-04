import { expect, it, vi } from "vitest";
import { createInternalVoiceSynth } from "./voices.js";
import { create_midi_synth } from "../midi_synth/index.js";

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
