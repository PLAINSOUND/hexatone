import { normalizeHejiPitchClassInput } from "./heji-normalization.js";

describe("normalizeHejiPitchClassInput", () => {
  it("normalizes bare notes, German H, and chromatic OpenType aliases", () => {
    expect(normalizeHejiPitchClassInput("a")).toBe("A");
    expect(normalizeHejiPitchClassInput("h")).toBe("B");
    expect(normalizeHejiPitchClassInput("*fE")).toBe("E");
    expect(normalizeHejiPitchClassInput("*stf")).toBe("F");
  });

  it("expands repeated and composite higher-prime shorthand", () => {
    expect(normalizeHejiPitchClassInput("*so5C")).toBe("C");
    expect(normalizeHejiPitchClassInput("*so125C")).toBe("C");
    expect(normalizeHejiPitchClassInput("*fu11A")).toBe("A");
    expect(normalizeHejiPitchClassInput("*no49D")).toBe("D");
  });

  it("rejects malformed explicit shorthand", () => {
    expect(normalizeHejiPitchClassInput("*so4C")).toBeNull();
    expect(normalizeHejiPitchClassInput("*no53Q")).toBeNull();
  });
});
