import { beforeEach, expect, it, vi } from "vitest";
import { ACTIVE_SOUND_KEY, PATCH_REARTICULATION_KEY } from "../persistence/io-reload-policy.js";
import { BUILTIN_USER_SOUNDS } from "../persistence/user-sounds.js";
import { createSoundRecall } from "./sound-recall.js";

const fluid = vi.hoisted(() => ({ engine: null, load: vi.fn(), stop: vi.fn() }));
vi.mock("../fluidsynth_synth/index.js", async original => ({
  waitForColdBankGap: (await original()).waitForColdBankGap,
  isFluidSynthEngineRunning: (await original()).isFluidSynthEngineRunning,
  ensureFluidSynthEngineAwake: vi.fn(async () => true),
  stopFluidSynthEngine: fluid.stop,
  peekFluidSynthEngine: () => fluid.engine,
  loadFluidSynthSoundFont: fluid.load,
}));

const readBank = vi.hoisted(() => vi.fn());
vi.mock("../fluidsynth_synth/soundfont-storage.js", async original => ({
  ...await original(), readWorkingSoundfont: readBank,
}));

const sound = name => BUILTIN_USER_SOUNDS.find(record => record.name === name);

beforeEach(() => {
  fluid.load.mockReset();
  fluid.engine = null;
  localStorage.clear();
  sessionStorage.clear();
});

it("recalls a resident bank with no sidebar and publishes readiness and selection", async () => {
  const reed = sound("Reed Organ");
  fluid.engine = { soundfontSource: { name: reed.soundfont.name }, selectPreset: vi.fn() };
  const beginPatch = vi.fn();
  const updateBank = vi.fn();
  const recall = createSoundRecall(() => ({ beginPatch, updateBank, discardEdits: vi.fn() }));
  expect(await recall.recall(reed)).toBe(true);
  const [updates, policy, bankReady, mix] = beginPatch.mock.lastCall;
  const [bank, program] = reed.soundfont.preset.split(":").map(Number);
  expect(updates).toMatchObject({ output_fluidsynth: true, fluidsynth_preset: reed.soundfont.preset });
  expect(policy).toBe("preserve");
  expect(await bankReady).toBe(true);
  expect(mix).toEqual(reed.soundfont);
  expect(fluid.engine.selectPreset).toHaveBeenCalledExactlyOnceWith({ bank, program }, { deferAttackProgram: true });
  expect(updateBank).toHaveBeenCalledExactlyOnceWith(reed.soundfont.preset, false);
  expect(fluid.load).not.toHaveBeenCalled();
  expect(recall.state).toMatchObject({ phase: "complete", name: reed.soundfont.name });
  expect(JSON.parse(sessionStorage.getItem(ACTIVE_SOUND_KEY))).toMatchObject({ builtinName: reed.name });
});

it("aborts a waiting recall when a new sound is selected and ignores its late result", async () => {
  const reed = sound("Reed Organ");
  const next = sound("Harpsichord");
  fluid.engine = { soundfontSource: { name: next.soundfont.name }, selectPreset: vi.fn(),
    soundfontCache: { keys: [`https://soundfonts.plainsound.org/${reed.soundfont.name}`] } };
  let signal;
  let finishLoad;
  fluid.load.mockImplementation((_source, options) => {
    signal = options.signal;
    options.onWaitingForSilence();
    return new Promise(resolve => { finishLoad = resolve; });
  });
  const beginPatch = vi.fn();
  const updateBank = vi.fn();
  const recall = createSoundRecall(() => ({ beginPatch, updateBank, discardEdits: vi.fn() }));

  const earlier = recall.recall(reed);
  expect(recall.state.phase).toBe("waiting");
  localStorage.setItem(PATCH_REARTICULATION_KEY, "true");
  expect(await recall.recall(next)).toBe(true);
  expect(signal.aborted).toBe(true);
  expect(beginPatch.mock.lastCall[1]).toBe("rearticulate");
  expect(await beginPatch.mock.calls[0][2]).toBe(false);

  finishLoad({ selectedPreset: { bank: 0, program: 1 } });
  expect(await earlier).toBe(false);
  expect(updateBank).toHaveBeenCalledExactlyOnceWith(next.soundfont.preset, false);
  expect(recall.state).toMatchObject({ phase: "complete", name: next.soundfont.name, revision: 2 });
});

