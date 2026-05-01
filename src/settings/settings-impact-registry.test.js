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
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).toContain("rSteps");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_device");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("key_labels");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("note_colors");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("output_mts");
  });

  it("keeps live MIDI input runtime settings out of Keys reconstruction", () => {
    expect(SETTINGS_IMPACT_GROUPS.inputRuntime).toContain("midiin_steps_per_channel");
    expect(SETTINGS_IMPACT_GROUPS.inputRuntime).toContain("midiin_pitchbend_mode");
    expect(SETTINGS_IMPACT_GROUPS.inputRuntime).toContain("wheel_to_recent");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_steps_per_channel");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_channel_group_size");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_anchor_channel");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_channel_legacy");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("wheel_to_recent");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_mapping_target");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_mpe_input");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_pitchbend_mode");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_pressure_mode");
  });

  it("keeps MIDI controller-map settings out of full Keys reconstruction", () => {
    expect(SETTINGS_IMPACT_GROUPS.inputRuntime).toContain("midiin_device");
    expect(SETTINGS_IMPACT_GROUPS.inputRuntime).toContain("midiin_controller_override");
    expect(SETTINGS_IMPACT_GROUPS.inputRuntime).toContain("midiin_central_degree");
    expect(SETTINGS_IMPACT_GROUPS.inputRuntime).toContain("midi_passthrough");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_device");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_controller_override");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("controller_anchor_note");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midi_passthrough");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("midiin_central_degree");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("axis49_center_note");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("tonalplexus_input_mode");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("lumatone_center_channel");
    expect(SETTINGS_IMPACT_GROUPS.keysReconstruction).not.toContain("lumatone_center_note");
  });

  it("snapshots only the requested group fields plus explicit extras", () => {
    const snapshot = settingsImpactSnapshot(
      {
        scale: ["1/1", "3/2"],
        key_labels: "heji",
        note_colors: ["#ffffff"],
        rSteps: 5,
      },
      "keysReconstruction",
      { midiTick: 2 },
    );
    expect(snapshot.scale).toEqual(["1/1", "3/2"]);
    expect(snapshot.rSteps).toBe(5);
    expect(snapshot.midiTick).toBe(2);
    expect(snapshot).not.toHaveProperty("key_labels");
    expect(snapshot).not.toHaveProperty("note_colors");
    expect(snapshot).not.toHaveProperty("midiin_device");
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
