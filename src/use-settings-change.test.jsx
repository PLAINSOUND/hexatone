import { render } from "@testing-library/preact";
import { useEffect } from "preact/hooks";
import useSettingsChange, { resizeScaleWithEquavePadding } from "./use-settings-change.js";

const HookHarness = ({ settings, setSettings, midi, capture }) => {
  const handlers = useSettingsChange(settings, setSettings, {
    midi,
    setMidiLearnActive: vi.fn(),
    setHakenPedalLearnActive: vi.fn(),
    keysRef: { current: null },
    setLatch: vi.fn(),
    bumpImportCount: vi.fn(),
    onUserScaleEdit: vi.fn(),
  });

  useEffect(() => {
    capture(handlers);
  }, [handlers, capture]);

  return null;
};

describe("resizeScaleWithEquavePadding", () => {
  it("grows by repeating the current equave and padding names/colors from degree 0", () => {
    const settings = {
      scale: ["100.", "200.", "3/1"],
      note_names: ["C", "D", "E"],
      note_colors: ["#111111", "#222222", "#333333"],
    };

    expect(resizeScaleWithEquavePadding(settings, 5)).toEqual({
      scale: ["100.", "200.", "3/1", "3/1", "3/1"],
      note_names: ["C", "D", "E", "C", "C"],
      note_colors: ["#111111", "#222222", "#333333", "#111111", "#111111"],
    });
  });

  it("truncates scale, names, and colors when shrinking", () => {
    const settings = {
      scale: ["100.", "200.", "300.", "2/1"],
      note_names: ["C", "D", "E", "F"],
      note_colors: ["#111111", "#222222", "#333333", "#444444"],
    };

    expect(resizeScaleWithEquavePadding(settings, 2)).toEqual({
      scale: ["100.", "200."],
      note_names: ["C", "D"],
      note_colors: ["#111111", "#222222"],
    });
  });

  it("falls back to a default equave and root metadata when scale data is sparse", () => {
    const settings = {
      scale: [],
      note_names: [],
      note_colors: [],
    };

    expect(resizeScaleWithEquavePadding(settings, 3)).toEqual({
      scale: ["2/1", "2/1", "2/1"],
      note_names: ["", "", ""],
      note_colors: ["#ffffff", "#ffffff", "#ffffff"],
    });
  });
});

describe("useSettingsChange", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("clears the detected controller output-port override when switching back to Auto Detect", () => {
    const setSettings = vi.fn();
    let handlers = null;
    const capture = (value) => {
      handlers = value;
    };

    render(
      <HookHarness
        settings={{
          midiin_device: "input-1",
          midiin_controller_override: "hakenaudio",
          hakenaudio_out_port: "manual-port",
        }}
        setSettings={setSettings}
        midi={{
          inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
          outputs: new Map(),
        }}
        capture={capture}
      />,
    );

    sessionStorage.setItem("hakenaudio_out_port", "manual-port");

    handlers.onChange("midiin_controller_override", "auto");

    expect(setSettings).toHaveBeenCalledTimes(1);
    const nextSettings = setSettings.mock.calls[0][0]({
      midiin_device: "input-1",
      midiin_controller_override: "hakenaudio",
      hakenaudio_out_port: "manual-port",
    });
    expect(nextSettings.midiin_controller_override).toBe("auto");
    expect(nextSettings.hakenaudio_out_port).toBeNull();
    expect(sessionStorage.getItem("midiin_controller_override")).toBe("auto");
    expect(sessionStorage.getItem("hakenaudio_out_port")).toBeNull();
  });
});
