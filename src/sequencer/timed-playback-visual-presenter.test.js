import { describe, expect, it, vi } from "vitest";
import {
  createTimedPlaybackVisualPresenter,
  TIMED_PLAYBACK_EVENT_CLASS,
  TIMED_PLAYBACK_ROW_CLASS,
} from "./timed-playback-visual-presenter.js";

function createFrameHarness() {
  let callback = null;
  return {
    requestFrame: vi.fn((nextCallback) => {
      callback = nextCallback;
      return 7;
    }),
    cancelFrame: vi.fn(() => {
      callback = null;
    }),
    flush() {
      const nextCallback = callback;
      callback = null;
      nextCallback?.();
    },
  };
}

describe("timed playback visual presenter", () => {
  it("coalesces positions and mutates only the latest row", () => {
    const frames = createFrameHarness();
    const rows = new Map([
      [1, document.createElement("div")],
      [2, document.createElement("div")],
    ]);
    const scrollSnapshotRow = vi.fn();
    const presenter = createTimedPlaybackVisualPresenter({
      resolveSnapshotRow: (id) => rows.get(id),
      scrollSnapshotRow,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue(1);
    presenter.enqueue(2);
    expect(frames.requestFrame).toHaveBeenCalledTimes(1);
    expect(rows.get(1).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(false);

    frames.flush();
    expect(rows.get(1).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(false);
    expect(rows.get(2).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(true);
    expect(scrollSnapshotRow).toHaveBeenCalledOnce();
    expect(scrollSnapshotRow).toHaveBeenCalledWith(rows.get(2));
  });

  it("moves and clears the active class without leaving queued work", () => {
    const frames = createFrameHarness();
    const rows = new Map([
      [1, document.createElement("div")],
      [2, document.createElement("div")],
    ]);
    const presenter = createTimedPlaybackVisualPresenter({
      resolveSnapshotRow: (id) => rows.get(id),
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue(1);
    frames.flush();
    presenter.enqueue(2);
    frames.flush();
    expect(rows.get(1).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(false);
    expect(rows.get(2).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(true);

    presenter.enqueue(1);
    presenter.clear();
    expect(frames.cancelFrame).toHaveBeenCalledWith(7);
    expect(rows.get(2).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(false);
    frames.flush();
    expect(rows.get(1).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(false);
  });

  it("caps geometry-based follow scrolling while continuing to move the highlight", () => {
    const frames = createFrameHarness();
    const rows = new Map([
      [1, document.createElement("div")],
      [2, document.createElement("div")],
      [3, document.createElement("div")],
    ]);
    const scrollSnapshotRow = vi.fn();
    let nowMs = 0;
    const presenter = createTimedPlaybackVisualPresenter({
      resolveSnapshotRow: (id) => rows.get(id),
      scrollSnapshotRow,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      now: () => nowMs,
      scrollIntervalMs: 200,
    });

    presenter.enqueue(1);
    frames.flush();
    nowMs = 50;
    presenter.enqueue(2);
    frames.flush();
    expect(rows.get(2).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(true);
    expect(scrollSnapshotRow).toHaveBeenCalledTimes(1);

    nowMs = 250;
    presenter.enqueue(3);
    frames.flush();
    expect(rows.get(3).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(true);
    expect(scrollSnapshotRow).toHaveBeenCalledTimes(2);
  });

  it("scrolls the earliest sounding snapshot without moving the current-cue highlight", () => {
    const frames = createFrameHarness();
    const rows = new Map([
      [6, document.createElement("div")],
      [7, document.createElement("div")],
    ]);
    const scrollSnapshotRow = vi.fn();
    const presenter = createTimedPlaybackVisualPresenter({
      resolveSnapshotRow: (id) => rows.get(id),
      scrollSnapshotRow,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue({ snapshotId: 7, scrollSnapshotId: 6 });
    frames.flush();

    expect(rows.get(7).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(true);
    expect(rows.get(6).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(false);
    expect(scrollSnapshotRow).toHaveBeenCalledWith(rows.get(6));
  });

  it("preserves the earliest scroll anchor when adjacent cues share a visual frame", () => {
    const frames = createFrameHarness();
    const rows = new Map([
      [6, document.createElement("div")],
      [7, document.createElement("div")],
    ]);
    const scrollSnapshotRow = vi.fn();
    const presenter = createTimedPlaybackVisualPresenter({
      resolveSnapshotRow: (id) => rows.get(id),
      scrollSnapshotRow,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue({
      snapshotId: 7,
      scrollSnapshotId: 6,
      scrollSnapshotIndex: 5,
      transport: { cueIndex: 27 },
    });
    presenter.enqueue({
      snapshotId: 7,
      scrollSnapshotId: 7,
      scrollSnapshotIndex: 6,
      transport: { cueIndex: 28 },
    });
    frames.flush();

    expect(rows.get(7).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(true);
    expect(scrollSnapshotRow).toHaveBeenCalledOnce();
    expect(scrollSnapshotRow).toHaveBeenCalledWith(rows.get(6));
  });

  it("coalesces transport values and mutates only changed sounding event rows", () => {
    const frames = createFrameHarness();
    const eventRows = new Map([
      ["a", document.createElement("div")],
      ["b", document.createElement("div")],
      ["c", document.createElement("div")],
    ]);
    const presentTransportPosition = vi.fn();
    const clearTransportPosition = vi.fn();
    const presenter = createTimedPlaybackVisualPresenter({
      resolveEventRow: (id) => eventRows.get(id),
      presentTransportPosition,
      clearTransportPosition,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue({ soundingEventIds: ["a"], transport: { barIndex: 0 } });
    presenter.enqueue({ soundingEventIds: ["a", "b"], transport: { barIndex: 1 } });
    frames.flush();
    expect(eventRows.get("a").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(true);
    expect(eventRows.get("b").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(true);
    expect(eventRows.get("c").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(false);
    expect(presentTransportPosition).toHaveBeenCalledOnce();
    expect(presentTransportPosition).toHaveBeenLastCalledWith({ barIndex: 1 });

    presenter.enqueue({ soundingEventIds: ["b", "c"], transport: { barIndex: 2 } });
    frames.flush();
    expect(eventRows.get("a").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(false);
    expect(eventRows.get("b").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(true);
    expect(eventRows.get("c").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(true);

    presenter.clear();
    expect(eventRows.get("b").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(false);
    expect(eventRows.get("c").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(false);
    expect(clearTransportPosition).toHaveBeenCalledOnce();
  });

  it("does not restore controlled transport fields when replaced during a rerender", () => {
    const frames = createFrameHarness();
    const clearTransportPosition = vi.fn();
    const presenter = createTimedPlaybackVisualPresenter({
      clearTransportPosition,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.dispose({ restoreTransport: false });

    expect(clearTransportPosition).not.toHaveBeenCalled();
  });
});
