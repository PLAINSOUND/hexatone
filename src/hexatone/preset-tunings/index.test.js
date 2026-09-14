import { describe, expect, it } from "vitest";

import {
  buildFilePresetTuningGroups,
  defaultTuningRecord,
  findPresetTuningByName,
  presetTuningGroups,
} from "./index.js";

describe("preset tunings registry", () => {
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
