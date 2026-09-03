import { normalizeHejiPitchClassInput } from "./heji-normalization.js";

describe("normalizeHejiPitchClassInput", () => {
  it("normalizes bare notes, German H, and chromatic OpenType ligatures", () => {
    expect(normalizeHejiPitchClassInput("a")).toBe("A");
    expect(normalizeHejiPitchClassInput("h")).toBe("B");
    expect(normalizeHejiPitchClassInput("*fE")).toBe("E");
    expect(normalizeHejiPitchClassInput("*stf")).toBe("F");
    expect(normalizeHejiPitchClassInput("*nTA")).toBe("A");
    expect(normalizeHejiPitchClassInput("*FC")).toBe("C");
    expect(normalizeHejiPitchClassInput("*SG")).toBe("G");
  });

  it("keeps 5-limit modifiers inside the 3-limit ligature", () => {
    expect(normalizeHejiPitchClassInput("*so5C")).toBe("C");
    expect(normalizeHejiPitchClassInput("*so125C")).toBe("C");
    expect(normalizeHejiPitchClassInput("*nu25A")).toBe("A");
  });

  it("parses prime 7 through 47 as separate OpenType ligatures", () => {
    const expected = new Map([
      [7, ["", ""]],
      [11, ["", ""]],
      [13, ["", ""]],
      [17, ["", ""]],
      [19, ["", ""]],
      [23, ["", ""]],
      [29, ["", ""]],
      [31, ["", ""]],
      [37, ["", ""]],
      [41, ["", ""]],
      [43, ["", ""]],
      [47, ["", ""]],
    ]);
    for (const [prime, [overtonalGlyph, undertonalGlyph]] of expected) {
      expect(normalizeHejiPitchClassInput(`*s*o${prime}C`)).toBe(`${overtonalGlyph}C`);
      expect(normalizeHejiPitchClassInput(`*u${prime}*sC`)).toBe(`${undertonalGlyph}C`);
    }
    expect(normalizeHejiPitchClassInput("*f*u11A")).toBe("A");
    expect(normalizeHejiPitchClassInput("*n*o49D")).toBe("D");
  });

  it("rejects malformed explicit shorthand", () => {
    expect(normalizeHejiPitchClassInput("*so4C")).toBeNull();
    expect(normalizeHejiPitchClassInput("*so7C")).toBeNull();
    expect(normalizeHejiPitchClassInput("*fu11A")).toBeNull();
    expect(normalizeHejiPitchClassInput("*no53Q")).toBeNull();
  });
});
