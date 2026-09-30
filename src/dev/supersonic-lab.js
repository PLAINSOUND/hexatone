/** Development-only A/B surface. Loads pinned local package assets on demand;
 * owns a separate audio context and an isolated native group, not app settings.
 * Optional capture samples SuperSonic directly and queries local scsynth through
 * the bridge without routing diagnostics into the audio engine's traffic counts.
 */
import { COMPARISON_GROUP, COMPARISON_INSTRUMENTS, createComparisonVoice,
  nativeComparisonMessage } from "./supersonic-comparison.js";
import { createPerformanceCapture, downloadPerformanceReport } from "./performance-capture.js";

const el = id => document.getElementById(id);
const log = text => { el("log").textContent = `${text}\n${el("log").textContent}`.slice(0, 12000); };
const values = () => Object.fromEntries(
  ["frequency", "velocity", "level", "mod", "filter", "retrigger"].map(key =>
    [key, el(key).type === "checkbox" ? el(key).checked : el(key).value]),
);
let sonic;
let socket;
let browserVoice;
let nativeVoice;
let nativePort;
let activeCore = null;
let nativeId = COMPARISON_GROUP + 1;
const available = new Set();
let definitionFailure = null;
let capture = null;
let captureTimer = null;
let captureStartedAt = 0;
let captureSampleIndex = 0;
let captureDestination = null;
let activeLabVoice = false;
let lastSonicMetrics = null;
let lastBridgeCounters = null;
const captureActions = { noteOn: 0, noteOff: 0, noteReplace: 0, controlUpdate: 0, panic: 0 };
const protect = fn => async () => { try { await fn(); } catch (error) { log(error.message); } };
const selectedVoice = () => {
  const voice = el("destination").value === "browser" ? browserVoice : nativeVoice;
  if (!voice) throw new Error("Boot/connect the selected destination first.");
  return voice;
};
const release = () => { browserVoice?.release(); nativeVoice?.release(); };
const panic = () => { browserVoice?.panic(); nativeVoice?.panic(); };

