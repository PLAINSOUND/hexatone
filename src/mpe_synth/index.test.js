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

beforeEach(() => {
  sessionStorage.clear();
});

describe("mpe_synth startup state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the manager and every member channel before configuring a fresh MPE session", async () => {
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
      "standard",
      12,
      2,
      12,
      2,
      500,
    );

    expect(midi_output.send.mock.calls.slice(0, 8)).toEqual([
      [[0xb0, 123, 0]],
      [[0xb0, 120, 0]],
      [[0xb1, 123, 0]],
      [[0xb1, 120, 0]],
      [[0xb2, 123, 0]],
      [[0xb2, 120, 0]],
      [[0xb3, 123, 0]],
      [[0xb3, 120, 0]],
    ]);
    expect(midi_output.send.mock.calls[8][0]).toEqual([0xb0, 101, 0]);
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

  it("explicitly releases persisted voices when a new MPE session starts", async () => {
    const firstOutput = { id: "reload-output", send: vi.fn() };
    const firstSynth = await create_mpe_synth(
      firstOutput,
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
    );
    const soundingHex = firstSynth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 12, 0, 100, 60, 72, 0, 1);

    const reloadedOutput = { id: "reload-output", send: vi.fn() };
    await create_mpe_synth(reloadedOutput, "1", 2, 2, 440, 0, 0, 60, scale12, "standard", 12, 2);

    expect(reloadedOutput.send.mock.calls[0][0]).toEqual([
      0x80 + soundingHex.channel - 1,
      soundingHex.note,
      0,
    ]);
    expect(reloadedOutput.send).toHaveBeenCalledWith([0xb0 + soundingHex.channel - 1, 123, 0]);
    expect(reloadedOutput.send).toHaveBeenCalledWith([0xb0 + soundingHex.channel - 1, 120, 0]);
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

  it("deduplicates repeated identical MPE+ bend, pressure, and CC74 updates", async () => {
    const midi_output = { send: vi.fn() };

    const synth = await create_mpe_synth(
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
      96,
      2,
      12,
      2,
      500,
      true,
      true,
    );

    midi_output.send.mockClear();
    const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);
    midi_output.send.mockClear();

    hex.retune(45, true);
    hex.retune(45, true);
    hex.aftertouch(90, 90 << 7);
    hex.aftertouch(90, 90 << 7);
    hex.cc74(81, 81 << 7);
    hex.cc74(81, 81 << 7);
    vi.advanceTimersByTime(5);

    const cc87Pitch = midi_output.send.mock.calls.filter(
      (call) => call[0][0] === 0xb0 + 1 && call[0][1] === 87,
    );
    const pitchBends = midi_output.send.mock.calls.filter((call) => call[0][0] === 0xe0 + 1);
    const channelPressure = midi_output.send.mock.calls.filter((call) => call[0][0] === 0xd0 + 1);
    const cc74 = midi_output.send.mock.calls.filter(
      (call) => call[0][0] === 0xb0 + 1 && call[0][1] === 74,
    );

    expect(cc87Pitch.length).toBe(3);
    expect(pitchBends.length).toBe(1);
    expect(channelPressure.length).toBe(1);
    expect(cc74.length).toBe(1);
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

  it("centers a released channel once its release guard has elapsed", async () => {
    const midi_output = { send: vi.fn() };
    const synth = await create_mpe_synth(
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
      48,
      2,
      12,
      2,
      500,
    );
    const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);
    vi.advanceTimersByTime(500);
    midi_output.send.mockClear();

    hex.noteOff(64);
    vi.advanceTimersByTime(510);

    expect(midi_output.send).toHaveBeenCalledWith([0xe0 + 1, 0, 64]);
  });

  it("cancels deferred pitch resets when the synth shuts down", async () => {
    const midi_output = { send: vi.fn() };
    const synth = await create_mpe_synth(
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
      48,
      2,
      12,
      2,
      500,
    );
    midi_output.send.mockClear();

    synth.shutdown();
    midi_output.send.mockClear();
    vi.advanceTimersByTime(1000);

    expect(midi_output.send).not.toHaveBeenCalled();
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

describe("mpe_synth MPE+ emission", () => {
  it("does not emit CC87 before pitch bend when MPE+ PB is disabled", async () => {
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
      "standard",
      96,
      2,
      12,
      2,
      500,
      true,
      false,
    );

    midi_output.send.mockClear();
    const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);
    midi_output.send.mockClear();

    hex.retune(52.5, true);

    expect(midi_output.send.mock.calls.some(([msg]) => msg[1] === 87)).toBe(false);
    expect(midi_output.send.mock.calls.some(([msg]) => (msg[0] & 0xf0) === 0xe0)).toBe(true);
  });

  it("retains CC87 for hi-res timbre and pressure when MPE+ PB is disabled", async () => {
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
      "standard",
      96,
      2,
      12,
      2,
      500,
      true,
      false,
    );

    midi_output.send.mockClear();
    const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);
    midi_output.send.mockClear();

    hex.cc74(64, 9000);
    hex.aftertouch(55, 7000);

    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 87, 9000 & 0x7f]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 74, (9000 >> 7) & 0x7f]);
    expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 87, 7000 & 0x7f]);
    expect(midi_output.send).toHaveBeenCalledWith([0xd0 + 1, (7000 >> 7) & 0x7f]);
  });

  it("emits CC87 ahead of hi-res bend when MPE+ PB is enabled", async () => {
    vi.useFakeTimers();
    try {
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
        "standard",
        96,
        2,
        12,
        2,
        500,
        true,
        true,
      );

      midi_output.send.mockClear();
      const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);
      midi_output.send.mockClear();

      hex.cc74(64, 9000);
      hex.aftertouch(55, 7000);
      hex.retune(52.5, true);
      vi.advanceTimersByTime(5);

      expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 87, 9000 & 0x7f]);
      expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 74, (9000 >> 7) & 0x7f]);
      expect(midi_output.send).toHaveBeenCalledWith([0xb0 + 1, 87, 7000 & 0x7f]);
      expect(midi_output.send).toHaveBeenCalledWith([0xd0 + 1, (7000 >> 7) & 0x7f]);
      expect(
        midi_output.send.mock.calls.some(([msg]) => msg[0] === 0xb0 + 1 && msg[1] === 87),
      ).toBe(true);
      expect(midi_output.send.mock.calls.some(([msg]) => (msg[0] & 0xf0) === 0xe0)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends every MPE+ pitch-bend packet immediately when MPE+ PB is enabled", async () => {
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
      "standard",
      96,
      2,
      12,
      2,
      500,
      true,
      true,
    );

    midi_output.send.mockClear();
    const first = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);
    const second = synth.makeHex({ x: 1, y: 0 }, 237.5, 2, 0, 12, 100, 300, 62, 72, 0, 1);
    midi_output.send.mockClear();

    first.retune(52.5, true);
    second.retune(252.5, true);

    expect(midi_output.send.mock.calls.filter(([msg]) => (msg[0] & 0xf0) === 0xe0)).toHaveLength(2);
    expect(midi_output.send.mock.calls.filter(([msg]) => msg[1] === 87)).toHaveLength(2);
  });

  it("updates MPE+ PB live without rebuilding", async () => {
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
      "standard",
      96,
      2,
      12,
      2,
      500,
      true,
      false,
    );

    midi_output.send.mockClear();
    const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);
    midi_output.send.mockClear();

    synth.setMpePlusPitchBendEnabled(true);
    expect(midi_output.send).not.toHaveBeenCalled();

    hex.retune(52.5, true);
    expect(midi_output.send.mock.calls.some(([msg]) => msg[1] === 87)).toBe(true);
    midi_output.send.mockClear();

    hex.retune(53.5, true);
    expect(midi_output.send.mock.calls.some(([msg]) => msg[1] === 87)).toBe(true);

    synth.setMpePlusPitchBendEnabled(false);
    midi_output.send.mockClear();

    hex.retune(54.5, true);
    expect(midi_output.send.mock.calls.some(([msg]) => msg[1] === 87)).toBe(false);
    expect(midi_output.send.mock.calls.some(([msg]) => (msg[0] & 0xf0) === 0xe0)).toBe(true);
  });

  it("applies live MPE+ PB toggles to notes created after the toggle", async () => {
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
      "standard",
      96,
      2,
      12,
      2,
      500,
      true,
      false,
    );

    synth.setMpePlusPitchBendEnabled(true);
    midi_output.send.mockClear();

    synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 72, 0, 1);

    const cc87Index = midi_output.send.mock.calls.findIndex(
      ([msg]) => msg[0] === 0xb0 + 1 && msg[1] === 87,
    );
    const pitchBendIndex = midi_output.send.mock.calls.findIndex(
      ([msg]) => (msg[0] & 0xf0) === 0xe0,
    );

    expect(cc87Index).toBeGreaterThanOrEqual(0);
    expect(pitchBendIndex).toBeGreaterThan(cc87Index);
  });

  it("keeps an octave's live sequencer bends on two distinct owned channels", async () => {
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
      "standard",
      96,
      2,
      12,
      2,
      500,
      true,
      false,
    );
    const upper = synth.makeHex({ x: 0, y: 0 }, 1901.955, 19, 0, 12, 1800, 2000, 88, 72, 0, 1);
    const lower = synth.makeHex({ x: 1, y: 0 }, 701.955, 7, 0, 12, 600, 800, 76, 72, 0, 1);
    midi_output.send.mockClear();

    upper.sequenceRetune(2048.955);
    lower.sequenceRetune(848.955);

    const bends = midi_output.send.mock.calls
      .map(([message]) => message)
      .filter((message) => (message[0] & 0xf0) === 0xe0);
    expect(bends).toHaveLength(2);
    expect(bends.map((message) => (message[0] & 0x0f) + 1)).toEqual([2, 3]);
    expect(bends[0].slice(1)).toEqual(bends[1].slice(1));
  });

  it("never lets a displaced MPE hex bend or note-off the channel's new owner", async () => {
    const midi_output = { send: vi.fn() };
    const synth = await create_mpe_synth(
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
      96,
      2,
      12,
      2,
      500,
      true,
      false,
    );
    const displaced = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 12, -100, 100, 69, 72, 0, 1);
    const owner = synth.makeHex({ x: 1, y: 0 }, 400, 4, 0, 12, 300, 500, 73, 72, 0, 1);
    midi_output.send.mockClear();

    displaced.sequenceRetune(147);
    owner.sequenceRetune(547);
    displaced.noteOff(40);

    const messages = midi_output.send.mock.calls.map(([message]) => message);
    expect(messages.filter((message) => (message[0] & 0xf0) === 0xe0)).toHaveLength(1);
    expect(messages.filter((message) => (message[0] & 0xf0) === 0x80)).toHaveLength(0);
    expect(displaced.release).toBe(true);
    expect(owner.release).toBe(false);
  });

  it("does not let an older same-coordinate retrigger release the newer allocation", async () => {
    const midi_output = { send: vi.fn() };
    const synth = await create_mpe_synth(
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
      96,
      2,
      12,
      2,
      500,
      true,
      false,
    );
    const older = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 12, -100, 100, 69, 72, 0, 1);
    const newer = synth.makeHex({ x: 0, y: 0 }, 400, 4, 0, 12, 300, 500, 73, 72, 0, 1);
    midi_output.send.mockClear();

    older.noteOff(40);
    newer.sequenceRetune(547);
    newer.noteOff(50);

    const messages = midi_output.send.mock.calls.map(([message]) => message);
    const noteOffs = messages.filter((message) => (message[0] & 0xf0) === 0x80);
    const bends = messages.filter((message) => (message[0] & 0xf0) === 0xe0);
    expect(noteOffs).toEqual([[0x81, newer.note, 50]]);
    expect(bends).toHaveLength(1);
    expect(older.release).toBe(true);
    expect(newer.release).toBe(true);
  });
});

