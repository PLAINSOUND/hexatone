import { beforeEach, expect, it, vi } from "vitest";
import { LAST_SOUNDFONT_KEY, restoreLocalSoundfont } from "./restore-local-soundfont.js";
const mocks = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), peek: vi.fn() }));
vi.mock("./soundfont-storage.js", async importOriginal => ({
  readOfflineSoundfont: mocks.read,
  soundfontStorageKey: (await importOriginal()).soundfontStorageKey,
}));
vi.mock("./index.js", () => ({ loadFluidSynthSoundFont: mocks.load, peekFluidSynthEngine: mocks.peek }));
beforeEach(() => {
  localStorage.clear();
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
