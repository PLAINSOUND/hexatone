import { describe, expect, it } from "vitest";

import {
  createTimedTransportDiagnostics,
  loadPersistedTimedTransportDiagnostics,
  persistTimedTransportDiagnostics,
  pushTimedTransportDiagnostic,
  resetTimedTransportDiagnostics,
  summarizeTimedTransportDiagnostics,
} from "./timed-transport-diagnostics.js";

describe("timed transport diagnostics", () => {
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
      recent: diagnostics.entries,
    });
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
        recent: diagnostics.entries,
      },
    });
  });
});
