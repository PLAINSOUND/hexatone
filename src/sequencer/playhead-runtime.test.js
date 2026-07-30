import { describe, expect, it } from "vitest";
import { derivePlayheadNavigationState } from "./playhead-runtime.js";

describe("sequencer playhead runtime", () => {
  it("derives cue and snapshot selections from the current bar when playback is off", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: -1, markerIndex: null, barIndex: 1 },
      sortedBars: [
        { id: "bar-1", position: 1 },
        { id: "bar-2", position: 2 },
      ],
      sequenceCueGroups: [
        { snapshotIndex: 0, time: 1.25 },
        { snapshotIndex: 1, time: 2.125 },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }],
    });

    expect(state.selectedBarTime).toBe(2);
    expect(state.nextCueIndexFromBar).toBe(1);
    expect(state.nextSnapshotIndexFromBar).toBe(1);
    expect(state.snapshotSelectValue).toBe("1");
    expect(state.cueSelectValue).toBe("1");
    expect(state.impliedPendingSnapshotIndex).toBe("1");
    expect(state.impliedPendingCueIndex).toBe("1");
  });

  it("prefers pending jump selections over derived playhead state", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: 0, markerIndex: 0, barIndex: 0 },
      sortedBars: [{ id: "bar-1", position: 1 }],
      sequenceCueGroups: [{ snapshotIndex: 0, time: 1.25 }],
      snapshots: [{ id: "s1" }],
      pendingSnapshotJumpIndex: "4",
      pendingCueJumpIndex: "7",
    });

    expect(state.snapshotSelectValue).toBe("4");
    expect(state.cueSelectValue).toBe("7");
    expect(state.impliedPendingSnapshotIndex).toBe("4");
    expect(state.impliedPendingCueIndex).toBe("7");
  });

  it("exposes an explicit terminal selection when the playhead is at sequence end", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: 5, markerIndex: null, barIndex: 0 },
      sortedBars: [{ id: "bar-1", position: 1 }],
      sequenceCueGroups: [{ snapshotIndex: 0, time: 1.25 }],
      snapshots: [{ id: "s1" }],
    });

    expect(state.playheadIsEnd).toBe(true);
    expect(state.snapshotSelectValue).toBe("__end__");
    expect(state.cueSelectValue).toBe("__end__");
    expect(state.impliedPendingSnapshotIndex).toBe("__end__");
    expect(state.impliedPendingCueIndex).toBe("__end__");
  });

  it("treats a stopped cue selection as armed so the selector stays bracketed", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: 2, markerIndex: 12, barIndex: 2, stopped: true },
      sortedBars: [
        { id: "bar-1", position: 1 },
        { id: "bar-2", position: 2 },
        { id: "bar-3", position: 3 },
      ],
      sequenceCueGroups: Array.from({ length: 16 }, (_, index) => ({
        snapshotIndex: Math.min(index, 3),
        time: 1 + index * 0.25,
      })),
      snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
      pendingTransportSelection: { snapshotIndex: 2, cueIndex: 12 },
    });

    expect(state.cueSelectValue).toBe("12");
    expect(state.impliedPendingCueIndex).toBe("12");
  });

  it("derives the next cue from the selected snapshot instead of the containing bar", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: 2, markerIndex: null, barIndex: 0, stopped: true },
      sortedBars: [{ id: "bar-1", position: 1 }],
      sequenceCueGroups: [
        { snapshotIndex: 0, time: 1 },
        { snapshotIndex: 1, time: 2 },
        { snapshotIndex: 2, time: 3 },
        { snapshotIndex: 2, time: 3.5 },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      pendingTransportSelection: { snapshotIndex: 2, cueIndex: 2 },
    });

    expect(state.snapshotSelectValue).toBe("2");
    expect(state.impliedPendingSnapshotIndex).toBe("2");
    expect(state.cueSelectValue).toBe("2");
    expect(state.impliedPendingCueIndex).toBe("2");
  });

  it("keeps the containing snapshot bracketed when a cue is armed", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: 1, markerIndex: 5, barIndex: 1, stopped: true },
      sortedBars: [
        { id: "bar-1", position: 1 },
        { id: "bar-2", position: 2 },
      ],
      sequenceCueGroups: Array.from({ length: 8 }, (_, index) => ({
        snapshotIndex: index < 3 ? 0 : 1,
        time: 1 + index * 0.25,
      })),
      snapshots: [{ id: "s1" }, { id: "s2" }],
      pendingTransportSelection: { snapshotIndex: 1, cueIndex: 5 },
    });

    expect(state.snapshotSelectValue).toBe("1");
    expect(state.impliedPendingSnapshotIndex).toBe("1");
    expect(state.cueSelectValue).toBe("5");
    expect(state.impliedPendingCueIndex).toBe("5");
  });

  it("brackets an explicitly selected snapshot even when the playhead remains off", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: -1, markerIndex: null, barIndex: 0, stopped: true },
      sortedBars: [{ id: "bar-1", position: 1 }],
      sequenceCueGroups: [
        { snapshotIndex: 0, time: 1 },
        { snapshotIndex: 1, time: 2 },
        { snapshotIndex: 1, time: 2.5 },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }],
      selectedSnapshotId: "s2",
      pendingTransportSelection: { snapshotIndex: 1, cueIndex: 1 },
    });

    expect(state.snapshotSelectValue).toBe("1");
    expect(state.impliedPendingSnapshotIndex).toBe("1");
    expect(state.cueSelectValue).toBe("1");
    expect(state.impliedPendingCueIndex).toBe("1");
  });

  it("brackets an explicitly selected cue from the selected marker time", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: -1, markerIndex: null, barIndex: 0, stopped: true },
      sortedBars: [{ id: "bar-1", position: 1 }],
      sequenceCueGroups: [
        { snapshotIndex: 0, time: 1 },
        { snapshotIndex: 1, time: 2 },
        { snapshotIndex: 1, time: 2.5 },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }],
      selectedSnapshotId: "s2",
      selectedMarker: { snapshotId: "s2", time: 0.5 },
      pendingTransportSelection: { snapshotIndex: 1, cueIndex: 2 },
    });

    expect(state.snapshotSelectValue).toBe("1");
    expect(state.impliedPendingSnapshotIndex).toBe("1");
    expect(state.cueSelectValue).toBe("2");
    expect(state.impliedPendingCueIndex).toBe("2");
  });

  it("shows the active cue index while playback is already on a cue", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: 1, markerIndex: 2, barIndex: 1, stopped: false },
      sortedBars: [
        { id: "bar-1", position: 1 },
        { id: "bar-2", position: 2 },
      ],
      sequenceCueGroups: [
        { snapshotIndex: 0, time: 1 },
        { snapshotIndex: 1, time: 2 },
        { snapshotIndex: 1, time: 2.5 },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }],
    });

    expect(state.cueSelectValue).toBe("2");
    expect(state.impliedPendingCueIndex).toBe("");
  });
});
