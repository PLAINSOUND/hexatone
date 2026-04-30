import { describe, expect, it } from "vitest";
import {
  classifyReleaseForSettlement,
  evaluateSettlement,
  hasLegacyFrameNotes,
  noteBelongsToFrameId,
  normalizeSettlementNotes,
} from "./note-context-runtime.js";

describe("keyboard/note-context-runtime", () => {
  it("classifies a note by onset frame id", () => {
    expect(noteBelongsToFrameId({ _onsetFrameId: "frame-old" }, "frame-old")).toBe(true);
    expect(noteBelongsToFrameId({ _onsetFrameId: "frame-new" }, "frame-old")).toBe(false);
  });

  it("detects legacy-frame notes across active and sustained collections", () => {
    const modulationState = {
      mode: "pending_settlement",
      oldFrame: { id: "frame-old" },
    };
    expect(hasLegacyFrameNotes(modulationState, [
      { onsetFrameId: "frame-old", source: "active" },
    ])).toBe(true);
    expect(hasLegacyFrameNotes(modulationState, [
      { onsetFrameId: "frame-old", source: "sustained" },
    ])).toBe(true);
    expect(hasLegacyFrameNotes(modulationState, [
      { onsetFrameId: "frame-new", source: "active" },
    ])).toBe(false);
  });

  it("evaluates whether pending modulation can settle", () => {
    const modulationState = {
      mode: "pending_settlement",
      oldFrame: { id: "frame-old" },
    };
    expect(evaluateSettlement(modulationState, [{ onsetFrameId: "frame-old", source: "active" }])).toEqual({
      pendingSettlement: true,
      hasLegacyNotes: true,
      canSettle: false,
    });
    expect(evaluateSettlement(modulationState, [{ onsetFrameId: "frame-new", source: "active" }])).toEqual({
      pendingSettlement: true,
      hasLegacyNotes: false,
      canSettle: true,
    });
    expect(evaluateSettlement({ mode: "idle" }, [], [])).toEqual({
      pendingSettlement: false,
      hasLegacyNotes: false,
      canSettle: false,
    });
  });

  it("normalizes Keys active/sustained containers into settlement snapshots", () => {
    expect(normalizeSettlementNotes(
      [{ _onsetFrameId: "frame-old" }],
      [[{ _onsetFrameId: "frame-new" }, 0]],
    )).toEqual([
      { onsetFrameId: "frame-old", source: "active" },
      { onsetFrameId: "frame-new", source: "sustained" },
    ]);
  });

  it("classifies release paths for settlement retry", () => {
    const modulationState = {
      mode: "pending_settlement",
      oldFrame: { id: "frame-old" },
    };

    expect(classifyReleaseForSettlement(modulationState, {
      suppressed: true,
      notes: [],
    })).toEqual({
      suppressed: true,
      pendingSettlement: true,
      hasLegacyNotes: false,
      canSettle: true,
      shouldRetrySettlement: false,
    });

    expect(classifyReleaseForSettlement(modulationState, {
      suppressed: false,
      notes: [{ onsetFrameId: "frame-old", source: "active" }],
    })).toEqual({
      suppressed: false,
      pendingSettlement: true,
      hasLegacyNotes: true,
      canSettle: false,
      shouldRetrySettlement: true,
    });
  });
});
