import { describe, expect, it } from "vitest";
import { deriveAutoNoteColors } from "../../settings/scale/auto-colors.js";

import {
  buildFilePresetTuningGroups,
  defaultTuningRecord,
  findPresetTuningByName,
  presetTuningGroups,
} from "./index.js";

describe("preset tunings registry", () => {
  it("places 53-Quintal immediately before 55-Quintal with its saved anchors", () => {
    const group = presetTuningGroups.find((entry) => entry.name === "Rational Intonation (JI)");
    const index = group.settings.findIndex((preset) => preset.name === "55-Quintal (Sabat Euler Lattice, centre D)");
    const preset = group.settings[index - 1];
    expect(preset).toMatchObject({
      name: "53-Quintal (Sabat Euler Lattice, centre D)",
      short_description: "53-JI-5L(Euler)",
      equivSteps: 53,
      center_degree: 9,
      reference_degree: 40,
      rSteps: 9,
      drSteps: 4,
      exquis_anchor_note: 35,
      lumatone_anchor_note: 27,
      lumatone_anchor_channel: 3,
    });
    expect(preset.scale).toHaveLength(53);
    expect(preset.note_names).toHaveLength(53);
    expect(preset.note_colors).toHaveLength(53);
    expect(preset.scale.at(-1)).toBe("2/1");
  });

  it("stores regenerated auto colours as manual palettes for Quintal and Zarlino", () => {
    for (const name of ["55-Quintal (Sabat Euler Lattice, centre D)", "41-(13-Limit) Zarlino"]) {
      const preset = findPresetTuningByName(name);
      expect(preset.key_colors_mode).toBe("manual");
      expect(preset.note_colors).toEqual(deriveAutoNoteColors(preset));
    }
  });
  it("places Zarlino after Breed and preserves the exported tuning and Exquis anchor", () => {
    const group = presetTuningGroups.find((entry) => entry.name === "Rational Intonation (JI)");
    const breedIndex = group.settings.findIndex((preset) => preset.name === "41-(13-Limit) Breed");
    const zarlino = group.settings[breedIndex + 1];
    expect(zarlino).toMatchObject({
      name: "41-(13-Limit) Zarlino",
      short_description: "41-JI-13L(Zarlino)",
      built_in_group: "Rational Intonation (JI)",
      exquis_anchor_note: 31,
      fundamental: 440,
      reference_degree: 31,
      key_colors_mode: "manual",
      key_labels: "heji",
    });
    expect(zarlino.scale).toHaveLength(41);
    expect(zarlino.note_names).toHaveLength(41);
    expect(zarlino.note_names[15]).toBe("F−52");
    expect(zarlino.scale[14]).toBe("13/10");
    expect(zarlino.note_colors[15]).toBe("#e8c9e4");
    expect(zarlino.note_colors).toHaveLength(41);
    expect(zarlino.scale[4]).toBe("351/320");
    expect(zarlino.note_colors[5]).toBe("#e8c9e4");
    expect(zarlino.scale[34]).toBe("9/5");
    expect(zarlino.note_names[35]).toBe("B+12");
    expect(zarlino.note_colors[35]).toBe("#c7c1a1");
    for (const [degree, ratio, label, color] of [
      [3, "21/20", "D", "#fde4d3"],
      [10, "75/64", "D", "#f0e5a4"],
      [32, "33/20", "A", "#e3f5d0"],
    ]) {
      expect(zarlino.scale[degree - 1]).toBe(ratio);
      expect(zarlino.note_names[degree]).toBe(label);
      expect(zarlino.note_colors[degree]).toBe(color);
    }
    expect(findPresetTuningByName(zarlino.name)).toEqual(zarlino);
  });

  it("places the renamed 53-Tertial replica directly after The Tree", () => {
    const group = presetTuningGroups.find((entry) => entry.name === "Marc Sabat NYKY Ensemble");
    const treeIndex = group.settings.findIndex(
      (preset) => preset.name === "Sabat: The Tree + Modulations",
    );
    const replica = group.settings[treeIndex + 1];
    expect(replica.name).toBe("53-tone Extended Pythagorean layout");
    const original = findPresetTuningByName("53-Tertial (centre D)");
    expect(original).toBeTruthy();
    // The new preset can have its own description and central degree while
    // retaining the original 53-tone pitch collection.
    expect(replica.scale).toEqual(original.scale);
  });

  it("builds file-backed tuning groups from discovered json and folder metadata", () => {
    const groups = buildFilePresetTuningGroups({
      jsonModules: {
        "./tests/file-backed-demo.json": {
          default: {
            name: "File Backed Demo",
            description: "demo",
            scale: ["100.", "1200."],
            key_colors_mode: "manual",
          },
        },
        "./tests/second-demo.json": {
          default: {
            name: "Second Demo",
            description: "second",
            scale: ["200.", "1200."],
            key_colors_mode: "auto",
          },
        },
      },
      presetRegistry: {
        categories: [
          {
            slug: "tests",
            name: "Tests",
            presets: ["second-demo", "file-backed-demo"],
          },
        ],
      },
    });

    expect(groups).toEqual([
      {
        name: "Tests",
        settings: [
          expect.objectContaining({
            name: "Second Demo",
            key_colors_mode: "auto",
          }),
          expect.objectContaining({
            name: "File Backed Demo",
            key_colors_mode: "manual",
          }),
        ],
      },
    ]);
  });

  it("discovers preset folders even when they do not provide metadata", () => {
    const groups = buildFilePresetTuningGroups({
      jsonModules: {
        "./experimental-tunings/zeta-demo.json": {
          default: {
            name: "Zeta Demo",
            description: "zeta",
            scale: ["300.", "1200."],
            key_colors_mode: "auto",
          },
        },
        "./experimental-tunings/alpha-demo.json": {
          default: {
            name: "Alpha Demo",
            description: "alpha",
            scale: ["100.", "1200."],
            key_colors_mode: "manual",
          },
        },
      },
      presetRegistry: { categories: [] },
    });

    expect(groups).toEqual([
      {
        name: "Experimental Tunings",
        settings: [
          expect.objectContaining({ name: "Alpha Demo" }),
          expect.objectContaining({ name: "Zeta Demo" }),
        ],
      },
    ]);
  });

  it("finds a built-in tuning by name from the file-backed library", () => {
    const tuning = findPresetTuningByName("Pauline Oliveros: Heart of Tones");
    expect(tuning).toEqual(
      expect.objectContaining({
        name: "Pauline Oliveros: Heart of Tones",
        scale: expect.any(Array),
      }),
    );
  });

  it("exposes a canonical default tuning record from the first built-in preset", () => {
    expect(defaultTuningRecord).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        scale: expect.any(Array),
        key_colors_mode: expect.any(String),
      }),
    );
    expect(defaultTuningRecord).toEqual(presetTuningGroups[0].settings[0]);
  });

  it("publishes only file-backed preset groups", () => {
    expect(presetTuningGroups.length).toBeGreaterThan(0);
    expect(
      presetTuningGroups.some((group) =>
        group.settings.some((preset) => preset.name === "Legacy Only"),
      ),
    ).toBe(false);
  });
});
