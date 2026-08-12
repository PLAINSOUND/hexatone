import { describe, expect, it } from "vitest";

import { collectTimedCueBurstsWithinLookahead } from "./timed-cue-scheduler.js";

describe("timed cue scheduler", () => {
  it("collects cue bursts inside the current lookahead window while skipping structural-only bursts", () => {
    const playbackBursts = [
      { playbackIndex: 0, elapsedSeconds: 0, sourceCueIndex: 1 },
      { playbackIndex: 1, elapsedSeconds: 0, sourceCueIndex: null },
      { playbackIndex: 2, elapsedSeconds: 0.1, sourceCueIndex: 2 },
      { playbackIndex: 3, elapsedSeconds: 0.25, sourceCueIndex: 3 },
    ];

    expect(collectTimedCueBurstsWithinLookahead(playbackBursts, 0, 0, 0.15)).toEqual({
      cueBursts: [playbackBursts[0], playbackBursts[2]],
      nextPlaybackIndex: 3,
    });
  });

  it("resumes collection from the next unscheduled playback index", () => {
    const playbackBursts = [
      { playbackIndex: 0, elapsedSeconds: 0, sourceCueIndex: 1 },
      { playbackIndex: 1, elapsedSeconds: 0.2, sourceCueIndex: 2 },
      { playbackIndex: 2, elapsedSeconds: 0.4, sourceCueIndex: 3 },
    ];

    expect(collectTimedCueBurstsWithinLookahead(playbackBursts, 1, 0.2, 0.15)).toEqual({
      cueBursts: [playbackBursts[1]],
      nextPlaybackIndex: 2,
    });
  });
});
