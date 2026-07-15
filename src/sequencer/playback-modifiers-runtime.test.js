import { describe, expect, it } from "vitest";

import {
  applyPlaybackPitchOffsetToNote,
  parseSequencePlaybackPitchInput,
  normaliseSequencePlaybackPitchInput,
} from "./playback-modifiers-runtime.js";

describe("playback modifiers runtime", () => {
  it("treats playback pitch offsets as cents rather than semitone units", () => {
    const shifted = applyPlaybackPitchOffsetToNote(
      { midicents: 69, frequency: 440 },
      100,
    );

    expect(shifted.midicents).toBe(70);
    expect(shifted.frequency).toBeCloseTo(466.1637615, 6);
  });

  it("keeps pitch input in scala-style display form with minimal normalization", () => {
    expect(normaliseSequencePlaybackPitchInput("3")).toBe("3/1");
    expect(normaliseSequencePlaybackPitchInput("1200.")).toBe("1200.0");
    expect(normaliseSequencePlaybackPitchInput("7\\12")).toBe("7\\12");
    expect(normaliseSequencePlaybackPitchInput("3/2")).toBe("3/2");
  });

  it("parses backslash notation through the shared scala cents path", () => {
    expect(parseSequencePlaybackPitchInput("4\\12")).toBeCloseTo(400, 6);
    expect(parseSequencePlaybackPitchInput("3/2")).toBeCloseTo(701.9550009, 6);
  });
});
