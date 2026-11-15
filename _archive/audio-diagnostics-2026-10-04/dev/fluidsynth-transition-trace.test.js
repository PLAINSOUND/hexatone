import { expect, it } from "vitest";
import { create_midi_synth } from "../midi_synth/index.js";

it("traces 12-EDO alternating notes through the built-in FluidSynth MTS route", async () => {
  const messages = [];
  const synth = await create_midi_synth({
    outputMode: {
      output: { send: bytes => messages.push([...bytes]) }, channel: 0,
      midiMapping: "MTS1", transportMode: "single_note_realtime",
      velocity: 72, sysexType: 127, deviceId: 127, mapNumber: 0,
      isFluidsynthMirror: true, anchorNote: 60, pitchBendRange: 2,
    },
    tuningContext: {
      fundamental: 440, degree0toRefAsArray: [0, 1],
      scale: Array.from({ length: 12 }, (_, i) => `${(i + 1) * 100}.`),
      equivInterval: 1200, name: "12edo trace",
    },
    legacyInput: { midiin_device: "generic", midiin_anchor_note: 60 },
  });
  messages.length = 0;
  for (const note of [60, 62, 60, 62, 64, 66, 64, 62, 60]) {
    // Cents relative to the configured A4 fundamental.
    const hex = synth.makeHex({ x: note, y: 0 }, (note - 69) * 100,
      0, 0, 12, -100, 100, note, 72, 0, 1);
    hex.noteOn();
    hex.noteOff(0);
  }
  const trace = messages.filter(bytes => bytes[0] === 0xf0 ||
    (bytes[0] & 0xf0) === 0x90 || (bytes[0] & 0xf0) === 0x80);
  expect(trace).toHaveLength(27);
  const notes = [60, 62, 60, 62, 64, 66, 64, 62, 60];
  notes.forEach((note, index) => {
    expect(trace[index * 3]).toEqual([
      0xf0, 127, 127, 8, 2, 0, 1, note, note, 0, 0, 0xf7,
    ]);
    expect(trace[index * 3 + 1]).toEqual([0x90, note, 72]);
    expect(trace[index * 3 + 2]).toEqual([0x80, note, 0]);
  });
});
