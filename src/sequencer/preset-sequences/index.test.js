import { describe, expect, it } from "vitest";
import {
  buildPresetSequenceGroups,
  loadPresetSequenceByName,
  presetSequenceGroups,
} from "./index.js";

describe("buildPresetSequenceGroups", () => {
  it("normalizes slug folders into display names and orders categories from the registry", () => {
    const groups = buildPresetSequenceGroups({
      jsonModules: {
        "./harmonic-studies/alpha.json": { default: { name: "Alpha Study", snapshots: [] } },
        "./demo/fall.json": { default: { name: "FALL", snapshots: [] } },
      },
      presetRegistry: {
        categories: [
          { slug: "demo", name: "Demo", sequences: ["fall"] },
          { slug: "harmonic-studies" },
        ],
      },
    });

    expect(groups.map((group) => group.name)).toEqual(["Demo", "Harmonic Studies"]);
    expect(groups[0].sequences.map((sequence) => sequence.name)).toEqual(["FALL"]);
    expect(groups[1].sequences.map((sequence) => sequence.name)).toEqual(["Alpha Study"]);
  });

  it("falls back to alphabetical sequence ordering when no per-category order is provided", () => {
    const groups = buildPresetSequenceGroups({
      jsonModules: {
        "./studies/beta.json": { default: { name: "Beta", snapshots: [] } },
        "./studies/alpha.json": { default: { name: "Alpha", snapshots: [] } },
      },
      presetRegistry: { categories: [{ slug: "studies" }] },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Studies");
    expect(groups[0].sequences.map((sequence) => sequence.name)).toEqual(["Alpha", "Beta"]);
  });

  it("keeps each registry menu name identical to the loaded sequence name", async () => {
    for (const group of presetSequenceGroups) {
      for (const descriptor of group.sequences) {
        const sequence = await loadPresetSequenceByName(descriptor.name);
        expect(sequence?.name).toBe(descriptor.name);
      }
    }
  });
});
