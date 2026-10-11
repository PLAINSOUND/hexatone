// Bounded, session-only telemetry. No note pitches, MIDI payloads or assets.
const events = [];
const latency = [];
const eventStages = new WeakMap();
const eventLoopGaps = [];
let latencyEnabled = false;
const latencyListeners = new Set();
export const getLatencyMeasurementEnabled = () => latencyEnabled;
export function subscribeLatencyMeasurement(listener) {
  latencyListeners.add(listener);
  return () => latencyListeners.delete(listener);
}
export function setLatencyMeasurementEnabled(enabled) {
  enabled = !!enabled;
  if (latencyEnabled === enabled) return;
  latencyEnabled = enabled;
  touch = null;
  latency.length = 0;
  eventLoopGaps.length = 0;
  recordAudioRuntime("latency-measurement", { enabled });
  for (const listener of latencyListeners) listener();
}
export function captureInputTiming(event) {
  if (!latencyEnabled) return;
  if (!eventStages.has(event)) eventStages.set(event, { captureAt: performance.now() });
}
export function markInputHandler(event) {
  if (!latencyEnabled) return;
  const stages = eventStages.get(event) ?? {};
  stages.handlerAt = performance.now();
  eventStages.set(event, stages);
}
export function recordEventLoopGap(expectedAt, observedAt) {
  if (!latencyEnabled) return;
  eventLoopGaps.push({ expectedAtMs: expectedAt, observedAtMs: observedAt,
    delayMs: Math.max(0, observedAt - expectedAt) });
  if (eventLoopGaps.length > 120) eventLoopGaps.shift();
}
let touch = null;
let nextTouch = 0;
let nextMeasurement = 0;
export function recordAudioRuntime(name, detail = {}) {
  events.push({ at: new Date().toISOString(), name, ...detail });
  if (events.length > 120) events.shift();
}
export async function traceAudioImport(backend, url, load) {
  const started = performance.now();
  const pending = { backend, url: String(url), started };
  imports.add(pending);
  recordAudioRuntime("module-import-start", { backend, url: pending.url });
  try {
    const result = await load();
    recordAudioRuntime("module-import-ready", { backend, url: pending.url,
      durationMs: performance.now() - started });
    return result;
  } catch (error) {
    recordAudioRuntime("module-import-failed", { backend, url: pending.url,
      durationMs: performance.now() - started, error: String(error.message ?? error),
      online: navigator.onLine, recentResources: performance.getEntriesByType?.("resource")
        .slice(-12).map(entry => ({ url: entry.name, initiatorType: entry.initiatorType,
          durationMs: entry.duration, transferSize: entry.transferSize,
          responseStatus: entry.responseStatus ?? null })) ?? [] });
    throw error;
  } finally { imports.delete(pending); }
}
const imports = new Set();
export function beginTouchTiming(event) {
  if (!latencyEnabled) return;
  // Only synchronous attacks caused by this canvas gesture are attributed.
  // Async preparation/sequence playback must not borrow a recent touch.
  const now = performance.now();
  const stages = eventStages.get(event);
  const handlerAt = stages?.handlerAt ?? now;
  const token = { id: ++nextTouch, at: handlerAt, seen: new Set(),
    eventToCaptureMs: stages?.captureAt != null && Number.isFinite(event.timeStamp) && event.timeStamp <= stages.captureAt
      ? stages.captureAt - event.timeStamp : null,
    captureToHandlerMs: stages?.captureAt != null ? handlerAt - stages.captureAt : null,
    handlerPreparationMs: now - handlerAt,
    recentEventLoopDelayMs: Math.max(0, ...eventLoopGaps.filter(gap =>
      gap.observedAtMs <= now && gap.observedAtMs >= now - 1000).map(gap => gap.delayMs)),
    eventType: event.type ?? null, pointerType: event.pointerType ?? null,
    inputAgeMs: Number.isFinite(event.timeStamp) && event.timeStamp <= handlerAt
      ? Math.max(0, handlerAt - event.timeStamp) : null };
  touch = token;
  queueMicrotask(() => { if (touch === token) touch = null; });
}
export function withTouchTiming(event, action) {
  if (!latencyEnabled) return action();
  const previous = touch;
  beginTouchTiming(event);
  try { return action(); }
  finally { touch = previous; }
}
export function recordTouchAudio(backend, context, scheduledDelayMs = 0) {
  if (!latencyEnabled || !touch || touch.seen.has(backend)) return;
  touch.seen.add(backend);
  const dispatchMs = performance.now() - touch.at;
  const baseLatencyMs = Number.isFinite(context?.baseLatency) ? context.baseLatency * 1000 : null;
  const outputLatencyMs = Number.isFinite(context?.outputLatency) ? context.outputLatency * 1000 : null;
  const measurement = { id: ++nextMeasurement, touchId: touch.id, backend, at: new Date().toISOString(),
    eventType: touch.eventType, pointerType: touch.pointerType,
    eventToCaptureMs: touch.eventToCaptureMs, captureToHandlerMs: touch.captureToHandlerMs,
    handlerPreparationMs: touch.handlerPreparationMs, recentEventLoopDelayMs: touch.recentEventLoopDelayMs,
    inputAgeMs: touch.inputAgeMs, dispatchMs, scheduledDelayMs: Math.max(0, scheduledDelayMs),
    contextState: context?.state ?? null, baseLatencyMs, outputLatencyMs,
    estimatedOutputMs: context?.state === "running" && outputLatencyMs != null
      ? dispatchMs + Math.max(0, scheduledDelayMs) + (baseLatencyMs ?? 0) + outputLatencyMs : null };
  latency.push(measurement);
  if (latency.length > 180) latency.shift();
  return measurement.id;
}
export function recordTouchRender(id, detail) {
  if (!latencyEnabled) return;
  const measurement = latency.find(entry => entry.id === id);
  if (measurement) Object.assign(measurement, detail);
}
export function audioRuntimeReport() {
  return { latencyMeasurementEnabled: latencyEnabled, events: [...events], pendingImports: [...imports].map(({ backend, url, started }) =>
    ({ backend, url, elapsedMs: performance.now() - started })), touchLatency: [...latency],
    eventLoopGaps: [...eventLoopGaps],
  latencyMeaning: "inputAgeMs is event timestamp to canvas handler entry. eventToCaptureMs ends at window capture; captureToHandlerMs measures propagation to the canvas handler. handlerPreparationMs is included in dispatchMs (handler entry to backend submission). recentEventLoopDelayMs is the largest 25ms timer delay observed in the preceding second, contextual evidence only, not an additive latency. Pre-capture delay cannot distinguish OS/browser input processing from main-thread waiting. estimatedOutputMs adds scheduling and browser latency estimates; it excludes envelopes, engine queues and speaker measurement. Missing output latency is unknown, not zero. Async attacks are not attributed." };
}
