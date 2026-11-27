/** Render real WASM bends, independent of browser/MIDI mocks.
 * Usage: node tools/fluidsynth/pitch-smoke.mjs [bank.sf2] [program]
 * With no bank, uses a generated pure sine; external recordings allow 2 cents.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { createInternalVoiceSynth } from "../../src/fluidsynth_synth/voices.js";
import { sineSoundfont } from "./sine-soundfont.mjs";

const root = new URL("../../", import.meta.url);
let Processor;
const scope = createContext({ console, TextDecoder, TextEncoder, sampleRate: 48000, currentFrame: 0,
  AudioWorkletProcessor: class {}, registerProcessor: (_, type) => { Processor = type; } });
runInContext(readFileSync(new URL("vendor/fluidsynth/processor.js", root), "utf8").replace(/^import[^\n]*\n/, ""), scope);
runInContext(readFileSync(new URL("vendor/fluidsynth/fluidsynth.js", root), "utf8")
  .replaceAll("import.meta.url", JSON.stringify(new URL("vendor/fluidsynth/fluidsynth.js", root).href))
  .replace("export default createFluidSynth;", ""), scope);
const module = await scope.createFluidSynth({ wasmBinary: readFileSync(new URL("vendor/fluidsynth/fluidsynth.wasm", root)), locateFile: () => "" });
const processor = Object.create(Processor.prototype);
const errors = [];
Object.assign(processor, { module, synth: module._ps_create(48000), blockSize: 128,
  leftPointer: module._malloc(512), rightPointer: module._malloc(512), sysexPointer: module._malloc(8192),
  handledPointer: module._malloc(4), midiQueue: [], midiSequence: 0,
  port: { postMessage: message => { if (message.type === "error") errors.push(message); } } });
assert.ok(processor.synth);
processor.initializeChannelTunings();
processor.handleMessage({ type: "load-soundfont", reverbSend: 0,
  bytes: process.argv[2] ? readFileSync(process.argv[2]) : sineSoundfont() });
assert.deepEqual(errors, []);
const program = Number(process.argv[3] ?? 0);

function renderSettled() {
  const audio = new Float32Array(32768);
  for (let i = 0; i < audio.length; i += 128) {
    const channels = [new Float32Array(128), new Float32Array(128)];
    processor.process([], [channels]);
    audio.set(channels[0], i);
    scope.currentFrame += 128;
  }
  return audio.slice(16384);
}

function frequency(audio, expected) {
  const correlations = [];
  let best = -Infinity, bestLag = 0, peak = 0;
  for (const value of audio) peak = Math.max(peak, Math.abs(value));
  assert.ok(peak > 1e-5, "Pitch measurement must contain audible signal");
  for (let lag = Math.max(2, Math.floor(48000 / expected * 0.65)); lag <= Math.ceil(48000 / expected * 1.5); lag++) {
    let sum = 0, left = 0, right = 0;
    for (let i = 0; i < audio.length - lag; i++) {
      sum += audio[i] * audio[i + lag];
      left += audio[i] ** 2;
      right += audio[i + lag] ** 2;
    }
    correlations[lag] = sum / Math.sqrt(left * right);
    if (correlations[lag] > best) { best = correlations[lag]; bestLag = lag; }
  }
  assert.ok(best > 0.9, "Pitch measurement needs a periodic signal");
  const a = correlations[bestLag - 1], b = correlations[bestLag], c = correlations[bestLag + 1];
  const offset = Number.isFinite(a) && Number.isFinite(c) ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
  return 48000 / (bestLag + offset);
}

const results = [];
for (const pitchBendRange of [48, 96]) {
  let renderCommands = false;
  const output = { reverbSend: 0, attackProgram: { soundfontId: processor.soundfontId, bank: 0, program },
    sendCommand: command => { if (renderCommands) processor.dispatchCommand(command); },
    send: bytes => { if (renderCommands) processor.dispatchMidi(bytes); } };
  const synth = createInternalVoiceSynth({ outputMode: { output, velocity: 100, pitchBendRange },
    tuningContext: { fundamental: 440 } });
  const expectedChannel = pitchBendRange === 48 ? 0 : 128;
  for (let channel = 0; channel < expectedChannel; channel++) {
    synth.makeHex(null, 0, 0, 0, 12, -100, 100, null, 100, null, 1).noteOn();
  }
  renderCommands = true;
  const note = synth.makeHex(null, 0, 0, 0, 12, -100, 100, null, 100, null, 1);
  note.noteOn(); note.pressure(process.argv[2] ? 100 : 0);
  assert.equal(note.channel, expectedChannel);
  for (const cents of [0, 100, 500, 1200, 2400, 0, -500, -1200]) {
    note.retune(cents);
    const expected = 440 * 2 ** (cents / 1200);
    const errorCents = 1200 * Math.log2(frequency(renderSettled(), expected) / expected);
    // Non-octave targets also include 14-bit bend and native cents-table
    // quantization. Exact octaves must track much more closely on the sine.
    const tolerance = process.argv[2] ? 2 : cents % 1200 === 0 ? 0.1 : 1.6;
    assert.ok(Math.abs(errorCents) < tolerance,
      `Range ${pitchBendRange}, bend ${cents}: pitch error ${errorCents.toFixed(3)} cents`);
    results.push({ pitchBendRange, cents, errorCents });
  }
  synth.shutdown();
}
assert.deepEqual(errors, []);
module._ps_destroy(processor.synth);
console.log(JSON.stringify({ fixture: process.argv[2] ?? "generated sine", measurements: results.length,
  maximumErrorCents: Math.max(...results.map(result => Math.abs(result.errorCents))) }));
