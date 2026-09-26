/** Exercises Hexatone's real local OSC adapter against a running Vite server. */
import { chromium } from "./upstream/node_modules/playwright/index.mjs";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
const production = process.argv.includes("--production");
const productionChunk = production
  ? (await readdir(new URL("../../build/assets/", import.meta.url))).find(name => /^supersonic_synth-.*\.js$/.test(name))
  : null;
const browser = await chromium.launch({
  executablePath: process.env.HEXATONE_BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const base = process.env.HEXATONE_TEST_URL ?? "http://127.0.0.1:5176";
  await page.goto(production ? `${base}/` : `${base}/supersonic-lab.html`);
  await page.waitForLoadState("networkidle");
  const result = await page.evaluate(async (moduleUrl) => {
    const NativeContext = window.AudioContext;
    let context;
    window.AudioContext = class extends NativeContext { constructor(options) { super(options); context = this; } };
    const originalConnect = AudioNode.prototype.connect;
    let analyser;
    AudioNode.prototype.connect = function (...args) {
      if (this instanceof AudioWorkletNode) {
        analyser = this.context.createAnalyser();
        originalConnect.call(this, analyser);
      }
      return originalConnect.apply(this, args);
    };
    const module = await import(moduleUrl);
    const create_supersonic_synth = module.create_supersonic_synth ?? Object.values(module).find(value => typeof value === "function");
    const synth = await create_supersonic_synth(undefined, undefined, [0.03, 0.03, 0.03, 0.03]);
    await synth.prepare();
    const note = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    note.noteOn();
    synth.applyZoneModwheel(60);
    await new Promise(resolve => setTimeout(resolve, 800));
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    const peak = Math.max(...data.map(Math.abs));
    const future = synth.makeHex({ x: 1, y: 0 }, 700, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    future.noteOn(performance.now() + 150);
    synth.allSoundOff();
    await new Promise(resolve => setTimeout(resolve, 400));
    analyser.getFloatTimeDomainData(data);
    const panicPeak = Math.max(...data.map(Math.abs));
    synth.shutdown({ panic: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    const contextState = context.state;
    const smooth = await create_supersonic_synth(undefined, undefined, [0, 0, 0, 0.1]);
    await smooth.prepare();
    smooth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1).noteOn();
    await new Promise(resolve => setTimeout(resolve, 800));
    smooth.shutdown();
    await new Promise(resolve => setTimeout(resolve, 50));
    analyser.getFloatTimeDomainData(data);
    const releasePeak = Math.max(...data.map(Math.abs));
    const releaseState = context.state;
    const deadline = performance.now() + 9000;
    while (context.state !== "closed" && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { peak, panicPeak, contextState, releasePeak, releaseState, drainedState: context.state };
  }, production ? `${base}/assets/${productionChunk}` : "/src/supersonic_synth/index.js");
  console.log(result);
  assert(result.peak > 0 && result.peak < 1);
  assert(result.panicPeak < 0.00001);
  assert.equal(result.contextState, "closed");
  assert(result.releasePeak > 0);
  assert.equal(result.releaseState, "running");
  assert.equal(result.drainedState, "closed");
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
