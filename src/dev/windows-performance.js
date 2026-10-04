// Temporary, opt-in capture. No audio graph changes or event payload recording.
const providers = new Map();
let capture = null;
let timer = null;
let observer = null;
let cleanup = [];
let nextId = 0;
const limit = (array, value, count) => { array.push(value); if (array.length > count) array.shift(); };

export function registerWindowsBackend(read) {
  const id = ++nextId;
  providers.set(id, read);
  return () => providers.delete(id);
}

export function recordWindowsEvent(name, detail = {}) {
  if (!capture) return;
  capture.counts[name] = (capture.counts[name] || 0) + 1;
  if (!name.startsWith("osc:") && name !== "supersonic:node-end") limit(capture.events,
    { elapsedMs: performance.now() - capture.started, name, ...detail }, 2000);
}

function sample() {
  if (!capture) return;
  const now = performance.now();
  const backends = [];
  for (const [id, read] of providers) {
    try { backends.push({ id, ...read() }); }
    catch (error) { backends.push({ id, error: error.message }); }
  }
  limit(capture.samples, { elapsedMs: now - capture.started,
    intervalMs: now - capture.previousSample, counts: { ...capture.counts },
    longTasks: { ...capture.longTasks }, visibility: document.visibilityState, backends }, 1200);
  capture.previousSample = now;
}

export function startWindowsCapture(settings = {}) {
  stopWindowsCapture();
  const now = performance.now();
  capture = { schema: "hexatone-windows-performance/v1", startedAt: new Date().toISOString(),
    started: now, previousSample: now, settings, counts: {}, events: [], samples: [],
    longTasks: { available: false, count: 0, totalMs: 0, maxMs: 0 },
    browser: { userAgent: navigator.userAgent, platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints, hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: globalThis.crossOriginIsolated },
  };
  for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "touchstart", "touchend", "touchcancel", "wheel"]) {
    const listener = event => {
      if (!event.target?.closest?.("canvas.keyboard")) return;
      recordWindowsEvent(`canvas:${type}`, { pointerId: event.pointerId,
        pointerType: event.pointerType, touches: event.touches?.length,
        cancelable: event.cancelable, touchAction: getComputedStyle(event.target).touchAction });
    };
    document.addEventListener(type, listener, { capture: true, passive: true });
    cleanup.push(() => document.removeEventListener(type, listener, true));
  }
  const onKey = event => {
    if (event.repeat || !event.shiftKey) return;
    if (event.code === "F8") { event.preventDefault(); markWindowsSilence(); }
    if (event.code === "F9") { event.preventDefault(); markWindowsRecovery(); }
  };
  window.addEventListener("keydown", onKey);
  cleanup.push(() => window.removeEventListener("keydown", onKey));
  if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
    capture.longTasks.available = true;
    observer = new PerformanceObserver(list => {
      if (!capture) return;
      for (const entry of list.getEntries()) {
        capture.longTasks.count++;
        capture.longTasks.totalMs += entry.duration;
        capture.longTasks.maxMs = Math.max(capture.longTasks.maxMs, entry.duration);
      }
    });
    observer.observe({ type: "longtask" });
  }
  sample();
  timer = setInterval(sample, 250);
}

export function markWindowsSilence() { recordWindowsEvent("audible-silence"); sample(); }
export function markWindowsRecovery() { recordWindowsEvent("audible-recovery"); sample(); }
export function stopWindowsCapture() {
  clearInterval(timer); timer = null;
  observer?.disconnect(); observer = null;
  cleanup.forEach(fn => fn()); cleanup = [];
  const result = capture;
  capture = null;
  if (result) result.endedAt = new Date().toISOString();
  return result;
}
export function saveWindowsCapture() {
  sample();
  const report = stopWindowsCapture();
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "hexatone-windows-performance.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
