import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create_midi_synth } from "./index.js";

const scale12 = [
  "100.",
  "200.",
  "300.",
  "400.",
  "500.",
  "600.",
  "700.",
  "800.",
  "900.",
  "1000.",
  "1100.",
  "1200.",
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-06T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("midi_synth controller-state replay", () => {
  it("sends a full pitch-bend-range RPN on synth creation", async () => {
    const output = { send: vi.fn() };
    await create_midi_synth({
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
        pitchBendRange: 12,
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

    expect(output.send).toHaveBeenCalledWith([0xb0 + 2, 101, 0]);
    expect(output.send).toHaveBeenCalledWith([0xb0 + 2, 100, 0]);
    expect(output.send).toHaveBeenCalledWith([0xb0 + 2, 6, 12]);
    expect(output.send).toHaveBeenCalledWith([0xb0 + 2, 38, 0]);
    expect(output.send).toHaveBeenCalledWith([0xb0 + 2, 101, 127]);
    expect(output.send).toHaveBeenCalledWith([0xb0 + 2, 100, 127]);
  });

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
        pitchBendRange: 2,
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

    expect(output.send).toHaveBeenCalledWith([0xb0 + 2, 1, 99]);
    expect(output.send).toHaveBeenCalledWith([0xb0 + 2, 64, 127]);
    expect(output.send).toHaveBeenCalledWith([0xd0 + 2, 33]);
    expect(output.send).toHaveBeenCalledWith([0xe0 + 2, 10000 & 0x7f, (10000 >> 7) & 0x7f]);
  });
});

describe("midi_synth bulk-dump retune policy", () => {
  it("keeps dynamic bulk retune state local without sending a live bulk dump", async () => {
    const output = { send: vi.fn() };
    const synth = await create_midi_synth({
      outputMode: {
        output,
        channel: 0,
        midiMapping: "DIRECT",
        transportMode: "bulk_dynamic_map",
        velocity: 72,
        sysexType: 126,
        deviceId: 127,
        mapNumber: 0,
        mapName: "test",
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

    const hex = synth.makeHex({ x: 0, y: 0 }, 100, 1, 0, 12, 0, 200, 60, 72, 0, 1);
    hex.noteOn();

    output.send.mockClear();
    hex.retune(130);

    expect(hex.cents).toBe(130);
    expect(hex.mts).toHaveLength(4);
    expect(output.send).not.toHaveBeenCalled();
  });

  it("keeps dynamic bulk carrier tuning cached for the next note-on dump after an OCT-style retune", async () => {
    const output = { send: vi.fn() };
    const synth = await create_midi_synth({
      outputMode: {
        output,
        channel: 0,
        midiMapping: "DIRECT",
        transportMode: "bulk_dynamic_map",
        velocity: 72,
        sysexType: 126,
        deviceId: 127,
        mapNumber: 0,
        mapName: "test",
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

    const firstHex = synth.makeHex({ x: 0, y: 0 }, 100, 1, 0, 12, 0, 200, 60, 72, 0, 1);
    firstHex.noteOn();
    firstHex.retune(1300);

    output.send.mockClear();

    const secondHex = synth.makeHex({ x: 1, y: 0 }, 400, 4, 0, 12, 300, 500, 61, 72, 0, 1);
    secondHex.noteOn();

    const dump = output.send.mock.calls[0][0];
    const offset = 22 + firstHex.carrier * 3;

    expect(dump[offset]).toBe(firstHex.mts[1]);
    expect(dump[offset + 1]).toBe(firstHex.mts[2]);
    expect(dump[offset + 2]).toBe(firstHex.mts[3]);
  });

  it("avoids immediately reusing a recently released dynamic bulk carrier", async () => {
    const output = { send: vi.fn() };
    const synth = await create_midi_synth({
      outputMode: {
        output,
        channel: 0,
        midiMapping: "DIRECT",
        transportMode: "bulk_dynamic_map",
        velocity: 72,
        sysexType: 126,
        deviceId: 127,
        mapNumber: 0,
        mapName: "test",
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

    const firstHex = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 12, -100, 100, 60, 72, 0, 1);
    firstHex.noteOn();
    const firstCarrier = firstHex.carrier;
    firstHex.noteOff(0);

    const secondHex = synth.makeHex({ x: 1, y: 0 }, 0, 0, 0, 12, -100, 100, 61, 72, 0, 1);
    secondHex.noteOn();

    expect(secondHex.carrier).not.toBe(firstCarrier);
  });

  it("static bulk note-ons do not send a fresh tuning map after an OCT-style retune", async () => {
    const output = { send: vi.fn() };
    const synth = await create_midi_synth({
      outputMode: {
        output,
        channel: 0,
        midiMapping: "DIRECT",
        transportMode: "bulk_static_map",
        velocity: 72,
        sysexType: 126,
        deviceId: 127,
        mapNumber: 0,
        mapName: "test",
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

    const firstHex = synth.makeHex({ x: 0, y: 0 }, 100, 1, 0, 12, 0, 200, 60, 72, 0, 1);
    firstHex.noteOn();
    firstHex.retune(2500);
    const firstMts = [...firstHex.mts];

    output.send.mockClear();

    const secondHex = synth.makeHex({ x: 1, y: 0 }, 400, 4, 0, 12, 300, 500, 61, 72, 0, 1);
    secondHex.noteOn();

    expect(output.send).toHaveBeenCalledTimes(1);
    expect(output.send).toHaveBeenCalledWith([0x90, secondHex.carrier, secondHex.velocity]);
    expect(firstHex.mts).toEqual(firstMts);
  });
});
