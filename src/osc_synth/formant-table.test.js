import { describe, expect, it } from "vitest";
import {
  FORMANT_PRESETS,
  formantPresetToOscArgs,
  pickFormantPreset,
  pickRandomFormantPreset,
} from "./formant-table.js";

describe("osc_synth formant table", () => {
  it("packs a formant preset into ff/fr/fa OSC args", () => {
    const preset = pickFormantPreset(0);
    const args = formantPresetToOscArgs(preset);
    expect(args).toHaveLength(30);
    expect(args.slice(0, 6)).toEqual([
      { type: "s", value: "ff0" },
      { type: "f", value: preset.freq[0] },
      { type: "s", value: "fr0" },
      { type: "f", value: preset.reso[0] },
      { type: "s", value: "fa0" },
      { type: "f", value: preset.amp[0] },
    ]);
    expect(args.slice(-6)).toEqual([
      { type: "s", value: "ff4" },
      { type: "f", value: preset.freq[4] },
      { type: "s", value: "fr4" },
      { type: "f", value: preset.reso[4] },
      { type: "s", value: "fa4" },
      { type: "f", value: preset.amp[4] },
    ]);
  });

  it("selects random presets from the defined bank", () => {
    const preset = pickRandomFormantPreset(() => 0.5);
    expect(FORMANT_PRESETS).toContain(preset);
  });
});
