import { afterEach, expect, it, vi } from "vitest";
import { canvasReplayEvents, canvasReplayDurationMs, deduplicatedCanvasReplayEvents,
  rotatingCanvasReplayEvents, rotateReplayCarriers,
  plainMidiCanvasReplayEvents, replayWithoutMts,
  staticTuningCanvasReplay, prepareStaticTuningReplay,
  suppressUnchangedMts, startCanvasReplay } from "./fluidsynth-canvas-replay.js";

afterEach(() => vi.useRealTimers());

it("preserves receive-trace ordering, duplicate tunings and timing", () => {
  expect(canvasReplayEvents.slice(0, 3).map(event => event.data)).toEqual([
    [240, 127, 127, 8, 2, 0, 1, 58, 58, 16, 25, 247],
    [144, 58, 72], [240, 127, 127, 8, 2, 0, 1, 58, 58, 16, 25, 247],
  ]);
  expect(canvasReplayEvents.every((event, i) => !i || event.time >= canvasReplayEvents[i - 1].time)).toBe(true);
  expect(canvasReplayEvents.at(-1)).toEqual({ time: 15105, data: [128, 56, 0] });
  // The initial attack/release occurs at the same receive timestamp.
  expect(canvasReplayEvents[3]).toEqual({ time: 0, data: [128, 58, 0] });
  // Preserve the split MTS/note-on timestamps near 04:08:18.167.
  expect(canvasReplayEvents.filter(event => event.time === 2355).map(event => event.data))
    .toEqual([[128, 56, 0], [240, 127, 127, 8, 2, 0, 1, 57, 56, 122, 96, 247]]);
  expect(canvasReplayEvents.filter(event => event.time === 2378).map(event => event.data))
    .toEqual([[144, 57, 72], [240, 127, 127, 8, 2, 0, 1, 57, 56, 122, 96, 247]]);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const output = { send: vi.fn() };
  startCanvasReplay(output);
  const setupCount = 2 + staticTuningCanvasReplay.setup.length;
  expect(output.send.mock.calls.slice(2).map(([data]) => data)).toEqual(staticTuningCanvasReplay.setup);
  vi.advanceTimersByTime(500);
  vi.advanceTimersByTime(15105);
  expect(output.send.mock.calls.slice(setupCount).map(([data]) => data)).toEqual(staticTuningCanvasReplay.events.map(event => event.data));
  vi.advanceTimersByTime(canvasReplayDurationMs - 15105);
  const count = output.send.mock.calls.length;
  vi.advanceTimersByTime(1000);
  expect(output.send).toHaveBeenCalledTimes(count);
});

it("pre-tunes each carrier once and preserves every rotating note event", () => {
  const prepared = prepareStaticTuningReplay(rotatingCanvasReplayEvents);
  expect(new Set(prepared.setup.map(data => data[7])).size).toBe(prepared.setup.length);
  expect(prepared.events).toEqual(rotatingCanvasReplayEvents.filter(event => event.data[0] !== 240));
  expect(prepared.events.some(event => event.data[0] === 240)).toBe(false);
  for (const tuning of prepared.setup) {
    expect(tuning).toEqual(rotatingCanvasReplayEvents.find(event => event.data[0] === 240 && event.data[7] === tuning[7]).data);
  }
});

it("omits MTS and keeps note-off matched to the rounded onset pitch", () => {
  const mts = pitch => [240, 127, 127, 8, 2, 0, 1, 60, pitch, 0, 0, 247];
  expect(replayWithoutMts([
    { time: 0, data: mts(59) }, { time: 1, data: [144, 60, 72] },
    { time: 2, data: mts(61) }, { time: 3, data: [128, 60, 0] },
  ])).toEqual([{ time: 1, data: [144, 59, 72] }, { time: 3, data: [128, 59, 0] }]);
  expect(plainMidiCanvasReplayEvents.some(event => event.data[0] === 240)).toBe(false);
  expect(plainMidiCanvasReplayEvents.map(event => event.time))
    .toEqual(canvasReplayEvents.filter(event => event.data[0] !== 240).map(event => event.time));
});

it("rotates released carriers while retaining onset pitches and matched note lifetimes", () => {
  const tuning = [240, 127, 127, 8, 2, 0, 1, 60, 59, 12, 34, 247];
  const events = [
    { time: 0, data: tuning }, { time: 0, data: [144, 60, 72] },
    { time: 10, data: [128, 60, 0] }, { time: 10, data: [144, 60, 72] },
    { time: 20, data: [128, 60, 0] },
  ];
  const rotated = rotateReplayCarriers(events);
  expect(rotated.map(event => event.data)).toEqual([
    [240, 127, 127, 8, 2, 0, 1, 0, 59, 12, 34, 247], [144, 0, 72], [128, 0, 0],
    [240, 127, 127, 8, 2, 0, 1, 1, 59, 12, 34, 247], [144, 1, 72], [128, 1, 0],
  ]);
  const pitchesAtOnsets = stream => {
    const tuningByCarrier = new Map();
    return stream.flatMap(({ time, data }) => {
      if (data[0] === 240) tuningByCarrier.set(data[7], data.slice(8, 11));
      return data[0] === 144 ? [{ time, velocity: data[2], pitch: tuningByCarrier.get(data[1]) }] : [];
    });
  };
  expect(pitchesAtOnsets(rotatingCanvasReplayEvents)).toEqual(pitchesAtOnsets(deduplicatedCanvasReplayEvents));
  expect(rotatingCanvasReplayEvents.filter(event => event.data[0] === 128).map(event => event.time))
    .toEqual(deduplicatedCanvasReplayEvents.filter(event => event.data[0] === 128).map(event => event.time));
});

it("removes only unchanged MTS state while preserving notes, timing and changed tunings", () => {
  const tuning = [240, 127, 127, 8, 2, 0, 1, 60, 60, 0, 0, 247];
  const changed = [...tuning];
  changed[10] = 1;
  const otherCarrier = [...tuning];
  otherCarrier[7] = 61;
  const events = [tuning, [144, 60, 72], tuning.slice(), [128, 60, 0],
    otherCarrier, tuning.slice(), changed, tuning.slice()].map((data, time) => ({ data, time }));
  expect(suppressUnchangedMts(events)).toEqual([events[0], events[1], events[3],
    events[4], events[6], events[7]]);
  const isNote = event => event.data[0] === 128 || event.data[0] === 144;
  expect(deduplicatedCanvasReplayEvents.filter(isNote)).toEqual(canvasReplayEvents.filter(isNote));
  expect(deduplicatedCanvasReplayEvents.length).toBeLessThan(canvasReplayEvents.length);
});
