import { describe, expect, it, vi } from "vitest";
import { createScheduledPlaybackEngine } from "./scheduled-playback-engine.js";

describe("scheduled playback engine", () => {
  it("starts, dispatches bursts in order, and finishes cleanly", () => {
    vi.useFakeTimers();
    let now = 0;
    const dispatched = [];
    const stateUpdates = [];
    const stopped = vi.fn();
    const playbackBursts = [
      { playbackIndex: 0, elapsedSeconds: 0, sourceCueIndex: 1 },
      { playbackIndex: 1, elapsedSeconds: 0.5, sourceCueIndex: 2 },
    ];

    const engine = createScheduledPlaybackEngine({
      getClockSeconds: () => now,
      onDispatchBursts: (bursts) => dispatched.push(...bursts.map(({ burst }) => burst.sourceCueIndex)),
      onStopPlayback: stopped,
      onStateChange: ({ state }) => stateUpdates.push(state.status),
    });

    engine.replacePlaybackBursts(playbackBursts);
    engine.start({ playbackIndex: 0 });

    expect(engine.getState().status).toBe("running");

    vi.advanceTimersByTime(1);
    now = 0;
    vi.runOnlyPendingTimers();

    expect(dispatched).toEqual([1]);

    now = 0.5;
    vi.advanceTimersByTime(500);
    vi.runOnlyPendingTimers();

    expect(dispatched).toEqual([1, 2]);
    expect(engine.getState().status).toBe("finished");
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(stateUpdates).toContain("running");
    expect(stateUpdates).toContain("finished");
  });

  it("pauses and resumes without losing the last dispatched burst", () => {
    vi.useFakeTimers();
    let now = 0;
    const replayed = [];
    const playbackBursts = [
      { playbackIndex: 0, elapsedSeconds: 0, sourceCueIndex: 1 },
      { playbackIndex: 1, elapsedSeconds: 1, sourceCueIndex: 2 },
    ];

    const engine = createScheduledPlaybackEngine({
      getClockSeconds: () => now,
      onReplayBurst: (burst) => replayed.push(burst.sourceCueIndex),
    });

    engine.replacePlaybackBursts(playbackBursts);
    engine.start({ playbackIndex: 0 });
    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();

    now = 0.2;
    engine.pause();
    expect(engine.getState().status).toBe("paused");

    now = 0.4;
    engine.resume();
    expect(engine.getState().status).toBe("running");
    expect(replayed).toEqual([1]);
  });

  it("preserves running state when playback bursts are rebuilt", () => {
    vi.useFakeTimers();
    let now = 0;
    const initialBursts = [
      { playbackIndex: 0, elapsedSeconds: 0, sourceCueIndex: 1 },
      { playbackIndex: 1, elapsedSeconds: 1, sourceCueIndex: 2 },
    ];
    const rebuiltBursts = [
      { playbackIndex: 0, elapsedSeconds: 0, sourceCueIndex: 1 },
      { playbackIndex: 1, elapsedSeconds: 1, sourceCueIndex: 2 },
      { playbackIndex: 2, elapsedSeconds: 2, sourceCueIndex: 3 },
    ];

    const engine = createScheduledPlaybackEngine({
      getClockSeconds: () => now,
    });

    engine.replacePlaybackBursts(initialBursts);
    engine.start({ playbackIndex: 1 });
    expect(engine.getState().nextPlaybackIndex).toBe(1);

    engine.replacePlaybackBursts(rebuiltBursts);
    expect(engine.getState().status).toBe("running");
    expect(engine.getState().nextPlaybackIndex).toBe(1);
  });
});
