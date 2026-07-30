import { describe, expect, it } from "vitest";

import { buildSequenceRuntimeModel } from "./runtime-model.js";

describe("buildSequenceRuntimeModel", () => {
  it("keeps piled tempi in the event list in creation order", () => {
    const runtime = buildSequenceRuntimeModel({
      snapshots: [{ id: "s1", length: 2, notes: [] }],
      tempi: [
        { id: 9, position: 1, bpm: 60 },
        { id: 10, position: 1, bpm: 72 },
        { id: 11, position: 1, bpm: 84 },
      ],
      source: "test",
    });

    expect(runtime.sortedTempi.map((tempo) => tempo.id)).toEqual([9, 10, 11]);
    expect(
      runtime.sequenceEvents
        .filter((event) => event.type === "tempo")
        .map((event) => event.tempoId),
    ).toEqual([9, 10, 11]);
  });

  it("can preserve visual repeat sections while disabling repeat playback", () => {
    const snapshots = [
      {
        id: "s1",
        length: 2,
        notes: [
          { id: "held", midicents: 69, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 2 },
        ],
      },
    ];
    const repeats = [
      { id: "start", position: 1, kind: "start" },
      { id: "end", position: 2, kind: "end", repeatCount: 2 },
    ];

    const withRepeats = buildSequenceRuntimeModel({
      snapshots,
      repeats,
      source: "test",
    });
    const withoutPlaybackRepeats = buildSequenceRuntimeModel({
      snapshots,
      repeats,
      playbackRepeats: [],
      source: "test",
    });

    expect(withRepeats.sequenceRepeatSections).toHaveLength(1);
    expect(withoutPlaybackRepeats.sequenceRepeatSections).toHaveLength(1);
    expect(withRepeats.timedPlaybackBursts.length).toBeGreaterThan(
      withoutPlaybackRepeats.timedPlaybackBursts.length,
    );
    expect(
      withoutPlaybackRepeats.timedPlaybackBursts.some((burst) => burst.repeatJump != null),
    ).toBe(false);
  });
});
