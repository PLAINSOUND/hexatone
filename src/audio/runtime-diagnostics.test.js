import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { audioRuntimeReport, beginTouchTiming, recordTouchAudio, recordTouchRender,
  traceAudioImport, withTouchTiming, captureInputTiming, markInputHandler,
  recordEventLoopGap, setLatencyMeasurementEnabled, recordAudioRuntime, markAudioTestStage } from "./runtime-diagnostics.js";

beforeEach(() => setLatencyMeasurementEnabled(true));
afterEach(() => setLatencyMeasurementEnabled(false));

it("does no timing work when disabled and still executes the attack", () => {
  setLatencyMeasurementEnabled(false);
  const clock = vi.spyOn(performance, "now");
  const action = vi.fn(() => 42);
  try {
    captureInputTiming({});
    markInputHandler({});
    beginTouchTiming({});
    recordEventLoopGap(0, 10);
    expect(withTouchTiming({}, action)).toBe(42);
    expect(recordTouchAudio("samples", {})).toBeUndefined();
    recordTouchRender(1, {});
    expect(clock).not.toHaveBeenCalled();
    expect(audioRuntimeReport().touchLatency).toEqual([]);
    expect(audioRuntimeReport().eventLoopGaps).toEqual([]);
  } finally { clock.mockRestore(); }
});

it("bounds engine events and timer history", () => {
  for (let i = 0; i < 200; i++) {
    recordAudioRuntime("test");
    recordEventLoopGap(i, i + 10);
  }
  expect(audioRuntimeReport().events).toHaveLength(120);
  expect(audioRuntimeReport().eventLoopGaps).toHaveLength(120);
});

it("separates pre-capture, propagation, preparation and submission timing", () => {
  const clock = vi.spyOn(performance, "now");
  try {
    const event = { type: "touchstart", timeStamp: 1000 };
    clock.mockReturnValue(1030);
    captureInputTiming(event);
    clock.mockReturnValue(1032);
    markInputHandler(event);
    recordEventLoopGap(1010, 1020);
    clock.mockReturnValue(1035);
    withTouchTiming(event, () => {
      clock.mockReturnValue(1036);
      recordTouchAudio("samples", { state: "running" });
    });
    expect(audioRuntimeReport().touchLatency.at(-1)).toMatchObject({
      inputAgeMs: 32, eventToCaptureMs: 30, captureToHandlerMs: 2,
      handlerPreparationMs: 3, dispatchMs: 4, recentEventLoopDelayMs: 10,
    });
    expect(recordTouchAudio("fluidsynth", {})).toBeUndefined();
  } finally { clock.mockRestore(); }
});

it("times the actual Touch Events handler and closes its scope synchronously", async () => {
  await Promise.resolve();
  const context = { state: "running" };
  let id;
  withTouchTiming({ type: "touchstart", timeStamp: performance.now() }, () => {
    id = recordTouchAudio("samples", context);
  });
  expect(id).toEqual(expect.any(Number));
  expect(recordTouchAudio("fluidsynth", context)).toBeUndefined();
});

it("separates input-to-render time from the return-message delay and samples playback buffering", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  const wall = vi.spyOn(Date, "now").mockReturnValue(100000);
  try {
    const event = { type: "mousedown", timeStamp: 990 };
    markInputHandler(event);
    clock.mockReturnValue(1005);
    wall.mockReturnValue(100005);
    const context = { state: "running", currentTime: 2, baseLatency: 0.003, outputLatency: 0.02,
      getOutputTimestamp: () => ({ contextTime: 1.98, performanceTime: 1000 }) };
    let id;
    withTouchTiming(event, () => { id = recordTouchAudio("fluidsynth", context); });
    clock.mockReturnValue(1050);
    wall.mockReturnValue(100050);
    recordTouchRender(id, { renderedAtEpochMs: 100020 });
    recordTouchRender(id, { firstSignalAtEpochMs: 100025 });
    expect(audioRuntimeReport().touchLatency[0]).toMatchObject({ inputAgeMs: 10,
      dispatchMs: 5, handlerToRenderMs: 20, inputToRenderMs: 30,
      renderReplyDelayMs: 30, inputToFirstSignalRenderMs: 35,
      inputToRenderConfirmationMs: 60, reportedRenderAheadMs: expect.closeTo(15),
      playbackClock: { playbackTimestampMatchesRenderClock: false } });
  } finally { clock.mockRestore(); wall.mockRestore(); }
});

