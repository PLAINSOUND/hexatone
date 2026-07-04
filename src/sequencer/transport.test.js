import { describe, expect, it } from "vitest";
import {
  absolutePositionToBarBeat,
  barBeatToAbsolutePosition,
  buildTempoSegments,
  deriveImplicitRepeatStartPosition,
  deriveImplicitRepeatStartPositionsForDanglingEnds,
  deriveTerminalBarlinePosition,
  normalizeBarMarkers,
  normalizeRepeatMarkers,
  normalizeMeterMarkers,
  normalizeSequenceTransport,
  normalizeTempoMarkers,
  secondsToSequencePosition,
  sequencePositionToSeconds,
  sequenceSpanToSeconds,
} from "./transport.js";

describe("sequencer transport", () => {
  it("injects a default tempo marker at sequence position 1", () => {
    expect(normalizeTempoMarkers([])).toEqual([
      {
        id: "tempo:default",
        position: 1,
        bpm: 60,
        beatNumerator: 1,
        beatDenominator: 4,
        beatLength: 1,
      },
    ]);
  });

  it("dedupes tempo markers by position keeping the later marker", () => {
    expect(normalizeTempoMarkers([
      { id: "a", position: 1, bpm: 60, beatLength: 1 },
      { id: "b", position: 1, bpm: 72, beatLength: 0.5 },
      { id: "c", position: 3, bpm: 90, beatLength: 1 },
    ])).toEqual([
      { id: "b", position: 1, bpm: 72, beatNumerator: 1, beatDenominator: 8, beatLength: 0.5 },
      { id: "c", position: 3, bpm: 90, beatNumerator: 1, beatDenominator: 4, beatLength: 1 },
    ]);
  });

  it("injects a default meter marker at sequence position 1", () => {
    expect(normalizeMeterMarkers([])).toEqual([
      {
        id: "meter:default",
        position: 1,
        numerator: 4,
        denominator: 4,
        beatLength: 1,
        barLength: 4,
      },
    ]);
  });

  it("preserves explicit non-power-of-two meter denominators while deriving bar length", () => {
    expect(normalizeMeterMarkers([
      { id: "m1", position: 2, numerator: 5, denominator: 7, beatLength: 0.5 },
    ])).toEqual([
      {
        id: "meter:default",
        position: 1,
        numerator: 4,
        denominator: 4,
        beatLength: 1,
        barLength: 4,
      },
      {
        id: "m1",
        position: 2,
        numerator: 5,
        denominator: 7,
        beatLength: 0.5,
        barLength: 2.5,
      },
    ]);
  });

  it("builds exact piecewise tempo segments from sequence space", () => {
    expect(buildTempoSegments([
      { id: "t1", position: 1, bpm: 60, beatLength: 1 },
      { id: "t2", position: 3, bpm: 120, beatLength: 1 },
    ])).toEqual([
      {
        id: "t1",
        position: 1,
        bpm: 60,
        beatNumerator: 1,
        beatDenominator: 4,
        beatLength: 1,
        startPosition: 1,
        endPosition: 3,
        startSeconds: 0,
        secondsPerUnit: 1,
      },
      {
        id: "t2",
        position: 3,
        bpm: 120,
        beatNumerator: 1,
        beatDenominator: 4,
        beatLength: 1,
        startPosition: 3,
        endPosition: Infinity,
        startSeconds: 2,
        secondsPerUnit: 0.5,
      },
    ]);
  });

  it("maps exact sequence positions to seconds under tempo automation", () => {
    const markers = [
      { position: 1, bpm: 60, beatLength: 1 },
      { position: 3, bpm: 120, beatLength: 1 },
    ];

    expect(sequencePositionToSeconds(1, markers)).toBe(0);
    expect(sequencePositionToSeconds(2.5, markers)).toBe(1.5);
    expect(sequencePositionToSeconds(4, markers)).toBe(2.5);
  });

  it("maps seconds back into exact sequence positions", () => {
    const markers = [
      { position: 1, bpm: 60, beatLength: 1 },
      { position: 3, bpm: 120, beatLength: 1 },
    ];

    expect(secondsToSequencePosition(0, markers)).toBe(1);
    expect(secondsToSequencePosition(1.5, markers)).toBe(2.5);
    expect(secondsToSequencePosition(2.5, markers)).toBe(4);
  });

  it("measures spans across multiple tempo regions without drift-prone accumulation logic", () => {
    const markers = [
      { position: 1, bpm: 90, beatLength: 1 },
      { position: 2.5, bpm: 45, beatLength: 0.5 },
      { position: 4, bpm: 120, beatLength: 1 },
    ];

    expect(sequenceSpanToSeconds(1, 2.5, markers)).toBeCloseTo(1, 8);
    expect(sequenceSpanToSeconds(2.5, 4, markers)).toBeCloseTo(4, 8);
    expect(sequenceSpanToSeconds(1, 5, markers)).toBeCloseTo(5.5, 8);
  });

  it("normalizes persisted transport defaults", () => {
    expect(normalizeSequenceTransport({})).toEqual({
      unit: "sequence",
      anchorSeconds: 0,
    });
    expect(normalizeSequenceTransport({ anchorSeconds: 12.5 })).toEqual({
      unit: "sequence",
      anchorSeconds: 12.5,
    });
  });

  it("normalizes bars with default 4/4 signatures", () => {
    expect(normalizeBarMarkers([{ id: 2, position: 2 }])).toEqual([
      { id: "bar:default", position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 4, denominator: 4 },
    ]);
  });

  it("forces bar positions to positive integers", () => {
    expect(normalizeBarMarkers([
      { id: "a", position: 0.4, numerator: 4, denominator: 4 },
      { id: "b", position: 2.7, numerator: 3, denominator: 2 },
    ], { includeDefault: false })).toEqual([
      { id: "a", position: 1, numerator: 4, denominator: 4 },
      { id: "b", position: 3, numerator: 3, denominator: 2 },
    ]);
  });

  it("derives bar-relative timing from explicit bar markers", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 3, denominator: 8 },
    ];

    expect(absolutePositionToBarBeat(1.3125, bars)).toEqual({
      barNumber: 1,
      beat: 2,
      numerator: 1,
      denominator: 4,
      barStart: 1,
      barLength: 1,
      beatsPerBar: 4,
      beatUnit: 4,
    });
  });

  it("prefers simple fractions when absolute positions have been rounded for display/storage", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 4, denominator: 4 },
    ];

    expect(absolutePositionToBarBeat(1.063, bars)).toEqual({
      barNumber: 1,
      beat: 1,
      numerator: 1,
      denominator: 4,
      barStart: 1,
      barLength: 1,
      beatsPerBar: 4,
      beatUnit: 4,
    });
  });

  it("uses the configured auto-denominator priority order", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 4, denominator: 4 },
    ];

    expect(absolutePositionToBarBeat(1.05, bars)).toEqual({
      barNumber: 1,
      beat: 1,
      numerator: 1,
      denominator: 5,
      barStart: 1,
      barLength: 1,
      beatsPerBar: 4,
      beatUnit: 4,
    });
  });

  it("converts bar, beat, and fractional beat data back to exact positions", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 4, denominator: 4 },
    ];

    expect(barBeatToAbsolutePosition({
      barNumber: 1,
      beat: 2,
      numerator: 1,
      denominator: 4,
    }, bars)).toBe(1.3125);
  });

  it("preserves an explicitly chosen denominator on reverse conversion", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 4, denominator: 4 },
    ];

    expect(absolutePositionToBarBeat(1.0625, bars, 8)).toEqual({
      barNumber: 1,
      beat: 1,
      numerator: 2,
      denominator: 8,
      barStart: 1,
      barLength: 1,
      beatsPerBar: 4,
      beatUnit: 4,
    });
  });

  it("carries a full fraction into the next beat", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 4, denominator: 4 },
    ];

    expect(barBeatToAbsolutePosition({
      barNumber: 1,
      beat: 1,
      numerator: 4,
      denominator: 4,
    }, bars)).toBe(1.25);
  });

  it("carries beat overflow into the next bar when bars are available", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 3, denominator: 4 },
      { id: 3, position: 3, numerator: 4, denominator: 4 },
    ];

    expect(barBeatToAbsolutePosition({
      barNumber: 1,
      beat: 4,
      numerator: 4,
      denominator: 4,
    }, bars)).toBe(2);

    expect(absolutePositionToBarBeat(2, bars)).toEqual({
      barNumber: 2,
      beat: 1,
      numerator: 0,
      denominator: 1,
      barStart: 2,
      barLength: 1,
      beatsPerBar: 3,
      beatUnit: 4,
    });
  });

  it("snaps rounded whole-beat positions in uneven bars to the next beat instead of 1/1 spillover", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 3, denominator: 2 },
      { id: 3, position: 3, numerator: 4, denominator: 4 },
    ];

    expect(barBeatToAbsolutePosition({
      barNumber: 2,
      beat: 3,
      numerator: 0,
      denominator: 1,
    }, bars)).toBe(2.666667);

    expect(absolutePositionToBarBeat(2.666667, bars, 1)).toEqual({
      barNumber: 2,
      beat: 3,
      numerator: 0,
      denominator: 1,
      barStart: 2,
      barLength: 1,
      beatsPerBar: 3,
      beatUnit: 2,
    });
  });

  it("keeps the last explicit bar active until another explicit bar marker appears", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 3, denominator: 2 },
    ];

    expect(absolutePositionToBarBeat(3.666667, bars, 1)).toEqual({
      barNumber: 2,
      beat: 3,
      numerator: 0,
      denominator: 1,
      barStart: 2,
      barLength: 1,
      beatsPerBar: 3,
      beatUnit: 2,
    });

    expect(barBeatToAbsolutePosition({
      barNumber: 2,
      beat: 2,
      numerator: 0,
      denominator: 1,
    }, bars)).toBe(2.333333);
  });

  it("spreads a bar signature across the full distance to the next explicit bar marker", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 3, denominator: 2 },
      { id: 3, position: 4, numerator: 4, denominator: 4 },
    ];

    expect(absolutePositionToBarBeat(3, bars, 1)).toEqual({
      barNumber: 2,
      beat: 2,
      numerator: 1,
      denominator: 2,
      barStart: 2,
      barLength: 2,
      beatsPerBar: 3,
      beatUnit: 2,
    });

    expect(barBeatToAbsolutePosition({
      barNumber: 2,
      beat: 3,
      numerator: 0,
      denominator: 1,
    }, bars)).toBe(3.333333);
  });

  it("derives a terminal barline position from snapshots and explicit bars", () => {
    expect(deriveTerminalBarlinePosition([
      {
        length: 1,
        notes: [{ start: 0, end: 0.875 }],
      },
      {
        length: 1.4,
        notes: [{ start: 0.2, end: 1.4 }],
      },
    ], [{ id: 1, position: 1 }, { id: 2, position: 2 }])).toBe(4);
  });

  it("keeps an exact integer snapshot ending on that same terminal barline", () => {
    expect(deriveTerminalBarlinePosition([
      {
        length: 1,
        notes: [{ start: 0, end: 1 }],
      },
      {
        length: 1,
        notes: [{ start: 0, end: 1 }],
      },
    ], [{ id: 1, position: 1 }, { id: 2, position: 2 }])).toBe(3);
  });

  it("spans the last explicit bar to the implicit terminal barline", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 14, position: 17, numerator: 1, denominator: 1 },
    ];
    const terminalPosition = 19;

    expect(absolutePositionToBarBeat(18, bars, 9, 9, terminalPosition)).toEqual({
      barNumber: 2,
      beat: 1,
      numerator: 1,
      denominator: 2,
      barStart: 17,
      barLength: 2,
      beatsPerBar: 1,
      beatUnit: 1,
    });

    expect(absolutePositionToBarBeat(19, bars, 9, 9, terminalPosition)).toEqual({
      barNumber: 2,
      beat: 1,
      numerator: 1,
      denominator: 1,
      barStart: 17,
      barLength: 2,
      beatsPerBar: 1,
      beatUnit: 1,
    });

    expect(barBeatToAbsolutePosition({
      barNumber: 2,
      beat: 1,
      numerator: 1,
      denominator: 1,
    }, bars, terminalPosition)).toBe(19);
  });

  it("treats n snapshots inside one bar as a bar whose global length is n", () => {
    const snapshots = Array.from({ length: 18 }, (_, index) => ({
      id: index + 1,
      length: 1,
      notes: [],
    }));
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 14, position: 17, numerator: 1, denominator: 1 },
    ];
    const terminalPosition = deriveTerminalBarlinePosition(snapshots, bars);

    expect(terminalPosition).toBe(19);
    expect(absolutePositionToBarBeat(17, bars, 9, 9, terminalPosition)).toEqual({
      barNumber: 2,
      beat: 1,
      numerator: 0,
      denominator: 1,
      barStart: 17,
      barLength: 2,
      beatsPerBar: 1,
      beatUnit: 1,
    });
    expect(absolutePositionToBarBeat(18, bars, 9, 9, terminalPosition)).toEqual({
      barNumber: 2,
      beat: 1,
      numerator: 1,
      denominator: 2,
      barStart: 17,
      barLength: 2,
      beatsPerBar: 1,
      beatUnit: 1,
    });
    expect(absolutePositionToBarBeat(19, bars, 9, 9, terminalPosition)).toEqual({
      barNumber: 2,
      beat: 1,
      numerator: 1,
      denominator: 1,
      barStart: 17,
      barLength: 2,
      beatsPerBar: 1,
      beatUnit: 1,
    });
  });

  it("round-trips user-entered fractions against the full terminal-spanning bar length", () => {
    const bars = [
      ...Array.from({ length: 13 }, (_, index) => ({
        id: index + 1,
        position: index + 1,
        numerator: 1,
        denominator: 1,
      })),
      { id: 14, position: 17, numerator: 1, denominator: 1 },
    ];
    const terminalPosition = 19;

    const quarterPosition = barBeatToAbsolutePosition({
      barNumber: 14,
      beat: 1,
      numerator: 1,
      denominator: 4,
    }, bars, terminalPosition);

    expect(quarterPosition).toBe(17.5);
    expect(absolutePositionToBarBeat(quarterPosition, bars, 4, 9, terminalPosition)).toEqual({
      barNumber: 14,
      beat: 1,
      numerator: 1,
      denominator: 4,
      barStart: 17,
      barLength: 2,
      beatsPerBar: 1,
      beatUnit: 1,
    });
  });

  it("normalizes repeat markers while preserving floating positions", () => {
    expect(normalizeRepeatMarkers([
      { id: "end-a", position: 3, kind: "end" },
      { id: "start-a", position: 1.5, kind: "start" },
      { id: "start-b", position: 1.5, kind: "start" },
    ])).toEqual([
      { id: "start-b", position: 1.5, kind: "start", repeatCount: null },
      { id: "end-a", position: 3, kind: "end", repeatCount: 2 },
    ]);
  });

  it("orders an end repeat before a start repeat at the same position", () => {
    expect(normalizeRepeatMarkers([
      { id: "start-a", position: 3, kind: "start" },
      { id: "end-a", position: 3, kind: "end", repeatCount: 2 },
    ])).toEqual([
      { id: "end-a", position: 3, kind: "end", repeatCount: 2 },
      { id: "start-a", position: 3, kind: "start", repeatCount: null },
    ]);
  });

  it("keeps dangling end repeats visible instead of synthesizing undeletable start markers", () => {
    expect(normalizeRepeatMarkers([
      { id: "end-a", position: 3, kind: "end" },
    ])).toEqual([
      { id: "end-a", position: 3, kind: "end", repeatCount: 2 },
    ]);
  });

  it("derives an implicit start position at the beginning when adding the first end repeat", () => {
    expect(deriveImplicitRepeatStartPosition([], 3)).toBe(1);
  });

  it("derives an implicit start position exactly at the previous end marker for a later dangling end repeat", () => {
    expect(deriveImplicitRepeatStartPosition([
      { id: "start-a", position: 1, kind: "start" },
      { id: "end-a", position: 3, kind: "end" },
    ], 5)).toBe(3);
  });

  it("does not derive an implicit start position when the preceding repeat marker is already a start", () => {
    expect(deriveImplicitRepeatStartPosition([
      { id: "end-a", position: 3, kind: "end" },
      { id: "start-a", position: 1, kind: "start" },
    ], 5)).toBe(3);
    expect(deriveImplicitRepeatStartPosition([
      { id: "start-b", position: 4, kind: "start" },
    ], 5)).toBeNull();
  });

  it("does not derive an implicit start position from a marker at the same position as the new end", () => {
    expect(deriveImplicitRepeatStartPosition([
      { id: "end-a", position: 2, kind: "end" },
    ], 2)).toBeNull();
  });

  it("derives extra implicit starts for later dangling end markers", () => {
    expect(deriveImplicitRepeatStartPositionsForDanglingEnds([
      { id: "start-a", position: 1, kind: "start" },
      { id: "end-a", position: 3, kind: "end" },
      { id: "end-b", position: 5, kind: "end" },
    ])).toEqual([3]);
  });

  it("drops invalid end repeat markers at position 1", () => {
    expect(normalizeRepeatMarkers([
      { id: "end-a", position: 1, kind: "end" },
    ])).toEqual([]);
  });

  it("clamps denominator to at least 1", () => {
    const bars = [
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 4, denominator: 4 },
    ];

    expect(barBeatToAbsolutePosition({
      barNumber: 1,
      beat: 1,
      numerator: 1,
      denominator: 0,
    }, bars)).toBe(1.25);
  });

  it("preserves a 0/n bar signature as a stopped bar", () => {
    const bars = [
      { id: 1, position: 1, numerator: 0, denominator: 4 },
      { id: 2, position: 2, numerator: 4, denominator: 4 },
    ];

    expect(normalizeBarMarkers(bars)[0]).toEqual({
      id: 1,
      position: 1,
      numerator: 0,
      denominator: 4,
    });

    expect(absolutePositionToBarBeat(1, bars)).toEqual({
      barNumber: 1,
      beat: 0,
      numerator: 0,
      denominator: 1,
      barStart: 1,
      barLength: 1,
      beatsPerBar: 0,
      beatUnit: 4,
      stopped: true,
    });

    expect(barBeatToAbsolutePosition({
      barNumber: 1,
      beat: 0,
      numerator: 0,
      denominator: 4,
    }, bars)).toBe(1);
  });
});
