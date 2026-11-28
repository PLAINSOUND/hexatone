import { beforeEach, expect, it, vi } from "vitest";
import { LAST_SOUNDFONT_KEY, restoreLocalSoundfont, restorePerformanceSoundfonts, restoreSoundfontSession } from "./restore-local-soundfont.js";
import { rememberPerformanceBanks } from "./performance-banks.js";
import { SOUND_RESTORE_KEY } from "../persistence/io-reload-policy.js";
const mocks = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), peek: vi.fn(), unpin: vi.fn() }));
vi.mock("./soundfont-storage.js", async importOriginal => ({
  readOfflineSoundfont: mocks.read,
  readWorkingSoundfont: mocks.read,
  soundfontStorageKey: (await importOriginal()).soundfontStorageKey,
}));
vi.mock("./index.js", () => ({ loadFluidSynthSoundFont: mocks.load, peekFluidSynthEngine: mocks.peek,
  clearPreparedSoundfonts: mocks.unpin }));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.resetAllMocks();
  localStorage.setItem(LAST_SOUNDFONT_KEY, JSON.stringify({ name: "Organ.sf2", url: "" }));
});
it("restores a locally saved bank with its saved preset and no network", async () => {
  mocks.read.mockResolvedValue({ blob: new Blob(["font"]) });
  localStorage.setItem("fluidsynth_bank_presets", JSON.stringify({ "local:Organ.sf2": "0:3" }));
  const engine = { selectedPreset: { bank: 0, program: 3 }, setVolume: vi.fn() };
  mocks.peek.mockReturnValue(engine);
  mocks.load.mockResolvedValue({ presets: [engine.selectedPreset] });
  expect((await restoreLocalSoundfont()).selectedPreset).toEqual(engine.selectedPreset);
  expect(mocks.read).toHaveBeenCalledWith("local:Organ.sf2");
  expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ name: "Organ.sf2", arrayBuffer: expect.any(Function) }),
    expect.objectContaining({ preferredPreset: "0:3" }));
});
it.each(["missing", "denied"])("does not download when local storage is %s", async (state) => {
  if (state === "denied") mocks.read.mockRejectedValue(new Error("denied"));
  expect(await restoreLocalSoundfont()).toBeNull();
  expect(mocks.load).not.toHaveBeenCalled();
});
it("does not replace a font already loaded manually", async () => {
  mocks.peek.mockReturnValue({ soundfontId: 1 });
  expect(await restoreLocalSoundfont()).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("restores a local Hexatone bank using its shared identity and old local preset", async () => {
  localStorage.setItem(LAST_SOUNDFONT_KEY, JSON.stringify({ name: "PlainsoundOrgan.sf2", url: "" }));
  localStorage.setItem("fluidsynth_bank_presets", JSON.stringify({ "local:PlainsoundOrgan.sf2": "0:2" }));
  mocks.read.mockResolvedValue({ blob: new Blob(["font"]) });
  mocks.load.mockResolvedValue({ presets: [] });
  await restoreLocalSoundfont();
  expect(mocks.read).toHaveBeenCalledWith("https://soundfonts.plainsound.org/PlainsoundOrgan.sf2");
  expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ name: "PlainsoundOrgan.sf2" }),
    expect.objectContaining({ preferredPreset: "0:2" }));
});

it("restores the remembered preload set in order, skipping budget failures and unpinned banks", async () => {
  const banks = rememberPerformanceBanks([], [{ name: "Organ.sf2" }, { name: "Big.sf2" }, { name: "Lute.sf2" }], true);
  rememberPerformanceBanks(banks, [{ name: "Unpinned.sf2" }], false);
  mocks.read.mockResolvedValue({ blob: new Blob(["font"]) });
  mocks.load.mockImplementation(async source => {
    if (source.name === "Big.sf2") throw new Error("SoundFont memory budget exceeded");
  });
  const result = await restorePerformanceSoundfonts();
  expect(mocks.load.mock.calls.map(([source, options]) => [source.name, options.prepareOnly]))
    .toEqual([["Organ.sf2", true], ["Big.sf2", true], ["Lute.sf2", true]]);
  expect(result).toEqual({ phase: "complete", prepared: 2,
    unavailable: [{ name: "Big.sf2", reason: "SoundFont memory budget exceeded" }] });
});

