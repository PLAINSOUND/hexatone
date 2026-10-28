// Bounded, session-only telemetry. No note pitches, MIDI payloads or assets.
import { playbackClockDiagnostics } from "./report-environment.js";
const events = [];
const latency = [];
const stages = [];
const measurementClocks = new WeakMap();
let currentStage = null;
let fluidSynthLifecycleProvider = null;
export function registerFluidSynthLifecycleDiagnostics(provider) {
  fluidSynthLifecycleProvider = provider;
}
export function markAudioTestStage(label) {
  if (!latencyEnabled) return;
  currentStage = { id: stages.length ? stages.at(-1).id + 1 : 1,
    label, at: new Date().toISOString() };
  stages.push(currentStage);
  if (stages.length > 6) stages.shift();
  recordAudioRuntime("audio-test-stage", currentStage);
  return currentStage.id;
}
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
  stages.length = 0;
  currentStage = null;
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
  stages.handlerAt ??= performance.now();
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
  // Only synchronous attacks caused by this browser input are attributed.
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
    inputSource: event.type === "keydown" ? "keyboard"
      : event.type?.startsWith("mouse") ? "mouse" : event.pointerType ?? "touch",
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
  const submittedAt = performance.now();
  const dispatchMs = submittedAt - touch.at;
  const baseLatencyMs = Number.isFinite(context?.baseLatency) ? context.baseLatency * 1000 : null;
  const outputLatencyMs = Number.isFinite(context?.outputLatency) ? context.outputLatency * 1000 : null;
  const playbackClock = playbackClockDiagnostics(context);
  const measurement = { id: ++nextMeasurement, touchId: touch.id, stageId: currentStage?.id ?? null, backend, at: new Date().toISOString(),
    eventType: touch.eventType, pointerType: touch.pointerType, inputSource: touch.inputSource,
    eventToCaptureMs: touch.eventToCaptureMs, captureToHandlerMs: touch.captureToHandlerMs,
    handlerPreparationMs: touch.handlerPreparationMs, recentEventLoopDelayMs: touch.recentEventLoopDelayMs,
    inputAgeMs: touch.inputAgeMs, dispatchMs, scheduledDelayMs: Math.max(0, scheduledDelayMs),
    contextState: context?.state ?? null, baseLatencyMs, outputLatencyMs,
    playbackClock,
    reportedRenderAheadMs: playbackClock.renderAheadMs ?? null,
    playbackTimestampAgeMs: playbackClock.timestampAgeMs ?? null,
    estimatedOutputMs: context?.state === "running" && outputLatencyMs != null
      ? dispatchMs + Math.max(0, scheduledDelayMs) + (baseLatencyMs ?? 0) + outputLatencyMs : null };
  latency.push(measurement);
  measurementClocks.set(measurement, { handlerAt: touch.at,
    handlerEpochMs: Date.now() - dispatchMs });
  // Preserve up to 180 rows per stage for a five-pass comparison, bounded
  // independently of how many stage markers the user adds.
  const sameStage = latency.filter(row => row.stageId === measurement.stageId);
  if (sameStage.length > 180) latency.splice(latency.indexOf(sameStage[0]), 1);
  if (latency.length > 900) latency.shift();
  return measurement.id;
}
export function recordTouchRender(id, detail) {
  if (!latencyEnabled) return;
  const measurement = latency.find(entry => entry.id === id);
  if (!measurement) return;
  Object.assign(measurement, detail);
  const clock = measurementClocks.get(measurement);
  if (!clock) return;
  // Confirmation arrival includes the message trip back to the main thread.
  measurement.inputToRenderConfirmationMs ??= measurement.inputAgeMs == null ? null
    : measurement.inputAgeMs + performance.now() - clock.handlerAt;
  for (const [timestamp, field] of [[detail.renderedAtEpochMs, "inputToRenderMs"],
    [detail.firstSignalAtEpochMs, "inputToFirstSignalRenderMs"]]) {
    if (!Number.isFinite(timestamp)) continue;
    const elapsed = timestamp - clock.handlerEpochMs;
    // Wall-clock timestamps bridge main/worklet clocks. Reject obvious clock
    // jumps instead of presenting them as latency; precision is milliseconds.
    if (elapsed < -2 || elapsed > 60000) { measurement.renderClockInvalid = true; continue; }
    measurement[field] = measurement.inputAgeMs == null ? null : measurement.inputAgeMs + Math.max(0, elapsed);
    if (field === "inputToRenderMs") {
      measurement.handlerToRenderMs = Math.max(0, elapsed);
      measurement.renderReplyDelayMs = Math.max(0, Date.now() - timestamp);
    }
  }
}
export function audioRuntimeReport() {
  const summarize = rows => Object.fromEntries([
    "inputAgeMs", "dispatchMs", "baseLatencyMs", "outputLatencyMs",
    "renderQueueLateMs", "nodeStartAcknowledgementMs",
    "inputToRenderMs", "handlerToRenderMs", "renderReplyDelayMs",
    "inputToFirstSignalRenderMs", "inputToRenderConfirmationMs",
    "reportedRenderAheadMs", "playbackTimestampAgeMs",
  ].map(key => {
    const values = rows.map(row => row[key]).filter(Number.isFinite).sort((a, b) => a - b);
    return [key, values.length ? { count: values.length,
      median: values[Math.floor(values.length / 2)],
      p95: values[Math.ceil(values.length * 0.95) - 1], max: values.at(-1) } : null];
  }));
  return { latencyMeasurementEnabled: latencyEnabled,
    fluidSynthLifecycle: fluidSynthLifecycleProvider?.() ?? null,
    testStages: stages.map(stage => ({ ...stage, backends: Object.fromEntries(
      [...new Set(latency.filter(row => row.stageId === stage.id).map(row => row.backend))]
        .map(backend => [backend, summarize(latency.filter(row => row.stageId === stage.id && row.backend === backend))])) })),
    events: [...events], pendingImports: [...imports].map(({ backend, url, started }) =>
    ({ backend, url, elapsedMs: performance.now() - started })), touchLatency: [...latency],
    eventLoopGaps: [...eventLoopGaps],
  latencyMeaning: "inputAgeMs is event timestamp to the browser note handler (mouse, keyboard or touch). eventToCaptureMs ends at window capture; captureToHandlerMs measures propagation to the canvas handler. handlerPreparationMs is included in dispatchMs (handler entry to backend submission). recentEventLoopDelayMs is the largest 25ms timer delay observed in the preceding second, contextual evidence only, not an additive latency. Pre-capture delay cannot distinguish OS/browser input processing from main-thread waiting. inputToRenderMs measures event to FluidSynth rendered attack block using millisecond wall clocks; handlerToRenderMs excludes input age, and renderReplyDelayMs measures the return-message delay. inputToFirstSignalRenderMs observes the first non-silent mixed-output block after an attack from silence; it includes the sound envelope but excludes browser/device output buffering. These wall-clock measurements are approximate and clock jumps invalidate them. inputToRenderConfirmationMs includes the return-message trip and main-thread waiting. estimatedOutputMs adds scheduling and browser latency estimates; it excludes envelopes, engine queues and speaker measurement. Missing output latency is unknown, not zero. Async attacks are not attributed." };
}
