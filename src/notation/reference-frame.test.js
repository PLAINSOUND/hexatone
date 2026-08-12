import fs from "fs";
import { findPresetTuningByName } from "../hexatone/preset-tunings/index.js";
import { parseScale } from "../settings/scale/parse-scale.js";
import { createReferenceFrame, spellScaleFromReferenceFrame } from "./reference-frame.js";

const LEGACY_PRESET_NOTE_NAMES = {
  // Restored from historical built-in preset data (commit 1dd1d43) after the
  // dedicated HEJI preset was removed from the live preset catalog.
  "Sabat: The Tree (HEJI)": [
    "C",
    "C",
    "C",
    "C",
    "D",
    "C",
    "C",
    "C",
    "D",
    "D",
    "D",
    "D",
    "D",
    "E",
    "D",
    "D",
    "E",
    "D",
    "E",
    "E",
    "E",
    "E",
    "E",
    "E",
    "E",
    "E",
    "F",
    "F",
    "E",
    "F",
    "F",
    "F",
    "F",
    "F",
    "F",
    "G",
    "F",
    "F",
    "G",
    "F",
    "G",
    "G",
    "G",
    "G",
    "G",
    "A",
    "G",
    "G",
    "A",
    "G",
    "G",
    "G",
    "A",
    "A",
    "A",
    "A",
    "A",
    "B",
    "A",
    "A",
    "A",
    "B",
    "A",
    "B",
    "A",
    "B",
    "B",
    "B",
    "B",
    "B",
    "B",
    "B",
    "B",
    "C",
    "B",
    "C",
    "C",
    "B",
    "C",
    "B",
    "B",
  ],
};

function presetRecord(presetName) {
  const preset = findPresetTuningByName(presetName);
  if (!preset) throw new Error(`Built-in preset not found: ${presetName}`);
  return preset;
}

function presetNoteNames(presetName) {
  const legacyNoteNames = LEGACY_PRESET_NOTE_NAMES[presetName];
  if (legacyNoteNames) return legacyNoteNames;
  return [...(presetRecord(presetName).note_names ?? [])];
}

describe("notation/reference-frame", () => {
  it("reproduces Sabat: The Tree (HEJI) from its declared anchor degree", () => {
    const scala = parseScale(fs.readFileSync("scales/81-HS-odd-47L.scl", "utf8")).scale;
    const degrees = ["1/1", ...scala.slice(0, -1)];
    const expected = presetNoteNames("Sabat: The Tree (HEJI)");
    const frame = createReferenceFrame({
      anchorLabel: "A",
      anchorRatio: degrees[56],
    });

    const generated = spellScaleFromReferenceFrame(degrees, frame).map(
      (item) => item.pitchClassGlyphs,
    );
    expect(generated).toEqual(expected);
  });

  it("reproduces 12-Pythagorean note names from the reference degree", () => {
    const scala = parseScale(fs.readFileSync("scales/12-JI-3L.scl", "utf8")).scale;
    const degrees = ["1/1", ...scala.slice(0, -1)];
    const expected = presetNoteNames("12-Pythagorean (pure fifths)");
    const frame = createReferenceFrame({
      anchorLabel: "A",
      anchorRatio: degrees[9],
    });

    const generated = spellScaleFromReferenceFrame(degrees, frame).map(
      (item) => item.pitchClassGlyphs,
    );
    expect(generated).toEqual(expected);
  });

  it("reproduces 53-(13-Limit) Taylor note names from the reference degree", () => {
    const scala = parseScale(fs.readFileSync("scales/53-JI-13L-CT.scl", "utf8")).scale;
    const degrees = ["1/1", ...scala.slice(0, -1)];
    const expected = presetNoteNames("53-(13-Limit) Taylor");
    const frame = createReferenceFrame({
      anchorLabel: "A",
      anchorRatio: degrees[40],
    });

    const generated = spellScaleFromReferenceFrame(degrees, frame).map(
      (item) => item.pitchClassGlyphs,
    );
    expect(generated).toEqual(expected);
  });

  it("reproduces 53-Tertial (center D) from its centered policy", () => {
    const preset = presetRecord("53-Tertial (center D)");
    const scala = [...preset.scale];
    const expected = [...preset.note_names];
    const degrees = ["1/1", ...scala.slice(0, -1)];
    const referenceDegree = Number(preset.reference_degree);
    const frame = createReferenceFrame({
      anchorLabel: expected[referenceDegree],
      anchorRatio: degrees[referenceDegree],
    });

    const generated = spellScaleFromReferenceFrame(degrees, frame, {
      allowSchismaConventional: true,
      notationPolicy: "53_tertial_center_d",
    }).map((item) => item.pitchClassGlyphs);
    expect(generated).toEqual(expected);
  });

  it("reproduces 22-Farabi with the provisional C-centered respelling seam", () => {
    const scala = parseScale(fs.readFileSync("scales/22-JI-17L-Farabi.scl", "utf8")).scale;
    const degrees = ["1/1", ...scala.slice(0, -1)];
    const expected = presetNoteNames("22-Farabi");
    const frame = createReferenceFrame({
      anchorLabel: "A",
      anchorRatio: degrees[17],
    });

    const generated = spellScaleFromReferenceFrame(degrees, frame, {
      allowSchismaConventional: true,
      notationPolicy: "farabi_center_c",
    }).map((item) => item.pitchClassGlyphs);
    expect(generated).toEqual(expected);
  });
});
