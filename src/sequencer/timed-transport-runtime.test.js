import { describe, expect, it } from "vitest";

import { buildPlaybackTimeline } from "./playback-timeline.js";
import {
  applyLiveRepeatDecision,
  advanceTimedTransport,
  createTimedTransportState,
  currentTimedTransportElapsedSeconds,
  findPlaybackStartIndex,
  pauseTimedTransport,
  resumeTimedTransport,
  seekTimedTransport,
  startTimedTransport,
  stopTimedTransport,
  updateTimedTransportSpeed,
} from "./timed-transport-runtime.js";

describe("timed transport runtime", () => {
  it("starts and dispatches due playback bursts by clock time", () => {
    const playbackBursts = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 1,
          notes: [
            {
              id: "n1",
              midicents: 69,
              attackVelocity: 80,
              releaseVelocity: 40,
              start: 0,
              end: 0.5,
            },
          ],
        },
      ],
    }).playbackBursts;

    const started = startTimedTransport(createTimedTransportState(playbackBursts), playbackBursts, {
      playbackIndex: 0,
      clockSeconds: 10,
    });
    expect(started.status).toBe("running");

    const firstAdvance = advanceTimedTransport(started, playbackBursts, 10);
    expect(firstAdvance.dueBursts.map((burst) => burst.sequenceTime)).toEqual([1]);

    const secondAdvance = advanceTimedTransport(firstAdvance.state, playbackBursts, 12);
    expect(secondAdvance.dueBursts.map((burst) => burst.sequenceTime)).toEqual([1.5]);
  });

  it("pauses, resumes, and seeks without losing the elapsed-time anchor", () => {
    const playbackBursts = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 1,
          notes: [
            {
              id: "n1",
              midicents: 69,
              attackVelocity: 80,
              releaseVelocity: 40,
              start: 0,
              end: 0.5,
            },
          ],
        },
        {
          id: "s2",
          length: 1,
          notes: [
            {
              id: "n2",
              midicents: 72,
              attackVelocity: 70,
              releaseVelocity: 35,
              start: 0,
              end: 0.5,
            },
          ],
        },
      ],
    }).playbackBursts;

    const started = startTimedTransport(createTimedTransportState(playbackBursts), playbackBursts, {
      clockSeconds: 4,
    });
    const paused = pauseTimedTransport(started, 4.75);
    expect(paused.status).toBe("paused");
    expect(paused.pausedElapsedSeconds).toBe(0.75);

    const resumed = resumeTimedTransport(paused, 9);
    expect(resumed.status).toBe("running");

    const sought = seekTimedTransport(resumed, playbackBursts, {
      playbackIndex: 2,
      clockSeconds: 9,
    });
    const advanced = advanceTimedTransport(sought, playbackBursts, 9);
    expect(advanced.dueBursts.map((burst) => burst.sequenceTime)).toEqual([2]);

    expect(stopTimedTransport(playbackBursts)).toEqual(createTimedTransportState(playbackBursts));
  });

  it("preserves elapsed time when playback speed changes during a run", () => {
    const playbackBursts = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 1,
          notes: [
            {
              id: "n1",
              midicents: 69,
              attackVelocity: 80,
              releaseVelocity: 40,
              start: 0,
              end: 0.5,
            },
          ],
        },
      ],
    }).playbackBursts;

    const started = startTimedTransport(createTimedTransportState(playbackBursts), playbackBursts, {
      clockSeconds: 10,
      speedMultiplier: 1,
    });
    const firstAdvance = advanceTimedTransport(started, playbackBursts, 10);
    const spedUp = updateTimedTransportSpeed(firstAdvance.state, 10.5, 2);

    expect(spedUp.pausedElapsedSeconds).toBe(0.5);
    expect(spedUp.speedMultiplier).toBe(2);

    expect(currentTimedTransportElapsedSeconds(spedUp, 10.75)).toBe(1);
  });

  it("preserves the terminal elapsed time after the final burst finishes playback", () => {
    const playbackBursts = [
      { playbackIndex: 0, elapsedSeconds: 64 },
      { playbackIndex: 1, elapsedSeconds: 162.75 },
    ];
    const started = startTimedTransport(createTimedTransportState(playbackBursts), playbackBursts, {
      clockSeconds: 10,
    });

    const result = advanceTimedTransport(started, playbackBursts, 108.755);

    expect(result.state.status).toBe("finished");
    expect(currentTimedTransportElapsedSeconds(result.state, 108.755)).toBeCloseTo(162.755);
  });

  it("dispatches same-time repeat jump bursts in a single scheduler tick", () => {
    const playbackBursts = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 2,
          notes: [
            {
              id: "held",
              midicents: 69,
              attackVelocity: 80,
              releaseVelocity: 40,
              start: 0,
              end: 2,
            },
          ],
        },
      ],
      repeats: [
        { id: "start", position: 1, kind: "start" },
        { id: "end", position: 2, kind: "end", repeatCount: 2 },
      ],
    }).playbackBursts;

    const state = startTimedTransport(createTimedTransportState(playbackBursts), playbackBursts, {
      clockSeconds: 0,
    });

    const firstPass = advanceTimedTransport(state, playbackBursts, 2);
    expect(firstPass.dueBursts.map((burst) => burst.sequenceTime)).toEqual([1, 2, 1]);
    expect(firstPass.dueBursts[1].repeatJump?.jumpToSequenceTime).toBe(1);
  });

  it("branches past remaining repeat passes when repeats are disabled live", () => {
    const playbackBursts = [
      { playbackIndex: 0, elapsedSeconds: 0 },
      {
        playbackIndex: 1,
        elapsedSeconds: 2,
        events: [{ type: "note", repeatCleanup: true }],
        soundingAfter: [],
        newlyAttacked: [],
        released: ["held"],
        repeatJump: { fromRepeatId: "end", jumpToSequenceTime: 1 },
        repeatSkip: {
          nextPlaybackIndex: 4,
          events: [{ type: "repeat-end" }],
          soundingAfter: [{ noteKey: "held" }],
          newlyAttacked: [],
          released: [],
        },
      },
      { playbackIndex: 2, elapsedSeconds: 2 },
      { playbackIndex: 3, elapsedSeconds: 4 },
      { playbackIndex: 4, elapsedSeconds: 6 },
    ];
    const running = {
      status: "running",
      anchorClockSeconds: 10,
      pausedElapsedSeconds: 0,
      speedMultiplier: 1,
      nextPlaybackIndex: 4,
      lastDispatchedPlaybackIndex: 3,
    };

    const result = applyLiveRepeatDecision(
      running,
      [playbackBursts[1], playbackBursts[2]],
      playbackBursts,
      {
        playRepeats: false,
        clockSeconds: 12,
      },
    );

    expect(result.dueBursts).toHaveLength(1);
    expect(result.dueBursts[0]).toMatchObject({
      playbackIndex: 1,
      repeatJump: null,
      repeatSkipped: { fromRepeatId: "end" },
      soundingAfter: [{ noteKey: "held" }],
    });
    expect(result.state).toMatchObject({
      status: "running",
      anchorClockSeconds: 12,
      pausedElapsedSeconds: 6,
      nextPlaybackIndex: 4,
      lastDispatchedPlaybackIndex: 1,
    });
  });

  it("finds a playback start index by cue, snapshot, or sequence time", () => {
    const playbackBursts = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 1,
          notes: [
            {
              id: "n1",
              midicents: 69,
              attackVelocity: 80,
              releaseVelocity: 40,
              start: 0,
              end: 0.5,
            },
          ],
        },
        {
          id: "s2",
          length: 1,
          notes: [
            {
              id: "n2",
              midicents: 72,
              attackVelocity: 70,
              releaseVelocity: 35,
              start: 0,
              end: 0.5,
            },
          ],
        },
      ],
    }).playbackBursts;

    expect(findPlaybackStartIndex(playbackBursts, { sequenceTime: 2 })).toBe(2);
    expect(findPlaybackStartIndex(playbackBursts, { cueIndex: 2 })).toBe(1);
    expect(findPlaybackStartIndex(playbackBursts, { snapshotIndex: 1 })).toBe(2);
  });
});