describe("mpe_synth automatic Y/Z output", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createAutoYzSynth = (midiOutput, enabled = true) =>
    create_mpe_synth(
      midiOutput,
      "1",
      2,
      4,
      440,
      0,
      0,
      60,
      scale12,
      "standard",
      96,
      2,
      12,
      2,
      500,
      true,
      false,
      enabled,
    );

  it("schedules velocity-shaped CC74 and channel pressure after note-on", async () => {
    const midiOutput = { send: vi.fn() };
    const synth = await createAutoYzSynth(midiOutput);
    midiOutput.send.mockClear();

    synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 100, 0, 1);
    vi.advanceTimersByTime(2);

    const calls = midiOutput.send.mock.calls;
    const noteOnIndex = calls.findIndex(([message]) => (message[0] & 0xf0) === 0x90);
    const generatedIndex = calls.findIndex(
      ([message], index) => index > noteOnIndex && message[1] === 74,
    );
    expect(noteOnIndex).toBeGreaterThanOrEqual(0);
    expect(generatedIndex).toBeGreaterThan(noteOnIndex);
    expect(calls[generatedIndex]).toHaveLength(1);
    expect(calls[generatedIndex + 1]).toHaveLength(1);
  });

  it("does not let a sequence's default zero pressure erase the velocity onset", async () => {
    const midiOutput = { send: vi.fn() };
    const synth = await createAutoYzSynth(midiOutput);
    const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 100, 0, 1);
    midiOutput.send.mockClear();

    hex.aftertouch(0, null, { initialSnapshotExpression: true });
    expect(midiOutput.send).not.toHaveBeenCalled();

    hex.aftertouch(80, null, { initialSnapshotExpression: true });
    expect(midiOutput.send).toHaveBeenCalled();
  });

  it("sends note-off before the short generated release ramp", async () => {
    const midiOutput = { send: vi.fn() };
    const synth = await createAutoYzSynth(midiOutput);
    const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 120, 0, 1);
    midiOutput.send.mockClear();

    // The experimental release curve follows Note Off velocity, independently
    // of the stored attack velocity (120).
    hex.noteOff(1);
    vi.advanceTimersByTime(10);

    expect(midiOutput.send.mock.calls[0][0][0] & 0xf0).toBe(0x80);
    expect(midiOutput.send.mock.calls[0][0][2]).toBe(1);
    expect(midiOutput.send.mock.calls[1][0].slice(0, 2)).toEqual([0xb0 + 1, 74]);
    expect(midiOutput.send.mock.calls[1]).toHaveLength(1);
    expect(midiOutput.send.mock.calls.at(-2)[0][2]).toBe(0);
    expect(midiOutput.send.mock.calls.at(-1)[0][1]).toBe(0);
  });

  it("can be toggled live and leaves ordinary MPE expression unchanged when off", async () => {
    const midiOutput = { send: vi.fn() };
    const synth = await createAutoYzSynth(midiOutput, false);
    const hex = synth.makeHex({ x: 0, y: 0 }, 37.5, 0, 0, 12, 0, 100, 60, 100, 0, 1);
    midiOutput.send.mockClear();

    hex.aftertouch(71);
    hex.cc74(82);
    expect(midiOutput.send.mock.calls.map(([message]) => message)).toEqual([
      [0xd0 + 1, 71],
      [0xb0 + 1, 74, 82],
    ]);

    midiOutput.send.mockClear();
    synth.setAutoGenerateMpeYzEnabled(true);
    vi.advanceTimersByTime(2);
    expect(midiOutput.send.mock.calls.some(([message]) => message[1] === 74)).toBe(true);
  });
});
