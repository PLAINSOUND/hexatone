import { describe, expect, it } from "vitest";
import { deriveSnapshotDegreeList, deriveSnapshotFilterEntries } from "./snapshot-filter-library.js";

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
});
