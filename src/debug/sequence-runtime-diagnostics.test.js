import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendPersistedSequenceRuntimeDiagnostic,
  createSequenceRuntimeDiagnostics,
  flushPersistedSequenceRuntimeDiagnostics,
  pushSequenceRuntimeDiagnostic,
  summarizeSequenceRuntimeDiagnostics,
} from "./sequence-runtime-diagnostics.js";

describe("sequence runtime diagnostics", () => {
  afterEach(() => {
    flushPersistedSequenceRuntimeDiagnostics();
    vi.useRealTimers();
  });

  it("summarizes rebuild causes and playback token changes", () => {
    let state = createSequenceRuntimeDiagnostics();
    state = pushSequenceRuntimeDiagnostic(state, {
      type: "rebuild-cause",
      changedKeys: ["initial-build"],
      playbackRuntimeToken: "playback-1",
      timedTriggerToken: "trigger-1",
      runtimeInstanceId: 1,
    });
    state = pushSequenceRuntimeDiagnostic(state, {
      type: "rebuild-cause",
      changedKeys: ["displaySnapshots"],
      playbackRuntimeToken: "playback-1",
      timedTriggerToken: "trigger-1",
      runtimeInstanceId: 2,
    });
    state = pushSequenceRuntimeDiagnostic(state, {
      type: "rebuild-cause",
      changedKeys: ["playbackSnapshots", "displaySnapshots"],
      playbackRuntimeToken: "playback-2",
      timedTriggerToken: "trigger-2",
      runtimeInstanceId: 3,
    });

    const summary = summarizeSequenceRuntimeDiagnostics(state);

    expect(summary.rebuilds).toMatchObject({
      count: 3,
      byChangedKey: {
        "initial-build": 1,
        displaySnapshots: 2,
        playbackSnapshots: 1,
      },
      byChangedKeySet: {
        "initial-build": 1,
        displaySnapshots: 1,
        "playbackSnapshots + displaySnapshots": 1,
      },
      playbackRuntimeTokenChangeCount: 1,
      timedTriggerTokenChangeCount: 1,
    });
    expect(summary.rebuilds.recent.at(-1)).toMatchObject({
      changedKeys: ["playbackSnapshots", "displaySnapshots"],
      playbackTokenChanged: true,
      timedTriggerTokenChanged: true,
      runtimeInstanceId: 3,
    });
  });

  it("batches a synchronous diagnostic burst into one storage write", () => {
    vi.useFakeTimers();
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };

    appendPersistedSequenceRuntimeDiagnostic({ type: "step", step: "one" }, storage);
    appendPersistedSequenceRuntimeDiagnostic({ type: "step", step: "two" }, storage);
    appendPersistedSequenceRuntimeDiagnostic({ type: "build", step: "complete" }, storage);

    expect(storage.setItem).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(storage.setItem.mock.calls[0][1]);
    expect(persisted.state.entries.map((entry) => entry.step)).toEqual([
      "one",
      "two",
      "complete",
    ]);
  });
});
