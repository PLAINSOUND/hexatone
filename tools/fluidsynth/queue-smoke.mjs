/** Check the staged real FluidSynth worklet's cancellation and Panic queues. */
import { chromium } from "../supersonic/upstream-088/node_modules/playwright/index.mjs";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  executablePath: process.env.HEXATONE_BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  const base = process.env.HEXATONE_TEST_URL ?? "http://127.0.0.1:5176";
  await page.goto(`${base}/fluidsynth/README.md`);
  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    await context.resume();
    await context.audioWorklet.addModule("/fluidsynth/processor.js");
    const wasmBytes = await (await fetch("/fluidsynth/fluidsynth.wasm")).arrayBuffer();
    const node = new AudioWorkletNode(context, "hexatone-fluidsynth", {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { wasmBytes },
    });
    const waitFor = type => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Worklet ${type} timeout`)), 10000);
      const listen = ({ data }) => {
        if (data.type !== type && data.type !== "error") return;
        clearTimeout(timer);
        node.port.removeEventListener("message", listen);
        if (data.type === "error") reject(new Error(data.message));
        else resolve(data);
      };
      node.port.addEventListener("message", listen);
      node.port.start();
    });
    await waitFor("ready");
    node.connect(context.destination);
    const frame = Math.ceil((context.currentTime + 10) * context.sampleRate);
    node.port.postMessage({ type: "midi-batch", events: [1, 2].map(owner => ({
      owner, frame, command: { channel: owner, op: "off", a: 60, b: 0 },
    })) });
    node.port.postMessage({ type: "cancel-owner-events", owner: 1 });
    const cleared = waitFor("recovery-cleared");
    node.port.postMessage({ type: "clear-recovery-events" });
    const result = await cleared;
    node.disconnect();
    node.port.close();
    await context.close();
    return result;
  });
  console.log(result);
  assert.equal(result.droppedEvents, 1);
} finally {
  await browser.close();
}
