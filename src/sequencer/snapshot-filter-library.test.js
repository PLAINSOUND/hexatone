import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveSnapshotDegreeList, deriveSnapshotFilterEntries } from "./snapshot-filter-library.js";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "../tuning/workspace.js";

describe("snapshot-filter-library", () => {
  const runtime = {
    scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
    equivInterval: 1200,
    referenceDegree: 9,
    fundamental: 440,
  };

  it("maps snapshot notes onto reduced degrees of the current tuning", () => {
    expect(deriveSnapshotDegreeList([
      { midicents: 69 },
      { midicents: 64 },
      { midicents: 60 },
    ], runtime)).toEqual([0, 4, 9]);
  });

  it("builds named virtual filter entries from snapshots", () => {
    expect(deriveSnapshotFilterEntries([
      {
        id: 1,
        notes: [
          { midicents: 69 },
          { midicents: 64 },
          { midicents: 60 },
        ],
      },
      {
        id: 2,
        notes: [
          { midicents: 67 },
          { midicents: 62 },
        ],
      },
    ], runtime)).toEqual([
      { id: "__snapshot__:1", name: "Snapshot 1", degrees: [0, 4, 9] },
      { id: "__snapshot__:2", name: "Snapshot 2", degrees: [2, 7] },
    ]);
  });

  it("derives snapshot degrees from raw Scala-style scale text", () => {
    expect(deriveSnapshotDegreeList([
      { midicents: 69 },
      { midicents: 64 },
      { midicents: 60 },
    ], {
      scale: ["100.0", "200.0", "300.0", "400.0", "500.0", "600.0", "700.0", "800.0", "900.0", "1000.0", "1100.0", "2/1"],
      equivInterval: 1200,
      referenceDegree: 9,
      fundamental: 440,
    })).toEqual([0, 4, 9]);
  });

  it("prefers exact monzo identity over nearest-frequency matching", () => {
    expect(deriveSnapshotDegreeList([
      {
        midicents: 69,
        ratioText: "45/32",
        monzo: [-5, 2, 1],
      },
      {
        midicents: 64,
        ratioText: "9/8",
        monzo: [-3, 2, 0],
      },
      {
        midicents: 60,
        ratioText: "153/128",
        monzo: [-7, 2, 0, 0, 0, 0, 1],
      },
    ], {
      scale: [0, 100, 200, 300, 400, 500, 600, 700],
      equivInterval: 1200,
      referenceDegree: 0,
      fundamental: 440,
      degreeIntervals: [
        { ratioText: "1/1", monzo: [0] },
        { ratioText: "9/8", monzo: [-3, 2, 0] },
        { ratioText: "45/32", monzo: [-5, 2, 1] },
        { ratioText: "153/128", monzo: [-7, 2, 0, 0, 0, 0, 1] },
        { ratioText: "5/4", monzo: [-2, 0, 1] },
        { ratioText: "3/2", monzo: [-1, 1, 0] },
        { ratioText: "15/8", monzo: [-3, 1, 1] },
        { ratioText: "2/1", monzo: [1] },
      ],
    })).toEqual([1, 2, 3]);
  });

  it("matches FALL snapshot 1 against the built-in Sabat The Tree tuning by exact degree identity", () => {
    const tuning = JSON.parse(
      readFileSync(
        "src/hexatone/preset-tunings/odd-partial-pitch-class-sets/81-47-limit-256-sabat-the-tree.json",
        "utf8",
      ),
    );
    const sequence = JSON.parse(
      readFileSync(
        "src/sequencer/preset-sequences/marc-sabat/FALL.json",
        "utf8",
      ),
    );
    const workspace = createScaleWorkspace({
      scale: tuning.scale,
      reference_degree: tuning.reference_degree ?? 0,
      fundamental: tuning.fundamental ?? 440,
    });
    const runtime = normalizeWorkspaceForKeys(workspace);
    runtime.referenceDegree = tuning.reference_degree ?? 0;
    runtime.fundamental = tuning.fundamental ?? 440;

    expect(deriveSnapshotDegreeList(sequence.snapshots[0].notes, runtime)).toEqual([11, 17, 29, 34, 56]);
  });
});
