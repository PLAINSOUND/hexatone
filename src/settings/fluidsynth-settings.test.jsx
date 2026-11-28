import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workingSoundfontKeys } from "../fluidsynth_synth/soundfont-storage.js";
import { act, fireEvent, render, screen, within } from "@testing-library/preact";

const fluidsynthMock = vi.hoisted(() => ({ engine: null, load: vi.fn(), stop: vi.fn(async () => {}), listeners: new Set() }));
const storageMock = vi.hoisted(() => ({ read: vi.fn(), store: vi.fn(), save: vi.fn() }));
vi.mock("../fluidsynth_synth/soundfont-storage.js", async importOriginal => ({
  ...(await importOriginal()),
  workingSoundfontKeys: vi.fn(async () => []),
  readOfflineSoundfont: storageMock.read,
  readWorkingSoundfont: storageMock.read,
  storeSoundfontCopy: storageMock.store,
  saveSoundfontFile: storageMock.save,
}));
vi.mock("../fluidsynth_synth/index.js", async importOriginal => ({
  waitForColdBankGap: (await importOriginal()).waitForColdBankGap,
  getFluidSynthEngine: vi.fn(async () => (fluidsynthMock.engine ??= {})),
  ensureFluidSynthEngineAwake: vi.fn(async () => true),
  loadFluidSynthSoundFont: fluidsynthMock.load,
  clearPreparedSoundfonts: fluidsynthMock.stop,
  stopFluidSynthEngine: fluidsynthMock.stop,
  peekFluidSynthEngine: () => fluidsynthMock.engine,
  subscribeFluidSynthEngine: (listener) => {
    fluidsynthMock.listeners.add(listener);
    return () => fluidsynthMock.listeners.delete(listener);
  },
}));

import { useLayoutEffect, useState } from "preact/hooks";
import { useSoundSession } from "../hooks/use-sound-session.js";
import { applyMixerParameter } from "../audio/sound-mixer.js";
import { createSoundRecall } from "../audio/sound-recall.js";
import FluidSynthSettingsView from "./fluidsynth-settings.jsx";
import { SOUND_RESTORE_KEY } from "../persistence/io-reload-policy.js";
import { captureUserSound, BUILTIN_USER_SOUNDS } from "../persistence/user-sounds.js";
import { readPerformanceBanks, rememberPerformanceBanks } from "../fluidsynth_synth/performance-banks.js";

// Drive the same runtime used by App without mounting the whole workspace.
function FluidSynthSettings({ soundRecall: reference, ...props }) {
  const session = useSoundSession(props.settings, () => {}, null, {
    applyMixer: (key, value) => applyMixerParameter(key, value, { recall }),
  });
  const [recall] = useState(() => createSoundRecall(() => ({
    discardEdits: session.discardEdits,
    beginPatch(_updates, _policy, ready, mix) {
      void ready?.then(loaded => {
        if (loaded) fluidsynthMock.engine?.setVolume?.(mix.volume);
      });
    },
    updateBank(value) { props.onChange("fluidsynth_preset", value); },
  })));
  useLayoutEffect(() => {
    if (!reference) return;
    const sound = captureUserSound("Test sound", { output_fluidsynth: true });
    recall.recall({ ...sound, soundfont: reference });
  }, [recall, reference]);
  return <FluidSynthSettingsView {...props} soundSession={session} soundRecall={recall} />;
}

