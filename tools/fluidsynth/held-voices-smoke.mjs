/** Real-WASM continuity and retirement check. Usage: node tools/fluidsynth/held-voices-smoke.mjs /path/to/sustaining.sf2 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

let Processor;
const scope = createContext({ console, TextDecoder, TextEncoder, sampleRate: 48000, currentFrame: 0,
  AudioWorkletProcessor: class {}, registerProcessor: (_, type) => { Processor = type; } });
runInContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), scope);
runInContext(readFileSync("vendor/fluidsynth/fluidsynth.js", "utf8")
  .replaceAll("import.meta.url", JSON.stringify(new URL("../../vendor/fluidsynth/fluidsynth.js", import.meta.url).href))
  .replace("export default createFluidSynth;", ""), scope);
const module = await scope.createFluidSynth({ wasmBinary: readFileSync("vendor/fluidsynth/fluidsynth.wasm"), locateFile: () => "" });
const bytes = readFileSync(process.argv[2]);
const loadNative = module._ps_load_soundfont;
let nativeLoads = 0;
module._ps_load_soundfont = (...args) => { nativeLoads++; return loadNative(...args); };
const errors = [];
const loadTimings = [];
function make(sequence) {
  const processor = Object.create(Processor.prototype);
  Object.assign(processor, { module, synth: module._ps_create(48000), blockSize: 128,
    leftPointer: module._malloc(512), rightPointer: module._malloc(512),
    midiQueue: [], soundfontSequence: sequence,
    port: { postMessage: message => {
      if (message.type === "error") errors.push(message);
      if (message.type === "soundfont-loaded") loadTimings.push(message.loadTimingMs);
    } } });
  processor.initializeChannelTunings();
  processor.handleMessage({ type: "load-soundfont", bytes, cacheKey: `bank-${sequence}`, reverbSend: 0 });
  return processor;
}
const processor = make(0), reference = make(1000);
const render = p => {
  const channels = [new Float32Array(128), new Float32Array(128)];
  assert.equal(p.process([], [channels]), true);
  return channels[0];
};
for (const p of [processor, reference]) p.dispatchCommand({ channel: 0, op: "on", a: 60, b: 100 });
for (let i = 0; i < 32; i++) { render(processor); render(reference); scope.currentFrame += 128; }
const synth = processor.synth, first = processor.soundfontId;
const oldPath = processor.soundfontFiles.get(first).path;
const voices = module._ps_active_voice_count(synth);
assert.ok(voices > 0, "Use a fixture with a sustaining first preset");
assert.notEqual(module._ps_unload_soundfont(synth, first), 0, "Adapter must reject unloading while voices play");
processor.handleMessage({ type: "replace-soundfont", bytes, cacheKey: "bank-B", reverbSend: 0 });
assert.deepEqual(errors, []);
assert.equal(processor.synth, synth);
assert.notEqual(processor.soundfontId, first);
assert.equal(module._ps_active_voice_count(synth), voices, "Replacement must neither kill nor reattack old voices");
let maximumDifference = 0, peak = 0;
for (let block = 0; block < 32; block++) {
  const actual = render(processor), expected = render(reference);
  for (let i = 0; i < actual.length; i++) {
    maximumDifference = Math.max(maximumDifference, Math.abs(actual[i] - expected[i]));
    peak = Math.max(peak, Math.abs(actual[i]));
  }
  scope.currentFrame += 128;
}
assert.ok(peak > 1e-5, "Continuity comparison must contain audible signal");
assert.ok(maximumDifference < 1e-6, `Held waveform changed: ${maximumDifference}`);
assert.ok(processor.retiredSoundfonts.has(first));
processor.dispatchCommand({ channel: 1, op: "on", a: 64, b: 100 });
render(processor);
assert.ok(module._ps_active_voice_count(synth) > voices, "New attacks must join the retained voices");
const beforeWarmSwitch = nativeLoads;
const activeBeforeWarmSwitch = module._ps_active_voice_count(synth);
for (const cacheKey of ["bank-0", "bank-B"]) processor.handleMessage({ type: "select-cached-soundfont", cacheKey });
assert.equal(nativeLoads, beforeWarmSwitch, "Resident switches must not parse the SoundFont again");
assert.equal(module._ps_active_voice_count(synth), activeBeforeWarmSwitch);
processor.handleMessage({ type: "replace-soundfont", bytes, cacheKey: "bank-C", deferWhenPlaying: true, requestId: 99 });
assert.equal(nativeLoads, beforeWarmSwitch, "Cold loading must wait while old notes play");
processor.handleMessage({ type: "midi-batch", events: [{ command: { channel: 2, op: "on", a: 67, b: 100 } }] });
let finalFade;
for (let block = 0; block < 15; block++) {
  finalFade = render(processor);
  scope.currentFrame += 128;
}
assert.equal(nativeLoads, beforeWarmSwitch, "All 40 ms of fade must render before native loading");
assert.equal(Math.abs(finalFade.at(-1)), 0);
render(processor);
assert.equal(nativeLoads, beforeWarmSwitch + 1);
assert.ok(module._ps_active_voice_count(synth) > 0, "The triggering note must play after loading");
processor.soundfontCacheBudget = 0; // Exercise LRU eviction after release.
processor.dispatchCommand({ channel: 2, op: "off", a: 67 });
processor.dispatchCommand({ channel: 0, op: "off", a: 60 });
processor.dispatchCommand({ channel: 1, op: "off", a: 64 });
for (let block = 0; block < 6000 && (module._ps_active_voice_count(synth) || processor.retiredSoundfonts.size); block++) {
  scope.currentFrame += 128;
  render(processor);
}
assert.equal(module._ps_active_voice_count(synth), 0);
assert.equal(processor.retiredSoundfonts.size, 0);
assert.equal(module.FS.analyzePath(oldPath).exists, false);
assert.ok(module._ps_get_preset_count(synth, first) < 0, "Retired native bank must be unloaded");
assert.deepEqual(errors, []);
for (const p of [processor, reference]) {
  module._ps_destroy(p.synth);
  module._free(p.leftPointer); module._free(p.rightPointer);
  for (const file of p.soundfontFiles.values()) module.FS.unlink(file.path);
}
console.log(`Real WASM: held waveform preserved (max difference ${maximumDifference}), resident switches avoid loading, cold switches fade 40 ms, banks/files evicted`);

// Waveform continuity is distinct from meeting the real-time render deadline.
// The current synchronous bank loader can exceed this budget despite matching
// the reference waveform exactly once rendering resumes.
console.log(JSON.stringify({ renderBlockBudgetMs: 128 / 48000 * 1000,
  synchronousLoadMs: loadTimings.map(t => t.virtualFile + t.nativeLoad + t.presetSetup) }));
