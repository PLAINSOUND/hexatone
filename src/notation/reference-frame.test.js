import fs from "fs";
import { parseScale } from "../settings/scale/parse-scale.js";
import { createReferenceFrame, spellScaleFromReferenceFrame } from "./reference-frame.js";

const LEGACY_PRESET_NOTE_NAMES = {
  // Restored from historical preset_values.js (commit 1dd1d43) after the
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

function presetBlock(presetName) {
  const presetText = fs.readFileSync("src/settings/preset_values.js", "utf8");
  const escapedName = presetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = presetText.search(new RegExp(`['"]?name['"]?\\s*:\\s*['"]${escapedName}['"]`));
  if (start < 0) throw new Error(`Preset not found in src/settings/preset_values.js: ${presetName}`);
  const end = presetText.indexOf("\n      },", start);
  return presetText.slice(start, end < 0 ? undefined : end);
}

function presetNoteNames(presetName) {
  const legacyNoteNames = LEGACY_PRESET_NOTE_NAMES[presetName];
  if (legacyNoteNames) return legacyNoteNames;
  const block = presetBlock(presetName);
  const noteNamesMatch = block.match(/note_names:\s*\[(.*?)\],\s*key_labels/s);
  if (!noteNamesMatch) throw new Error(`note_names not found for preset: ${presetName}`);
  return [
    ...noteNamesMatch[1].matchAll(/['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
}

function jsonPresetArray(block, key, nextKey) {
  return [
    ...block
      .match(new RegExp(`["']?${key}["']?:\\s*\\[(.*?)\\],\\s*["']?${nextKey}["']?`, "s"))[1]
      .matchAll(/['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
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
    const block = presetBlock("53-Tertial (center D)");
    const scala = jsonPresetArray(block, "scale", "equivSteps");
    const expected = jsonPresetArray(block, "note_names", "note_colors");
    const degrees = ["1/1", ...scala.slice(0, -1)];
    const referenceDegree = Number(block.match(/['"]?reference_degree['"]?\s*:\s*(\d+)/)[1]);
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
