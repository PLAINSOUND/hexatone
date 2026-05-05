import { describe, it, expect } from "vitest";
import {
  deriveOutputRuntime,
  deriveOscVolumes,
  deriveTuningRuntime,
  resolveOctaveShortcutAction,
  resolveBidirectionalControllerOutputPort,
  resolveControllerPrefsTarget,
  resolveInputController,
  resolveLumatoneOutputPort,
} from "./use-synth-wiring.js";
import { getControllerById } from "./controllers/registry.js";

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
  output_mts_bulk: true,
  mts_bulk_device: "direct-1",
  mts_bulk_mode: "dynamic",
  mts_bulk_channel: 0,
  mts_bulk_device_id: 12,
  mts_bulk_tuning_map_number: 5,
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
    const settings = makeSettings({ mts_bulk_mode: "static" });
    const tuningRuntime = deriveTuningRuntime(settings);
    const { outputs } = deriveOutputRuntime(settings, makeMidi(), tuningRuntime);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].transportMode).toBe("bulk_static_map");
    expect(outputs[0].anchorNote).toBe(44);
    expect(outputs[0].mapNumber).toBe(5);
    expect(outputs[0].deviceId).toBe(12);
  });

  it("derives dynamic bulk-dump mode separately from static mode", () => {
    const settings = makeSettings({ mts_bulk_mode: "dynamic" });
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

  it("does not treat unknown auto-detected inputs as a known controller prefs target", () => {
    const ctrl = resolveControllerPrefsTarget({ name: "KORG microKEY-37" });
    expect(ctrl).toBeNull();
  });

  it("keeps known controllers on their dedicated registry entries", () => {
    const ctrl = resolveInputController({ name: "Lumatone" });
    expect(ctrl?.id).toBe("lumatone");
  });

  it("detects Haken Continuum inputs as the dedicated Haken controller entry", () => {
    const ctrl = resolveInputController({ name: "Haken Audio Continuum" });
    expect(ctrl?.id).toBe("hakenaudio");
    expect(ctrl?.mpe).toBe(true);
  });

  it("honors manual controller override before port-name detection", () => {
    const ctrl = resolveInputController({ name: "USB MIDI Interface" }, "tonalplexus");
    expect(ctrl?.id).toBe("tonalplexus");
  });

  it("falls back override typos to the Generic keyboard controller", () => {
    const ctrl = resolveInputController({ name: "USB MIDI Interface" }, "not-a-controller");
    expect(ctrl?.id).toBe("generic");
  });

  it("prefers the Lumatone MIDI Function output when resolving raw LED ports", () => {
    const outputs = new Map([
      ["lumatone-main", { id: "lumatone-main", name: "Lumatone Port 1" }],
      ["midi-function", { id: "midi-function", name: "MIDI Function" }],
    ]);

    expect(
      resolveLumatoneOutputPort(outputs, { name: "MIDI Function" })?.id,
    ).toBe("midi-function");
  });

  it("honors a manual Lumatone output override before MIDI Function preference", () => {
    const outputs = new Map([
      ["lumatone-main", { id: "lumatone-main", name: "Lumatone Port 1" }],
      ["midi-function", { id: "midi-function", name: "MIDI Function" }],
    ]);

    expect(
      resolveLumatoneOutputPort(outputs, { name: "MIDI Function" }, "lumatone-main")?.id,
    ).toBe("lumatone-main");
  });

  it("prefers the Exquis output with the closest name to the selected input", () => {
    const outputs = new Map([
      ["exquis-other", { id: "exquis-other", name: "Intuitive Instruments Exquis Port 2" }],
      ["exquis-main", { id: "exquis-main", name: "Intuitive Instruments Exquis Port 1" }],
    ]);

    expect(
      resolveBidirectionalControllerOutputPort(
        outputs,
        { name: "Intuitive Instruments Exquis Port 1" },
        getControllerById("exquis"),
      )?.id,
    ).toBe("exquis-main");
  });

  it("falls back to auto-detect when a saved controller output override is missing", () => {
    const outputs = new Map([
      ["lumatone-main", { id: "lumatone-main", name: "Lumatone" }],
      ["midi-function", { id: "midi-function", name: "MIDI Function" }],
    ]);

    expect(
      resolveBidirectionalControllerOutputPort(
        outputs,
        { name: "Lumatone" },
        getControllerById("lumatone"),
        "missing-port-id",
      )?.id,
    ).toBe("midi-function");
  });

  it("prefers the LinnStrument output with the closest name to the selected input", () => {
    const outputs = new Map([
      ["linn-200", { id: "linn-200", name: "Roger Linn Design LinnStrument 200" }],
      ["linn-128", { id: "linn-128", name: "Roger Linn Design LinnStrument 128" }],
    ]);

    expect(
      resolveBidirectionalControllerOutputPort(
        outputs,
        { name: "Roger Linn Design LinnStrument 128" },
        getControllerById("linnstrument"),
      )?.id,
    ).toBe("linn-128");
  });
});
