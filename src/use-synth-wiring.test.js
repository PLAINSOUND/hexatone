import { describe, it, expect } from "vitest";
import {
  deriveOutputRuntime,
  deriveOscVolumes,
  deriveTuningRuntime,
  resolveOctaveShortcutAction,
  resolveInputController,
} from "./use-synth-wiring.js";

const partchScale = [
  "81/80",
  "33/32",
  "21/20",
  "16/15",
  "12/11",
  "11/10",
  "10/9",
  "9/8",
  "8/7",
  "7/6",
  "32/27",
  "6/5",
  "11/9",
  "5/4",
  "14/11",
  "9/7",
  "21/16",
  "4/3",
  "27/20",
  "11/8",
  "7/5",
  "10/7",
  "16/11",
  "40/27",
  "3/2",
  "32/21",
  "14/9",
  "11/7",
  "8/5",
  "18/11",
  "5/3",
  "27/16",
  "12/7",
  "7/4",
  "16/9",
  "9/5",
  "20/11",
  "11/6",
  "15/8",
  "40/21",
  "64/33",
  "160/81",
  "2/1",
];

const makeSettings = (overrides = {}) => ({
  output_mts: false,
  output_direct: true,
  direct_device: "direct-1",
  direct_mode: "dynamic",
  direct_channel: 0,
  direct_device_id: 12,
  direct_tuning_map_number: 5,
  midi_velocity: 72,
  fundamental: 220.5,
  reference_degree: 0,
  center_degree: 18,
  scale: partchScale,
  name: "Partch test",
  ...overrides,
});

const makeMidi = () => {
  const output = { id: "direct-1", name: "Direct Out" };
  return {
    outputs: new Map([[output.id, output]]),
  };
};

describe("use-synth-wiring runtime derivation", () => {
  it("derives committed cents from the workspace-backed tuning runtime", () => {
    const tuningRuntime = deriveTuningRuntime({
      scale: ["9/8", "5/4", "7\\12", "2/1"],
      reference_degree: 1,
      fundamental: 440,
      name: "Mixed interval test",
    });

    expect(tuningRuntime.scale).toEqual([
      0,
      expect.closeTo(203.91000173077484, 10),
      expect.closeTo(386.3137138648348, 10),
      700,
    ]);
    expect(tuningRuntime.equivInterval).toBeCloseTo(1200, 10);
    expect(tuningRuntime.degree0toRefAsArray[0]).toBeCloseTo(203.91000173077484, 10);
    expect(tuningRuntime.name).toBe("Mixed interval test");
    expect(tuningRuntime.fundamental).toBe(440);
  });

  it("derives the centered static bulk-dump anchor for the Partch preset", () => {
    const settings = makeSettings({ direct_mode: "static" });
    const tuningRuntime = deriveTuningRuntime(settings);
    const { outputs } = deriveOutputRuntime(settings, makeMidi(), tuningRuntime);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].transportMode).toBe("bulk_static_map");
    expect(outputs[0].anchorNote).toBe(44);
    expect(outputs[0].mapNumber).toBe(5);
    expect(outputs[0].deviceId).toBe(12);
  });

  it("derives dynamic bulk-dump mode separately from static mode", () => {
    const settings = makeSettings({ direct_mode: "dynamic" });
    const tuningRuntime = deriveTuningRuntime(settings);
    const { outputs } = deriveOutputRuntime(settings, makeMidi(), tuningRuntime);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].transportMode).toBe("bulk_dynamic_map");
    expect(outputs[0].allocationMode).toBe("mts1");
    expect(outputs[0].mapNumber).toBe(5);
    expect(outputs[0].deviceId).toBe(12);
  });

  it("derives persisted OSC layer volumes from local storage for fresh note-ons after refresh", () => {
    localStorage.setItem("osc_volume_pluck", "0.11");
    localStorage.setItem("osc_volume_buzz", "0.22");
    localStorage.setItem("osc_volume_formant", "0.33");
    localStorage.setItem("osc_volume_saw", "0.44");

    expect(
      deriveOscVolumes({
        osc_volume_pluck: 0.5,
        osc_volume_buzz: 0.5,
        osc_volume_formant: 0.5,
        osc_volume_saw: 0.5,
      }),
    ).toEqual([0.11, 0.22, 0.33, 0.44]);

    localStorage.removeItem("osc_volume_pluck");
    localStorage.removeItem("osc_volume_buzz");
    localStorage.removeItem("osc_volume_formant");
    localStorage.removeItem("osc_volume_saw");
  });
});

describe("use-synth-wiring octave shortcuts", () => {
  it("maps up/down arrows to octave shifts", () => {
    expect(resolveOctaveShortcutAction({ code: "ArrowUp" }, false)).toEqual({
      type: "shift",
      dir: 1,
    });
    expect(resolveOctaveShortcutAction({ code: "ArrowDown" }, false)).toEqual({
      type: "shift",
      dir: -1,
    });
  });

  it("maps left/right arrows to deferred/immediate OCT mode", () => {
    expect(resolveOctaveShortcutAction({ code: "ArrowLeft" }, false)).toEqual({
      type: "mode",
      deferred: true,
    });
    expect(resolveOctaveShortcutAction({ code: "ArrowRight" }, false)).toEqual({
      type: "mode",
      deferred: false,
    });
  });

  it("ignores octave shortcuts while typing or using modified/browser shortcuts", () => {
    expect(resolveOctaveShortcutAction({ code: "ArrowUp" }, true)).toBeNull();
    expect(resolveOctaveShortcutAction({ code: "ArrowUp", ctrlKey: true }, false)).toBeNull();
    expect(resolveOctaveShortcutAction({ code: "ArrowRight", metaKey: true }, false)).toBeNull();
    expect(resolveOctaveShortcutAction({ code: "ArrowLeft", altKey: true }, false)).toBeNull();
    expect(resolveOctaveShortcutAction({ code: "ArrowDown", repeat: true }, false)).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(resolveOctaveShortcutAction({ code: "KeyA" }, false)).toBeNull();
  });
});

describe("use-synth-wiring controller resolution", () => {
  it("falls back unknown inputs to the Generic keyboard controller", () => {
    const ctrl = resolveInputController({ name: "KORG microKEY-37" });
    expect(ctrl?.id).toBe("generic");
    expect(ctrl?.anchorDefault).toBe(60);
  });

  it("keeps known controllers on their dedicated registry entries", () => {
    const ctrl = resolveInputController({ name: "Lumatone" });
    expect(ctrl?.id).toBe("lumatone");
  });

  it("honors manual controller override before port-name detection", () => {
    const ctrl = resolveInputController({ name: "USB MIDI Interface" }, "tonalplexus");
    expect(ctrl?.id).toBe("tonalplexus");
  });

  it("falls back override typos to the Generic keyboard controller", () => {
    const ctrl = resolveInputController({ name: "USB MIDI Interface" }, "not-a-controller");
    expect(ctrl?.id).toBe("generic");
  });
});