const captureStatus = (text) => { el("capture-status").textContent = text; };
const activeSonicMetrics = () => {
  if (!sonic) return null;
  try {
    const metrics = sonic.getMetrics();
    const tree = sonic.getRawTree();
    return {
      metrics,
      nodes: { count: tree.nodeCount, droppedCount: tree.droppedCount },
      audioContext: {
        state: sonic.audioContext?.state ?? null,
        sampleRate: sonic.audioContext?.sampleRate ?? null,
        baseLatency: sonic.audioContext?.baseLatency ?? null,
        outputLatency: sonic.audioContext?.outputLatency ?? null,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
};
const captureSample = () => {
  if (!capture) return;
  const destination = el("destination").value;
  const sample = {
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - captureStartedAt),
    destination,
    engineVariant: destination === "browser" ? activeCore : "local-scsynth-via-osc-bridge",
    instrument: el("instrument").value,
    controls: values(),
    activeLabVoice,
    actions: { ...captureActions },
  };
  if (destination === "browser") {
    sample.superSonic = activeSonicMetrics();
    const currentMetrics = sample.superSonic?.metrics;
    if (currentMetrics && lastSonicMetrics) {
      sample.superSonic.intervalDeltas = {
        processedMessages: currentMetrics.scsynthMessagesProcessed - lastSonicMetrics.scsynthMessagesProcessed,
        droppedMessages: currentMetrics.scsynthMessagesDropped - lastSonicMetrics.scsynthMessagesDropped,
        schedulerDropped: currentMetrics.scsynthSchedulerDropped - lastSonicMetrics.scsynthSchedulerDropped,
        schedulerLates: currentMetrics.scsynthSchedulerLates - lastSonicMetrics.scsynthSchedulerLates,
        wasmErrors: currentMetrics.scsynthWasmErrors - lastSonicMetrics.scsynthWasmErrors,
        audioHealthPct: currentMetrics.audioHealthPct,
        glitchCount: currentMetrics.glitchCount,
        glitchDurationMs: currentMetrics.glitchDurationMs,
      };
    }
    lastSonicMetrics = currentMetrics ?? null;
  }
  const sampleIndex = captureSampleIndex++;
  capture.sample(sample);
  if (destination === "native" && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      diagnostic: "sample",
      requestId: `${captureStartedAt}-${sampleIndex}`,
      port: nativePort,
      sampleIndex,
    }));
  }
};
const startCapture = () => {
  if (capture) {
    const report = capture.report();
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ diagnostic: "stop" }));
    }
    clearInterval(captureTimer);
    captureTimer = null;
    capture = null;
    captureDestination = null;
    el("capture").textContent = "Start performance capture";
    captureStatus("Capture saved as JSON");
    const suffix = report.metadata.destination === "native" ? "osc-bridge" : "supersonic";
    downloadPerformanceReport(report, `hexatone-${suffix}-${Date.now()}.json`);
    log(`Performance capture exported (${report.samples.length} samples).`);
    return;
  }
  const destination = el("destination").value;
  if (destination === "browser" && !sonic) throw new Error("Boot SuperSonic before capturing it.");
  if (destination === "native" && socket?.readyState !== WebSocket.OPEN) {
    throw new Error("Connect the local OSC bridge before capturing it.");
  }
  captureStartedAt = performance.now();
  captureDestination = destination;
  captureSampleIndex = 0;
  lastSonicMetrics = null;
  lastBridgeCounters = null;
  for (const key of Object.keys(captureActions)) captureActions[key] = 0;
  const systemReport = destination === "browser" ? sonic.getSystemReport() : null;
  capture = createPerformanceCapture({
    destination,
    instrument: el("instrument").value,
    controls: values(),
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGb: navigator.deviceMemory ?? null,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      systemReport,
    },
    nativeServer: destination === "native" ? { host: "127.0.0.1", port: nativePort } : null,
    note: "Manual A/B lab capture; perform the same gesture sequence for each destination.",
  });
  if (destination === "native") socket.send(JSON.stringify({ diagnostic: "start" }));
  captureSample();
  captureTimer = setInterval(captureSample, 1000);
  el("capture").textContent = "Stop & download capture";
  captureStatus(`Capturing ${destination}…`);
};

el("boot").onclick = protect(async () => {
  el("boot").disabled = true;
  el("core").disabled = true;
  try {
    // Keep GPL core assets separately served; this page is not a production entry.
    const url = "/node_modules/supersonic-scsynth/dist/supersonic.js";
    const { SuperSonic } = await import(/* @vite-ignore */ url);
    const core = el("core").value;
    activeCore = core;
    const corePath = core === "stock" ? "/node_modules/supersonic-scsynth-core/"
      : `/tools/supersonic/generated/${core}-core/`;
    log(`Engine: ${core}; reload this page to change build.`);
    sonic = new SuperSonic({
      baseURL: new URL("/node_modules/supersonic-scsynth/dist/", location.href).href,
      coreBaseURL: new URL(corePath, location.href).href,
      mode: "postMessage",
      synthdefBaseURL: new URL("/tools/supersonic/generated/", location.href).href,
    });
    sonic.on("error", error => log(`Engine: ${error.message}`));
    sonic.on("in", message => {
      if (message[0] === "/fail") log(JSON.stringify(message));
      if (message[0] === "/fail" && message[1] === "/d_recv") definitionFailure = String(message[2]);
      if (message[0] === "/n_end") browserVoice?.ended(message[1]);
    });
    await sonic.init();
    sonic.send("/notify", 1);
    sonic.send("/g_new", COMPARISON_GROUP, 0, 0);
    for (const name of COMPARISON_INSTRUMENTS) {
      try {
        definitionFailure = null;
        await sonic.loadSynthDef(`hexlab_${name}`);
        // 0.86.0 can resolve loading despite a server /fail. Wait for the
        // command barrier before accepting this definition as playable.
        await sonic.sync();
        if (definitionFailure) throw new Error(definitionFailure);
        available.add(name);
        log(`${name}: loaded`);
      } catch (error) { log(`${name}: unavailable — ${error.message}`); }
    }
    browserVoice = createComparisonVoice((...args) => sonic.send(...args), () => sonic.nextNodeId());
    log(`SuperSonic ready: ${sonic.audioContext.sampleRate} Hz; ${sonic.mode}`);
  } catch (error) {
    await sonic?.destroy();
    sonic = null;
    el("boot").disabled = false;
    el("core").disabled = false;
    throw error;
  }
});

