import { describe, expect, it, vi } from "vitest";

vi.mock("../../settings/presets/preset_values", () => ({
  presets: [
    {
      name: "Tests",
      settings: [
        {
          name: "Pauline Oliveros: Heart of Tones",
          description: "legacy demo",
          scale: ["1.", "2."],
          auto_colors: true,
        },
        {
          name: "Legacy Only",
          description: "legacy only",
          scale: ["3.", "4."],
          auto_colors: true,
        },
      ],
    },
  ],
  default_settings: {
    name: "Pauline Oliveros: Heart of Tones",
    description: "legacy demo",
    scale: ["1.", "2."],
    auto_colors: true,
  },
}));

import {
  buildFilePresetTuningGroups,
  defaultTuningRecord,
  findPresetTuningByName,
  presetTuningGroups,
} from "./index.js";

describe("preset tunings registry", () => {
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

  it("finds a built-in tuning by name", () => {
    const tuning = findPresetTuningByName("Pauline Oliveros: Heart of Tones");
    expect(tuning).toEqual(expect.objectContaining({
      name: "Pauline Oliveros: Heart of Tones",
      scale: expect.any(Array),
    }));
  });

  it("exposes a canonical default tuning record", () => {
    expect(defaultTuningRecord).toEqual(expect.objectContaining({
      name: expect.any(String),
      scale: expect.any(Array),
      key_colors_mode: expect.any(String),
    }));
  });

  it("merges file-backed presets with legacy groups while preserving unmigrated presets", () => {
    const testsGroup = presetTuningGroups.find((group) => group.name === "Tests");
    expect(testsGroup).toBeTruthy();
    expect(testsGroup.settings.map((setting) => setting.name)).toEqual([
      "Legacy Only",
    ]);
  });
});
