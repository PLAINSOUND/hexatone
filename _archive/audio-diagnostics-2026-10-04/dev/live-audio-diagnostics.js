/**
 * Opt-in production-path audio/input capture for diagnosing live performance.
 * Enable in I/O or call globalThis.__hexatoneAudioDiagnostics.start()/stop().
 * No event payloads are retained; captures contain rates, counters and samples.
 */
import { createPerformanceCapture, downloadPerformanceReport } from "./performance-capture.js";

let running = false;
let capture = null;
let timer = null;
let context = {};
let provider = null;
let bridge = null;
let bridgeTimer = null;
let bridgeRequest = 0;
let bridgeSamples = [];
let bridgePortIndex = 0;
let activePointers = new Set();
let longTaskObserver = null;
let longTasks = { count: 0, totalMs: 0, maxMs: 0 };
let previousSampleAt = null;
let lastReport = null;
let timeline = [];
const backendProviders = new Map();
const diagnosticsListeners = new Set();
const diagnosticActions = new Set();
export function subscribeAudioDiagnosticActions(listener) {
  diagnosticActions.add(listener);
  return () => diagnosticActions.delete(listener);
}
const notifyDiagnostics = () => diagnosticsListeners.forEach(listener => listener(running));

export function subscribeAudioDiagnostics(listener) {
  diagnosticsListeners.add(listener);
  listener(running);
  return () => diagnosticsListeners.delete(listener);
}

export function registerAudioDiagnosticBackend(name, read) {
  backendProviders.set(name, read);
  return () => { if (backendProviders.get(name) === read) backendProviders.delete(name); };
}

function record(name, detail = {}) {
  if (!running || !capture) return;
  capture.event(name);
  if (name === "audible-failure" || name === "backend-toggle" || name.includes("error")) {
    timeline.push({ name, elapsedMs: Math.round(performance.now() - startedAt), detail });
    if (timeline.length > 500) timeline.shift();
  }
  const events = context.eventDetails ?? (context.eventDetails = {});
  const current = events[name] ?? { count: 0, last: null };
  current.count += 1;
  current.last = detail;
  events[name] = current;
}

function bridgeSend(payload) {
  if (bridge?.readyState === WebSocket.OPEN) bridge.send(JSON.stringify(payload));
}

function startBridgeCapture(url) {
  if (!url || !/^wss?:/.test(url)) return;
  try {
    bridge = new WebSocket(url);
    bridge.onopen = () => bridgeSend({ diagnostic: "start" });
    bridge.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.diagnostic === "sample") bridgeSamples.push(message);
    };
    bridge.onerror = () => { context.bridgeError = "Could not connect to OSC bridge diagnostics"; };
    bridgeTimer = setInterval(() => {
      const ports = [57101, 57102, 57103, 57104];
      bridgeSend({ diagnostic: "sample", requestId: `live-${Date.now()}`, sampleIndex: bridgeRequest++, port: ports[bridgePortIndex] });
      bridgePortIndex = (bridgePortIndex + 1) % ports.length;
    }, 160);
  } catch (error) {
    context.bridgeError = error.message;
  }
}

function sample() {
  if (!running || !capture) return;
  const sampleAt = performance.now();
  const engine = provider?.() ?? null;
  const memory = performance.memory;
  capture.sample({
    outputs: context.outputs,
    backends: Object.fromEntries([...backendProviders].map(([name, read]) => {
      try { return [name, read()]; } catch (error) { return [name, { error: error.message }]; }
    })),
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startedAt),
    sampleIntervalMs: previousSampleAt == null ? null : Math.round(sampleAt - previousSampleAt),
    intervalDriftMs: previousSampleAt == null ? null : Math.round(sampleAt - previousSampleAt - 1000),
    activePointers: activePointers.size,
    engine,
    browser: {
      visibilityState: document.visibilityState,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGb: navigator.deviceMemory ?? null,
      heapUsedBytes: memory?.usedJSHeapSize ?? null,
      heapLimitBytes: memory?.jsHeapSizeLimit ?? null,
      audioContextState: engine?.audioContext?.state ?? null,
      sampleRate: engine?.audioContext?.sampleRate ?? null,
      baseLatencySeconds: engine?.audioContext?.baseLatency ?? null,
      outputLatencySeconds: engine?.audioContext?.outputLatency ?? null,
    },
    bridge: bridgeSamples.splice(0),
    mainThreadLongTasks: { ...longTasks },
    eventCounts: Object.fromEntries(Object.entries(context.eventDetails ?? {}).map(([key, value]) => [key, value.count])),
  });
  previousSampleAt = sampleAt;
}

