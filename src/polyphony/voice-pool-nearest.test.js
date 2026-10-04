import { describe, expect, it } from "vitest";
import { VoicePool } from "./voice-pool-nearest.js";

describe("nearest-note voice ownership", () => {
  it("keeps same-coordinate, same-pitch triggers in separate carrier voices", () => {
    const pool = new VoicePool([60, 61]);
    const coords = { x: 0, y: 0 };
    const lumatoneTrigger = {};
    const pointerTrigger = {};

    const lumatone = pool.noteOn(coords, 60, lumatoneTrigger);
    const pointer = pool.noteOn(coords, 60, pointerTrigger);

    expect(lumatone.slot).not.toBe(pointer.slot);
    expect(lumatone.retrigger).toBe(false);
    expect(pointer.retrigger).toBe(false);
    expect(pool.activeCount).toBe(2);

    expect(pool.noteOff(coords, lumatoneTrigger)).toBe(lumatone.slot);
    expect(pool.ownsVoice(pointer.slot, pointerTrigger)).toBe(true);
    expect(pool.noteOff(coords, pointerTrigger)).toBe(pointer.slot);
    expect(pool.activeCount).toBe(0);
  });

});
