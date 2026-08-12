import { describe, expect, it } from "vitest";
import { shouldShowCourtesyCueDot } from "./event-row.jsx";

describe("sequencer courtesy cue marker", () => {
  it("keeps the green dot through three digits", () => {
    expect(shouldShowCourtesyCueDot(999)).toBe(true);
  });

  it("hides the green dot for four-digit courtesy continuations", () => {
    expect(shouldShowCourtesyCueDot(1000)).toBe(false);
  });
});
