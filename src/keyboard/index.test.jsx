import { render, fireEvent, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useRef, useState } from "preact/hooks";
import Keyboard from "./index.js";
import Keys from "./keys.js";
import Colors from "../settings/scale/colors.js";
import useSettingsChange from "../use-settings-change.js";
import { normalizeColors } from "../normalize-settings.js";

vi.mock("./keyboard.css", () => ({}));

const keysState = vi.hoisted(() => ({
  instances: [],
}));

vi.mock("./keys.js", () => {
  class MockKeys {
    constructor(canvas, settings) {
      this.initialSettings = settings;
      this.updateInputRuntime = vi.fn();
      this.updateLiveOutputState = vi.fn();
      this.updateColors = vi.fn();
      this.scheduleImmediateGridRedraw = vi.fn();
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
  liveInputSettings: { midiin_device: "OFF", midiin_bend_range: "28/27" },
  liveOutputSettings: { output_sample: false, midi_device: "OFF" },
  colorSettings: {
    note_colors: ["#ffffff"],
    spectrum_colors: false,
    fundamental_color: "#ffffff",
  },
  inputRuntime: { bendRange: "28/27", wheelSemitones: 2 },
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

  it("constructs Keys with normalized color settings on first mount", () => {
    render(
      <Keyboard
        {...baseProps}
        settings={{ ...baseProps.settings, spectrum_colors: true }}
        colorSettings={{
          note_colors: ["#95c69b"],
          spectrum_colors: false,
          fundamental_color: "#000000",
        }}
      />,
    );

    expect(keysState.instances[0].initialSettings.spectrum_colors).toBe(false);
    expect(keysState.instances[0].initialSettings.note_colors).toEqual(["#95c69b"]);
    expect(keysState.instances[0].initialSettings.fundamental_color).toBe("#000000");
  });

  it("repaints the keyboard when Spectrum is selected from the color mode selector", async () => {
    const Harness = () => {
      const [settings, setSettings] = useState({
        ...baseSettings,
        spectrum_colors: false,
        auto_colors: false,
        fundamental_color: "#ffdbe8",
        note_colors: ["#ffffff", "#eeeeee", "#dddddd"],
        scale: ["100.", "200.", "1200."],
        note_names: ["A", "B", "C"],
        key_labels: "no_labels",
      });
      const keysRef = useRef(null);
      const { onChange, onAtomicChange } = useSettingsChange(settings, setSettings, {
        midi: null,
        setMidiLearnActive: vi.fn(),
        setHakenPedalLearnActive: vi.fn(),
        keysRef,
        setLatch: vi.fn(),
        bumpImportCount: vi.fn(),
        onUserScaleEdit: vi.fn(),
      });
      const colorSettings = normalizeColors(settings);
      return (
        <>
          <Keyboard
            {...baseProps}
            settings={baseSettings}
            colorSettings={colorSettings}
            onKeysReady={(keys) => {
              keysRef.current = keys;
            }}
          />
          <Colors
            settings={{ ...settings, ...colorSettings }}
            rawSettings={settings}
            onChange={onChange}
            onAtomicChange={onAtomicChange}
          />
        </>
      );
    };

    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "spectrum" } });

    await waitFor(() => {
      expect(keysState.instances[0].updateColors).toHaveBeenCalled();
    });

    expect(keysState.instances[0].updateColors.mock.calls.at(-1)[0]).toMatchObject({
      spectrum_colors: true,
      fundamental_color: "ffdbe8",
    });
    expect(keysState.instances[0].resizeHandler).toHaveBeenCalled();
    expect(keysState.instances[0].scheduleImmediateGridRedraw).toHaveBeenCalled();
  });
});