el("connect").onclick = protect(async () => {
  nativePort = Number(el("port").value);
  if (!Number.isInteger(nativePort) || nativePort < 1024 || nativePort > 65535) {
    throw new Error("Invalid native server port");
  }
  el("connect").disabled = true;
  el("port").disabled = true;
  socket = new WebSocket("ws://127.0.0.1:8089");
  socket.onclose = () => {
    nativeVoice = null;
    el("connect").disabled = false;
    el("port").disabled = false;
    log("Bridge disconnected. If native audio remains, stop it in SuperCollider.");
  };
  socket.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message?.diagnostic !== "sample") return;
    if (capture && captureDestination === "native") {
      const bridge = message.bridge ?? null;
      const bridgeInterval = bridge && lastBridgeCounters ? {
        messages: bridge.messages - lastBridgeCounters.messages,
        bytes: bridge.bytes - lastBridgeCounters.bytes,
        sendErrors: bridge.sendErrors - lastBridgeCounters.sendErrors,
      } : null;
      if (bridge) lastBridgeCounters = bridge;
      capture.updateSample(message.sampleIndex, { nativeServerStatus: message.server ?? null,
        bridge, bridgeInterval, diagnosticError: message.error ?? null });
    }
  });
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Start yarn osc-bridge first."));
  });
  const send = (address, ...args) => {
    if (socket.readyState !== WebSocket.OPEN) throw new Error("Bridge unavailable");
    socket.send(JSON.stringify(nativeComparisonMessage(nativePort, address, args)));
  };
  send("/g_new", COMPARISON_GROUP, 0, 0);
  nativeVoice = createComparisonVoice(send, () => nativeId++);
  log(`Bridge connected, native destination ${nativePort}. This is not a server acknowledgement.`);
});
el("attack").onclick = protect(async () => {
  const instrument = el("instrument").value;
  const voice = selectedVoice();
  if (voice === browserVoice) {
    if (!available.has(instrument)) throw new Error(`${instrument} did not load; see log.`);
    await sonic.audioContext.resume();
  }
  if (activeLabVoice) captureActions.noteReplace += 1;
  voice.attack(instrument, values());
  activeLabVoice = true;
  captureActions.noteOn += 1;
});
el("release").onclick = protect(() => {
  release();
  if (activeLabVoice) captureActions.noteOff += 1;
  activeLabVoice = false;
});
el("panic").onclick = protect(() => {
  panic();
  captureActions.panic += 1;
  activeLabVoice = false;
});
el("capture").onclick = protect(startCapture);
el("destination").onchange = protect(panic);
el("instrument").onchange = protect(release);
for (const key of ["frequency", "velocity", "level", "mod", "filter", "retrigger"]) {
  el(key).oninput = protect(() => {
    selectedVoice().update(values());
    captureActions.controlUpdate += 1;
  });
}
window.addEventListener("pagehide", () => {
  clearInterval(captureTimer);
  try { panic(); } catch { /* Native cleanup cannot be guaranteed after disconnect. */ }
  sonic?.destroy();
  socket?.close();
});
log("Compile definitions with tools/supersonic/compile.scd before booting. No CDN used.");
