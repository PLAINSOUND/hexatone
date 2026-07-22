import { h } from "preact";
import { useRef } from "preact/hooks";
import { act, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import {
  buildVirtualSequenceLayout,
  estimateSequenceGroupHeight,
  useSequenceVirtualization,
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

  it("batches ResizeObserver row measurements into the next animation frame", () => {
    const animationFrames = [];
    let nextFrameId = 1;
    class MockResizeObserver {
      static instances = [];

      constructor(callback) {
        this.callback = callback;
        this.observed = new Set();
        MockResizeObserver.instances.push(this);
      }

      observe(node) {
        this.observed.add(node);
      }

      unobserve(node) {
        this.observed.delete(node);
      }

      disconnect() {
        this.observed.clear();
      }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => {
      animationFrames.push(callback);
      return nextFrameId++;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const items = Array.from({ length: 40 }, (_, index) => ({
      key: `item-${index}`,
      estimatedSize: 50,
    }));
    let virtualization = null;
    function Probe() {
      const scrollPanelRef = useRef(null);
      virtualization = useSequenceVirtualization({ scrollPanelRef, items });
      return h("div", { ref: scrollPanelRef });
    }

    const view = render(h(Probe));
    const row = document.createElement("div");
    row.getBoundingClientRect = () => ({ height: 100 });

    act(() => virtualization.measureItem("item-0", row));
    expect(virtualization.layout.sizes[0]).toBe(50);
    expect(animationFrames).toHaveLength(1);

    act(() => animationFrames.shift()(0));
    expect(virtualization.layout.sizes[0]).toBe(100);

    const rowObserver = MockResizeObserver.instances.find((observer) => observer.observed.has(row));
    act(() => rowObserver.callback([{ target: row, contentRect: { height: 160 } }]));
    expect(virtualization.layout.sizes[0]).toBe(100);
    expect(animationFrames).toHaveLength(1);

    act(() => animationFrames.shift()(16));
    expect(virtualization.layout.sizes[0]).toBe(160);

    view.unmount();
    vi.unstubAllGlobals();
  });
});
