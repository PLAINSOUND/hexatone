import { h } from "preact";
import { useRef, useState } from "preact/hooks";
import { act, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import {
  buildVirtualSequenceLayout,
  deriveRecentFittingEventBounds,
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

  it("keeps the render window centered on an explicit index regardless of physical scrollTop", () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      key: `item-${index}`,
      estimatedSize: 50,
    }));
    const layout = buildVirtualSequenceLayout({
      items,
      scrollTop: 4800,
      viewportHeight: 100,
      overscan: 100,
      anchorIndex: 20,
    });

    const mountedIndexes = layout.rows
      .filter((row) => row.type === "item")
      .map((row) => row.index);
    expect(mountedIndexes).toContain(20);
    expect(mountedIndexes).not.toContain(96);
  });

  it("keeps the largest suffix of recent sounding events that fits", () => {
    expect(deriveRecentFittingEventBounds([
      { top: 0, bottom: 30 },
      { top: 300, bottom: 330 },
      { top: 350, bottom: 380 },
    ], 100)).toEqual({
      top: 300,
      bottom: 380,
      allFit: false,
      includedCount: 2,
    });
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

  it("invalidates an unmounted row measurement when structural content changes", () => {
    const animationFrames = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const initialItems = Array.from({ length: 40 }, (_, index) => ({
      key: `item-${index}`,
      estimatedSize: 50,
      measurementToken: "initial",
    }));
    let virtualization = null;
    let updateItems = null;
    function Probe() {
      const scrollPanelRef = useRef(null);
      const [items, setItems] = useState(initialItems);
      updateItems = setItems;
      virtualization = useSequenceVirtualization({ scrollPanelRef, items });
      return h("div", { ref: scrollPanelRef });
    }

    const view = render(h(Probe));
    const row = document.createElement("div");
    row.getBoundingClientRect = () => ({ height: 100 });
    act(() => virtualization.measureItem("item-0", row));
    act(() => animationFrames.shift()(0));
    expect(virtualization.layout.sizes[0]).toBe(100);

    act(() => virtualization.measureItem("item-0", null));
    act(() => updateItems(initialItems.map((item, index) => (
      index === 0
        ? { ...item, estimatedSize: 80, measurementToken: "tempo-added" }
        : item
    ))));

    expect(virtualization.layout.sizes[0]).toBe(80);

    view.unmount();
    vi.unstubAllGlobals();
  });

  it("rebuilds from fresh estimates immediately when the event-list revision changes", () => {
    const animationFrames = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const initialItems = Array.from({ length: 40 }, (_, index) => ({
      key: `item-${index}`,
      estimatedSize: 50,
      measurementToken: "unchanged-shape",
    }));
    let virtualization = null;
    let rebuild = null;
    function Probe() {
      const scrollPanelRef = useRef(null);
      const [state, setState] = useState({ items: initialItems, revision: 1 });
      rebuild = setState;
      virtualization = useSequenceVirtualization({
        scrollPanelRef,
        items: state.items,
        revision: state.revision,
      });
      return h("div", { ref: scrollPanelRef });
    }

    const view = render(h(Probe));
    const row = document.createElement("div");
    row.getBoundingClientRect = () => ({ height: 100 });
    act(() => virtualization.measureItem("item-0", row));
    act(() => animationFrames.shift()(0));
    expect(virtualization.layout.sizes[0]).toBe(100);
    act(() => virtualization.measureItem("item-0", null));

    act(() => rebuild({
      items: initialItems.map((item, index) => (
        index === 0 ? { ...item, estimatedSize: 80 } : item
      )),
      revision: 2,
    }));

    expect(virtualization.layout.sizes[0]).toBe(80);

    view.unmount();
    vi.unstubAllGlobals();
  });

  it("keeps a start-aligned index anchored while mounted row measurements settle", () => {
    const animationFrames = [];
    let nextFrameId = 1;
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
    let scrollTop = 0;
    function Probe() {
      const scrollPanelRef = useRef(null);
      const contentRef = useRef(null);
      virtualization = useSequenceVirtualization({
        scrollPanelRef,
        contentRef,
        items,
      });
      return h(
        "div",
        { ref: scrollPanelRef },
        h("div", { ref: contentRef }),
      );
    }

    const view = render(h(Probe));
    const panel = view.container.firstElementChild;
    const content = panel.firstElementChild;
    Object.defineProperty(panel, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(panel, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });
    panel.getBoundingClientRect = () => ({ top: 0 });
    content.getBoundingClientRect = () => ({ top: -scrollTop });

    act(() => virtualization.scrollIndexIntoView(20, { align: "start" }));
    expect(scrollTop).toBe(1000);

    for (let index = 0; index < 12; index += 1) {
      const measuredRow = document.createElement("div");
      measuredRow.getBoundingClientRect = () => ({ height: 20 });
      act(() => virtualization.measureItem(`item-${index}`, measuredRow));

      let safety = 20;
      while (virtualization.layout.sizes[index] !== 20 && animationFrames.length > 0 && safety > 0) {
        safety -= 1;
        act(() => animationFrames.shift()(0));
      }
      expect(virtualization.layout.sizes[index]).toBe(20);
    }

    expect(scrollTop).toBe(640);

    view.unmount();
    vi.unstubAllGlobals();
  });

  it("shows a fitting target range but bottom-aligns the preferred event when it overflows", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      key: `item-${index}`,
      estimatedSize: 50,
    }));
    let virtualization = null;
    let scrollTop = 500;
    function Probe() {
      const scrollPanelRef = useRef(null);
      const contentRef = useRef(null);
      virtualization = useSequenceVirtualization({
        scrollPanelRef,
        contentRef,
        items,
      });
      return h(
        "div",
        { ref: scrollPanelRef },
        h(
          "div",
          { ref: contentRef },
          h(
            "div",
            { "data-sequence-virtual-index": "10" },
            h("div", { "data-sequence-event-id": "early" }),
          ),
          h(
            "div",
            { "data-sequence-virtual-index": "12" },
            h("div", { "data-sequence-event-id": "middle" }),
            h("div", { "data-sequence-event-id": "recent" }),
          ),
        ),
      );
    }

    const view = render(h(Probe));
    const panel = view.container.firstElementChild;
    const content = panel.firstElementChild;
    const early = content.querySelector('[data-sequence-virtual-index="10"]');
    const recent = content.querySelector('[data-sequence-virtual-index="12"]');
    const earlyEvent = content.querySelector('[data-sequence-event-id="early"]');
    const middleEvent = content.querySelector('[data-sequence-event-id="middle"]');
    const recentEvent = content.querySelector('[data-sequence-event-id="recent"]');
    Object.defineProperty(panel, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(panel, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });
    panel.getBoundingClientRect = () => ({ top: 0, bottom: 200 });
    content.getBoundingClientRect = () => ({ top: -scrollTop });
    early.getBoundingClientRect = () => ({ top: 1000 - scrollTop, bottom: 1040 - scrollTop, height: 40 });
    recent.getBoundingClientRect = () => ({ top: 1100 - scrollTop, bottom: 1140 - scrollTop, height: 40 });
    earlyEvent.getBoundingClientRect = () => ({ top: 1010 - scrollTop, bottom: 1030 - scrollTop, height: 20 });
    middleEvent.getBoundingClientRect = () => ({ top: 1080 - scrollTop, bottom: 1100 - scrollTop, height: 20 });
    recentEvent.getBoundingClientRect = () => ({ top: 1110 - scrollTop, bottom: 1130 - scrollTop, height: 20 });

    act(() => virtualization.scrollIndexIntoView(12, {
      align: "start",
      topOffset: 6,
      targetIndexes: [10, 12],
      overflowAlignment: "end",
      preferredEventId: "recent",
      targetEventIds: ["early", "missing", "recent"],
    }));
    expect(scrollTop).toBe(936);

    act(() => virtualization.scrollIndexIntoView(12, {
      align: "start",
      topOffset: 6,
      targetIndexes: [10, 12],
      overflowAlignment: "end",
      preferredEventId: "recent",
      targetEventIds: ["early", "middle", "recent"],
    }));
    expect(scrollTop).toBe(1004);

    early.getBoundingClientRect = () => ({ top: 500 - scrollTop, bottom: 540 - scrollTop, height: 40 });
    recent.getBoundingClientRect = () => ({ top: 1200 - scrollTop, bottom: 1240 - scrollTop, height: 40 });
    earlyEvent.getBoundingClientRect = () => ({ top: 510 - scrollTop, bottom: 530 - scrollTop, height: 20 });
    middleEvent.getBoundingClientRect = () => ({ top: 1160 - scrollTop, bottom: 1180 - scrollTop, height: 20 });
    recentEvent.getBoundingClientRect = () => ({ top: 1210 - scrollTop, bottom: 1230 - scrollTop, height: 20 });
    act(() => virtualization.scrollIndexIntoView(12, {
      align: "start",
      topOffset: 6,
      targetIndexes: [10, 12],
      overflowAlignment: "end",
      preferredEventId: "recent",
      targetEventIds: ["early", "middle", "recent"],
    }));
    expect(scrollTop).toBe(1036);

    view.unmount();
  });
});
