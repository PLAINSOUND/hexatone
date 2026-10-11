import { describe, expect, it, vi } from "vitest";
import { audioAttackAllowed, blockAudioAttacks, allowAudioAttacks } from "./attack-gate.js";

describe("audio attack gate", () => {
  it("detects a frozen running clock during repeated attacks", () => {
    const clock = vi.spyOn(performance, "now");
    try {
      const context = { state: "running", currentTime: 10 };
      clock.mockReturnValue(0);
      expect(audioAttackAllowed(context)).toBe(true);
      clock.mockReturnValue(251);
      expect(audioAttackAllowed(context)).toBe(false);
      context.currentTime = 11;
      expect(audioAttackAllowed(context)).toBe(false);
      allowAudioAttacks(context);
      expect(audioAttackAllowed(context)).toBe(true);
    } finally { clock.mockRestore(); }
  });
  it("does not reopen merely because an interrupted context reports running", () => {
    const context = { state: "running" };
    expect(audioAttackAllowed(context)).toBe(true);
    context.state = "interrupted";
    expect(audioAttackAllowed(context)).toBe(false);
    context.state = "running";
    expect(audioAttackAllowed(context)).toBe(false);
    allowAudioAttacks(context);
    expect(audioAttackAllowed(context)).toBe(true);
  });
  it("latches detected stalls independently for each context", () => {
    const context = { state: "running" };
    blockAudioAttacks(context);
    expect(audioAttackAllowed(context)).toBe(false);
    expect(audioAttackAllowed({ state: "running" })).toBe(true);
  });
});
