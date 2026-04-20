import { describe, expect, it } from "vitest";
import { getEffectivePreviewCents } from "./tune-cell.js";

describe("TuneCell compare preview", () => {
  it("returns tuned cents when not comparing", () => {
    expect(getEffectivePreviewCents(123.4, false, 100)).toBe(123.4);
  });

  it("returns original cents when compare mode is active", () => {
    expect(getEffectivePreviewCents(123.4, true, 100)).toBe(100);
  });

  it("returns null when there is no preview tuning", () => {
    expect(getEffectivePreviewCents(null, false, 100)).toBeNull();
    expect(getEffectivePreviewCents(null, true, 100)).toBeNull();
  });
});
