import { describe, it, expect, vi } from "vitest";
import { create_midi_synth } from "./index.js";

const scale12 = [
  "100.", "200.", "300.", "400.", "500.", "600.",
  "700.", "800.", "900.", "1000.", "1100.", "1200.",
];

describe("midi_synth controller-state replay", () => {
  it("replays saved CC, channel pressure, and pitch bend to the output channel", async () => {
    const output = { send: vi.fn() };
    const synth = await create_midi_synth({
      outputMode: {
        output,
        channel: 2,
        midiMapping: "MTS1",
        transportMode: "single_note_realtime",
        velocity: 72,
        sysexType: 127,
        deviceId: 127,
        mapNumber: 0,
        anchorNote: 60,
      },
      tuningContext: {
        fundamental: 440,
        degree0toRefAsArray: [0, 1],
        scale: scale12,
        equivInterval: 1200,
        name: "test",
      },
      legacyInput: {
        midiin_device: "input-1",
        midiin_central_degree: 60,
      },
    });

    synth.applyControllerState({
      ccValues: { 1: 99, 64: 127 },
      channelPressure: 33,
      pitchBend14: 10000,
    });

    expect(output.send).toHaveBeenCalledWith([0xB0 + 2, 1, 99]);
    expect(output.send).toHaveBeenCalledWith([0xB0 + 2, 64, 127]);
    expect(output.send).toHaveBeenCalledWith([0xD0 + 2, 33]);
    expect(output.send).toHaveBeenCalledWith([0xE0 + 2, 10000 & 0x7F, (10000 >> 7) & 0x7F]);
  });
});
