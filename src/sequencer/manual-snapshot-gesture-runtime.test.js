import { describe, expect, it, vi } from "vitest";
import { createManualSnapshotGestureRuntime } from "./manual-snapshot-gesture-runtime.js";

describe("manual snapshot gesture runtime", () => {
  it("lets formations overlap and cancels only the requested gesture", () => {
    vi.useFakeTimers();
    const attacks = [];
    const cancelled = [];
    const runtime = createManualSnapshotGestureRuntime();
    const plan = {
      events: [
        { noteId: "now", offsetMs: 0 },
        { noteId: "later", offsetMs: 100 },
      ],
    };

    const first = runtime.start(plan, {
      onAttack: (event, id) => attacks.push([id, event.noteId]),
      onCancel: (id) => cancelled.push(id),
    });
    const second = runtime.start(plan, {
      onAttack: (event, id) => attacks.push([id, event.noteId]),
    });
    runtime.cancel(first);
    vi.advanceTimersByTime(100);

    expect(attacks).toEqual([
      [first, "now"],
      [second, "now"],
      [second, "later"],
    ]);
    expect(cancelled).toEqual([first]);
    vi.useRealTimers();
  });

  it("prevents all pending attacks after global cancellation", () => {
    vi.useFakeTimers();
    const attack = vi.fn();
    const runtime = createManualSnapshotGestureRuntime();
    runtime.start({ events: [{ offsetMs: 50 }] }, { onAttack: attack });
    runtime.start({ events: [{ offsetMs: 75 }] }, { onAttack: attack });

    runtime.cancelAll();
    vi.runAllTimers();

    expect(attack).not.toHaveBeenCalled();
    expect(runtime.activeGestureIds()).toEqual([]);
    vi.useRealTimers();
  });

  it("dispatches a release plan measured from a later trigger", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const complete = vi.fn();
    const runtime = createManualSnapshotGestureRuntime();
    const gestureId = runtime.start({
      events: [
        { type: "attack", eventId: "note-0", offsetMs: 0 },
      ],
    }, {
      onRelease: release,
      onComplete: complete,
    });

    expect(runtime.activeGestureIds()).toEqual([gestureId]);
    runtime.release(gestureId, {
      events: [{ type: "release", eventId: "note-0", offsetMs: 500 }],
    });
    vi.advanceTimersByTime(500);
    expect(release).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(gestureId);
    expect(runtime.activeGestureIds()).toEqual([]);
    vi.useRealTimers();
  });

  it("suppresses pending attacks once their immediate release has fired", () => {
    vi.useFakeTimers();
    const attack = vi.fn();
    const release = vi.fn();
    const runtime = createManualSnapshotGestureRuntime();
    const gestureId = runtime.start({
      events: [
        { type: "attack", eventId: "note-0", offsetMs: 100 },
        { type: "attack", eventId: "note-1", offsetMs: 200 },
      ],
    }, {
      onAttack: attack,
      onRelease: release,
    });

    runtime.release(gestureId, {
      events: [
        { type: "release", eventId: "note-0", offsetMs: 0 },
        { type: "release", eventId: "note-1", offsetMs: 0 },
      ],
    });
    vi.runAllTimers();

    expect(release).toHaveBeenCalledTimes(2);
    expect(attack).not.toHaveBeenCalled();
    expect(runtime.activeGestureIds()).toEqual([]);
    vi.useRealTimers();
  });
});
