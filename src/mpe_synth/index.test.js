import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create_mpe_synth } from "./index.js";

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

describe("mpe_synth startup state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("centers every voice channel immediately when the MPE synth is created", async () => {
    const midi_output = { send: vi.fn() };

    await create_mpe_synth(
      midi_output,
      "1",
      2,
      4,
      440,
      0,
      0,
      60,
      scale12,
      "Ableton_workaround",
      48,
      2,
      12,
      2,
      500,
    );

    expect(midi_output.send).toHaveBeenCalledWith([0xe0 + 1, 0, 64]);
    expect(midi_output.send).toHaveBeenCalledWith([0xe0 + 2, 0, 64]);
    expect(midi_output.send).toHaveBeenCalledWith([0xe0 + 3, 0, 64]);
  });

  it("sends full RPN sequences for manager and member pitch-bend setup", async () => {
    const midi_output = { send: vi.fn() };

    await create_mpe_synth(
      midi_output,
      "1",
      2,
      2,
      440,
      0,
      0,
      60,
      scale12,
      "standard",
      12,
      2,
      12,
      2,
      500,
    );

    expect(midi_output.send).toHaveBeenCalledWith([0xb0, 101, 0]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0, 100, 6]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0, 6, 1]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0, 38, 0]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0, 101, 127]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0, 100, 127]);

    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 101, 0]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 100, 0]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 6, 12]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 38, 0]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 101, 127]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 100, 127]);
  });

  it("re-centers every voice channel again after the release guard", async () => {
    const midi_output = { send: vi.fn() };

    await create_mpe_synth(
      midi_output,
      "1",
      2,
      3,
      440,
      0,
      0,
      60,
      scale12,
      "Ableton_workaround",
      48,
      2,
      12,
      2,
      500,
    );

    const initialCallCount = midi_output.send.mock.calls.length;
    vi.advanceTimersByTime(500);

    const laterCalls = midi_output.send.mock.calls.slice(initialCallCount);
    expect(laterCalls).toEqual(expect.arrayContaining([[[0xe0 + 1, 0, 64]], [[0xe0 + 2, 0, 64]]]));
  });

  it("does not defer-reset a channel that has become active before the timeout", async () => {
    const midi_output = { send: vi.fn() };

    const synth = await create_mpe_synth(
      midi_output,
      "1",
      2,
      3,
      440,
      0,
      0,
      60,
      scale12,
      "Ableton_workaround",
      48,
      2,
      12,
      2,
      500,
    );

    midi_output.send.mockClear();
    synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);
    const activePbStatus = midi_output.send.mock.calls[0][0][0];
    const callsBeforeTimeout = midi_output.send.mock.calls.length;

    vi.advanceTimersByTime(500);

    const laterCalls = midi_output.send.mock.calls.slice(callsBeforeTimeout);
    expect(laterCalls).not.toEqual(expect.arrayContaining([[[activePbStatus, 0, 64]]]));
  });
});

describe("mpe_synth first-note ordering", () => {
  it("sends pitch bend before noteOn for a newly allocated note", async () => {
    const midi_output = { send: vi.fn() };

    const synth = await create_mpe_synth(
      midi_output,
      "1",
      2,
      4,
      440,
      0,
      0,
      60,
      scale12,
      "Ableton_workaround",
      48,
      2,
      12,
      2,
      500,
    );

    midi_output.send.mockClear();

    synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);

    expect(midi_output.send).toHaveBeenCalledTimes(2);
    expect(midi_output.send.mock.calls[0][0][0] & 0xf0).toBe(0xe0);
    expect(midi_output.send.mock.calls[1][0][0] & 0xf0).toBe(0x90);
  });
});

describe("mpe_synth controller-state replay", () => {
  it("replays saved CC, channel pressure, and pitch bend on the manager channel", async () => {
    const midi_output = { send: vi.fn() };

    const synth = await create_mpe_synth(
      midi_output,
      "1",
      2,
      4,
      440,
      0,
      0,
      60,
      scale12,
      "Ableton_workaround",
      48,
      2,
      12,
      2,
      500,
    );

    midi_output.send.mockClear();
    synth.applyControllerState({
      ccValues: { 1: 88, 64: 127 },
      channelPressure: 31,
      pitchBend14: 9000,
    });

    expect(midi_output.send).toHaveBeenCalledWith([0xb0, 1, 88]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0, 64, 127]);
    expect(midi_output.send).toHaveBeenCalledWith([0xd0, 31]);
    expect(midi_output.send).toHaveBeenCalledWith([0xe0, 9000 & 0x7f, (9000 >> 7) & 0x7f]);
  });
});
