import { describe, expect, it } from "vitest";
import {
  buildVirtualSequenceLayout,
  estimateSequenceGroupHeight,
} from "./sequence-virtualization.js";

describe("sequence virtualization", () => {
  it("renders the viewport, overscan, and disjoint pinned items with exact spacers", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ key: `item-${index}`, estimatedSize: 100 }));
    const layout = buildVirtualSequenceLayout({
      items,
      scrollTop: 400,
      viewportHeight: 100,
      overscan: 100,
      pinnedIndexes: [0, 9],
    });

    expect(layout.rows.filter((row) => row.type === "item").map((row) => row.index)).toEqual([0, 2, 3, 4, 5, 6, 9]);
    expect(layout.rows.filter((row) => row.type === "spacer").reduce((sum, row) => sum + row.size, 0)).toBe(300);
    expect(layout.totalSize).toBe(1000);
  });

  it("uses measured heights and estimates expanded snapshot groups", () => {
    const items = [{ key: "a", estimatedSize: 100 }, { key: "b", estimatedSize: 100 }];
    const layout = buildVirtualSequenceLayout({
      items,
      measuredSizes: new Map([["a", 175]]),
      enabled: false,
    });

    expect(layout.offsets).toEqual([0, 175, 275]);
    expect(estimateSequenceGroupHeight({ expanded: true, eventCount: 4, structuralCount: 2 })).toBe(217);
  });
});
