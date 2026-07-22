import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bufferTimedTransportDiagnostics,
  createTimedTransportDiagnostics,
  flushPersistedTimedTransportDiagnostics,
  loadPersistedTimedTransportDiagnostics,
  persistTimedTransportDiagnostics,
  pushTimedTransportDiagnostic,
  resetTimedTransportDiagnostics,
  summarizeTimedTransportDiagnostics,
} from "./timed-transport-diagnostics.js";

afterEach(() => {
  flushPersistedTimedTransportDiagnostics();
  vi.useRealTimers();
});

const EMPTY_UI_SUMMARY = {
  sampleCount: 0,
  commitSampleCount: 0,
  frameSampleCount: 0,
  longFrameCount: 0,
  meanCommitDurationMs: null,
  maxCommitDurationMs: null,
  meanFrameIntervalMs: null,
  maxFrameIntervalMs: null,
  meanMeasurementDurationMs: null,
  maxMeasurementDurationMs: null,
  maxSnapshotRowCount: null,
  maxEventRowCount: null,
  maxStructuralRowCount: null,
  maxRowCount: null,
  maxVisibleRowCount: null,
  maxMountedNodeCount: null,
  recent: [],
};

describe("timed transport diagnostics", () => {
  it("preserves absent row metrics as null instead of coercing them to zero", () => {
    const diagnostics = pushTimedTransportDiagnostic(createTimedTransportDiagnostics(), {
      type: "ui-frame-sample",
      visibleRowCount: null,
      mountedNodeCount: null,
    });

    expect(diagnostics.entries[0]).toMatchObject({
      visibleRowCount: null,
      mountedNodeCount: null,
    });
    expect(summarizeTimedTransportDiagnostics(diagnostics).ui).toMatchObject({
      maxVisibleRowCount: null,
      maxMountedNodeCount: null,
    });
  });

  it("keeps a bounded ring buffer of entries", () => {
    let diagnostics = createTimedTransportDiagnostics(2);
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "schedule", cueIndex: 1 });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", cueIndex: 2 });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", cueIndex: 3 });

    expect(diagnostics.entries.map((entry) => entry.cueIndex)).toEqual([2, 3]);
    expect(diagnostics.nextId).toBe(4);
  });

  it("summarizes lateness samples", () => {
    let diagnostics = createTimedTransportDiagnostics();
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", latenessMs: 12 });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", latenessMs: 31 });

    expect(summarizeTimedTransportDiagnostics(diagnostics)).toEqual({
      entryCount: 2,
      latenessSampleCount: 2,
      overrunCount: 1,
      meanLatenessMs: 21.5,
      meanAbsoluteLatenessMs: 21.5,
      rmsLatenessMs: 23.505,
      maxLatenessMs: 31,
      intervalJitterSampleCount: 0,
      meanIntervalJitterMs: null,
      meanAbsoluteIntervalJitterMs: null,
      rmsIntervalJitterMs: null,
      maxAbsoluteIntervalJitterMs: null,
      ui: EMPTY_UI_SUMMARY,
      runtimeRebuildCount: 0,
      recent: diagnostics.entries,
    });
  });

  it("summarizes interval jitter between expected and actual fire spacing", () => {
    let diagnostics = createTimedTransportDiagnostics();
    diagnostics = pushTimedTransportDiagnostic(diagnostics, {
      type: "fire",
      clockSeconds: 10,
      elapsedSeconds: 1,
      latenessMs: 0,
    });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, {
      type: "fire",
      clockSeconds: 10.55,
      elapsedSeconds: 1.5,
      latenessMs: 50,
    });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, {
      type: "fire",
      clockSeconds: 11.03,
      elapsedSeconds: 2,
      latenessMs: 30,
    });

    expect(summarizeTimedTransportDiagnostics(diagnostics)).toEqual({
      entryCount: 3,
      latenessSampleCount: 3,
      overrunCount: 2,
      meanLatenessMs: 26.667,
      meanAbsoluteLatenessMs: 26.667,
      rmsLatenessMs: 33.665,
      maxLatenessMs: 50,
      intervalJitterSampleCount: 2,
      meanIntervalJitterMs: 15,
      meanAbsoluteIntervalJitterMs: 35,
      rmsIntervalJitterMs: 38.079,
      maxAbsoluteIntervalJitterMs: 50,
      ui: EMPTY_UI_SUMMARY,
      runtimeRebuildCount: 0,
      recent: diagnostics.entries,
    });
  });

  it("summarizes sampled sequencer UI work and runtime rebuilds", () => {
    let diagnostics = createTimedTransportDiagnostics();
    diagnostics = pushTimedTransportDiagnostic(diagnostics, {
      type: "ui-commit",
      commitDurationMs: 18.25,
      measurementDurationMs: 1.5,
      snapshotRowCount: 24,
      eventRowCount: 12,
      structuralRowCount: 8,
      rowCount: 40,
      visibleRowCount: 10,
      mountedNodeCount: 320,
    });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, {
      type: "ui-frame-sample",
      frameIntervalMs: 55,
      measurementDurationMs: 0.5,
      snapshotRowCount: 26,
      eventRowCount: 14,
      structuralRowCount: 8,
      rowCount: 44,
      visibleRowCount: 12,
      mountedNodeCount: 340,
    });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, {
      type: "runtime-rebuild",
      runtimeInstanceId: 12,
    });

    const summary = summarizeTimedTransportDiagnostics(diagnostics);

    expect(summary.latenessSampleCount).toBe(0);
    expect(summary.meanLatenessMs).toBeNull();
    expect(summary.ui).toEqual({
      sampleCount: 2,
      commitSampleCount: 1,
      frameSampleCount: 1,
      longFrameCount: 1,
      meanCommitDurationMs: 18.25,
      maxCommitDurationMs: 18.25,
      meanFrameIntervalMs: 55,
      maxFrameIntervalMs: 55,
      meanMeasurementDurationMs: 1,
      maxMeasurementDurationMs: 1.5,
      maxSnapshotRowCount: 26,
      maxEventRowCount: 14,
      maxStructuralRowCount: 8,
      maxRowCount: 44,
      maxVisibleRowCount: 12,
      maxMountedNodeCount: 340,
      recent: diagnostics.entries.slice(0, 2),
    });
    expect(summary.runtimeRebuildCount).toBe(1);
  });

  it("resets while preserving or replacing the configured limit", () => {
    let diagnostics = createTimedTransportDiagnostics(10);
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "schedule" });

    expect(resetTimedTransportDiagnostics(diagnostics)).toEqual({
      limit: 10,
      entries: [],
      nextId: 1,
    });
    expect(resetTimedTransportDiagnostics(diagnostics, 5)).toEqual({
      limit: 5,
      entries: [],
      nextId: 1,
    });
  });

  it("round-trips persisted diagnostics through storage", () => {
    const storage = {
      values: new Map(),
      getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
      },
      setItem(key, value) {
        this.values.set(key, value);
      },
    };
    let diagnostics = createTimedTransportDiagnostics(10);
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", latenessMs: 18, cueIndex: 7 });

    persistTimedTransportDiagnostics(diagnostics, storage);

    expect(loadPersistedTimedTransportDiagnostics(storage)).toEqual({
      state: diagnostics,
      summary: {
        entryCount: 1,
        latenessSampleCount: 1,
        overrunCount: 0,
        meanLatenessMs: 18,
        meanAbsoluteLatenessMs: 18,
        rmsLatenessMs: 18,
        maxLatenessMs: 18,
        intervalJitterSampleCount: 0,
        meanIntervalJitterMs: null,
        meanAbsoluteIntervalJitterMs: null,
        rmsIntervalJitterMs: null,
        maxAbsoluteIntervalJitterMs: null,
        ui: EMPTY_UI_SUMMARY,
        runtimeRebuildCount: 0,
        recent: diagnostics.entries,
      },
    });
  });

  it("batches hot-path persistence and writes only the latest state", () => {
    vi.useFakeTimers();
    const storage = {
      values: new Map(),
      writes: 0,
      getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
      },
      setItem(key, value) {
        this.writes += 1;
        this.values.set(key, value);
      },
    };
    let diagnostics = pushTimedTransportDiagnostic(
      createTimedTransportDiagnostics(10),
      { type: "schedule", cueIndex: 1 },
    );
    bufferTimedTransportDiagnostics(diagnostics, storage);
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", cueIndex: 2 });
    bufferTimedTransportDiagnostics(diagnostics, storage);

    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(1999);
    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.writes).toBe(1);
    expect(loadPersistedTimedTransportDiagnostics(storage)?.state).toEqual(diagnostics);
  });
});
