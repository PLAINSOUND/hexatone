import { describe, expect, it } from "vitest";

import { buildPlaybackTimeline } from "./playback-timeline.js";
import { compileScheduledPlaybackPlan } from "./scheduled-playback-plan.js";

describe("scheduled playback plan", () => {
  it("compiles playback bursts into exact scheduled bursts and flat events", () => {
    const timeline = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 1,
          notes: [
            { id: "a", midicents: 69, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 0.5 },
          ],
        },
      ],
    });

    const plan = compileScheduledPlaybackPlan(timeline);

    expect(plan.scheduledBursts.map((burst) => (
      [burst.playbackIndex, burst.sequenceTime, burst.absoluteSeconds]
    ))).toEqual([
      [0, 1, 0],
      [1, 1.5, 2],
      [2, 2, 4],
    ]);

    expect(plan.scheduledEvents.map((event) => (
      [event.type, event.kind, event.sequenceTime, event.absoluteSeconds]
    ))).toEqual([
      ["bar", "bar", 1, 0],
      ["note", "attack", 1, 0],
      ["note", "release", 1.5, 2],
      ["barline", "barline", 2, 4],
    ]);
  });

  it("preserves repeat-cleanup releases and repeat-jump metadata in the flat schedule", () => {
    const timeline = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 2,
          notes: [
            { id: "held", midicents: 69, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 2 },
          ],
        },
      ],
      repeats: [
        { id: "start", position: 1, kind: "start" },
        { id: "end", position: 2, kind: "end", repeatCount: 2 },
      ],
    });

    const plan = compileScheduledPlaybackPlan(timeline);
    const repeatJumpBurst = plan.scheduledBursts.find((burst) => burst.repeatJump != null);
    const cleanupEvent = plan.scheduledEvents.find((event) => event.repeatCleanup === true);

    expect(repeatJumpBurst?.repeatJump).toEqual({
      fromRepeatId: "end",
      toStartRepeatId: "start",
      jumpToSequenceTime: 1,
      remainingRepeatsAfterJump: 0,
    });
    expect(cleanupEvent).toMatchObject({
      type: "note",
      kind: "release",
      repeatCleanup: true,
      sequenceTime: 2,
      absoluteSeconds: 2,
    });
  });

  it("preserves snapped runtime pitch values in the scheduled plan", () => {
    const timeline = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 1,
          notes: [
            {
              id: "sharp-a",
              midicents: 69.12,
              frequency: 443.060442,
              displayLabel: "edited",
              attackVelocity: 80,
              releaseVelocity: 40,
              start: 0,
              end: 0.5,
            },
          ],
        },
      ],
      runtimePitchMode: "snapped",
      runtimePitchContext: {
        scale: [0, 1200],
        equivInterval: 1200,
        fundamental: 440,
        referenceDegree: 0,
        noteNames: ["A", "A8"],
      },
    });

    const plan = compileScheduledPlaybackPlan(timeline);
    const attack = plan.scheduledEvents.find((event) => event.type === "note" && event.kind === "attack");

    expect(attack?.midicents).toBe(69);
    expect(attack?.frequency).toBe(440);
    expect(attack?.displayLabel).toBe("A");
  });
});
