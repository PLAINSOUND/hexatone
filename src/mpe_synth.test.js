import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create_mpe_synth } from "./mpe_synth/index.js";

const scale12 = [
  "100.", "200.", "300.", "400.", "500.", "600.",
  "700.", "800.", "900.", "1000.", "1100.", "1200.",
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

    expect(midi_output.send).toHaveBeenCalledWith([0xE0 + 1, 0, 64]);
    expect(midi_output.send).toHaveBeenCalledWith([0xE0 + 2, 0, 64]);
    expect(midi_output.send).toHaveBeenCalledWith([0xE0 + 3, 0, 64]);
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
    expect(laterCalls).toEqual(
      expect.arrayContaining([
        [[0xE0 + 1, 0, 64]],
        [[0xE0 + 2, 0, 64]],
      ]),
    );
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
    synth.makeHex(
      { x: 0, y: 0 },
      37.5,
      0,
      0,
      12,
      0,
      100,
      60,
      72,
      0,
      1,
    );
    const activePbStatus = midi_output.send.mock.calls[0][0][0];
    const callsBeforeTimeout = midi_output.send.mock.calls.length;

    vi.advanceTimersByTime(500);

    const laterCalls = midi_output.send.mock.calls.slice(callsBeforeTimeout);
    expect(laterCalls).not.toEqual(
      expect.arrayContaining([
        [[activePbStatus, 0, 64]],
      ]),
    );
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

    synth.makeHex(
      { x: 0, y: 0 },
      37.5,
      0,
      0,
      12,
      0,
      100,
      60,
      72,
      0,
      1,
    );

    expect(midi_output.send).toHaveBeenCalledTimes(2);
    expect(midi_output.send.mock.calls[0][0][0] & 0xF0).toBe(0xE0);
    expect(midi_output.send.mock.calls[1][0][0] & 0xF0).toBe(0x90);
  });
});
