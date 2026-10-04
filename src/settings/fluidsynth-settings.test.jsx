import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";

const fluidsynthMock = vi.hoisted(() => ({ engine: null, load: vi.fn(), listeners: new Set() }));
vi.mock("../fluidsynth_synth/index.js", () => ({
  loadFluidSynthSoundFont: fluidsynthMock.load,
  peekFluidSynthEngine: () => fluidsynthMock.engine,
  subscribeFluidSynthEngine: (listener) => {
    fluidsynthMock.listeners.add(listener);
    return () => fluidsynthMock.listeners.delete(listener);
  },
}));

import FluidSynthSettings from "./fluidsynth-settings.jsx";

describe("FluidSynth settings", () => {
  it("remembers the last hosted bank after refresh and loads it without reselection", async () => {
    localStorage.setItem("fluidsynth_last_hosted_soundfont", "PlainsoundOrganGedackt.sf2");
    fluidsynthMock.load.mockResolvedValue({ presets: [{ bank: 0, program: 0 }] });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const menu = screen.getByLabelText("Hexatone FluidSynth SoundFont");
    expect(menu.value).toBe("PlainsoundOrganGedackt.sf2");
    expect(menu.style.color).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalled());
    expect(fluidsynthMock.load.mock.calls[0][0].name).toBe("PlainsoundOrganGedackt.sf2");
  });
  it("aborts a hosted download when Choose Local File is clicked without disabling playback", async () => {
    let signal;
    fluidsynthMock.load.mockImplementation((_source, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () =>
        reject(new DOMException("Cancelled", "AbortError"))));
    });
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Hexatone FluidSynth SoundFont"), {
      target: { value: "PlainsoundOrganGedackt.sf2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));
    await vi.waitFor(() => expect(signal).toBeTruthy());
    const button = screen.getByRole("button", { name: "Choose Local File" });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(signal.aborted).toBe(true);
    await vi.waitFor(() => expect(screen.getByText("Download cancelled.")).toBeTruthy());
    expect(onChange).not.toHaveBeenCalledWith("output_fluidsynth", false);
    expect(screen.getByLabelText("FluidSynth SoundFont").disabled).toBe(false);
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fluidsynthMock.engine = null;
    fluidsynthMock.load.mockReset();
    fluidsynthMock.listeners.clear();
  });

  it("hides all SoundFont controls while disabled and reveals them when enabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FluidSynthSettings settings={{}} onChange={onChange} />);

    expect(screen.queryByLabelText("Hexatone FluidSynth SoundFont")).toBeNull();
    expect(screen.queryByLabelText("FluidSynth SoundFont")).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose Local File" })).toBeNull();
    expect(screen.queryByLabelText("FluidSynth preset")).toBeNull();
    expect(screen.queryByRole("slider", { name: "FluidSynth volume" })).toBeNull();
    expect(screen.getByLabelText("Use FluidSynth output").checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Use FluidSynth output"));
    expect(onChange).toHaveBeenCalledWith("output_fluidsynth", true);

    rerender(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    expect(screen.getByLabelText("Hexatone FluidSynth SoundFont")).toBeTruthy();
    expect(screen.getByRole("option", { name: "PlainsoundOrgan.sf2" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "PlainsoundHarpsichord.sf2" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "PlainsoundOrganGedackt.sf2" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "PlainsoundHarpsichordLute.sf2" })).toBeTruthy();
    expect(screen.getByLabelText("FluidSynth SoundFont").disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Load Hexatone SoundFont" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Choose Local File" })).toBeTruthy();
    expect(screen.getByLabelText("FluidSynth preset").disabled).toBe(true);
    expect(
      screen.getByRole("slider", { name: "FluidSynth volume" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("enables preset, output, and volume controls once a bank is loaded", () => {
    const selectPreset = vi.fn();
    const setVolume = vi.fn();
    fluidsynthMock.engine = {
      soundfontId: 1,
      presets: [
        { name: "Gedackt", bank: 0, program: 0 },
        { name: "Principal", bank: 0, program: 1 },
      ],
      selectPreset,
      setVolume,
    };
    const onChange = vi.fn();
    render(
      <FluidSynthSettings
        settings={{ output_fluidsynth: true, fluidsynth_preset: "0:0" }}
        onChange={onChange}
      />,
    );

    const preset = screen.getByLabelText("FluidSynth preset");
    expect(preset.disabled).toBe(false);
    fireEvent.change(preset, { target: { value: "0:1" } });
    expect(selectPreset).toHaveBeenCalledWith({ name: "Principal", bank: 0, program: 1 });
    expect(onChange).toHaveBeenCalledWith("fluidsynth_preset", "0:1");

    fireEvent.keyDown(screen.getByRole("slider", { name: "FluidSynth volume" }), {
      key: "ArrowRight",
    });
    expect(setVolume).toHaveBeenCalledWith(101);
    expect(localStorage.getItem("fluidsynth_internal_volume")).toBe("101");
    expect(screen.getByLabelText("FluidSynth SoundFont").disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Load Hexatone SoundFont" })).toBeTruthy();
  });

  it("restores the hosted SoundFont selection from the active engine", () => {
    fluidsynthMock.engine = {
      soundfontId: 1,
      presets: [{ name: "Organ", bank: 0, program: 0 }],
      soundfontSource: { name: "PlainsoundOrgan.sf2" },
    };

    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Hexatone FluidSynth SoundFont").value).toBe(
      "PlainsoundOrgan.sf2",
    );
    expect(screen.getByText("Loaded: PlainsoundOrgan.sf2")).toBeTruthy();
  });

  it("refreshes the preset controls when a recovered worklet reloads its SoundFont", async () => {
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    expect(screen.getByLabelText("FluidSynth preset").disabled).toBe(true);

    fluidsynthMock.engine = {
      soundfontId: 1,
      presets: [{ name: "Organ", bank: 0, program: 0 }],
      soundfontSource: { name: "Organ.sf2" },
    };
    fluidsynthMock.listeners.forEach((listener) => listener(fluidsynthMock.engine));

    await vi.waitFor(() => expect(screen.getByLabelText("FluidSynth preset").disabled).toBe(false));
    expect(screen.getByText("Loaded: Organ.sf2")).toBeTruthy();
  });

  it("shows the hosted URL and percentage while downloading", () => {
    let finishLoading;
    fluidsynthMock.load.mockImplementation(
      () => new Promise((resolve) => (finishLoading = resolve)),
    );
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Hexatone FluidSynth SoundFont"), {
      target: { value: "PlainsoundOrgan.sf2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));

    const url = "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2";
    expect(screen.getByRole("link", { name: url }).getAttribute("href")).toBe(url);
    expect(screen.getByText("0%"));
    finishLoading({ presets: [] });
  });

  it("does not automatically enable output when loading a SoundFont", async () => {
    const setVolume = vi.fn();
    fluidsynthMock.engine = { soundfontId: null, presets: [], setVolume };
    fluidsynthMock.load.mockResolvedValue({
      presets: [{ name: "Organ", bank: 0, program: 0 }],
    });
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    const file = new File([new Uint8Array([1, 2, 3])], "Organ.sf2");
    fireEvent.change(screen.getByLabelText("FluidSynth SoundFont"), {
      target: { files: [file] },
    });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith("fluidsynth_preset", "0:0"));
    expect(onChange).not.toHaveBeenCalledWith("output_fluidsynth", true);
  });
});
