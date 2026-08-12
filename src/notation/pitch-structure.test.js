import {
  clearPitchStructure,
  createPitchStructure,
  parseHejiToStructure,
  pitchStructureToHeji,
  withPitchStructureAccidentalDelta,
  withPitchStructureFlag,
  withPitchStructureLetter,
  withPitchStructurePrimeDelta,
  withPitchStructureSyntonicDelta,
  withPitchStructureTemperedAccidentalCount,
} from "./pitch-structure.js";

describe("notation/pitch-structure", () => {
  it("builds a palette-style HEJI spelling from structural state", () => {
    let structure = createPitchStructure();
    structure = withPitchStructureLetter(structure, "A");
    structure = withPitchStructureAccidentalDelta(structure, 1);
    structure = withPitchStructurePrimeDelta(structure, 19, -1);

    expect(pitchStructureToHeji(structure)).toBe("A");
  });

  it("treats higher-prime exponents as signed counts", () => {
    let structure = createPitchStructure({ letter: "A" });
    structure = withPitchStructurePrimeDelta(structure, 7, 1);
    structure = withPitchStructurePrimeDelta(structure, 7, 1);
    structure = withPitchStructurePrimeDelta(structure, 7, -1);

    expect(pitchStructureToHeji(structure)).toBe("A");
  });

  it("supports fifth-limit spill naturals beyond three commas", () => {
    let structure = createPitchStructure({ letter: "A" });
    structure = withPitchStructureSyntonicDelta(structure, 4);

    expect(pitchStructureToHeji(structure)).toBe("A");
  });

  it("suppresses the cautionary natural for higher-prime inflections when requested", () => {
    let structure = createPitchStructure({ letter: "A" });
    structure = withPitchStructurePrimeDelta(structure, 7, -1);
    structure = withPitchStructureFlag(structure, "cautionaryNatural", false);

    expect(pitchStructureToHeji(structure)).toBe("A");
  });

  it("compresses double septimals through the structure flag", () => {
    let structure = createPitchStructure({ letter: "A" });
    structure = withPitchStructurePrimeDelta(structure, 7, 1);
    structure = withPitchStructurePrimeDelta(structure, 7, 1);

    expect(pitchStructureToHeji(structure)).toBe("A");
    expect(
      pitchStructureToHeji(withPitchStructureFlag(structure, "useDoubleSeptimals", false)),
    ).toBe("A");
  });

  it("parses an existing HEJI spelling back into structural data", () => {
    const structure = parseHejiToStructure("A");

    expect(structure).toMatchObject({
      letter: "A",
      accidentalCount: 1,
      syntonic: 0,
      primeExponents: { 19: -1 },
    });
  });

  it("renders tempered chromatic accidentals when that mode is selected", () => {
    let structure = createPitchStructure({ letter: "A" });
    structure = withPitchStructureTemperedAccidentalCount(structure, 1);

    expect(pitchStructureToHeji(structure)).toBe("A");
    expect(parseHejiToStructure("A")).toMatchObject({
      letter: "A",
      accidentalCount: 1,
      syntonic: 0,
      useTemperedAccidentals: true,
    });
  });

  it("resets cleanly to the default empty structure", () => {
    expect(clearPitchStructure()).toEqual({
      letter: "",
      accidentalCount: 0,
      syntonic: 0,
      primeExponents: {},
      cautionaryNatural: false,
      useDoubles: true,
      useDoubleSeptimals: true,
      useTemperedAccidentals: false,
    });
  });
});
