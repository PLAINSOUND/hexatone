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
