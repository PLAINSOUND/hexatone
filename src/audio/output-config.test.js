// Construction identity must track pitch/connection changes, not live controls.
import { describe, expect, it } from "vitest";
import { monoOutputConfig, sampleOutputConfig, oscOutputConfig, mpeOutputConfig,
  mtsOutputConfig } from "./output-config.js";
import { createOutputPortIdentity } from "./output-port-identity.js";

const settings = { fundamental: 440, instrument: "A", midiin_anchor_note: 60 };
const tuning = { referenceDegree: 1, centerDegree: 0, scale: ["3/2", "2/1"],
  equivSteps: 2, equivInterval: 1200 };

describe("output construction plans", () => {
  it("uses the sample constructor arguments as its identity", () => {
    const plan = sampleOutputConfig(settings, tuning);
    expect(JSON.parse(plan.key)).toEqual(plan.args);
    expect(sampleOutputConfig({ ...settings, instrument: "B" }, tuning).key).not.toBe(plan.key);
    expect(sampleOutputConfig(settings, { ...tuning, referenceDegree: 0 }).key).not.toBe(plan.key);
  });

  it("keeps mono live controls out of identity and normalises defaults", () => {
    const port = {}, id = createOutputPortIdentity();
    const plan = monoOutputConfig(settings, tuning, port, id);
    const live = monoOutputConfig({ ...settings, mono_channel: 0, mono_bend_range: 2,
      midi_velocity: 72, mono_portamento: true, mono_portamento_time: 25, mono_slide_cc: 1 }, tuning, port, id);
    expect(live.key).toBe(plan.key);
    expect(live.args).toMatchObject({ portamento: true, time: 25, slideCc: 1 });
    expect(plan.args.referenceCents).toBeCloseTo(701.955, 3);
    expect(monoOutputConfig({ ...settings, mono_bend_range: 12 }, tuning, port, id).key).not.toBe(plan.key);
    expect(monoOutputConfig(settings, tuning, {}, id).key).not.toBe(plan.key);
    expect(monoOutputConfig(settings, { ...tuning, referenceDegree: 0 }, port, id).key).not.toBe(plan.key);
  });

  it("constructs OSC with current controls without changing connection/pitch identity", () => {
    const plan = oscOutputConfig(settings, tuning);
    const controls = { volumes: [1, 0, 0, 1], quickRelease: 0.5, quickReleaseTime: 0.1,
      rasterOnly: true, sustain: true, retrigger: false };
    expect(plan.args(controls)).toEqual(["ws://localhost:8089", ["pluck", "string", "formant", "tone"],
      controls.volumes, 0.5, 0.1, true, 440, 1, tuning.scale, 1,
      { sustainBuzzFormant: true, retriggerBuzzFormant: false }]);
    expect(oscOutputConfig({ ...settings, osc_quick_release: 1 }, tuning).key).toBe(plan.key);
    expect(oscOutputConfig({ ...settings, osc_bridge_url: "ws://other" }, tuning).key).not.toBe(plan.key);
    expect(oscOutputConfig(settings, { ...tuning, scale: ["2/1"] }).key).not.toBe(plan.key);
  });

  it("preserves MPE argument order, Haken overrides and live expression flags", () => {
    const port = {}, id = createOutputPortIdentity();
    const config = { ...settings, midiin_mpe_manager_ch: 1, mpe_lo_ch: 2, mpe_hi_ch: 9, mpe_mode: "custom" };
    const plan = mpeOutputConfig(config, tuning, port, id, true);
    expect(plan.args).toEqual([port, 1, 2, 9, 440, 1, 0, 60, tuning.scale,
      "standard", 96, 2, 2, 1200, undefined, undefined, false, false]);
    expect(mpeOutputConfig({ ...config, mpe_plus_output: true, mpe_auto_generate_yz: true,
      mpe_pitchbend_range: 12 }, tuning, port, id, true).key).toBe(plan.key);
    expect(mpeOutputConfig(config, tuning, {}, id, true).key).not.toBe(plan.key);
    expect(mpeOutputConfig(config, { ...tuning, equivSteps: 3 }, port, id, true).key).not.toBe(plan.key);
    expect(mpeOutputConfig(config, tuning, port, id).key).not.toBe(plan.key);
  });

  it("keys MTS by effective mode and tuning, excluding dynamic callbacks", () => {
    const port = {}, id = createOutputPortIdentity();
    const mode = { output: port, transportMode: "bulk_dynamic_map", anchorNote: 64, pitchBendRange: 2 };
    const runtime = { fundamental: 440, scale: tuning.scale, degree0toRefAsArray: [3, 2], equivInterval: 1200, name: "A" };
    const callback = () => ({ mapNumber: 2 });
    const plan = mtsOutputConfig(settings, runtime, mode, id, callback);
    expect(plan.args.outputMode).toMatchObject({ anchorNote: 64, midiMapping: "MTS_BULK" });
    expect(plan.args.getDynamicBulkConfig).toBe(callback);
    expect(mtsOutputConfig({ ...settings, midiin_anchor_note: 70 }, runtime, mode, id, () => ({})).key).toBe(plan.key);
    expect(mtsOutputConfig(settings, { ...runtime, fundamental: 441 }, mode, id, callback).key).not.toBe(plan.key);
    expect(mtsOutputConfig(settings, runtime, { ...mode, pitchBendRange: 12 }, id, callback).key).not.toBe(plan.key);
    expect(mtsOutputConfig(settings, runtime, { ...mode, output: {} }, id, callback).key).not.toBe(plan.key);
    const single = mtsOutputConfig(settings, runtime, { ...mode, transportMode: "single", allocationMode: "mts2" }, id, callback);
    expect(single.args.outputMode).toMatchObject({ anchorNote: 60, midiMapping: "MTS2" });
    expect(single.args.getDynamicBulkConfig).toBeNull();
  });
});
