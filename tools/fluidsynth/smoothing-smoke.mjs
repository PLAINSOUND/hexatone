/** Exercise the real WASM runtime through the worklet, including bank replacement.
 * Usage: node tools/fluidsynth/smoothing-smoke.mjs /path/to/test.sf2
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

let Processor;
const scope = createContext({
  console, TextDecoder, TextEncoder,
  AudioWorkletProcessor: class {}, sampleRate: 48000, currentFrame: 0,
  registerProcessor: (_, processor) => { Processor = processor; },
});
assert.equal(runInContext("typeof performance", scope), "undefined");
// Evaluate both modules in the same restricted realm as an AudioWorklet. Node's
// global Performance API must not mask missing browser-worklet globals.
runInContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), scope);
runInContext(readFileSync("vendor/fluidsynth/fluidsynth.js", "utf8")
  .replaceAll("import.meta.url", JSON.stringify(new URL("../../vendor/fluidsynth/fluidsynth.js", import.meta.url).href))
  .replace("export default createFluidSynth;", ""), scope);
const module = await scope.createFluidSynth({ wasmBinary: readFileSync("vendor/fluidsynth/fluidsynth.wasm"), locateFile: () => "" });
const errors = [];
const processor = Object.create(Processor.prototype);
Object.assign(processor, { module, synth: module._ps_create(48000), midiQueue: [],
  port: { postMessage: message => { if (message.type === "error") errors.push(message); } } });
assert.ok(processor.synth);
processor.initializeChannelTunings();
processor.handleMessage({ type: "set-smoothing", pressureMs: 150, expressionMs: 80, minimumMs: 20 });
processor.applySmoothing();
const originalSetter = module._ps_set_smoothing;
const restored = [];
module._ps_set_smoothing = (...args) => { restored.push(args.slice(1)); return originalSetter(...args); };
const bank = readFileSync(process.argv[2]);
for (const type of ["load-soundfont", "replace-soundfont"]) {
  processor.handleMessage({ type, bytes: bank });
  assert.deepEqual(errors, []);
  assert.ok(processor.soundfontId >= 0);
  const left = module._malloc(128 * 4), right = module._malloc(128 * 4);
  assert.equal(module._ps_note_on(processor.synth, 0, 60, 100), 0);
  assert.equal(module._ps_channel_pressure(processor.synth, 0, 127), 0);
  assert.equal(module._ps_cc(processor.synth, 0, 74, 127), 0);
  for (let block = 0; block < 100; block++) {
    assert.equal(module._ps_render(processor.synth, left, right, 128), 0);
    assert.ok(module.HEAPF32.subarray(left / 4, left / 4 + 128).every(Number.isFinite));
  }
  module._free(left); module._free(right);
}
assert.deepEqual(restored, [[150, 80, 20]]);
// Burst changes while real voices render, then simulate a long-idle return.
const left = module._malloc(128 * 4), right = module._malloc(128 * 4);
Object.assign(processor, { blockSize: 128, leftPointer: left, rightPointer: right });
for (let key = 48; key < 80; key++) assert.equal(module._ps_note_on(processor.synth, 0, key, 90), 0);
const outputs = [[new Float32Array(128), new Float32Array(128)]];
const callsBeforeDrag = restored.length;
for (let block = 0; block < 100; block++) {
  scope.currentFrame = block * 128;
  for (let event = 0; event < 20; event++) processor.handleMessage({ type: "set-smoothing",
    pressureMs: (block * 20 + event) % 251, expressionMs: 80 });
  assert.equal(processor.process([], outputs), true);
  assert.ok(outputs[0].every(channel => channel.every(Number.isFinite)));
}
assert.ok(restored.length - callsBeforeDrag <= 8, "Drag updates must be coalesced at render boundaries");
scope.currentFrame = 48000 * 3600;
processor.handleMessage({ type: "set-smoothing", pressureMs: 0, expressionMs: 0 });
assert.equal(processor.process([], outputs), true);
assert.deepEqual(restored.at(-1), [0, 0, 0]);
assert.deepEqual(errors, []);
module._free(left); module._free(right);
module._ps_destroy(processor.synth);
console.log("Real WASM worklet: smoothing, bank replacement, rapid fader bursts, idle return and rendering passed");