let startedAt = 0;

function start() {
  if (running) return "Capture is already running.";
  running = true;
  startedAt = performance.now();
  context.eventDetails = {};
  bridgeSamples = [];
  longTasks = { count: 0, totalMs: 0, maxMs: 0 };
  previousSampleAt = null;
  activePointers.clear();
  timeline = [];
  if (typeof PerformanceObserver === "function") {
    try {
      longTaskObserver = new PerformanceObserver(entries => {
        for (const entry of entries.getEntries()) {
          longTasks.count += 1;
          longTasks.totalMs += entry.duration;
          longTasks.maxMs = Math.max(longTasks.maxMs, entry.duration);
        }
      });
      longTaskObserver.observe({ type: "longtask", buffered: false });
    } catch { longTaskObserver = null; }
  }
  capture = createPerformanceCapture({
    purpose: "live input and four-layer audio-backend stress test",
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGb: navigator.deviceMemory ?? null,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
    },
    app: { ...context },
    instruction: "Use the same test scenario for each backend. Event payloads are not stored.",
  });
  notifyDiagnostics();
  if (context.outputBackend === "osc-bridge") startBridgeCapture(context.oscBridgeUrl);
  sample();
  timer = setInterval(sample, 1000);
  return "Capture started. Call stop() to download the JSON report.";
}

function stop(download = true) {
  if (!running) return "No capture is running.";
  sample();
  running = false;
  notifyDiagnostics();
  clearInterval(timer);
  clearInterval(bridgeTimer);
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  timer = bridgeTimer = null;
  bridgeSend({ diagnostic: "stop" });
  bridge?.close();
  bridge = null;
  const report = capture.report();
  report.timeline = [...timeline];
  report.metadata.app = { ...context, eventDetails: undefined };
  report.events = { ...report.events, ...Object.fromEntries(Object.entries(context.eventDetails ?? {}).map(([key, value]) => [key, value.count])) };
  capture = null;
  lastReport = report;
  if (download) {
    downloadPerformanceReport(report, `hexatone-live-${context.outputBackend ?? "audio"}-${Date.now()}.json`);
    diagnosticActions.forEach(listener => listener("save"));
  }
  return `Capture saved (${report.samples.length} time samples).`;
}

{
  globalThis.__hexatoneAudioDiagnostics = {
    start,
    stop,
    report: () => capture ? { ...capture.report(), timeline: [...timeline] } : lastReport,
    mark: (label = "audible failure") => {
      record("audible-failure", { label, elapsedMs: performance.now() - startedAt });
      if (running) {
        diagnosticActions.forEach(listener => listener("mark", { label, elapsedMs: Math.round(performance.now() - startedAt) }));
        sample();
      }
    },
    status: () => ({ enabled: running, running, context: { ...context }, activePointers: activePointers.size }),
    configure: next => {
      if (JSON.stringify(next.outputs) !== JSON.stringify(context.outputs)) record("backend-toggle", { outputs: next.outputs });
      context = { ...context, ...next };
    },
    setEngineProvider: next => { provider = next; },
    input: record,
    pointer(type, id, count) {
      if (!running) return;
      if (type === "down") activePointers.add(id);
      if (type === "up" || type === "cancel") activePointers.delete(id);
      if (Number.isFinite(count)) context.maxSimultaneousPointers = Math.max(context.maxSimultaneousPointers ?? 0, count);
      record(`pointer:${type}`, { pointerType: "touch", active: activePointers.size });
    },
  };
}

export function recordLiveAudioDiagnostic(name, detail) {
  globalThis.__hexatoneAudioDiagnostics?.input(name, detail);
}

export function recordLivePointerDiagnostic(type, id, count) {
  globalThis.__hexatoneAudioDiagnostics?.pointer(type, id, count);
}