it("names the locally available slim bank without reading its bytes when recall would exceed the budget", async () => {
  const name = "PlainsoundHarpsichordLute.sf2";
  const blob = { size: 60, arrayBuffer: vi.fn() };
  readBank.mockImplementation(async key => key.endsWith(name) ? { blob } : null);
  fluid.engine = { soundfontCache: { keys: [], estimatedBytes: 60, budgetBytes: 100 } };
  const recall = createSoundRecall(() => ({ beginPatch: vi.fn(), discardEdits: vi.fn() }));
  expect(await recall.recall(sound("Harpsichord"))).toBe(false);
  expect(recall.state).toMatchObject({ phase: "over-budget", name,
    message: 'Preload memory full. Please select PlainsoundHarpsichordLute.sf2 manually in "Current SoundFont".' });
  expect(blob.arrayBuffer).not.toHaveBeenCalled();
  expect(fluid.load).not.toHaveBeenCalled();
});

it("waits for held notes then replaces the old bank and selects the local preset", async () => {
  const name = "PlainsoundHarpsichordLute.sf2";
  readBank.mockImplementation(async key => key.endsWith(name) ? { blob: { size: 40 } } : null);
  fluid.engine = { soundfontCache: { keys: [], estimatedBytes: 60, budgetBytes: 100 } };
  let silent = false;
  const updateBank = vi.fn();
  const recall = createSoundRecall(() => ({
    beginPatch: vi.fn(), discardEdits: vi.fn(), canLoadColdBank: () => silent, updateBank,
  }));
  fluid.load.mockResolvedValue({ selectedPreset: { bank: 0, program: 0 } });
  const phases = [];
  recall.changes.addEventListener("change", () => phases.push(recall.state.phase));
  const ready = recall.recall(sound("Harpsichord"));
  await vi.waitFor(() => expect(recall.state.phase).toBe("waiting"));
  expect(fluid.stop).not.toHaveBeenCalled();
  silent = true;
  expect(await ready).toBe(true);
  expect(phases).toEqual(["checking", "waiting", "loading", "complete"]);
  expect(fluid.stop).not.toHaveBeenCalled();
  expect(recall.state.name).toBe(name);
  expect(updateBank).toHaveBeenCalledWith("0:0", true);
});

it("keeps sustain on the playing patch and commits only the last cold bank after release", async () => {
  const name = "Reed Organ";
  localStorage.setItem(PATCH_REARTICULATION_KEY, "true");
  readBank.mockResolvedValue({ blob: { size: 40 } });
  fluid.load.mockResolvedValue({ presets: [] });
  let held = true;
  const beginPatch = vi.fn();
  const recall = createSoundRecall(() => ({
    beginPatch, discardEdits: vi.fn(), updateBank: vi.fn(), canLoadColdBank: () => !held,
  }));
  const first = recall.recall(sound("Harpsichord"));
  const last = recall.recall(sound(name));
  expect(await first).toBe(false);
  expect(recall.state.phase).toBe("waiting");
  expect(beginPatch).not.toHaveBeenCalled();
  expect(fluid.load).not.toHaveBeenCalled();
  held = false;
  expect(await last).toBe(true);
  expect(beginPatch).toHaveBeenCalledTimes(1);
  expect(beginPatch.mock.lastCall[1]).toBe("preserve");
  expect(fluid.load.mock.calls.map(([source]) => source.name)).toEqual(
    sound(name).settings.output_fluidsynth ? [recall.state.name] : []);
  expect(recall.selection.name).toBe(name);
});

