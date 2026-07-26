import { describe, expect, it } from "vitest";

import {
  buildLoadedSequenceWorkspace,
  buildRestoredSequenceWorkspace,
  defaultSequenceBars,
  defaultSequenceTempi,
  deriveSequenceWorkspaceIds,
} from "./workspace-runtime.js";

describe("workspace runtime", () => {
  it("builds the default structural markers for a new sequence workspace", () => {
    expect(defaultSequenceBars()).toEqual([{ id: 1, position: 1, numerator: 4, denominator: 4 }]);
    expect(defaultSequenceTempi()).toEqual([{
      id: 1,
      position: 1,
      bpm: 60,
      beatNumerator: 1,
      beatDenominator: 4,
      beatLength: 1,
      mode: "immediate",
    }]);
  });

  it("derives snapshot and bar id seeds from the loaded workspace", () => {
    expect(deriveSequenceWorkspaceIds({
      snapshots: [{ id: 3 }, { id: 9 }, { id: "bad" }],
      bars: [{ id: 2 }, { id: 7 }, { id: "bad" }],
    })).toEqual({
      snapshotId: 9,
      barId: 7,
    });
  });

  it("normalizes a loaded built-in sequence into workspace state", () => {
    const result = buildLoadedSequenceWorkspace({
      name: "FALL",
      snapshots: [{ id: 4, length: 1, notes: [] }],
      bars: [{ id: 2, position: 2, numerator: 3, denominator: 2 }],
      tempi: [{ id: 3, position: 2, bpm: 72, beatNumerator: 1, beatDenominator: 8, beatLength: 0.5, mode: "transition" }],
      repeats: [{ id: 5, position: 3, kind: "end", repeatCount: 4 }],
      snapshotLabelMode: "odd-partials",
      autoCreateBars: false,
      description: "demo",
    }, { source: "builtin" });

    expect(result).toMatchObject({
      snapshotLabelMode: "odd-partials",
      sequenceAutoCreateBars: false,
      activeSequenceSource: "builtin",
      activeSequenceBuiltInName: "FALL",
      activeSequenceName: "FALL",
      activeSequenceSavedName: "",
      activeSequenceDescription: "demo",
      ids: {
        snapshotId: 4,
        barId: 2,
      },
    });
    expect(result.tempi).toHaveLength(2);
    expect(result.tempi[0]).toMatchObject({
      position: 1,
      bpm: 60,
      mode: "immediate",
    });
    expect(result.tempi[1]).toMatchObject({
      id: 3,
      position: 2,
      bpm: 72,
      mode: "gradual",
    });
  });

  it("shapes the restored workspace payload for app state rehydration", () => {
    const result = buildRestoredSequenceWorkspace({
      snapshots: [{ id: 2, length: 1, notes: [] }],
      bars: [{ id: 3, position: 2, numerator: 4, denominator: 4 }],
      tempi: [{ id: 4, position: 2, bpm: 80, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" }],
      repeats: [{ id: 5, position: 2.5, kind: "start", repeatCount: null }],
      snapshotLabelMode: "proportion",
      activeSequenceSource: "user",
      activeSequenceBuiltInName: "",
      activeSequenceName: "Mine",
      activeSequenceSavedName: "Mine",
      activeSequenceDescription: "saved",
      sequenceLegato: false,
      snapSequenceToCurrentTuning: true,
      sequenceAutoCreateBars: false,
    });

    expect(result).toMatchObject({
      activeSequenceSource: "user",
      activeSequenceName: "Mine",
      activeSequenceSavedName: "Mine",
      activeSequenceDescription: "saved",
      sequenceLegato: false,
      snapSequenceToCurrentTuning: true,
      sequenceAutoCreateBars: false,
      ids: {
        snapshotId: 2,
        barId: 3,
      },
    });
  });
});
