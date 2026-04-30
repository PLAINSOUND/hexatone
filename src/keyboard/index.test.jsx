import { render } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import Keyboard from "./index.js";
import Keys from "./keys.js";

const keysState = vi.hoisted(() => ({
  instances: [],
}));

vi.mock("./keys.js", () => {
  class MockKeys {
    constructor() {
      this.updateInputRuntime = vi.fn();
      this.updateLiveOutputState = vi.fn();
      this.updateColors = vi.fn();
      this.updateLabels = vi.fn();
      this.resizeHandler = vi.fn();
      this.releaseAllKeyboardNotes = vi.fn();
      this.setMidiLearnMode = vi.fn();
      this.getModulationState = vi.fn(() => null);
      this.deconstruct = vi.fn();
      keysState.instances.push(this);
    }
  }
  return { default: MockKeys };
});

const baseSettings = {
  rSteps: 1,
  drSteps: 5,
  hexSize: 60,
  rotation: 0,
  center_degree: 0,
  scale: [0, 100, 1200],
  equivSteps: 3,
  reference_degree: 0,
  fundamental: 440,
  key_labels: "no_labels",
  no_labels: true,
  note_colors: ["#ffffff"],
  spectrum_colors: false,
  fundamental_color: "#ffffff",
};

const baseProps = {
  settings: baseSettings,
  tuningRuntime: null,
  reconstructionKey: "rebuild-a",
  liveInputSettings: { midiin_device: "OFF", midiin_bend_range: "64/63" },
  liveOutputSettings: { output_sample: false, midi_device: "OFF" },
  colorSettings: {
    note_colors: ["#ffffff"],
    spectrum_colors: false,
    fundamental_color: "#ffffff",
  },
  inputRuntime: { bendRange: "64/63", wheelSemitones: 2 },
  labelSettings: { key_labels: "no_labels", no_labels: true },
  synth: {},
  active: true,
  midiLearnActive: false,
};

describe("Keyboard settings-impact boundary", () => {
  beforeEach(() => {
    keysState.instances.length = 0;
    Keys.mockClear?.();
  });

  it("updates live input runtime without reconstructing Keys", () => {
    const { rerender } = render(<Keyboard {...baseProps} />);
    const keys = keysState.instances[0];

    rerender(
      <Keyboard
        {...baseProps}
        inputRuntime={{ bendRange: "9/8", wheelSemitones: 12 }}
        liveInputSettings={{ midiin_device: "OFF", midiin_bend_range: "9/8" }}
      />,
    );

    expect(keysState.instances).toHaveLength(1);
    expect(keys.updateInputRuntime).toHaveBeenLastCalledWith(
      { bendRange: "9/8", wheelSemitones: 12 },
      { midiin_device: "OFF", midiin_bend_range: "9/8" },
    );
  });

  it("reconstructs Keys only when reconstructionKey changes", () => {
    const { rerender } = render(<Keyboard {...baseProps} />);
    const first = keysState.instances[0];

    rerender(<Keyboard {...baseProps} colorSettings={{ ...baseProps.colorSettings, fundamental_color: "#000000" }} />);
    expect(keysState.instances).toHaveLength(1);
    expect(first.updateColors).toHaveBeenLastCalledWith({
      note_colors: ["#ffffff"],
      spectrum_colors: false,
      fundamental_color: "#000000",
    });

    rerender(<Keyboard {...baseProps} reconstructionKey="rebuild-b" />);
    expect(first.deconstruct).toHaveBeenCalledTimes(1);
    expect(keysState.instances).toHaveLength(2);
  });
});
