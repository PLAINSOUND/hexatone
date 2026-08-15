import { describe, expect, it } from "vitest";

import { buildPlaybackTimeline } from "./playback-timeline.js";
import { deriveTimedCueTriggers } from "./timed-cue-triggers.js";

describe("timed cue triggers", () => {
  it("derives cue trigger times from the playback timeline", () => {
    const timeline = buildPlaybackTimeline({
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
    });

    const triggers = deriveTimedCueTriggers(timeline);

    expect(
      triggers.map((trigger) => ({
        cueIndex: trigger.cueIndex,
        sequenceTime: trigger.sequenceTime,
        absoluteSeconds: trigger.absoluteSeconds,
      })),
    ).toEqual([
      { cueIndex: 1, sequenceTime: 1, absoluteSeconds: 0 },
      { cueIndex: 2, sequenceTime: 1.5, absoluteSeconds: 2 },
    ]);
  });

  it("marks only genuinely new notes for reattack in legato mode", () => {
    const timeline = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 2,
          notes: [
            { id: "a", midicents: 60, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 2 },
          ],
        },
        {
          id: "s2",
          length: 1,
          notes: [
            { id: "b", midicents: 64, attackVelocity: 75, releaseVelocity: 35, start: 0, end: 1 },
          ],
        },
      ],
    });

    const triggers = deriveTimedCueTriggers(timeline, { legato: true });
    const secondCue = triggers[1];

    expect(secondCue.notes.map((note) => [note.midicents, note.reattack])).toEqual([
      [64, true],
      [60, false],
    ]);
  });

  it("marks a newly attacked note for reattack while preserving the sounding chord", () => {
    const timeline = buildPlaybackTimeline({
      snapshots: [
        {
          id: "s1",
          length: 2,
          notes: [
            { id: "a", midicents: 60, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 2 },
          ],
        },
        {
          id: "s2",
          length: 1,
          notes: [
            { id: "b", midicents: 64, attackVelocity: 75, releaseVelocity: 35, start: 0, end: 1 },
          ],
        },
      ],
    });

    const triggers = deriveTimedCueTriggers(timeline);
    const secondCue = triggers[1];

    expect(secondCue.notes.map((note) => [note.midicents, note.reattack])).toEqual([
      [64, true],
      [60, false],
    ]);
  });

  it("preserves structural events on cue triggers that share a playback instant", () => {
    const timeline = buildPlaybackTimeline({
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
    });

    const triggers = deriveTimedCueTriggers(timeline);

    expect(triggers[0].structuralEvents.map((event) => event.type)).toEqual([
      "repeat-start",
      "bar",
    ]);
    expect(triggers[1].structuralEvents.map((event) => event.type)).toEqual([
      "repeat-start",
      "bar",
    ]);
  });
});
