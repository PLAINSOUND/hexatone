import fs from "fs";
import { parseScale } from "../settings/scale/parse-scale.js";
import { createReferenceFrame, spellScaleFromReferenceFrame } from "./reference-frame.js";

function presetNoteNames(presetName) {
  const presetText = fs.readFileSync("src/settings/preset_values.js", "utf8");
  const index = presetText.indexOf(presetName);
  const block = presetText.slice(index, index + 12000);
  return [...block.match(/note_names:\s*\[(.*?)\],\s*key_labels/s)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
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

    const generated = spellScaleFromReferenceFrame(degrees, frame).map((item) => item.pitchClassGlyphs);
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

    const generated = spellScaleFromReferenceFrame(degrees, frame).map((item) => item.pitchClassGlyphs);
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

    const generated = spellScaleFromReferenceFrame(degrees, frame).map((item) => item.pitchClassGlyphs);
    expect(generated).toEqual(expected);
  });
});
