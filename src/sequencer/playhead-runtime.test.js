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

  it("normalizes end-of-sequence playhead state back to the first selectable item", () => {
    const state = derivePlayheadNavigationState({
      playhead: { stepIndex: 5, markerIndex: null, barIndex: 0 },
      sortedBars: [{ id: "bar-1", position: 1 }],
      sequenceCueGroups: [{ snapshotIndex: 0, time: 1.25 }],
      snapshots: [{ id: "s1" }],
    });

    expect(state.playheadIsEnd).toBe(true);
    expect(state.snapshotSelectValue).toBe("0");
    expect(state.cueSelectValue).toBe("0");
    expect(state.impliedPendingSnapshotIndex).toBe("0");
    expect(state.impliedPendingCueIndex).toBe("0");
  });
});
