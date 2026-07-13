import { describe, expect, it } from "vitest";
import {
  buildBarRelativeDraft,
  buildEventSequenceDraft,
  commitForeignDrafts,
  eventBarRelativeDraftKey,
  eventSequenceDraftKey,
  removeDraftEntry,
  resolveBarRelativeDraftPosition,
  resolveDraftScopeTarget,
  resolveEventSequenceDraftTarget,
  tempoBarRelativeDraftKey,
  updateBarRelativeDrafts,
  updateEventSequenceDrafts,
} from "./sequence-drafts.js";

describe("sequencer sequence drafts", () => {
  it("builds stable draft keys", () => {
    expect(eventSequenceDraftKey("s1", "e1", "attack")).toBe("s1:e1:attack");
    expect(eventBarRelativeDraftKey("s1", "e1", "release")).toBe("s1:e1:release");
    expect(tempoBarRelativeDraftKey(12)).toBe("12");
  });

  it("updates event sequence drafts while preserving absolute time when snapshot changes", () => {
    const next = updateEventSequenceDrafts({}, {
      draftKey: "s1:e1:attack",
      field: "snapshotNumber",
      value: "3",
      meta: { snapshotNumber: 1, relativeTime: 0.375, snapshotId: "s1" },
      snapshotCount: 5,
    });

    expect(next["s1:e1:attack"]).toMatchObject({
      snapshotNumber: "3",
      offset: "-1.625000",
      scope: "event-sequence:s1:e1:attack",
    });
  });

  it("normalizes bar-relative drafts when bar changes and preserves numerator when beat changes", () => {
    expect(buildBarRelativeDraft({ barNumber: 2, beat: 3, numerator: 5, denominator: 8 }, "bar"))
      .toEqual({ barNumber: "2", beat: "1", numerator: "0", denominator: "8" });
    expect(buildBarRelativeDraft({ barNumber: 2, beat: 3, numerator: 5, denominator: 8 }, "beat"))
      .toEqual({ barNumber: "2", beat: "3", numerator: "5", denominator: "8" });
  });

  it("updates bar-relative draft scopes and removes entries immutably", () => {
    const drafts = updateBarRelativeDrafts({}, {
      draftKey: "a",
      barBeat: { barNumber: 1, beat: 1, numerator: 0, denominator: 1 },
      field: "num",
      value: "3",
      meta: { snapshotId: "s1" },
      scopePrefix: "event",
      beatsPerBarForBarNumber: () => 4,
    });

    expect(drafts.a).toMatchObject({
      numerator: "3",
      scope: "event:a",
      draftKey: "a",
    });
    expect(removeDraftEntry(drafts, "a")).toEqual({});
  });

  it("clamps beat drafts to the current bar numerator without clearing the numerator draft", () => {
    const drafts = updateBarRelativeDrafts({}, {
      draftKey: "b",
      barBeat: { barNumber: 2, beat: 1, numerator: 3, denominator: 8, beatsPerBar: 3 },
      field: "beat",
      value: "9",
      meta: { snapshotId: "s1" },
      scopePrefix: "event",
      beatsPerBarForBarNumber: (barNumber) => (Number(barNumber) === 2 ? 3 : 4),
    });

    expect(drafts.b).toMatchObject({
      beat: "3",
      numerator: "3",
    });
  });

  it("builds initial event sequence drafts from snapshot and offset", () => {
    expect(buildEventSequenceDraft(2, 0.5, { snapshotId: "s2" })).toEqual({
      snapshotNumber: "2",
      offset: "0.500000",
      snapshotId: "s2",
    });
  });

  it("resolves event-sequence draft targets and bar-relative positions", () => {
    expect(resolveEventSequenceDraftTarget(
      { snapshotNumber: "2", offset: "0.375000" },
      [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
    )).toMatchObject({
      snapshotNumber: 2,
      targetSnapshot: { id: "s2" },
      nextAbsoluteTime: 2.375,
    });

    expect(resolveBarRelativeDraftPosition(
      { barNumber: "2", beat: "3", numerator: "1", denominator: "4" },
      [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 2, numerator: 3, denominator: 2 },
      ],
    )).toBe(2.75);
  });

  it("commits only drafts outside the current scope and resolves draft scope targets", () => {
    const committed = [];
    commitForeignDrafts(
      {
        a: { scope: "event:a", id: "a" },
        b: { scope: "event:b", id: "b" },
      },
      "event:a",
      (draft) => committed.push(draft.id),
    );
    expect(committed).toEqual(["b"]);

    const node = document.createElement("div");
    node.setAttribute("data-event-sequence-draft-scope", "event:a");
    const child = document.createElement("span");
    node.appendChild(child);
    document.body.appendChild(node);
    expect(resolveDraftScopeTarget({ target: child }, "data-event-sequence-draft-scope")).toBe("event:a");
    document.body.removeChild(node);
  });
});
