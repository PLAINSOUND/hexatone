import { describe, expect, it, vi } from "vitest";
import {
  createTimedPlaybackAutoscrollPresenter,
  createTimedPlaybackHighlightPresenter,
  createTimedTransportReadoutPresenter,
  deriveTimedPageFollowPosition,
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

  it("follows only newly attacked rows while sustained earlier notes remain highlighted", () => {
    expect(deriveTimedPageFollowPosition({
      burst: {
        newlyAttacked: ["new"],
        soundingAfter: [
          { instanceKey: "held", eventId: "event-held", snapshotIndex: 0 },
          { instanceKey: "new", eventId: "event-new", snapshotIndex: 4 },
        ],
      },
      sequenceEvents: [
        { eventId: "event-held" },
        { eventId: "event-new" },
      ],
      snapshots: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ],
    })).toEqual({
      scrollSnapshotId: 5,
      scrollSnapshotEndId: 5,
      scrollSnapshotIndex: 4,
      scrollEventIds: ["event-new"],
    });
  });

  it("follows the current snapshot for a release-only cue without targeting an old note", () => {
    expect(deriveTimedPageFollowPosition({
      burst: {
        newlyAttacked: [],
        soundingAfter: [
          { instanceKey: "held", eventId: "event-held", snapshotIndex: 0 },
        ],
      },
      sequenceEvents: [{ eventId: "event-held" }],
      snapshots: [{ id: 1 }, { id: 2 }],
      fallbackSnapshotIndex: 1,
      fallbackSnapshotId: 2,
    })).toEqual({
      scrollSnapshotId: 2,
      scrollSnapshotEndId: 2,
      scrollSnapshotIndex: 1,
      scrollEventIds: [],
    });
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

  it("uses sounding event rows as the authoritative timed viewport targets", () => {
    const frames = createFrameHarness();
    const snapshotRow = document.createElement("div");
    const earlyEvent = document.createElement("div");
    const latestEvent = document.createElement("div");
    const scrollSnapshotRows = vi.fn();
    const presenter = createTimedPlaybackAutoscrollPresenter({
      resolveSnapshotRow: () => snapshotRow,
      resolveEventRow: (id) => (
        id === "early" ? earlyEvent : id === "latest" ? latestEvent : null
      ),
      scrollSnapshotRows,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    presenter.enqueue({
      scrollSnapshotId: 2,
      scrollEventIds: ["early", "latest"],
    });
    frames.flush();

    expect(scrollSnapshotRows).toHaveBeenCalledWith([earlyEvent, latestEvent]);
  });

  it("does not drop a below-viewport cue that arrives within the former throttle window", () => {
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
      now: () => 100,
    });

    presenter.enqueue({ scrollSnapshotId: 1 });
    frames.flush();
    presenter.enqueue({ scrollSnapshotId: 2 });
    frames.flush();

    expect(scrollSnapshotRows).toHaveBeenNthCalledWith(1, [rows.get(1)]);
    expect(scrollSnapshotRows).toHaveBeenNthCalledWith(2, [rows.get(2)]);
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
