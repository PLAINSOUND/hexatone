import { afterEach, describe, expect, it, vi } from "vitest";
import { VoicePool } from "./voice-pool-oldest.js";

describe("VoicePool release generations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes a release after lazy expiry when its channel was not reused", () => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const pool = new VoicePool([2, 3], 50);
    const released = pool.noteOn([0, 0]);

    pool.noteOff([0, 0], released.allocationToken);
    now = 151;
    pool.noteOn([1, 0]); // expires channel 2, then consumes channel 3 first

    expect(pool.completeRelease(2, released.allocationToken)).toBe(true);
  });

  it("rejects cleanup from an older generation after its channel is reused", () => {
    const pool = new VoicePool([2], 50);
    const released = pool.noteOn([0, 0]);

    pool.noteOff([0, 0], released.allocationToken);
    pool.noteOn([1, 0]);

    expect(pool.completeRelease(2, released.allocationToken)).toBe(false);
  });
});

describe("VoicePool chord-aware stealing", () => {
  const allocate = (pool, id, note, pitch = note) => {
    const allocation = pool.noteOn([id, 0], 8192, note, pitch);
    pool.setLastNote(allocation.slot, note);
    pool.setLastPitch(allocation.slot, pitch);
    return allocation;
  };

  it("prefers an interior octave duplication", () => {
    const pool = new VoicePool([2, 3, 4, 5, 6], 50, true);
    [48, 55, 60, 67, 72].forEach((note, index) => allocate(pool, index, note));

    const incoming = allocate(pool, 5, 76);

    expect(incoming.stolen).toEqual([2, 0]);
    expect(incoming.stolenNote).toBe(60);
  });

  it("takes the middlemost interior note when no pitch class is duplicated", () => {
    const pool = new VoicePool([2, 3, 4, 5], 50, true);
    [48, 55, 64, 71].forEach((note, index) => allocate(pool, index, note));

    const incoming = allocate(pool, 4, 76);

    expect(incoming.stolen).toEqual([2, 0]);
    expect(incoming.stolenNote).toBe(64);
  });

  it("includes the incoming note when identifying the new outer register", () => {
    const pool = new VoicePool([2, 3], 50, true);
    allocate(pool, 0, 48);
    allocate(pool, 1, 60);

    const incoming = allocate(pool, 2, 36);

    expect(incoming.stolen).toEqual([0, 0]);
    expect(incoming.stolenNote).toBe(48);
  });

  it("recognizes octave duplication from tuned pitch rather than rounded carrier class", () => {
    const pool = new VoicePool([2, 3, 4, 5, 6], 50, true);
    allocate(pool, 0, 48, 48.1);
    allocate(pool, 1, 55, 55);
    allocate(pool, 2, 60, 60.3);
    allocate(pool, 3, 68, 68);
    allocate(pool, 4, 72, 72.1);

    const incoming = allocate(pool, 5, 76, 76);

    expect(incoming.stolen).toEqual([4, 0]);
    expect(incoming.stolenNote).toBe(72);
  });
});