it("rejects implausible wall-clock jumps in render timing", () => {
  beginTouchTiming({ timeStamp: performance.now() });
  const id = recordTouchAudio("fluidsynth", {});
  recordTouchRender(id, { renderedAtEpochMs: Date.now() - 120000 });
  expect(audioRuntimeReport().touchLatency[0].renderClockInvalid).toBe(true);
  expect(audioRuntimeReport().touchLatency[0].inputToRenderMs).toBeUndefined();
});

it("records all three backends once per touch and excludes unrelated async attacks", async () => {
  beginTouchTiming({ timeStamp: performance.now() });
  const context = { state: "running", baseLatency: 0.003, outputLatency: 0.02 };
  const ids = ["samples", "fluidsynth", "supersonic"].map(name => recordTouchAudio(name, context, 2));
  expect(ids.every(Number.isFinite)).toBe(true);
  expect(recordTouchAudio("samples", context)).toBeUndefined();
  recordTouchRender(ids[1], { renderQueueLateMs: 1 });
  const rows = audioRuntimeReport().touchLatency.slice(-3);
  expect(rows.map(row => row.backend)).toEqual(["samples", "fluidsynth", "supersonic"]);
  expect(rows[0].estimatedOutputMs).toBeGreaterThanOrEqual(25);
  expect(rows[1].renderQueueLateMs).toBe(1);
  await Promise.resolve();
  expect(recordTouchAudio("samples", context)).toBeUndefined();
});

it("does not claim audible output when latency is unknown or context is interrupted", () => {
  beginTouchTiming({});
  recordTouchAudio("samples", { state: "running", baseLatency: 0.003 });
  recordTouchAudio("supersonic", { state: "interrupted", outputLatency: 0.02 });
  expect(audioRuntimeReport().touchLatency.slice(-2).map(row => row.estimatedOutputMs)).toEqual([null, null]);
});

it("reports pending imports, their URL and failed stage without swallowing errors", async () => {
  let reject;
  const load = traceAudioImport("test-backend", "/engine.js", () => new Promise((_, fail) => { reject = fail; }));
  expect(audioRuntimeReport().pendingImports[0]).toMatchObject({ backend: "test-backend", url: "/engine.js" });
  reject(new Error("Import failed"));
  await expect(load).rejects.toThrow("Import failed");
  expect(audioRuntimeReport().pendingImports).toEqual([]);
  expect(audioRuntimeReport().events.at(-1)).toMatchObject({ name: "module-import-failed", url: "/engine.js" });
});

it("bounds touch history", () => {
  for (let i = 0; i < 200; i++) { beginTouchTiming({}); recordTouchAudio("samples", {}); }
  expect(audioRuntimeReport().touchLatency).toHaveLength(180);
});

it("preserves five bounded passes and summarizes late acknowledgements by stage", () => {
  for (const label of ["Baseline", "FluidSynth loaded", "Contexts resumed", "FluidSynth worklet restarted", "Contexts recreated"]) {
    markAudioTestStage(label);
    for (let i = 0; i < 200; i++) {
      beginTouchTiming({});
      const id = recordTouchAudio("supersonic", {});
      recordTouchRender(id, { nodeStartAcknowledgementMs: label === "Baseline" ? 4 : 10 });
    }
  }
  const report = audioRuntimeReport();
  expect(report.touchLatency).toHaveLength(900);
  expect(report.testStages.map(stage => stage.backends.supersonic.nodeStartAcknowledgementMs.median)).toEqual([4, 10, 10, 10, 10]);
  setLatencyMeasurementEnabled(false);
  expect(audioRuntimeReport().testStages).toEqual([]);
});
