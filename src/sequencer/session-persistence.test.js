import { describe, expect, it, beforeEach } from "vitest";

import {
  SEQUENCE_WORKSPACE_STORAGE_KEY,
  clearSequenceWorkspaceSession,
  loadSequenceWorkspaceFromSession,
  saveSequenceWorkspaceToSession,
} from "./session-persistence.js";

describe("sequencer session persistence", () => {
  beforeEach(() => {
    sessionStorage.removeItem(SEQUENCE_WORKSPACE_STORAGE_KEY);
  });

  it("round-trips the active sequencer workspace through sessionStorage", () => {
    saveSequenceWorkspaceToSession({
      snapshots: [{
        id: 1,
        length: 1,
        notes: [],
        manualTrigger: { articulation: "arpeggiate" },
      }],
      bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" }],
      repeats: [{ id: "r1", position: 2, kind: "end", repeatCount: 3 }],
      snapshotLabelMode: "proportion",
      activeSequenceSource: "builtin",
      activeSequenceBuiltInName: "FALL",
      activeSequenceName: "FALL",
      activeSequenceSavedName: "FALL",
      activeSequenceDescription: "demo",
      sequenceLegato: true,
      snapSequenceToCurrentTuning: false,
      sequenceAutoCreateBars: true,
      manualArpeggiation: {
        mode: "per-snapshot",
        initialSpreadMs: 950,
        timingVariation: 0.27,
      },
    });

    expect(loadSequenceWorkspaceFromSession()).toEqual({
      version: 2,
      snapshots: [{
        id: 1,
        length: 1,
        notes: [],
        manualTrigger: {
          articulation: "arpeggiate",
          styleId: null,
          styleParameters: null,
        },
      }],
      bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" }],
      repeats: [{ id: "r1", position: 2, kind: "end", repeatCount: 3 }],
      snapshotLabelMode: "proportion",
      activeSequenceSource: "builtin",
      activeSequenceBuiltInName: "FALL",
      activeSequenceName: "FALL",
      activeSequenceSavedName: "FALL",
      activeSequenceDescription: "demo",
      sequenceLegato: true,
      snapSequenceToCurrentTuning: false,
      sequenceAutoCreateBars: true,
      manualArpeggiation: {
        mode: "per-snapshot",
        styleId: "positional",
        initialSpreadMs: 950,
        spreadVariation: 0.3,
        timingVariation: 0.27,
        decayMs: 5000,
        decayVariation: 0.75,
        styleParameters: {},
      },
    });
  });

  it("clears the stored sequence workspace", () => {
    saveSequenceWorkspaceToSession({ snapshots: [{ id: 1, length: 1, notes: [] }] });
    clearSequenceWorkspaceSession();
    expect(loadSequenceWorkspaceFromSession()).toBeNull();
  });
});
