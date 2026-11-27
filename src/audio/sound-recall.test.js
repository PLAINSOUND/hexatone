import { beforeEach, expect, it, vi } from "vitest";
import { ACTIVE_SOUND_KEY, PATCH_REARTICULATION_KEY } from "../persistence/io-reload-policy.js";
import { BUILTIN_USER_SOUNDS } from "../persistence/user-sounds.js";
import { createSoundRecall } from "./sound-recall.js";

const fluid = vi.hoisted(() => ({ engine: null, load: vi.fn() }));
vi.mock("../fluidsynth_synth/index.js", () => ({
  peekFluidSynthEngine: () => fluid.engine,
  loadFluidSynthSoundFont: fluid.load,
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