it("finishes session restore only after the worklet confirms the saved banks", async () => {
  rememberPerformanceBanks([], [{ name: "Organ.sf2" }, { name: "Lute.sf2" }, { name: "Missing.sf2" }], true);
  mocks.read.mockImplementation(async key => key.endsWith("Missing.sf2") ? null : { blob: new Blob(["font"]) });
  const engine = { selectedPreset: { bank: 0, program: 3 }, setVolume: vi.fn() };
  mocks.peek.mockReturnValue(engine);
  let finishLute;
  mocks.load.mockImplementation(async (source, options) => {
    if (!options.prepareOnly) engine.soundfontCache = { keys: ["local:Organ.sf2"] };
    if (source.name === "Lute.sf2") {
      options.onWaitingForSilence();
      await new Promise(resolve => { finishLute = resolve; });
    }
    return { presets: [engine.selectedPreset] };
  });
  const onProgress = vi.fn(), complete = vi.fn(), onActiveReady = vi.fn();
  const restoring = restoreSoundfontSession({ onProgress, onActiveReady }).then(complete);
  await vi.waitFor(() => expect(finishLute).toBeTypeOf("function"));
  expect(onActiveReady).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selectedPreset: engine.selectedPreset }));
  expect(complete).not.toHaveBeenCalled();
  expect(onProgress).toHaveBeenLastCalledWith({ phase: "waiting", name: "Lute.sf2", index: 2, total: 3 });
  expect(mocks.read.mock.calls.map(([key]) => key)).toEqual(["local:Organ.sf2", "local:Lute.sf2"]);
  finishLute();
  await restoring;
  expect(onProgress).toHaveBeenLastCalledWith({ phase: "complete", prepared: 2,
    unavailable: [{ name: "Missing.sf2", reason: "No saved browser copy" }] });
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ selectedPreset: engine.selectedPreset }));
});

it("retains library references with Restore SOUND settings off and does not read the files", async () => {
  rememberPerformanceBanks([], [{ name: "Organ.sf2" }], true);
  localStorage.setItem(SOUND_RESTORE_KEY, "false");
  expect(await restoreLocalSoundfont()).toBeNull();
  await restorePerformanceSoundfonts();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
});

it("lets an explicit recall supersede active-bank restore while completing saved preparation", async () => {
  rememberPerformanceBanks([], [{ name: "Lute.sf2" }], true);
  mocks.read.mockResolvedValue({ blob: new Blob(["font"]) });
  const controller = new AbortController();
  let finishActive;
  const engine = { setVolume: vi.fn() };
  mocks.peek.mockReturnValue(engine);
  mocks.load.mockImplementation(async (source, options) => {
    if (!options.prepareOnly) {
      expect(source.name).toBe("Organ.sf2");
      expect(options.signal).toBe(controller.signal);
      await new Promise(resolve => { finishActive = resolve; });
    }
    return { presets: [] };
  });

  const restores = restoreSoundfontSession({ activeSignal: controller.signal });
  await vi.waitFor(() => expect(finishActive).toBeTypeOf("function"));
  controller.abort();
  finishActive();
  expect(await restores).toBeUndefined();
  expect(engine.setVolume).not.toHaveBeenCalled();
  expect(mocks.load.mock.calls.map(([source, options]) => [source.name, !!options.prepareOnly]))
    .toEqual([["Organ.sf2", false], ["Lute.sf2", true]]);
});

it("makes Default's available Gedackt current before preloading another window's remembered banks", async () => {
  const name = "PlainsoundOrganGedackt.sf2";
  rememberPerformanceBanks([], [{ name: "Organ.sf2" }], true);
  mocks.read.mockResolvedValue({ blob: new Blob(["bank"]) });
  mocks.load.mockResolvedValue({ presets: [] });
  await restoreSoundfontSession({ restoreSelectedSound: true });
  expect(mocks.load.mock.calls.map(([source, options]) => [source.name, options.preferredPreset, !!options.prepareOnly]))
    .toEqual([[name, "0:1", false], ["Organ.sf2", undefined, true]]);
});

it("restores the edited current bank on same-window reload", async () => {
  sessionStorage.setItem(LAST_SOUNDFONT_KEY, JSON.stringify({ name: "Edited.sf2" }));
  mocks.read.mockResolvedValue({ blob: new Blob(["bank"]) });
  await restoreSoundfontSession({ restoreSelectedSound: true, preferredPreset: "0:4" });
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "Edited.sf2" }),
    expect.objectContaining({ preferredPreset: "0:4" }));
});
