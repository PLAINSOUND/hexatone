import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";

const fluidsynthMock = vi.hoisted(() => ({ engine: null, load: vi.fn(), listeners: new Set() }));
const storageMock = vi.hoisted(() => ({ read: vi.fn(), store: vi.fn(), keep: vi.fn(), remove: vi.fn(), save: vi.fn() }));
vi.mock("../fluidsynth_synth/soundfont-storage.js", () => ({
  soundfontStorageKey: (source) => source.url || `local:${source.name}`,
  readOfflineSoundfont: storageMock.read,
  readWorkingSoundfont: storageMock.read,
  keepWorkingSoundfont: storageMock.keep,
  storeOfflineSoundfont: storageMock.store,
  removeOfflineSoundfont: storageMock.remove,
  saveSoundfontFile: storageMock.save,
}));
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
  afterEach(() => vi.unstubAllGlobals());
  it("cancels a hosted download from the load button and ignores its late completion", async () => {
    let signal;
    let finish;
    fluidsynthMock.load.mockImplementation((source, options) => {
      void source.arrayBuffer().catch(() => {});
      signal = options.signal;
      return new Promise((resolve) => { finish = resolve; });
    });
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Hexatone FluidSynth SoundFont"), {
      target: { value: "PlainsoundOrganGedackt.sf2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));
    const cancel = await screen.findByRole("button", { name: "Cancel Download" });
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);
    expect(signal.aborted).toBe(true);
    expect(screen.getByText("Download cancelled.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load Hexatone SoundFont" }).disabled).toBe(false);
    finish({ presets: [{ bank: 0, program: 0 }] });
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });
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
    fluidsynthMock.load.mockImplementation((source, options) => {
      void source.arrayBuffer().catch(() => {});
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
    await screen.findByRole("button", { name: "Cancel Download" });
    const button = screen.getByRole("button", { name: "Choose Local File" });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(signal.aborted).toBe(true);
    await vi.waitFor(() => expect(screen.getByText("Download cancelled.")).toBeTruthy());
    expect(onChange).not.toHaveBeenCalledWith("output_fluidsynth", false);
    expect(screen.getByLabelText("FluidSynth SoundFont").disabled).toBe(false);
  });
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    })));
    localStorage.clear();
    sessionStorage.clear();
    fluidsynthMock.engine = null;
    fluidsynthMock.load.mockReset();
    fluidsynthMock.listeners.clear();
    storageMock.read.mockReset().mockResolvedValue(null);
    storageMock.store.mockReset().mockResolvedValue(undefined);
    storageMock.keep.mockReset().mockResolvedValue(undefined);
    storageMock.remove.mockReset().mockResolvedValue(undefined);
    storageMock.save.mockReset();
  });

  it("shows file controls only for loaded banks and removes offline copies without changing playback", async () => {
    const source = { name: "PlainsoundOrgan.sf2", url: "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2" };
    const blob = new Blob(["bank"]);
    storageMock.read.mockResolvedValue({ blob });
    fluidsynthMock.engine = { soundfontId: 1, presets: [{ bank: 0, program: 0 }], soundfontSource: source };
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Remove Offline Copy" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save SoundFont File…" }));
    await vi.waitFor(() => expect(storageMock.save).toHaveBeenCalledWith(source.name, blob));
    fireEvent.click(screen.getByRole("button", { name: "Remove Offline Copy" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Keep for Offline Use" })).toBeTruthy());
    expect(storageMock.remove).toHaveBeenCalledWith(source.url);
    expect(screen.queryByText("Available offline in this browser.")).toBeNull();
    expect(screen.queryByText(/Offline copy removed/)).toBeNull();
    storageMock.save.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Save SoundFont File…" }));
    await vi.waitFor(() => expect(storageMock.save).toHaveBeenCalledWith(source.name, blob));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Keep for Offline Use" }).disabled).toBe(false));
    let finishRestore;
    source.arrayBuffer = vi.fn();
    storageMock.keep.mockImplementation(() => new Promise((resolve) => {
      finishRestore = resolve;
    }));
    fireEvent.click(screen.getByRole("button", { name: "Keep for Offline Use" }));
    expect(screen.getByRole("button", { name: "Saving offline…" }).disabled).toBe(true);
    finishRestore();
    await vi.waitFor(() => expect(screen.getByText("Available offline in this browser.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Remove Offline Copy" })).toBeTruthy();
    expect(source.arrayBuffer).not.toHaveBeenCalled();
    expect(storageMock.keep).toHaveBeenCalledWith(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reads the hosted offline copy before attempting any network download", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    storageMock.read.mockResolvedValue({ blob: { size: 3, arrayBuffer: () => Promise.resolve(bytes) } });
    fluidsynthMock.load.mockImplementation(async (source, options) => {
      expect(await source.arrayBuffer()).toBe(bytes);
      await options.onBytesReady(source, bytes);
      return { presets: [] };
    });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Hexatone FluidSynth SoundFont"), {
      target: { value: "PlainsoundOrgan.sf2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));
    await vi.waitFor(() => expect(storageMock.store).toHaveBeenCalled());
    expect(storageMock.read).toHaveBeenCalledWith("https://soundfonts.plainsound.org/PlainsoundOrgan.sf2");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks offline availability on reload and follows the selected menu bank", async () => {
    localStorage.setItem("fluidsynth_last_hosted_soundfont", "PlainsoundOrgan.sf2");
    storageMock.read.mockImplementation((key) => Promise.resolve(key.endsWith("PlainsoundOrgan.sf2") ? { blob: new Blob([1]) } : null));
    render(<FluidSynthSettings settings={{ output_fluidsynth: true, fluidsynth_preset: "0:99" }} onChange={vi.fn()} />);
    await screen.findByText("Available offline in this browser.");
    const availability = screen.getByText("Available offline in this browser.");
    expect(availability.tagName).toBe("SPAN");
    expect(availability.parentElement.classList.contains("fluidsynth-settings__load-row")).toBe(true);
    expect(screen.getByText("Available offline in this browser.").parentElement.classList.contains("fluidsynth-settings__load-row")).toBe(true);
    expect(screen.getByLabelText("FluidSynth preset").value).toBe("");
    expect(screen.getByLabelText("FluidSynth preset").disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Hexatone FluidSynth SoundFont"), { target: { value: "PlainsoundSrutibox.sf2" } });
    expect(screen.queryByText("Available offline in this browser.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Offline Copy" })).toBeNull();
  });

  it("keeps the same offline row mounted while checking a newly selected cached bank", async () => {
    let finishCheck;
    const cached = { blob: new Blob([1]) };
    storageMock.read.mockImplementation((key) => key.endsWith("PlainsoundSrutibox.sf2")
      ? new Promise((resolve) => { finishCheck = resolve; }) : Promise.resolve(cached));
    fluidsynthMock.engine = {
      soundfontId: 1,
      soundfontSource: { name: "PlainsoundOrgan.sf2", url: "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2" },
      presets: [{ bank: 0, program: 0, name: "Organ" }],
    };
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const row = (await screen.findByText("Available offline in this browser.")).parentElement;
    const buttons = [...row.querySelectorAll("button")];
    fireEvent.change(screen.getByLabelText("Hexatone FluidSynth SoundFont"), {
      target: { value: "PlainsoundSrutibox.sf2" },
    });
    expect(row.isConnected).toBe(true);
    expect(row.getAttribute("aria-hidden")).toBe("true");
    expect([...row.querySelectorAll("button")]).toEqual(buttons);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(screen.queryByRole("button", { name: "Remove Offline Copy" })).toBeNull();
    await vi.waitFor(() => expect(finishCheck).toBeTypeOf("function"));
    finishCheck(cached);
    await vi.waitFor(() => expect(row.getAttribute("aria-hidden")).toBeNull());
    expect(screen.getByText("Available offline in this browser.").parentElement).toBe(row);
    expect([...row.querySelectorAll("button")]).toEqual(buttons);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not show stale presets or storage actions for a newly selected bank", () => {
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "PlainsoundOrgan.sf2" },
      presets: [{ bank: 0, program: 3, name: "Old preset" }], selectedPreset: { bank: 0, program: 3 } };
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    expect(screen.getByLabelText("FluidSynth preset").value).toBe("0:3");
    fireEvent.change(screen.getByLabelText("Hexatone FluidSynth SoundFont"), { target: { value: "PlainsoundSrutibox.sf2" } });
    expect(screen.getByLabelText("FluidSynth preset").disabled).toBe(true);
    expect(screen.queryByRole("option", { name: /Old preset/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save SoundFont File…" })).toBeNull();
    expect(screen.getByText("Loaded: PlainsoundOrgan.sf2")).toBeTruthy();
  });

  it("loads offline silently while keeping installation controls disabled", async () => {
    let finish;
    let options;
    const bytes = new Uint8Array([1]).buffer;
    storageMock.read.mockResolvedValue({ blob: { size: 1, arrayBuffer: async () => bytes } });
    fluidsynthMock.load.mockImplementation(async (source, nextOptions) => {
      options = nextOptions;
      await source.arrayBuffer();
      return new Promise((resolve) => { finish = resolve; });
    });
    localStorage.setItem("fluidsynth_last_hosted_soundfont", "PlainsoundOrgan.sf2");
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const notice = await screen.findByText("Available offline in this browser.");
    const offlineRow = notice.parentElement;
    const offlineButtons = [...offlineRow.querySelectorAll("button")];
    expect(offlineButtons).toHaveLength(2);
    expect(offlineButtons.every((button) => button.disabled)).toBe(true);
    expect(offlineButtons[0].parentElement.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(screen.queryByText(/Loading offline copy PlainsoundOrgan/)).toBeNull();
    expect(screen.queryByText(/Checking stored copy/)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel Download" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Loading…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Load Hexatone SoundFont" }).disabled).toBe(true);
    options.onDownloadComplete();
    await Promise.resolve();
    expect(screen.queryByText(/Loading instrument PlainsoundOrgan/)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose Local File" }).disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    const presets = [{ bank: 0, program: 0, name: "Organ" }];
    fluidsynthMock.engine = {
      soundfontId: 1, presets,
      soundfontSource: { name: "PlainsoundOrgan.sf2", url: "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2" },
    };
    finish({ presets });
    await screen.findByRole("button", { name: "Save SoundFont File…" });
    await screen.findByRole("button", { name: "Remove Offline Copy" });
    expect(screen.getByText("Available offline in this browser.").parentElement).toBe(offlineRow);
    expect([...offlineRow.querySelectorAll("button")]).toEqual(offlineButtons);
    expect(offlineButtons[0].parentElement.getAttribute("aria-hidden")).toBeNull();
    expect(offlineButtons.every((button) => !button.disabled)).toBe(true);
    expect(screen.queryByRole("button", { name: "Loading…" })).toBeNull();
  });

  it.each(["0:2", "0:99"])("restores a bank-specific preset %s or falls back to a valid first preset", async (saved) => {
    const key = "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2";
    localStorage.setItem("fluidsynth_bank_presets", JSON.stringify({ [key]: saved }));
    localStorage.setItem("fluidsynth_last_hosted_soundfont", "PlainsoundOrgan.sf2");
    const selectPreset = vi.fn();
    fluidsynthMock.engine = { soundfontId: null, presets: [], selectPreset };
    const presets = [{ bank: 0, program: 1, name: "First" }, { bank: 0, program: 2, name: "Saved" }];
    fluidsynthMock.load.mockResolvedValue({ presets });
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true, fluidsynth_preset: "0:66" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));
    const chosen = saved === "0:2" ? presets[1] : presets[0];
    await vi.waitFor(() => expect(selectPreset).toHaveBeenCalledWith(chosen));
    expect(fluidsynthMock.load.mock.calls[0][1].preferredPreset).toBe(saved);
    expect(onChange).toHaveBeenCalledWith("fluidsynth_preset", `0:${chosen.program}`);
  });

  it("keeps playback enabled when offline storage fails after downloading", async () => {
    storageMock.store.mockRejectedValue(new Error("Quota exceeded"));
    fluidsynthMock.load.mockImplementation(async (source, options) => {
      await options.onBytesReady(source, new Uint8Array([1]).buffer);
      return { presets: [{ bank: 0, program: 0 }] };
    });
    const onChange = vi.fn();
    localStorage.setItem("fluidsynth_last_hosted_soundfont", "PlainsoundOrgan.sf2");
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));
    await screen.findByText(/couldn’t save an offline copy: Quota exceeded/);
    expect(onChange).not.toHaveBeenCalledWith("output_fluidsynth", false);
    expect(screen.queryByText("Available offline in this browser.")).toBeNull();
  });

  it("reports storage read failures before falling back to a cancellable download", async () => {
    storageMock.read.mockRejectedValue(new Error("Blocked"));
    fluidsynthMock.load.mockImplementation((source) => source.arrayBuffer());
    localStorage.setItem("fluidsynth_last_hosted_soundfont", "PlainsoundOrgan.sf2");
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));
    await screen.findByText("Couldn’t read the stored copy. Downloading instead…");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel Download" }));
    await screen.findByText("Download cancelled.");
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
    expect(screen.queryByRole("button", { name: "Save SoundFont File…" })).toBeNull();
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

  it("shows the hosted URL and percentage only while downloading", async () => {
    let finishLoading;
    fluidsynthMock.load.mockImplementation(
      (source) => {
        void source.arrayBuffer().catch(() => {});
        return new Promise((resolve) => (finishLoading = resolve));
      },
    );
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Hexatone FluidSynth SoundFont"), {
      target: { value: "PlainsoundOrgan.sf2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load Hexatone SoundFont" }));

    const url = "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2";
    await screen.findByRole("button", { name: "Cancel Download" });
    expect(screen.getByRole("link", { name: url }).getAttribute("href")).toBe(url);
    expect(screen.getByText("0%"));
    finishLoading({ presets: [] });
  });

  it("keeps the backend enabled and shows the error when a local SoundFont fails", async () => {
    fluidsynthMock.load.mockRejectedValue(new Error("Out of memory"));
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("FluidSynth SoundFont"), {
      target: { files: [new File([new Uint8Array([1])], "Organ.sf2")] },
    });
    await screen.findByText("SoundFont load failed: Out of memory");
    expect(onChange).not.toHaveBeenCalledWith("output_fluidsynth", false);
    expect(screen.getByRole("button", { name: "Choose Local File" }).disabled).toBe(false);
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

  it("leaves the native picker unrestricted and accepts generic-MIME SoundFonts", async () => {
    fluidsynthMock.load.mockResolvedValue({ presets: [] });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const input = screen.getByLabelText("FluidSynth SoundFont");
    expect(input.hasAttribute("accept")).toBe(false);
    const file = new File([new Uint8Array([1])], "Organ.SF3", { type: "application/octet-stream" });
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalledWith(file, expect.any(Object)));
  });

  it("rejects other file types without changing the loaded engine", () => {
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("FluidSynth SoundFont"), {
      target: { files: [new File(["text"], "notes.txt")] },
    });
    expect(screen.getByText("Choose a SoundFont file in .sf2 or .sf3 format.")).toBeTruthy();
    expect(fluidsynthMock.load).not.toHaveBeenCalled();
  });
});