it.each(["Reed Organ", "Test Tone", "Hammond"])("cancels a cold recall and activates %s while sustain is held", async name => {
  localStorage.setItem(PATCH_REARTICULATION_KEY, "true");
  const original = sound("Reed Organ");
  fluid.engine = { soundfontSource: { name: original.soundfont.name }, selectPreset: vi.fn() };
  const beginPatch = vi.fn();
  const recall = createSoundRecall(() => ({
    beginPatch, discardEdits: vi.fn(), updateBank: vi.fn(), canLoadColdBank: () => false,
  }));
  await recall.recall(original);
  beginPatch.mockClear();
  const cancelled = recall.recall(sound("Harpsichord"));
  expect(recall.state.phase).toBe("waiting");
  expect(await recall.recall(sound(name))).toBe(true);
  expect(await cancelled).toBe(false);
  expect(recall.state.phase).toBe("complete");
  expect(beginPatch).toHaveBeenCalledTimes(1);
  expect(beginPatch.mock.lastCall[1]).toBe("rearticulate");
  expect(fluid.load).not.toHaveBeenCalled();
});

it.each(["current", "cached", "suspended", "absent"])("recalls Baroque Organ from sustained Hammond with a %s bank", async mode => {
  const organ = sound("Baroque Organ");
  const name = organ.soundfont.name;
  fluid.engine = mode === "absent" ? null : {
    soundfontId: 1, node: {}, context: { state: mode === "suspended" ? "suspended" : "running" },
    soundfontSource: { name: mode === "cached" ? "Other.sf2" : name },
    soundfontCache: { keys: [`https://soundfonts.plainsound.org/${name}`] }, selectPreset: vi.fn(),
  };
  readBank.mockResolvedValue({ blob: { size: 40 } });
  fluid.load.mockResolvedValue({ presets: [] });
  const beginPatch = vi.fn();
  let held = true;
  const recall = createSoundRecall(() => ({
    fluidOutputEnabled: false, canLoadColdBank: () => !held,
    discardEdits: vi.fn(), beginPatch, updateBank: vi.fn(),
  }));
  await recall.recall(sound("Hammond"));
  beginPatch.mockClear();
  const ready = recall.recall(organ);
  if (mode !== "current") {
    expect(recall.state.phase).toBe("waiting");
    expect(beginPatch).not.toHaveBeenCalled();
    expect(fluid.load).not.toHaveBeenCalled();
    held = false;
  }
  expect(await ready).toBe(true);
  expect(beginPatch).toHaveBeenCalledTimes(1);
  expect(recall.state.phase).toBe("complete");
});

it("rearticulates sustained notes immediately with a resident non-current Organ bank", async () => {
  localStorage.setItem(PATCH_REARTICULATION_KEY, "true");
  const organ = sound("Baroque Organ");
  const bank = organ.soundfont.fallback;
  fluid.engine = { soundfontId: 1, node: {}, context: { state: "running" },
    soundfontSource: { name: "Other.sf2" }, soundfontCache: { keys: [`https://soundfonts.plainsound.org/${bank.name}`] } };
  fluid.load.mockResolvedValue({ presets: [] });
  const beginPatch = vi.fn();
  const recall = createSoundRecall(() => ({
    fluidOutputEnabled: false, canLoadColdBank: () => false, discardEdits: vi.fn(), beginPatch, updateBank: vi.fn(),
  }));
  const phases = [];
  recall.changes.addEventListener("change", () => phases.push(recall.state.phase));
  expect(await recall.recall(organ)).toBe(true);
  expect(beginPatch.mock.lastCall[1]).toBe("rearticulate");
  expect(recall.state.name).toBe(bank.name);
  expect(phases).not.toContain("waiting");
});

it("restarts a shut-down local SuperSonic server when the selected patch uses it", async () => {
  const beginPatch = vi.fn();
  const recall = createSoundRecall(() => ({ beginPatch, localServerOff: true, discardEdits: vi.fn() }));
  await recall.recall(sound("Hammond"));
  expect(beginPatch.mock.lastCall[0]).not.toHaveProperty("osc_server_off");
  const record = sound("Harpsichord");
  fluid.engine = { soundfontSource: record.soundfont };
  await recall.recall(record);
  expect(beginPatch.mock.lastCall[0]).toMatchObject({ output_osc: true, osc_server_off: false });
});
