import { describe, expect, it } from "vitest";

import {
  buildCueBursts,
  buildPlaybackBursts,
  buildPlaybackTimeline,
  deriveTempoAtSequencePosition,
  deriveBurstSoundingState,
} from "./playback-timeline.js";
import { deriveRepeatSections } from "./repeat-playback-runtime.js";
import { deriveSequenceCueGroups, deriveSequenceEvents } from "./trigger-groups.js";

describe("playback timeline", () => {
  it("builds linear playback bursts with monotonically increasing elapsed seconds", () => {
    const snapshots = [
      {
        id: "s1",
        length: 1,
        notes: [
          { id: "n1", midicents: 69, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 0.5 },
        ],
      },
      {
        id: "s2",
        length: 1,
        notes: [
          { id: "n2", midicents: 72, attackVelocity: 70, releaseVelocity: 35, start: 0, end: 0.5 },
        ],
      },
    ];

    const timeline = buildPlaybackTimeline({ snapshots });

    expect(timeline.playbackBursts.map((burst) => burst.sequenceTime)).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(timeline.playbackBursts.map((burst) => burst.elapsedSeconds)).toEqual([0, 1, 2, 3, 4]);
    expect(timeline.playbackBursts[0].soundingAfter.map((note) => note.noteKey)).toEqual(["n1"]);
    expect(timeline.playbackBursts[1].soundingAfter).toEqual([]);
    expect(timeline.timelineEndPosition).toBe(3);
  });

  it("expands repeat traversal and injects synthetic note cleanup before loop jumps", () => {
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

    const timeline = buildPlaybackTimeline({ snapshots, repeats });

    expect(timeline.repeatSections).toEqual([
      {
        repeatId: "end",
        startRepeatId: "start",
        startPosition: 1,
        endPosition: 2,
        repeatCount: 2,
        startCueIndex: 0,
        endCueIndex: 0,
      },
    ]);
    expect(timeline.playbackBursts.map((burst) => burst.sequenceTime)).toEqual([1, 2, 1, 2, 3]);
    expect(timeline.playbackBursts.map((burst) => burst.elapsedSeconds)).toEqual([0, 2, 2, 4, 6]);
    expect(timeline.playbackBursts[1].repeatJump).toEqual({
      fromRepeatId: "end",
      toStartRepeatId: "start",
      jumpToSequenceTime: 1,
      remainingRepeatsAfterJump: 0,
    });
    expect(timeline.playbackBursts[1].events.some((event) => event.repeatCleanup === true)).toBe(true);
    expect(timeline.playbackBursts[1].soundingAfter).toEqual([]);
    expect(timeline.playbackBursts[1].repeatSkip).toMatchObject({
      nextPlaybackIndex: 4,
      soundingAfter: expect.any(Array),
    });
    expect(timeline.playbackBursts[1].repeatSkip.events.some((event) => event.repeatCleanup === true)).toBe(false);
    expect(timeline.playbackBursts[3].repeatJump).toBeNull();
  });

  it("remaps sequence notes to the current runtime tuning in snapped mode", () => {
    const snapshots = [
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
    ];

    const timeline = buildPlaybackTimeline({
      snapshots,
      runtimePitchMode: "snapped",
      runtimePitchContext: {
        scale: [0, 1200],
        equivInterval: 1200,
        fundamental: 440,
        referenceDegree: 0,
        noteNames: ["A", "A8"],
      },
    });

    const firstNoteEvent = timeline.playbackBursts[0].events.find((event) => event.type === "note" && event.kind === "attack");
    expect(firstNoteEvent?.midicents).toBe(69);
    expect(firstNoteEvent?.frequency).toBe(440);
    expect(firstNoteEvent?.displayLabel).toBe("A");
  });

  it("keeps structural-only repeat-end bursts out of the sounding state after loop cleanup", () => {
    const snapshots = [
      {
        id: "s1",
        length: 2,
        notes: [
          { id: "held", midicents: 60, attackVelocity: 70, releaseVelocity: 30, start: 0, end: 2 },
        ],
      },
    ];
    const repeats = [
      { id: "start", position: 1, kind: "start" },
      { id: "end", position: 2, kind: "end", repeatCount: 2 },
    ];

    const sequenceEvents = deriveSequenceEvents(snapshots, [], [], repeats);
    const cueBursts = deriveBurstSoundingState(buildCueBursts(sequenceEvents));
    const repeatSections = deriveRepeatSections(deriveSequenceCueGroups(snapshots, [], [], repeats), repeats);
    const playbackBursts = buildPlaybackBursts(cueBursts, repeatSections, {
      barTimingSegments: [
        {
          startPosition: 1,
          endPosition: Infinity,
          startQuarterNotes: 0,
          quarterNotesPerUnit: 1,
        },
      ],
      tempoSegments: [
        {
          startPosition: 1,
          endPosition: Infinity,
          startQuarterNotes: 0,
          endQuarterNotes: Infinity,
          startSeconds: 0,
          secondsPerQuarter: 1,
        },
      ],
    });

    expect(cueBursts.find((burst) => burst.time === 2)?.soundingBefore.map((note) => note.noteKey)).toEqual(["held"]);
    expect(playbackBursts.find((burst) => burst.sequenceTime === 2)?.soundingAfter).toEqual([]);
  });

  it("stretches timed playback across the musical span of a multi-snapshot bar", () => {
    const snapshots = [
      {
        id: "s1",
        length: 1,
        notes: [{ id: "n1", midicents: 69, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 0.5 }],
      },
      {
        id: "s2",
        length: 1,
        notes: [{ id: "n2", midicents: 72, attackVelocity: 70, releaseVelocity: 35, start: 0, end: 0.5 }],
      },
    ];
    const bars = [{ id: "bar-1", position: 1, numerator: 1, denominator: 1 }];
    const tempi = [{ id: "tempo-1", position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }];

    const timeline = buildPlaybackTimeline({ snapshots, bars, tempi });

    expect(timeline.playbackBursts.map((burst) => burst.elapsedSeconds)).toEqual([0, 1, 2, 3, 4]);
  });

  it("maps cue times correctly when the bar beat unit differs from the tempo unit", () => {
    const snapshots = [
      {
        id: "s1",
        length: 1,
        notes: [
          { id: "n1", midicents: 69, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 0.333333 },
          { id: "n2", midicents: 72, attackVelocity: 75, releaseVelocity: 35, start: 0.333333, end: 0.666667 },
          { id: "n3", midicents: 76, attackVelocity: 70, releaseVelocity: 30, start: 0.666667, end: 1 },
        ],
      },
    ];
    const bars = [{ id: "bar-1", position: 1, numerator: 3, denominator: 2 }];
    const tempi = [{ id: "tempo-1", position: 1, bpm: 72, beatNumerator: 3, beatDenominator: 16, beatLength: 0.75 }];

    const timeline = buildPlaybackTimeline({ snapshots, bars, tempi });

    expect(timeline.playbackBursts.map((burst) => burst.sequenceTime)).toEqual([
      1,
      1.333333,
      1.666667,
      2,
    ]);
    const elapsed = timeline.playbackBursts.map((burst) => burst.elapsedSeconds);
    expect(elapsed[0]).toBeCloseTo(0, 6);
    expect(elapsed[1]).toBeCloseTo(2.222222, 5);
    expect(elapsed[2]).toBeCloseTo(4.444444, 5);
    expect(elapsed[3]).toBeCloseTo(6.666667, 6);
  });

  it("compresses cue spacing across a gradual transition target before the destination marker", () => {
    const snapshots = [
      {
        id: "s1",
        length: 1,
        notes: [
          { id: "n1", midicents: 69, attackVelocity: 80, releaseVelocity: 40, start: 0, end: 0.5 },
        ],
      },
      {
        id: "s2",
        length: 1,
        notes: [
          { id: "n2", midicents: 72, attackVelocity: 75, releaseVelocity: 35, start: 0, end: 0.5 },
        ],
      },
    ];
    const bars = [{ id: "bar-1", position: 1, numerator: 1, denominator: 1 }];
    const immediateTempi = [
      { id: "tempo-1", position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" },
      { id: "tempo-2", position: 3, bpm: 120, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" },
    ];
    const transitionTempi = [
      { id: "tempo-1", position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" },
      { id: "tempo-2", position: 3, bpm: 120, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "gradual" },
    ];

    const immediateTimeline = buildPlaybackTimeline({ snapshots, bars, tempi: immediateTempi });
    const transitionTimeline = buildPlaybackTimeline({ snapshots, bars, tempi: transitionTempi });

    const immediateElapsed = immediateTimeline.playbackBursts.map((burst) => burst.elapsedSeconds);
    const transitionElapsed = transitionTimeline.playbackBursts.map((burst) => burst.elapsedSeconds);

    expect(immediateElapsed).toEqual([0, 1, 2, 3, 4]);
    expect(transitionElapsed[0]).toBe(0);
    expect(transitionElapsed[1]).toBeCloseTo(0.892574, 5);
    expect(transitionElapsed[2]).toBeCloseTo(1.62186, 5);
    expect(transitionElapsed[3]).toBeCloseTo(2.238463, 5);
    expect(transitionElapsed[4]).toBeCloseTo(2.772589, 5);
    expect(transitionElapsed[1]).toBeLessThan(immediateElapsed[1]);
    expect(transitionElapsed[2]).toBeLessThan(immediateElapsed[2]);
    expect(transitionElapsed[3]).toBeLessThan(immediateElapsed[3]);
    expect(transitionElapsed[4]).toBeLessThan(immediateElapsed[4]);
  });

  it("derives the live tempo at a transport position inside a gradual transition", () => {
    const bars = [{ id: "bar-1", position: 1, numerator: 1, denominator: 1 }];
    const tempi = [
      { id: "tempo-1", position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" },
      { id: "tempo-2", position: 3, bpm: 120, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "gradual" },
    ];

    expect(deriveTempoAtSequencePosition(1, tempi, bars, 3)).toEqual({
      wholeNotesPerMinute: 15,
      beatNumerator: 1,
      beatDenominator: 4,
      bpm: 60,
    });
    expect(deriveTempoAtSequencePosition(2, tempi, bars, 3)).toEqual({
      wholeNotesPerMinute: 22.5,
      beatNumerator: 1,
      beatDenominator: 4,
      bpm: 90,
    });
  });

  it("uses the newest piled tempo and ignores superseded gradual behavior", () => {
    const bars = [
      { id: "bar-1", position: 1, numerator: 4, denominator: 4 },
      { id: "bar-2", position: 3, numerator: 4, denominator: 4 },
    ];
    const tempi = [
      { id: "tempo-1", position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, mode: "immediate" },
      { id: "tempo-old", position: 3, bpm: 120, beatNumerator: 1, beatDenominator: 4, mode: "gradual" },
      { id: "tempo-new", position: 3, bpm: 90, beatNumerator: 1, beatDenominator: 4, mode: "immediate" },
    ];

    expect(deriveTempoAtSequencePosition(2, tempi, bars, 4)?.bpm).toBe(60);
    expect(deriveTempoAtSequencePosition(3, tempi, bars, 4)?.bpm).toBe(90);
  });

  it("applies an immediate tempo marker after a completed gradual change", () => {
    const snapshots = Array.from({ length: 5 }, (_, index) => ({
      id: `s${index + 1}`,
      length: 1,
      notes: [{
        id: `n${index + 1}`,
        midicents: 69 + index,
        attackVelocity: 80,
        releaseVelocity: 40,
        start: 0,
        end: 1,
      }],
    }));
    const bars = Array.from({ length: 6 }, (_, index) => ({
      id: `bar-${index + 1}`,
      position: index + 1,
      numerator: 1,
      denominator: 4,
    }));
    const tempi = [
      { id: "tempo-1", position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, mode: "immediate" },
      { id: "tempo-2", position: 3, bpm: 120, beatNumerator: 1, beatDenominator: 4, mode: "gradual" },
      { id: "tempo-3", position: 4, bpm: 30, beatNumerator: 1, beatDenominator: 4, mode: "immediate" },
    ];

    const timeline = buildPlaybackTimeline({ snapshots, bars, tempi });
    const elapsedByPosition = new Map(
      timeline.playbackBursts.map((burst) => [burst.sequenceTime, burst.elapsedSeconds]),
    );

    expect(deriveTempoAtSequencePosition(3.5, tempi, bars, 6)?.bpm).toBe(120);
    expect(deriveTempoAtSequencePosition(4, tempi, bars, 6)?.bpm).toBe(30);
    expect(deriveTempoAtSequencePosition(4.5, tempi, bars, 6)?.bpm).toBe(30);
    expect(elapsedByPosition.get(4) - elapsedByPosition.get(3)).toBeCloseTo(0.5, 6);
    expect(elapsedByPosition.get(5) - elapsedByPosition.get(4)).toBeCloseTo(2, 6);
  });
});
