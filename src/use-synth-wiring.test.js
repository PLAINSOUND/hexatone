import { describe, it, expect } from "vitest";
import {
  deriveOutputRuntime,
  deriveTuningRuntime,
  resolveOctaveShortcutAction,
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
