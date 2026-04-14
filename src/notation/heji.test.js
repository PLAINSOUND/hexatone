import {
  glyphStringForSelection,
  hejiDeltaMonzoForSelection,
  hejiToMonzo,
  monzoToHeji,
  parseHejiGlyphInput,
} from "./heji.js";

describe("notation/heji", () => {
  it("parses base and extra glyphs into a selection", () => {
    const parsed = parseHejiGlyphInput("");
    expect(parsed.baseId).toBe("sharp:0");
    expect(parsed.schismaAmount).toBe(0);
    expect(parsed.extraIds).toEqual(["septimal:-1"]);
  });

  it("renders glyph strings for a selection", () => {
    expect(glyphStringForSelection("natural:0", [])).toBe("");
    expect(glyphStringForSelection("sharp:0", ["septimal:-1"])).toBe("");
  });

  it("keeps repeated prime-family glyphs as repeated accidentals", () => {
    const parsed = parseHejiGlyphInput("");
    expect(parsed.baseId).toBe("natural:0");
    expect(parsed.extraIds).toEqual(["19_limit:-1", "19_limit:-1"]);
    expect(glyphStringForSelection(parsed.baseId, parsed.extraIds)).toBe("");
  });

  it("parses and renders dedicated double-septimal glyphs", () => {
    const parsedLower = parseHejiGlyphInput("");
    expect(parsedLower.extraIds).toEqual(["septimal:-1", "septimal:-1"]);
    expect(glyphStringForSelection("natural:0", parsedLower.extraIds)).toBe("");

    const parsedUpper = parseHejiGlyphInput("");
    expect(parsedUpper.extraIds).toEqual(["septimal:1", "septimal:1"]);
    expect(glyphStringForSelection("natural:0", parsedUpper.extraIds)).toBe("");
  });

  it("renders triple septimal accidentals as single plus double glyphs", () => {
    expect(
      glyphStringForSelection("natural:0", ["septimal:-1", "septimal:-1", "septimal:-1"]),
    ).toBe("");
    expect(glyphStringForSelection("natural:0", ["septimal:1", "septimal:1", "septimal:1"])).toBe(
      "",
    );
  });

  it("orders higher primes farther from the letter name", () => {
    expect(glyphStringForSelection("sharp:0", ["septimal:-1", "19_limit:1", "47_limit:-1"])).toBe(
      "",
    );
  });

  it("builds the A4 1/1 monzo from a natural spelling", () => {
    const monzo = hejiToMonzo({
      letter: "A",
      octave: 4,
      baseId: "natural:0",
      extraIds: [],
    });
    expect(monzo).toEqual(new Array(15).fill(0));
  });

  it("round-trips a supported spelling through monzoToHeji", () => {
    const source = {
      letter: "G",
      octave: 4,
      baseId: "sharp:1",
      extraIds: ["septimal:-1"],
    };
    const monzo = hejiToMonzo(source);
    const spelled = monzoToHeji(monzo);
    expect(spelled.supported).toBe(true);
    expect(spelled.letter).toBe(source.letter);
    expect(spelled.octave).toBe(source.octave);
    expect(spelled.baseId).toBe(source.baseId);
    expect(spelled.extraIds).toEqual(source.extraIds);
  });

  it("uses the corrected 47-limit quartertone glyph", () => {
    const delta = hejiDeltaMonzoForSelection("natural:0", ["47_limit:-1"]);
    expect(delta).toEqual([-4, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);

    const source = {
      letter: "G",
      octave: 4,
      baseId: "natural:0",
      extraIds: ["47_limit:-1"],
    };
    const monzo = hejiToMonzo(source);
    const spelled = monzoToHeji(monzo);
    expect(spelled.supported).toBe(true);
    expect(spelled.extraIds).toEqual(source.extraIds);
    expect(spelled.label.glyphs).toBe("G4");
  });

  it("supports third syntonic lowerings in the conventional accidental layer", () => {
    expect(glyphStringForSelection("sharp:-3", [])).toBe("");
  });

  it("parses and renders schisma prefixes in the conventional accidental layer", () => {
    const parsed = parseHejiGlyphInput("");
    expect(parsed.baseId).toBe("natural:1");
    expect(parsed.schismaAmount).toBe(2);
    expect(glyphStringForSelection(parsed.baseId, parsed.extraIds, parsed.schismaAmount)).toBe(
      "",
    );
  });

  it("combines one schisma lower with one syntonic lower into a Pythagorean comma", () => {
    const delta = hejiDeltaMonzoForSelection("sharp:-1", [], -1);
    expect(delta).toEqual([19, -12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(glyphStringForSelection("sharp:-1", [], -1)).toBe("");
  });

  it("marks unsupported monzos cleanly", () => {
    const unsupported = monzoToHeji([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(unsupported.supported).toBe(false);
  });
});
