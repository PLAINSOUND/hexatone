import { describe, expect, it } from "vitest";

import {
  advanceCueIndexWithRepeats,
  deriveRepeatSections,
} from "./repeat-playback-runtime.js";

describe("repeat playback runtime", () => {
  it("pairs repeat markers to cue ranges", () => {
    const cueGroups = [
      { time: 1 },
      { time: 1.5 },
      { time: 2 },
      { time: 3 },
    ];

    expect(deriveRepeatSections(cueGroups, [
      { id: "start", position: 1.5, kind: "start" },
      { id: "end", position: 2, kind: "end", repeatCount: 3 },
    ])).toEqual([
      {
        repeatId: "end",
        startRepeatId: "start",
        startPosition: 1.5,
        endPosition: 2,
        repeatCount: 3,
        startCueIndex: 1,
        endCueIndex: 1,
      },
    ]);
  });

  it("loops back until the repeat count is exhausted", () => {
    const repeatSections = [
      {
        repeatId: "end",
        startCueIndex: 1,
        endCueIndex: 1,
        startPosition: 1.5,
        endPosition: 2,
        repeatCount: 3,
      },
    ];

    const first = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: 4,
      cueGroups: [{ time: 1 }, { time: 1.5 }, { time: 2 }, { time: 3 }],
      repeatSections,
      repeatPlaybackState: {},
    });
    expect(first).toEqual({
      nextCueIndex: 1,
      nextRepeatPlaybackState: { end: 1 },
      didLoop: true,
    });

    const second = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: 4,
      cueGroups: [{ time: 1 }, { time: 1.5 }, { time: 2 }, { time: 3 }],
      repeatSections,
      repeatPlaybackState: first.nextRepeatPlaybackState,
    });
    expect(second).toEqual({
      nextCueIndex: 1,
      nextRepeatPlaybackState: { end: 0 },
      didLoop: true,
    });

    const third = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: 4,
      cueGroups: [{ time: 1 }, { time: 1.5 }, { time: 2 }, { time: 3 }],
      repeatSections,
      repeatPlaybackState: second.nextRepeatPlaybackState,
    });
    expect(third).toEqual({
      nextCueIndex: 2,
      nextRepeatPlaybackState: {},
      didLoop: false,
    });
  });

  it("skips a disabled repeat without forgetting earlier completed passes", () => {
    const repeatSections = [{
      repeatId: "end",
      startCueIndex: 0,
      endCueIndex: 1,
      startPosition: 1,
      endPosition: 2,
      repeatCount: 4,
    }];
    const cueGroups = [{ time: 1 }, { time: 1.5 }, { time: 2 }, { time: 3 }];
    const first = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: cueGroups.length,
      cueGroups,
      repeatSections,
      repeatPlaybackState: {},
    });
    const skipped = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: cueGroups.length,
      cueGroups,
      repeatSections,
      repeatPlaybackState: first.nextRepeatPlaybackState,
      playRepeats: false,
    });
    const enabledAgain = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: cueGroups.length,
      cueGroups,
      repeatSections,
      repeatPlaybackState: skipped.nextRepeatPlaybackState,
      playRepeats: true,
    });

    expect(first.nextRepeatPlaybackState).toEqual({ end: 2 });
    expect(skipped).toEqual({
      nextCueIndex: 2,
      nextRepeatPlaybackState: { end: 2 },
      didLoop: false,
    });
    expect(enabledAgain.nextRepeatPlaybackState).toEqual({ end: 1 });
  });

  it("loops when the next cue would cross the repeat end position even without a cue exactly at the boundary", () => {
    const repeatSections = [
      {
        repeatId: "end",
        startCueIndex: 0,
        endCueIndex: 1,
        startPosition: 1,
        endPosition: 2,
        repeatCount: 2,
      },
    ];

    expect(advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: 4,
      cueGroups: [{ time: 1 }, { time: 1.5 }, { time: 2.25 }, { time: 3 }],
      repeatSections,
      repeatPlaybackState: {},
    })).toEqual({
      nextCueIndex: 0,
      nextRepeatPlaybackState: { end: 0 },
      didLoop: true,
    });
  });

  it("repeats consistently on later passes instead of drifting forward before looping", () => {
    const repeatSections = [
      {
        repeatId: "end",
        startCueIndex: 0,
        endCueIndex: 1,
        startPosition: 1,
        endPosition: 2,
        repeatCount: 4,
      },
    ];

    const cueGroups = [{ time: 1 }, { time: 1.5 }, { time: 2 }, { time: 3 }];

    const first = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: cueGroups.length,
      cueGroups,
      repeatSections,
      repeatPlaybackState: {},
    });
    expect(first).toEqual({
      nextCueIndex: 0,
      nextRepeatPlaybackState: { end: 2 },
      didLoop: true,
    });

    const second = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: cueGroups.length,
      cueGroups,
      repeatSections,
      repeatPlaybackState: first.nextRepeatPlaybackState,
    });
    expect(second).toEqual({
      nextCueIndex: 0,
      nextRepeatPlaybackState: { end: 1 },
      didLoop: true,
    });

    const third = advanceCueIndexWithRepeats({
      currentCueIndex: 1,
      cueCount: cueGroups.length,
      cueGroups,
      repeatSections,
      repeatPlaybackState: second.nextRepeatPlaybackState,
    });
    expect(third).toEqual({
      nextCueIndex: 0,
      nextRepeatPlaybackState: { end: 0 },
      didLoop: true,
    });
  });

  it("does not re-trigger a completed repeat after playback has already advanced beyond the repeated section", () => {
    const repeatSections = [
      {
        repeatId: "end",
        startCueIndex: 0,
        endCueIndex: 1,
        startPosition: 1,
        endPosition: 2,
        repeatCount: 2,
      },
    ];

    expect(advanceCueIndexWithRepeats({
      currentCueIndex: 2,
      cueCount: 4,
      cueGroups: [{ time: 1 }, { time: 1.5 }, { time: 2.25 }, { time: 3 }],
      repeatSections,
      repeatPlaybackState: {},
    })).toEqual({
      nextCueIndex: 3,
      nextRepeatPlaybackState: {},
      didLoop: false,
    });
  });

  it("excludes a cue exactly at the repeat-end position because the end marker fires first", () => {
    const cueGroups = [
      { time: 1 },
      { time: 1.5 },
      { time: 2 },
      { time: 3 },
    ];

    expect(deriveRepeatSections(cueGroups, [
      { id: "start", position: 1, kind: "start" },
      { id: "end", position: 2, kind: "end", repeatCount: 2 },
    ])).toEqual([
      {
        repeatId: "end",
        startRepeatId: "start",
        startPosition: 1,
        endPosition: 2,
        repeatCount: 2,
        startCueIndex: 0,
        endCueIndex: 1,
      },
    ]);
  });

  it("reuses the previous start marker when a later start is deleted", () => {
    const cueGroups = [
      { time: 1 },
      { time: 2 },
      { time: 3 },
      { time: 4 },
      { time: 5 },
    ];

    expect(deriveRepeatSections(cueGroups, [
      { id: "start-a", position: 1, kind: "start" },
      { id: "end-a", position: 3, kind: "end", repeatCount: 2 },
      { id: "end-b", position: 5, kind: "end", repeatCount: 2 },
    ])).toEqual([
      {
        repeatId: "end-a",
        startRepeatId: "start-a",
        startPosition: 1,
        endPosition: 3,
        repeatCount: 2,
        startCueIndex: 0,
        endCueIndex: 1,
      },
      {
        repeatId: "end-b",
        startRepeatId: "start-a",
        startPosition: 1,
        endPosition: 5,
        repeatCount: 2,
        startCueIndex: 0,
        endCueIndex: 3,
      },
    ]);
  });
});
