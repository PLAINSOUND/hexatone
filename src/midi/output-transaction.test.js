import { describe, expect, it } from "vitest";
import {
  getOutputTransaction,
  outputAudioTime,
  outputTimestamp,
  withOutputTransaction,
} from "./output-transaction.js";
describe("synchronous output transactions", () => {
  it("shares clocks through nested chord operations and flushes even when output throws", () => {
    let clock = 1;
    let flushed = false;
    const context = {
      get currentTime() {
        return clock++;
      },
    };
    expect(() =>
      withOutputTransaction(() => {
        const timestamp = outputTimestamp();
        expect(outputAudioTime(context)).toBe(1);
        getOutputTransaction().finalizers.set("recovery", () => {
          flushed = true;
        });
        withOutputTransaction(() => {
          expect(outputAudioTime(context)).toBe(1);
          expect(outputTimestamp()).toBe(timestamp);
        });
        expect(flushed).toBe(false);
        throw new Error("output failure");
      }),
    ).toThrow("output failure");
    expect(flushed).toBe(true);
    expect(getOutputTransaction()).toBeNull();
    expect(outputAudioTime(context)).toBe(2);
  });
});
