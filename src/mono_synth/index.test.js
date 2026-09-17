import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { chooseMonoCarrier, createMonoSynth } from "./index.js";
import { withOutputTransaction } from "../midi/output-transaction.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup(options = {}) {
  const output = { send: vi.fn() };
  const synth = createMonoSynth({ output, schedulerOptions: { worker: false }, ...options });
  output.send.mockClear();
  const note = (pitch) => synth.makeHex(null, (pitch - 69) * 100, 0, 0, 0, 0, 0, pitch, 90);
  const ons = () => output.send.mock.calls.filter(([b]) => b[0] === 0x90);
  const offs = () => output.send.mock.calls.filter(([b]) => b[0] === 0x80);
  return { output, synth, note, ons, offs };
}
describe("monophonic MIDI output", () => {
  it("chooses a balanced carrier covering all held notes and favours recent notes if impossible", () => {
    expect(chooseMonoCarrier([60, 64], 2)).toBe(62);
    expect(chooseMonoCarrier([60, 80, 82], 2)).toBe(81);
    expect(chooseMonoCarrier([60, 80], 2)).toBe(80);
  });
  it("uses last-note priority and returns to older held identities", () => {
    const { synth, note, ons, offs } = setup();
    const a = note(60),
      b = note(64),
      c = note(67);
    a.noteOn();
    b.noteOn();
    c.noteOn();
    b.noteOff();
    expect(ons()).toHaveLength(3);
    c.noteOff();
    expect(ons().at(-1)[0][1]).toBe(60);
    a.noteOff();
    expect(offs()).toHaveLength(4);
    expect(synth.hasVoices()).toBe(false);
    synth.shutdown();
  });
  it("retains the carrier for bendable overlap and smoothly returns", () => {
    const { synth, output, note, ons } = setup({ portamento: true, time: 80 });
    const a = note(60),
      b = note(61);
    a.noteOn();
    b.noteOn();
    b.cc74(100);
    b.aftertouch(90);
    vi.advanceTimersByTime(100);
    expect(ons()).toHaveLength(1);
    expect(output.send.mock.calls).toContainEqual([[0xb0, 74, 100], expect.any(Number)]);
    expect(output.send.mock.calls).toContainEqual([[0xd0, 90], expect.any(Number)]);
    b.noteOff();
    vi.advanceTimersByTime(100);
    expect(ons()).toHaveLength(1);
    expect(output.send.mock.calls.at(-3)[0]).toEqual([0xe0, 0, 64]);
    synth.shutdown();
  });
  it("rearticulates out-of-range pitches using the whole held set", () => {
    const { synth, note, ons } = setup({ portamento: true });
    const a = note(60),
      b = note(64);
    a.noteOn();
    b.noteOn();
    expect(ons().map(([b]) => b[1])).toEqual([60, 62]);
    b.noteOff();
    vi.advanceTimersByTime(100);
    expect(ons()).toHaveLength(2);
    synth.shutdown();
  });
  it("groups chord transactions and preserves their scheduled onset", () => {
    const { synth, note, ons } = setup({ portamento: true });
    const a = note(60),
      b = note(64);
    withOutputTransaction(() => {
      a.noteOn(100);
      b.noteOn(100);
      b.cc74(70);
    });
    expect(ons()).toEqual([[[0x90, 62, 90], 100]]);
    synth.shutdown();
  });
  it("does not glide across a nonoverlapping transaction or emit after panic", () => {
    const { synth, output, note, ons } = setup({ portamento: true });
    const a = note(60),
      b = note(61);
    a.noteOn();
    withOutputTransaction(() => {
      a.noteOff();
      b.noteOn();
    });
    expect(ons()).toHaveLength(2);
    const c = note(62);
    c.noteOn();
    vi.advanceTimersByTime(16);
    synth.allSoundOff();
    const calls = output.send.mock.calls.length;
    vi.advanceTimersByTime(200);
    expect(output.send).toHaveBeenCalledTimes(calls);
    synth.shutdown();
  });
});
