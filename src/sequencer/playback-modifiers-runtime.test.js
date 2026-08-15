import { describe, expect, it } from "vitest";

import {
  applyPlaybackPitchOffsetToNote,
  applySequenceTimbreModWheelToNote,
  parseSequencePlaybackPitchInput,
  normaliseSequencePlaybackPitchInput,
  skewSequenceTimbreValue,
} from "./playback-modifiers-runtime.js";

describe("playback modifiers runtime", () => {
  it("treats playback pitch offsets as cents rather than semitone units", () => {
    const shifted = applyPlaybackPitchOffsetToNote({ midicents: 69, frequency: 440 }, 100);

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

  it("skews saved timbre around a neutral Mod Wheel value of 64", () => {
    expect(skewSequenceTimbreValue(80, 0)).toBe(0);
    expect(skewSequenceTimbreValue(80, 64)).toBe(80);
    expect(skewSequenceTimbreValue(80, 127)).toBe(127);
    expect(skewSequenceTimbreValue(80, 32)).toBe(40);
    expect(skewSequenceTimbreValue(80, 96)).toBe(104);
  });

  it("keeps source timbre metadata immutable across repeated live skews", () => {
    const low = applySequenceTimbreModWheelToNote({ timbre: 80 }, 32);
    const high = applySequenceTimbreModWheelToNote(low, 127);

    expect(low).toMatchObject({ timbre: 40, sequenceSourceTimbre: 80 });
    expect(high).toMatchObject({ timbre: 127, sequenceSourceTimbre: 80 });
  });
});
