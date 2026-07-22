import { describe, expect, it, vi } from "vitest";
import {
  createTimedPlaybackVisualPresenter,
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
});