describe("FluidSynth settings", () => {
  it.each(["Download SoundFont", "local file"])("selects Default's newly resident bank and program after %s", async action => {
    const name = "PlainsoundOrganGedackt.sf2";
    const engine = { soundfontCache: { keys: [], preparedKeys: [] } };
    fluidsynthMock.engine = engine;
    const preset = { name: "Gedackt", bank: 0, program: 1 };
    fluidsynthMock.load.mockImplementation(async (source, options) => {
      if (options.prepareOnly) {
        engine.soundfontCache.keys = ["https://soundfonts.plainsound.org/" + name];
      } else {
        Object.assign(engine, { soundfontId: 1, soundfontSource: source, selectedPreset: preset, presets: [preset] });
      }
      return { presets: [preset], selectedPreset: preset };
    });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    if (action === "Download SoundFont") {
      fireEvent.change(screen.getByLabelText("Load SoundFonts"), { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Download SoundFont" }));
    } else {
      fireEvent.change(screen.getByLabelText("Local SoundFonts to load"), {
        target: { files: [new File(["bank"], name)] },
      });
    }
    await vi.waitFor(() => expect(screen.getByLabelText("Current SoundFont").value).toBe(name));
    expect(fluidsynthMock.load).toHaveBeenLastCalledWith(expect.objectContaining({ name }),
      expect.objectContaining({ preferredPreset: "0:1" }));
    expect(screen.getByLabelText("FluidSynth preset").value).toBe("0:1");
  });

  it("accepts multiple local files and finishes preparing them while offline storage is pending", async () => {
    const files = ["PlainsoundOrgan.sf2", "PlainsoundHarpsichord.sf2", "PlainsoundSrutibox.sf2"]
      .map(name => new File(["test bank"], name));
    storageMock.store.mockImplementation(() => new Promise(() => {}));
    fluidsynthMock.load.mockResolvedValue({ soundfontId: 1 });
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    const picker = screen.getByLabelText("Local SoundFonts to load");
    expect(picker.multiple).toBe(true);
    fireEvent.change(picker, { target: { files: { ...files, length: files.length } } });
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalledTimes(3));
    act(() => {
      fluidsynthMock.engine = { soundfontCache: {
        preparedKeys: files.map(file => `https://soundfonts.plainsound.org/${file.name}`),
        estimatedBytes: 15 * 1024 ** 2,
        budgetBytes: 512 * 1024 ** 2,
      } };
      fluidsynthMock.listeners.forEach(listener => listener(fluidsynthMock.engine));
    });
    expect(await screen.findByText(`Loaded: ${files.map(file => file.name).join(", ")}`)).toBeTruthy();
    expect(screen.getByText("SoundFonts in memory: 15 MiB estimated of 512 MiB.")).toBeTruthy();
    expect(screen.queryByText(/Selected files:|ready for patch changes/)).toBeNull();
    expect(fluidsynthMock.load.mock.calls.map(([file]) => file)).toEqual(files);
    expect(storageMock.store).toHaveBeenCalledTimes(3);
    expect(fetch).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports worklet memory alongside the preparation controls even with FluidSynth output off", () => {
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: false }} onChange={onChange} />);
    const mib = 1024 * 1024;
    act(() => {
      fluidsynthMock.engine = { soundfontCache: { estimatedBytes: 200 * mib, preparedBytes: 100 * mib, budgetBytes: 384 * mib,
        wasmHeapCapacityBytes: 120 * mib, preparedKeys: [] } };
      fluidsynthMock.listeners.forEach(listener => listener(fluidsynthMock.engine));
    });
    expect(screen.getByText("SoundFonts in memory: 200 MiB estimated of 384 MiB.")).toBeTruthy();
    expect(screen.queryByText(/WASM heap capacity/)).toBeNull();
    expect(screen.getByRole("button", { name: "Download SoundFont" }).closest(".fluidsynth-settings__load-row")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Prepare Organ, Harpsichord and Srutibox" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("distinguishes saved references, banks waiting for silence and banks ready after restore", () => {
    rememberPerformanceBanks([], [{ name: "Organ.sf2" }, { name: "Missing.sf2" }], true);
    const props = { settings: { output_fluidsynth: true }, onChange: vi.fn() };
    const view = render(<FluidSynthSettings {...props}
      restoreProgress={{ phase: "waiting", name: "Organ.sf2", index: 1, total: 2 }} />);
    const menu = screen.getByLabelText("Current SoundFont");
    const loadMenu = screen.getByLabelText("Load SoundFonts");
    expect(screen.getByRole("status").textContent).toContain("Waiting for silence to load Organ.sf2");
    expect(within(menu).getByRole("option", { name: "Organ.sf2" })).toBeTruthy();
    expect(within(loadMenu).getByRole("option", { name: "Organ.sf2" })).toBeTruthy();
    fluidsynthMock.engine = { soundfontCache: { keys: ["local:Organ.sf2"], preparedKeys: ["local:Organ.sf2"] } };
    act(() => fluidsynthMock.listeners.forEach(listener => listener(fluidsynthMock.engine)));
    view.rerender(<FluidSynthSettings {...props} restoreProgress={{ phase: "complete", prepared: 1,
      unavailable: [{ name: "Missing.sf2", reason: "No saved browser copy" }] }} />);
    expect(within(menu).getByRole("option", { name: "Organ.sf2 (loaded)" })).toBeTruthy();
    expect(within(loadMenu).getByRole("option", { name: "Organ.sf2 (loaded)" })).toBeTruthy();
    expect(screen.getByText("Loaded: Organ.sf2")).toBeTruthy();
    expect(screen.getByText(/Missing.sf2 \(No saved browser copy\)/)).toBeTruthy();
  });

  it("discovers an unlisted browser copy and consolidates phone allocation failures across both menus", async () => {
    const names = Array.from({ length: 5 }, (_, i) => `Bank${i}.sf2`);
    rememberPerformanceBanks([], names.slice(0, 4).map(name => ({ name })), true);
    workingSoundfontKeys.mockResolvedValueOnce(names.map(name => `local:${name}`));
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      restoreProgress={{ phase: "complete", unavailable: names.slice(0, 4).map(name =>
        ({ name, reason: "RangeError: Out of memory" })) }} />);
    for (const label of ["Load SoundFonts", "Current SoundFont"]) {
      const menu = within(screen.getByLabelText(label));
      for (const name of names) expect(await menu.findByRole("option", { name: name + " (available)" })).toBeTruthy();
    }
    expect(screen.getAllByText(/Preload memory full/)).toHaveLength(1);
    expect(screen.queryByText(/RangeError/)).toBeNull();
  });

  it("can prepare a bank with the default collapsed player settings without changing the active patch", async () => {
    sessionStorage.removeItem("hexatone_fluidsynth_collapsed");
    fluidsynthMock.engine = { soundfontSource: { name: "PlainsoundOrgan.sf2" }, soundfontId: 1,
      presets: [], soundfontCache: { preparedKeys: [] } };
    fluidsynthMock.load.mockResolvedValue({ soundfontId: 2 });
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Show SoundFont Player settings" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(screen.getByLabelText("Load SoundFonts"), {
      target: { value: "PlainsoundHarpsichord.sf2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Download SoundFont" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Download SoundFont" })).toBeTruthy());
    expect(fluidsynthMock.load).toHaveBeenCalledWith(expect.objectContaining({ name: "PlainsoundHarpsichord.sf2" }),
      expect.objectContaining({ prepareOnly: true }));
    expect(screen.getByLabelText("Current SoundFont").value).toBe("PlainsoundOrgan.sf2");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists the same banks and labels in both menus and switches to a resident bank directly", async () => {
    const name = "PlainsoundHarpsichord.sf2";
    const url = `https://soundfonts.plainsound.org/${name}`;
    rememberPerformanceBanks([], [{ name, url }], true);
    fluidsynthMock.engine = { soundfontId: null, soundfontCache: { keys: [url], preparedKeys: [url] } };
    fluidsynthMock.load.mockResolvedValue({ presets: [{ bank: 0, program: 3 }] });
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    const playback = screen.getByLabelText("Current SoundFont");
    const options = menu => [...menu.options].slice(1).map(option => [option.value, option.textContent]);
    expect(options(playback)).toEqual(options(screen.getByLabelText("Load SoundFonts")));
    expect(within(playback).getByRole("option", { name: "PlainsoundSrutibox.sf2" })).toBeTruthy();
    expect(within(playback).getByRole("option", { name: name + " (loaded)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load Hexatone SoundFont" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose Local File" })).toBeNull();
    fireEvent.change(playback, { target: { value: name } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith("fluidsynth_preset", "0:3"));
    expect(fluidsynthMock.load).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows Lute download progress and only its own budget warning after a failed Principal restore", async () => {
    const principal = "PlainsoundOrganPrincipal.sf2";
    const lute = "PlainsoundHarpsichordLute.sf2";
    const reason = "SoundFont memory budget exceeded";
    rememberPerformanceBanks([], [{ name: principal }], true);
    let finish;
    const release = new Promise(resolve => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, headers: { get: () => "4" },
      body: { getReader: () => {
        let first = true;
        return { releaseLock() {}, async read() {
          if (first) { first = false; return { value: new Uint8Array(2) }; }
          await release;
          return { done: true };
        } };
      } },
    })));
    fluidsynthMock.load.mockImplementation(async (source, options) => {
      await source.arrayBuffer(options.onDownloadProgress).catch(() => {});
      throw new Error(reason);
    });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      restoreProgress={{ phase: "complete", unavailable: [{ name: principal, reason }] }} />);
    fireEvent.change(screen.getByLabelText("Load SoundFonts"), { target: { value: lute } });
    fireEvent.click(screen.getByRole("button", { name: "Download SoundFont" }));
    await vi.waitFor(() => expect(screen.getByRole("progressbar").value).toBe(50));
    expect(screen.queryByText(/Principal.sf2 exceeds/)).toBeNull();
    finish();
    await screen.findByText(/Preload memory full/);
    expect(screen.getAllByText(/Preload memory full/)).toHaveLength(1);
  });

  it("hides an earlier missing Principal recall when a manual Lute preload fails", async () => {
    const principal = "PlainsoundOrganPrincipal.sf2";
    const lute = "PlainsoundHarpsichordLute.sf2";
    fluidsynthMock.load.mockRejectedValue(new Error("SoundFont memory budget exceeded"));
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      soundRecall={{ name: principal, preset: "0:3" }} />);
    await screen.findByText(`Add ${principal} in Load SoundFonts.`);
    fireEvent.change(screen.getByLabelText("Load SoundFonts"), { target: { value: lute } });
    fireEvent.click(screen.getByRole("button", { name: "Download SoundFont" }));
    await screen.findByText(/Preload memory full/);
    expect(screen.queryByText(`Add ${principal} in Load SoundFonts.`)).toBeNull();
  });

  it("replaces a restore warning with one readable failure when the same bank is retried", async () => {
    const name = "Extra.sf2";
    const reason = "RuntimeError: Aborted(RangeError: allocation failed)";
    rememberPerformanceBanks([], [{ name, url: "" }], true);
    fluidsynthMock.load.mockRejectedValueOnce(new Error(reason));
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      restoreProgress={{ phase: "complete", unavailable: [{ name, reason }] }} />);
    const message = /Preload memory full/;
    expect(screen.getAllByText(message)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Local SoundFonts to load"), {
      target: { files: [new File(["bank"], name)] },
    });
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalled());
    await screen.findByText(message);
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.queryByText(/RuntimeError/i)).toBeNull();
  });

  it("starts the shut-down player with the remembered bank and preset from the collapsed fieldset", async () => {
    sessionStorage.setItem("hexatone_fluidsynth_collapsed", "true");
    const name = "Extra.sf2";
    sessionStorage.setItem("fluidsynth_last_soundfont_source", JSON.stringify({ name }));
    localStorage.setItem("fluidsynth_bank_presets", JSON.stringify({ "local:Extra.sf2": "0:4" }));
    storageMock.read.mockResolvedValue({ blob: new Blob(["bank"]) });
    fluidsynthMock.load.mockResolvedValue({ presets: [{ bank: 0, program: 4 }] });
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: false }} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Shut Down FluidSynth" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Use FluidSynth output"));
    expect(onChange).toHaveBeenCalledWith("output_fluidsynth", true);
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalledWith(expect.objectContaining({ name }),
      expect.objectContaining({ preferredPreset: "0:4" })));
  });

  it("clears the playing bank and keeps its library entry selectable", async () => {
    const name = "Organ.sf2";
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name }, presets: [{ bank: 0, program: 0 }] };
    fluidsynthMock.stop.mockImplementationOnce(async () => {
      fluidsynthMock.engine = null;
      for (const notify of fluidsynthMock.listeners) notify(null);
    });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const picker = screen.getByLabelText("Current SoundFont");
    expect(picker.value).toBe(name);
    fireEvent.click(screen.getByRole("button", { name: "Shut Down FluidSynth" }));
    await vi.waitFor(() => expect(picker.value).toBe(""));
    expect(within(picker).getByRole("option", { name: name + "" })).toBeTruthy();
  });

  it("keeps an oversized local bank in the library and loads it on playback selection", async () => {
    const name = "Extra.sf2";
    const file = new File(["bank"], name);
    fluidsynthMock.load.mockRejectedValueOnce(new Error("SoundFont memory budget exceeded"));
    fluidsynthMock.load.mockResolvedValueOnce({ presets: [{ bank: 0, program: 2 }] });
    const onChange = vi.fn();
    const view = render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Local SoundFonts to load"), { target: { files: [file] } });
    expect(await screen.findByText('Preload memory full. Please select the desired soundfont manually in "Current SoundFont".')).toBeTruthy();
    expect(storageMock.store).toHaveBeenCalledWith(file, file);
    expect(readPerformanceBanks()).toEqual([{ name, url: "", preload: true }]);
    expect(onChange).not.toHaveBeenCalled();
    view.unmount();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    const playback = screen.getByLabelText("Current SoundFont");
    expect(within(playback).getByRole("option", { name: `${name}` })).toBeTruthy();
    fireEvent.change(playback, { target: { value: name } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith("fluidsynth_preset", "0:2"));
    expect(fluidsynthMock.load.mock.lastCall[0].url).toBe(`local:${name}`);
    expect(fluidsynthMock.load.mock.lastCall[1].prepareOnly).toBeUndefined();
  });

  it("switches an available bank to Current after held notes release when preloading exceeds memory", async () => {
    const name = "PlainsoundHarpsichordLute.sf2";
    const url = "https://soundfonts.plainsound.org/" + name;
    workingSoundfontKeys.mockResolvedValueOnce([url]);
    fluidsynthMock.engine = { soundfontCache: { estimatedBytes: 80, budgetBytes: 100 } };
    fluidsynthMock.load.mockImplementation(async (source, options) => {
      if (options.prepareOnly) await options.onBytesReady(source, new ArrayBuffer(20));
      return { presets: [{ bank: 0, program: 0 }] };
    });
    let idle = false;
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      keysRef={{ current: { isSoundInteractionIdle: () => idle } }} />);
    const menu = screen.getByLabelText("Load SoundFonts");
    await within(menu).findByRole("option", { name: name + " (available)" });
    fireEvent.change(menu, { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Load SoundFont" }));
    await vi.waitFor(() => expect(storageMock.store).toHaveBeenCalled());
    expect(fluidsynthMock.stop).not.toHaveBeenCalled();
    idle = true;
    await vi.waitFor(() => expect(screen.getByLabelText("Current SoundFont").value).toBe(name));
    expect(fluidsynthMock.stop).toHaveBeenCalledExactlyOnceWith({ naturalRelease: true });
  });

  it("unpins one bank without removing the library entry or changing playback", () => {
    rememberPerformanceBanks([], [{ name: "Local.sf2" }, { name: "Other.sf2" }], true);
    fluidsynthMock.engine = { soundfontCache: { preparedKeys: ["local:Local.sf2"] } };
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Load SoundFonts"), { target: { value: "Local.sf2" } });
    fireEvent.click(screen.getByRole("button", { name: "Unload" }));
    expect(fluidsynthMock.stop).toHaveBeenCalledWith("local:Local.sf2");
    expect(readPerformanceBanks().map(({ preload }) => preload)).toEqual([false, true]);
    expect(within(screen.getByLabelText("Current SoundFont"))
      .getByRole("option", { name: /Local.sf2/ })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels an on-demand load while it waits for silence and returns to the playing bank", async () => {
    rememberPerformanceBanks([], [{ name: "Next.sf2" }], false);
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "Current.sf2" }, presets: [{ bank: 0, program: 0 }] };
    fluidsynthMock.load.mockImplementation((_source, { signal, onWaitingForSilence }) => {
      onWaitingForSilence();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const playback = screen.getByLabelText("Current SoundFont");
    fireEvent.change(playback, { target: { value: "Next.sf2" } });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel Load" }));
    expect(playback.value).toBe("Current.sf2");
    expect(screen.getByText("SoundFont load cancelled.")).toBeTruthy();
  });

  it("does not save a temporary working bank as offline again during recall", async () => {
    const bytes = new ArrayBuffer(3);
    storageMock.read.mockResolvedValue({ offline: false, blob: { size: 3, arrayBuffer: async () => bytes } });
    fluidsynthMock.load.mockImplementation(async source => {
      await source.arrayBuffer();
      return { presets: [] };
    });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      soundRecall={BUILTIN_USER_SOUNDS[0].soundfont} />);
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveResolved());
    expect(storageMock.store).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains the latest volume when an asynchronous recalled bank finishes loading", async () => {
    let finishLoad;
    storageMock.read.mockResolvedValue({ blob: new Blob([new Uint8Array([1])]) });
    fluidsynthMock.load.mockImplementation(() => new Promise(resolve => { finishLoad = resolve; }));
    const setVolume = vi.fn();
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "Previous.sf2" },
      presets: [{ bank: 0, program: 0 }], setVolume };
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      soundRecall={{ name: "PlainsoundOrgan.sf2", preset: "0:4", volume: 30, reverb: 15,
        smoothing: { pressureMs: 0, expressionMs: 0, minimumMs: 0 } }} />);
    await vi.waitFor(() => expect(finishLoad).toBeTypeOf("function"));
    fireEvent.keyDown(screen.getByRole("slider", { name: "FluidSynth volume" }), { key: "ArrowRight" });
    await act(async () => { finishLoad({ presets: [{ bank: 0, program: 4 }] }); });
    expect(setVolume).toHaveBeenLastCalledWith(31);
    expect(screen.getByRole("slider", { name: "FluidSynth volume" }).getAttribute("aria-valuenow")).toBe("31");
  });

  it("can recall the active backup bank even when browser storage fails", async () => {
    storageMock.read.mockRejectedValue(new Error("Storage unavailable"));
    const selectPreset = vi.fn();
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "PlainsoundOrganGedackt.sf2" }, selectPreset };
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      soundRecall={BUILTIN_USER_SOUNDS[0].soundfont} />);
    await vi.waitFor(() => expect(selectPreset).toHaveBeenCalledWith({ bank: 0, program: 1 }, { deferAttackProgram: true }));
    expect(fluidsynthMock.load).not.toHaveBeenCalled();
  });

  it("preserves edited patch and controls across off/on and still allows explicit recall", () => {
    sessionStorage.setItem("hexatone_fluidsynth_collapsed", "false");
    const selectPreset = vi.fn(preset => { fluidsynthMock.engine.selectedPreset = preset; });
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "Organ.sf2" },
      presets: [{ bank: 0, program: 1, name: "One" }, { bank: 0, program: 2, name: "Two" }],
      selectPreset, setVolume: vi.fn(), setReverb: vi.fn(), setSmoothing: vi.fn() };
    const soundRecall = { name: "Organ.sf2", preset: "0:1", volume: 30, reverb: 15,
      smoothing: { pressureMs: 80, expressionMs: 0, minimumMs: 20 } };
    const props = { onChange: vi.fn(), soundRecall };
    const view = render(<FluidSynthSettings {...props} settings={{ output_fluidsynth: true }} />);
    fireEvent.change(screen.getByLabelText("FluidSynth preset"), { target: { value: "0:2" } });
    for (const label of ["FluidSynth volume", "FluidSynth reverb", "Pressure Smoothing (ms)", "Minimum Smoothing (ms)"])
      fireEvent.keyDown(screen.getByRole("slider", { name: label }), { key: "ArrowRight" });
    view.rerender(<FluidSynthSettings {...props} settings={{ output_fluidsynth: false }} />);
    view.rerender(<FluidSynthSettings {...props} settings={{ output_fluidsynth: true }} />);
    expect(selectPreset).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("FluidSynth preset").value).toBe("0:2");
    for (const [label, value] of [["FluidSynth volume", 31], ["FluidSynth reverb", 16],
      ["Pressure Smoothing (ms)", 81], ["Minimum Smoothing (ms)", 21]])
      expect(screen.getByRole("slider", { name: label }).getAttribute("aria-valuenow")).toBe(String(value));
    view.rerender(<FluidSynthSettings {...props} soundRecall={{ ...soundRecall }} settings={{ output_fluidsynth: true }} />);
    expect(selectPreset).toHaveBeenLastCalledWith({ bank: 0, program: 1 }, { deferAttackProgram: true });
    expect(screen.getByRole("slider", { name: "FluidSynth volume" }).getAttribute("aria-valuenow")).toBe("30");
  });

  it("loads slim Principal for Baroque Organ when both files are stored but cold", async () => {
    storageMock.read.mockResolvedValue({ blob: new Blob([new Uint8Array([1])]) });
    fluidsynthMock.load.mockResolvedValue({ presets: [{ bank: 0, program: 3 }] });
    const sound = BUILTIN_USER_SOUNDS.find(sound => sound.name === "Baroque Organ");
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      soundRecall={sound.soundfont} />);
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalled());
    expect(fluidsynthMock.load.mock.calls[0][0].name).toBe("PlainsoundOrganPrincipal.sf2");
    expect(fluidsynthMock.load.mock.calls[0][1].preferredPreset).toBe("0:3");
  });

  it("recalls the cached full Organ if the slim Gedackt bank is unavailable", async () => {
    storageMock.read.mockImplementation(async key => key.endsWith("PlainsoundOrgan.sf2")
      ? { blob: new Blob([new Uint8Array([1])]) } : undefined);
    fluidsynthMock.load.mockResolvedValue({ presets: [{ bank: 0, program: 1 }] });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      soundRecall={BUILTIN_USER_SOUNDS[0].soundfont} />);
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.getByLabelText("Load SoundFonts").value).toBe("PlainsoundOrgan.sf2"));
    expect(fluidsynthMock.load.mock.calls[0][0].name).toBe("PlainsoundOrgan.sf2");
    expect(fluidsynthMock.load.mock.calls[0][1].preferredPreset).toBe("0:1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the active slim Harpsichord bank even when the full bank is stored", async () => {
    storageMock.read.mockResolvedValue({ blob: new Blob([new Uint8Array([1])]) });
    const selectPreset = vi.fn(), onChange = vi.fn();
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "PlainsoundHarpsichordLute.sf2" }, selectPreset };
    const sound = BUILTIN_USER_SOUNDS.find(sound => sound.name === "Harpsichord");
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange}
      soundRecall={sound.soundfont} />);
    await vi.waitFor(() => expect(selectPreset).toHaveBeenCalledWith({ bank: 0, program: 0 }, { deferAttackProgram: true }));
    expect(onChange).toHaveBeenCalledWith("fluidsynth_preset", "0:0");
    expect(fluidsynthMock.load).not.toHaveBeenCalled();
  });

  it.each([["PlainsoundHarpsichord.sf2", 3], ["PlainsoundHarpsichordLute.sf2", 0]])(
    "selects Lute when %s is supplied after a pending Harpsichord recall", async (name, program) => {
      const sound = BUILTIN_USER_SOUNDS.find(sound => sound.name === "Harpsichord");
      const onChange = vi.fn();
      fluidsynthMock.load.mockResolvedValue({ presets: [{ bank: 0, program }] });
      render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange}
        soundRecall={sound.soundfont} />);
      expect(await screen.findByText(/Add PlainsoundHarpsichord.sf2 or PlainsoundHarpsichordLute.sf2/)).toBeTruthy();
      fireEvent.change(screen.getByLabelText("Local SoundFonts to load"), {
        target: { files: [new File(["soundfont"], name)] },
      });
      await vi.waitFor(() => expect(screen.getByRole("button", { name: "Load Local File" }).disabled).toBe(false));
      fireEvent.change(screen.getByLabelText("Current SoundFont"), { target: { value: name } });
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith("fluidsynth_preset", `0:${program}`));
      expect(fluidsynthMock.load).toHaveBeenCalledWith(expect.objectContaining({ name }),
        expect.objectContaining({ preferredPreset: `0:${program}` }));
    },
  );

  it("recalls a user sound preset on the current bank without loading it again", () => {
    const selectPreset = vi.fn();
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "Organ.sf2" },
      presets: [{ bank: 0, program: 4, name: "Stop" }], selectPreset };
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      soundRecall={{ name: "Organ.sf2", preset: "0:4", volume: 30, reverb: 15,
        smoothing: { pressureMs: 100, expressionMs: 80, minimumMs: 10 } }} />);
    expect(selectPreset).toHaveBeenCalledWith({ bank: 0, program: 4 }, { deferAttackProgram: true });
    expect(fluidsynthMock.load).not.toHaveBeenCalled();
    expect(screen.getByLabelText("FluidSynth volume").getAttribute("aria-valuenow")).toBe("30");
  });

  it("recalls a cached bank with the saved preset, overriding the last used preset", async () => {
    storageMock.read.mockResolvedValue({ blob: new Blob([new Uint8Array([1])]) });
    fluidsynthMock.load.mockResolvedValue({ presets: [{ bank: 0, program: 4 }] });
    const props = { onChange: vi.fn(), soundRecall: { name: "PlainsoundOrgan.sf2", preset: "0:4", volume: 30, reverb: 15,
      smoothing: { pressureMs: 100, expressionMs: 80, minimumMs: 10 } } };
    const view = render(<FluidSynthSettings {...props} settings={{ output_fluidsynth: true }} />);
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalled());
    expect(fluidsynthMock.load.mock.calls[0][1].preferredPreset).toBe("0:4");
    expect(fetch).not.toHaveBeenCalled();
    view.rerender(<FluidSynthSettings {...props} settings={{ output_fluidsynth: false }} />);
    view.rerender(<FluidSynthSettings {...props} settings={{ output_fluidsynth: true }} />);
    expect(fluidsynthMock.load).toHaveBeenCalledTimes(1);
  });

  it("asks for a missing bank instead of downloading during user sound recall", async () => {
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()}
      soundRecall={{ name: "Missing.sf2", preset: "0:4", volume: 30, reverb: 15,
        smoothing: { pressureMs: 100, expressionMs: 80, minimumMs: 10 } }} />);
    expect(await screen.findByText("Add Missing.sf2 in Load SoundFonts.")).toBeTruthy();
    expect(fluidsynthMock.load).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("collapses only smoothing with the shared toggle and remembers the choice", () => {
    sessionStorage.removeItem("hexatone_fluidsynth_collapsed");
    localStorage.setItem("fluidsynth_internal_smoothing", JSON.stringify({ pressureMs: 100, expressionMs: 80, minimumMs: 20 }));
    const setSmoothing = vi.fn(), onChange = vi.fn();
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "MyOrgan.sf2" },
      presets: [{ bank: 0, program: 0, name: "Organ" }], setSmoothing };
    const settings = { output_fluidsynth: true };
    const view = render(<FluidSynthSettings settings={settings} onChange={onChange} />);
    const toggle = screen.getByRole("button", { name: "Show SoundFont Player settings" });
    expect(toggle.classList.contains("section-collapse-toggle")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.querySelector(".disclosure-toggle-glyph--collapsed")).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Pressure Smoothing (ms)" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Expression Y Smoothing (ms)" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Minimum Smoothing (ms)" })).toBeNull();
    expect(screen.getByRole("slider", { name: "FluidSynth volume" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "FluidSynth reverb" })).toBeTruthy();
    expect(screen.getByLabelText("Current SoundFont")).toBeTruthy();
    expect(screen.getByLabelText("FluidSynth preset")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByRole("slider", { name: "Pressure Smoothing (ms)" }).getAttribute("aria-valuenow")).toBe("100");
    expect(sessionStorage.getItem("hexatone_fluidsynth_collapsed")).toBe("false");
    view.unmount();
    render(<FluidSynthSettings settings={settings} onChange={onChange} />);
    expect(screen.getByRole("slider", { name: "Minimum Smoothing (ms)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide SoundFont Player settings" }));
    expect(screen.queryByRole("slider", { name: "Pressure Smoothing (ms)" })).toBeNull();
    expect(setSmoothing).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("limits the shared minimum to enabled smoothing times and persists it", () => {
    localStorage.setItem("fluidsynth_internal_smoothing", JSON.stringify({ pressureMs: 100, expressionMs: 0, minimumMs: 20 }));
    const setSmoothing = vi.fn();
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "MyOrgan.sf2" },
      presets: [{ bank: 0, program: 0, name: "Organ" }], setSmoothing };
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const minimum = screen.getByRole("slider", { name: "Minimum Smoothing (ms)" });
    expect(minimum.getAttribute("aria-valuemax")).toBe("100");
    fireEvent.keyDown(minimum, { key: "End" });
    expect(setSmoothing).toHaveBeenLastCalledWith({ pressureMs: 100, expressionMs: 0, minimumMs: 100 });
    expect(JSON.parse(localStorage.getItem("fluidsynth_internal_smoothing")).minimumMs).toBe(100);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Pressure Smoothing (ms)" }), { key: "ArrowLeft" });
    expect(minimum.getAttribute("aria-valuenow")).toBe("99");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Pressure Smoothing (ms)" }), { key: "Home" });
    expect(minimum.getAttribute("aria-disabled")).toBe("true");
    expect(setSmoothing).toHaveBeenLastCalledWith({ pressureMs: 0, expressionMs: 0, minimumMs: 0 });
  });
  it("persists independent smoothing faders and greys their labels only at zero", () => {
    const setSmoothing = vi.fn();
    fluidsynthMock.engine = { soundfontId: 1, soundfontSource: { name: "MyOrgan.sf2" },
      presets: [{ bank: 0, program: 0, name: "Organ" }], setSmoothing };
    const view = render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const pressure = screen.getByRole("slider", { name: "Pressure Smoothing (ms)" });
    const expression = screen.getByRole("slider", { name: "Expression Y Smoothing (ms)" });
    expect(screen.getByText("Pressure Smoothing (ms)").className).toBe("fluidsynth-settings__smoothing-off");
    expect(pressure.getAttribute("aria-valuemax")).toBe("500");
    fireEvent.keyDown(pressure, { key: "End" });
    fireEvent.keyDown(expression, { key: "ArrowRight" });
    expect(setSmoothing).toHaveBeenLastCalledWith({ pressureMs: 500, expressionMs: 1, minimumMs: 0 });
    expect(screen.getByText("Pressure Smoothing (ms)").className).toBe("");
    view.unmount();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: "Pressure Smoothing (ms)" }).getAttribute("aria-valuenow")).toBe("500");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Pressure Smoothing (ms)" }), { key: "Home" });
    expect(setSmoothing).toHaveBeenLastCalledWith({ pressureMs: 0, expressionMs: 1, minimumMs: 0 });
    expect(screen.getByText("Pressure Smoothing (ms)").className).toBe("fluidsynth-settings__smoothing-off");
  });
  afterEach(() => vi.unstubAllGlobals());
  it("uses the shared output fader styling", () => {
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    expect(screen.getByText("Built-in SoundFont Player").closest("fieldset").classList.contains("output-routing-fieldset")).toBe(true);
  });
  beforeEach(() => {
    fluidsynthMock.stop.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    })));
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("hexatone_fluidsynth_collapsed", "false");
    fluidsynthMock.engine = null;
    fluidsynthMock.load.mockReset();
    fluidsynthMock.listeners.clear();
    storageMock.read.mockReset().mockResolvedValue(null);
    storageMock.store.mockReset().mockResolvedValue(undefined);
    storageMock.save.mockReset();
  });

  it.each([true, false])("exports the file with Restore set to %s and hides browser copy controls", async restore => {
    localStorage.setItem(SOUND_RESTORE_KEY, String(restore));
    const source = { name: "PlainsoundOrgan.sf2", url: "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2" };
    const blob = new Blob(["bank"]);
    storageMock.read.mockResolvedValue({ blob });
    fluidsynthMock.engine = { soundfontId: 1, presets: [{ bank: 0, program: 0 }], soundfontSource: source };
    const onChange = vi.fn();
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Save SoundFont File…" }));
    await vi.waitFor(() => expect(storageMock.save).toHaveBeenCalledWith(source.name, blob));
    expect(screen.queryByRole("button", { name: "Remove Offline Copy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep for Offline Use" })).toBeNull();
    expect(screen.queryByText(/Available offline in this browser/)).toBeNull();
    expect(storageMock.store).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["clear", "disable", "unmount"])("cancels pending playback loading on %s", async action => {
    fluidsynthMock.load.mockImplementation((_source, { signal }) => new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    const onChange = vi.fn();
    const view = render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Current SoundFont"), { target: { value: "PlainsoundOrgan.sf2" } });
    const signal = fluidsynthMock.load.mock.lastCall[1].signal;
    if (action === "clear") fireEvent.click(screen.getByRole("button", { name: "Shut Down FluidSynth" }));
    else if (action === "disable") view.rerender(<FluidSynthSettings settings={{ output_fluidsynth: false }} onChange={onChange} />);
    else view.unmount();
    expect(signal.aborted).toBe(true);
    expect(onChange).not.toHaveBeenCalledWith("fluidsynth_preset", expect.anything());
  });

  it("enables preset, output, and volume controls once a bank is loaded", async () => {
    const selectPreset = vi.fn();
    const setVolume = vi.fn();
    const setReverb = vi.fn();
    fluidsynthMock.engine = {
      soundfontId: 1,
      presets: [
        { name: "Gedackt", bank: 0, program: 0 },
        { name: "Principal", bank: 0, program: 1 },
      ],
      selectPreset,
      setVolume,
      setReverb,
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

    fireEvent.keyDown(screen.getByRole("slider", { name: "FluidSynth reverb" }), { key: "ArrowRight" });
    expect(setReverb).toHaveBeenCalledWith(21);
    await vi.waitFor(() => expect(localStorage.getItem("fluidsynth_internal_reverb")).toBe("21"));
    expect(localStorage.getItem("fluidsynth_internal_volume")).toBe("101");
    expect(screen.getByLabelText("Local SoundFonts to load").disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Load Hexatone SoundFont" })).toBeNull();
  });

  it("restores the hosted SoundFont selection from the active engine", () => {
    fluidsynthMock.engine = {
      soundfontId: 1,
      presets: [{ name: "Organ", bank: 0, program: 0 }],
      soundfontSource: { name: "PlainsoundOrgan.sf2" },
    };

    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Current SoundFont").value).toBe(
      "PlainsoundOrgan.sf2",
    );
    expect(screen.queryByText("Loaded: PlainsoundOrgan.sf2")).toBeNull();
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
    expect(screen.getByLabelText("Current SoundFont").value).toBe("Organ.sf2");
  });

  it("leaves the native picker unrestricted and accepts generic-MIME SoundFonts", async () => {
    fluidsynthMock.load.mockResolvedValue({ presets: [] });
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    const input = screen.getByLabelText("Local SoundFonts to load");
    expect(input.hasAttribute("accept")).toBe(false);
    const file = new File([new Uint8Array([1])], "Organ.SF3", { type: "application/octet-stream" });
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() => expect(fluidsynthMock.load).toHaveBeenCalledWith(file, expect.any(Object)));
  });

  it("rejects other file types without changing the loaded engine", () => {
    render(<FluidSynthSettings settings={{ output_fluidsynth: true }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Local SoundFonts to load"), {
      target: { files: [new File(["text"], "notes.txt")] },
    });
    expect(screen.getByText("Choose SoundFont files in .sf2 or .sf3 format.")).toBeTruthy();
    expect(fluidsynthMock.load).not.toHaveBeenCalled();
  });
});
