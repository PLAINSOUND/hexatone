/** Local WASM compatibility/render probe using upstream's Playwright dependency.
 * Serves only this checkout on loopback; no production server/config changes.
 * Run: node tools/supersonic/browser-smoke.mjs baseline|dfm1 [postMessage|sab]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "./upstream-088/node_modules/playwright/index.mjs";

const core = process.argv[2] ?? "dfm1";
const mode = process.argv[3] ?? "postMessage";
const envelopes = process.argv[4] === "envelopes";
const cycles = process.argv[4] === "cycles";
assert(["baseline", "dfm1"].includes(core));
assert(["postMessage", "sab"].includes(mode));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = createServer(async (req, res) => {
  if (mode === "sab") {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (name === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Audio probe</title>"); return; }
  const file = path.resolve(root, `.${name}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".js") ? "text/javascript" : "application/octet-stream");
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.HEXATONE_BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  page.on("pageerror", error => console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async ({ core, mode, envelopes, cycles }) => {
    const { SuperSonic } = await import("/node_modules/supersonic-scsynth/dist/supersonic.js");
    const sonic = new SuperSonic({
      baseURL: new URL("/node_modules/supersonic-scsynth/dist/", location.href).href,
      coreBaseURL: new URL(`/tools/supersonic/generated/${core}-core/`, location.href).href,
      mode, audioContextOptions: { sampleRate: 48000 },
    });
    const failures = [];
    const ended = new Set();
    sonic.on("in", msg => { if (msg[0] === "/fail") failures.push(msg); });
    sonic.on("in", msg => { if (msg[0] === "/n_end") ended.add(msg[1]); });
    const result = { core, mode, instruments: [] };
    try {
      await sonic.init();
      await sonic.audioContext.resume();
      sonic.send("/notify", 1);
      sonic.send("/g_new", 991, 0, 0);
      const analyser = sonic.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      sonic.node.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      for (const name of ["string", "formant", "pluck", "tone"]) {
        const before = failures.length;
        await sonic.loadSynthDef(`/tools/supersonic/generated/hexlab_${name}.scsyndef`);
        await sonic.sync();
        const loadErrors = failures.slice(before);
        if (loadErrors.length) { result.instruments.push({ name, loaded: false, errors: loadErrors }); continue; }
        const node = sonic.nextNodeId();
        sonic.send("/s_new", `hexlab_${name}`, node, 0, 991,
          "freq", 220, "on_vel", 80, "vol", 0.06, "gate", 1, "sustain_mode", name === "formant" ? 0 : 1);
        let peak = 0, finite = true;
        // Observe render output, not just successful definition loading.
        for (let n = 0; n < 20; n++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          analyser.getFloatTimeDomainData(data);
          for (const sample of data) { finite &&= Number.isFinite(sample); peak = Math.max(peak, Math.abs(sample)); }
        }
        sonic.send("/n_set", node, "freq", 330, "expressionY", 0.7, "pressure", 0.5);
        await new Promise(resolve => setTimeout(resolve, 100));
        if (name === "formant") {
          const deadline = performance.now() + 8000;
          while (!ended.has(node) && performance.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (!ended.has(node)) throw new Error("Formant did not automatically free its node");
        } else sonic.send("/n_set", node, "gate", 0);
        sonic.send("/g_freeAll", 991);
        await sonic.sync();
        result.instruments.push({ name, loaded: true, peak, finite, errors: failures.slice(before) });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (envelopes) {
        result.envelopes = [];
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const peak = () => {
          analyser.getFloatTimeDomainData(data);
          return Math.max(...data.map(Math.abs));
        };
        for (const name of ["string", "formant"]) {
          for (const quick of [0, 1]) {
            const node = sonic.nextNodeId();
            sonic.send("/s_new", `hexlab_${name}`, node, 0, 991,
              "freq", 220, "on_vel", 80, "off_vel", 64, "vol", 0.1,
              "gate", 1, "retrigger_mode", 1, "quick_release", quick, "quick_release_time", 0.05);
            await wait(100);
            const earlyPeak = peak();
            await wait(4100);
            const heldPeak = peak();
            const aliveWhileHeld = !ended.has(node);
            sonic.send("/n_set", node, "gate", 0);
            await wait(300);
            const aliveAfter300ms = !ended.has(node);
            const deadline = performance.now() + 4500;
            while (!ended.has(node) && performance.now() < deadline) await wait(50);
            result.envelopes.push({ name, quick, earlyPeak, heldPeak, aliveWhileHeld,
              aliveAfter300ms, ended: ended.has(node) });
          }
        }
      }
      if (cycles) {
        result.cycles = [];
        for (const name of ["string", "formant"]) {
          const node = sonic.nextNodeId();
          sonic.send("/s_new", `hexlab_${name}`, node, 0, 991, "freq", 220,
            "on_vel", 80, "vol", 0.1, "gate", 1, "retrigger_mode", 1,
            "quick_release", 1, "quick_release_time", 0.05);
          let latePeak = 0, quietSamples = 0;
          for (let n = 0; n < 440; n++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            analyser.getFloatTimeDomainData(data);
            const peak = Math.max(...data.map(Math.abs));
            if (n > 260) latePeak = Math.max(latePeak, peak);
            if (n > 80 && peak < 0.000001) quietSamples++;
          }
          const alive = !ended.has(node);
          sonic.send("/n_set", node, "gate", 0);
          await new Promise(resolve => setTimeout(resolve, 500));
          result.cycles.push({ name, latePeak, quietSamples, alive, ended: ended.has(node) });
        }
      }
      return result;
    } finally { await sonic.destroy(); }
  }, { core, mode, envelopes, cycles });
  console.log(JSON.stringify(result, null, 2));
  for (const instrument of result.instruments) {
    if (core === "baseline" && ["pluck", "tone"].includes(instrument.name)) {
      assert(!instrument.loaded && instrument.errors.some(msg => msg.join(" ").includes("DFM1")));
    } else {
      assert(instrument.loaded, `${instrument.name} did not load`);
      assert(instrument.finite && instrument.peak > 0 && instrument.peak < 1, `${instrument.name} invalid/silent output`);
      assert.equal(instrument.errors.length, 0);
    }
  }
  for (const envelope of result.envelopes ?? []) {
    assert(envelope.aliveWhileHeld && envelope.heldPeak > 0, `${envelope.name} did not sustain`);
    assert(envelope.earlyPeak < envelope.heldPeak, `${envelope.name} attack was not soft`);
    assert.equal(envelope.aliveAfter300ms, envelope.quick === 0);
    assert(envelope.ended, `${envelope.name} did not finish its release`);
  }
  for (const cycle of result.cycles ?? []) {
    assert(cycle.latePeak > 0.000001, `${cycle.name} did not recur`);
    assert(cycle.quietSamples > 0, `${cycle.name} did not complete separate cycles`);
    assert(cycle.alive && cycle.ended, `${cycle.name} incorrect lifetime`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
