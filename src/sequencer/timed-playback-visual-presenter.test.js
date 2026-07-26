import { describe, expect, it, vi } from "vitest";
import {
  createTimedPlaybackAutoscrollPresenter,
  createTimedPlaybackHighlightPresenter,
  createTimedTransportReadoutPresenter,
  resolveSequencerViewportOwner,
  SEQUENCER_VIEWPORT_OWNER_NAVIGATION,
  SEQUENCER_VIEWPORT_OWNER_TIMED_PLAYBACK,
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

describe("timed playback highlight presenter", () => {
  it("moves snapshot and sounding-event highlights without locating or scrolling rows", () => {
    const snapshotRows = new Map([
      [1, document.createElement("div")],
      [2, document.createElement("div")],
    ]);
    const eventRows = new Map([
      ["a", document.createElement("div")],
      ["b", document.createElement("div")],
    ]);
    const presenter = createTimedPlaybackHighlightPresenter({
      resolveSnapshotRow: (id) => snapshotRows.get(id),
      resolveEventRow: (id) => eventRows.get(id),
    });

    presenter.present({ snapshotId: 1, soundingEventIds: ["a"] });
    expect(snapshotRows.get(1).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(true);
    expect(eventRows.get("a").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(true);

    presenter.present({ snapshotId: 2, soundingEventIds: ["b"] });
    expect(snapshotRows.get(1).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(false);
    expect(snapshotRows.get(2).classList.contains(TIMED_PLAYBACK_ROW_CLASS)).toBe(true);
    expect(eventRows.get("a").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(false);
    expect(eventRows.get("b").classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(true);
  });

  it("reapplies current highlights when virtual rows mount later", () => {
    const eventRows = new Map();
    const presenter = createTimedPlaybackHighlightPresenter({
      resolveEventRow: (id) => eventRows.get(id),
    });

    presenter.present({ soundingEventIds: ["held"] });
    const mountedRow = document.createElement("div");
    eventRows.set("held", mountedRow);
    presenter.refresh();

    expect(mountedRow.classList.contains(TIMED_PLAYBACK_EVENT_CLASS)).toBe(true);
  });
});

describe("timed playback autoscroll presenter", () => {
  it("takes exclusive viewport ownership only while timed playback is running", () => {
    expect(resolveSequencerViewportOwner({ timedPlaybackRunning: false }))
      .toBe(SEQUENCER_VIEWPORT_OWNER_NAVIGATION);
    expect(resolveSequencerViewportOwner({ timedPlaybackRunning: true }))
      .toBe(SEQUENCER_VIEWPORT_OWNER_TIMED_PLAYBACK);
  });

  it("coalesces positions and scrolls only the latest target", () => {
    const frames = createFrameHarness();
    const rows = new Map([
      [1, document.createElement("div")],
      [2, document.createElement("div")],
    ]);
    const scrollSnapshotRows = vi.fn();
    const presenter = createTimedPlaybackAutoscrollPresenter({
      resolveSnapshotRow: (id) => rows.get(id),
      scrollSnapshotRows,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue({ scrollSnapshotId: 1 });
    presenter.enqueue({ scrollSnapshotId: 2 });
    frames.flush();

    expect(scrollSnapshotRows).toHaveBeenCalledOnce();
    expect(scrollSnapshotRows).toHaveBeenCalledWith([rows.get(2)]);
  });

  it("does not locate, prepare, or scroll while disabled", () => {
    const frames = createFrameHarness();
    const resolveSnapshotRow = vi.fn();
    const prepareSnapshotRow = vi.fn();
    const scrollSnapshotRows = vi.fn();
    let enabled = true;
    const presenter = createTimedPlaybackAutoscrollPresenter({
      isEnabled: () => enabled,
      resolveSnapshotRow,
      prepareSnapshotRow,
      scrollSnapshotRows,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue({ scrollSnapshotId: 1 });
    enabled = false;
    frames.flush();
    presenter.enqueue({ scrollSnapshotId: 2 });

    expect(resolveSnapshotRow).not.toHaveBeenCalled();
    expect(prepareSnapshotRow).not.toHaveBeenCalled();
    expect(scrollSnapshotRows).not.toHaveBeenCalled();
  });

  it("bounds virtual-row preparation retries", () => {
    const frames = createFrameHarness();
    const prepareSnapshotRow = vi.fn(() => true);
    const presenter = createTimedPlaybackAutoscrollPresenter({
      resolveSnapshotRow: () => null,
      prepareSnapshotRow,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      maxPrepareFrames: 2,
    });

    presenter.enqueue({ scrollSnapshotId: 1 });
    frames.flush();
    frames.flush();
    frames.flush();

    expect(prepareSnapshotRow).toHaveBeenCalledTimes(2);
    expect(frames.requestFrame).toHaveBeenCalledTimes(3);
  });

  it("passes a fitting sounding range in one scroll request", () => {
    const frames = createFrameHarness();
    const rows = new Map([
      [2, document.createElement("div")],
      [4, document.createElement("div")],
    ]);
    const scrollSnapshotRows = vi.fn();
    const presenter = createTimedPlaybackAutoscrollPresenter({
      resolveSnapshotRow: (id) => rows.get(id),
      scrollSnapshotRows,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue({ scrollSnapshotId: 2, scrollSnapshotEndId: 4 });
    frames.flush();

    expect(scrollSnapshotRows).toHaveBeenCalledWith([rows.get(2), rows.get(4)]);
  });
});

describe("timed transport readout presenter", () => {
  it("updates and restores readouts independently", () => {
    const presentTransportPosition = vi.fn();
    const clearTransportPosition = vi.fn();
    const presenter = createTimedTransportReadoutPresenter({
      presentTransportPosition,
      clearTransportPosition,
    });

    presenter.present({ cueIndex: 4 });
    presenter.clear();

    expect(presentTransportPosition).toHaveBeenCalledWith({ cueIndex: 4 });
    expect(clearTransportPosition).toHaveBeenCalledOnce();
  });
});
