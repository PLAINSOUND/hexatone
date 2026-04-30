import { describe, expect, it } from "vitest";
import { SETTINGS_REGISTRY } from "../persistence/settings-registry.js";
import {
  SETTINGS_IMPACT_FIELDS,
  SETTINGS_IMPACT_GROUPS,
  SETTINGS_IMPACT_IGNORED_FIELDS,
  settingsImpactKey,
  settingsImpactSnapshot,
} from "./settings-impact-registry.js";

const flattenValues = (groups) => Object.values(groups).flat();

describe("settings impact registry", () => {
  it("covers every persisted setting with an impact or an explicit ignore decision", () => {
    const classified = new Set([
      ...flattenValues(SETTINGS_IMPACT_FIELDS),
      ...flattenValues(SETTINGS_IMPACT_GROUPS),
      ...flattenValues(SETTINGS_IMPACT_IGNORED_FIELDS),
    ]);
    const missing = SETTINGS_REGISTRY.map((entry) => entry.key).filter((key) => !classified.has(key));
    expect(missing).toEqual([]);
  });

  it("does not classify the same setting as both impacted and ignored", () => {
    const impacted = new Set([
      ...flattenValues(SETTINGS_IMPACT_FIELDS),
      ...flattenValues(SETTINGS_IMPACT_GROUPS),
    ]);
    const overlap = flattenValues(SETTINGS_IMPACT_IGNORED_FIELDS).filter((key) =>
      impacted.has(key),
    );
    expect(overlap).toEqual([]);
  });

  it("keeps structural settings independent from MIDI input/output runtime fields", () => {
    expect(SETTINGS_IMPACT_GROUPS.structural).toContain("scale");
    expect(SETTINGS_IMPACT_GROUPS.structural).toContain("key_labels");
    expect(SETTINGS_IMPACT_GROUPS.structural).not.toContain("midiin_device");
    expect(SETTINGS_IMPACT_GROUPS.structural).not.toContain("output_mts");
    expect(SETTINGS_IMPACT_GROUPS.structural).not.toContain("note_colors");
  });

  it("keeps Keys reconstruction independent from label and output settings", () => {
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).toContain("midiin_device");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).toContain("rSteps");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("key_labels");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("note_colors");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("output_mts");
  });

  it("snapshots only the requested group fields plus explicit extras", () => {
    const snapshot = settingsImpactSnapshot(
      {
        scale: ["1/1", "3/2"],
        key_labels: "heji",
        note_colors: ["#ffffff"],
        midiin_device: "controller-a",
      },
      "keysReconstruction",
      { midiTick: 2 },
    );
    expect(snapshot.scale).toEqual(["1/1", "3/2"]);
    expect(snapshot.midiin_device).toBe("controller-a");
    expect(snapshot.midiTick).toBe(2);
    expect(snapshot).not.toHaveProperty("key_labels");
    expect(snapshot).not.toHaveProperty("note_colors");
  });

  it("keeps impact keys stable when unrelated settings change", () => {
    const base = {
      scale: ["1/1", "3/2"],
      equivSteps: 12,
      reference_degree: 0,
      fundamental: 440,
      note_colors: ["#ffffff"],
      midi_device: "OFF",
    };
    const changedColor = { ...base, note_colors: ["#000000"] };
    const changedOutput = { ...base, midi_device: "synth-a" };
    const changedTuning = { ...base, fundamental: 442 };

    expect(settingsImpactKey(base, "structural")).toBe(
      settingsImpactKey(changedColor, "structural"),
    );
    expect(settingsImpactKey(base, "structural")).toBe(
      settingsImpactKey(changedOutput, "structural"),
    );
    expect(settingsImpactKey(base, "structural")).not.toBe(
      settingsImpactKey(changedTuning, "structural"),
    );
  });

  it("throws for unknown impact groups", () => {
    expect(() => settingsImpactSnapshot({}, "missing")).toThrow(
      "Unknown settings impact group: missing",
    );
  });
});
