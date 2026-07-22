import { describe, expect, it, vi } from "vitest";

import { collectSequencerUiMetrics } from "./timed-ui-diagnostics.js";

function row(top, bottom) {
  const node = document.createElement("div");
  node.getBoundingClientRect = vi.fn(() => ({ top, bottom }));
  return node;
}

describe("timed UI diagnostics", () => {
  it("counts unique mounted rows without reading row geometry or traversing descendants", () => {
    const scrollPanel = document.createElement("div");
    scrollPanel.getBoundingClientRect = vi.fn();
    scrollPanel.querySelectorAll = vi.fn();
    Object.defineProperty(scrollPanel, "scrollTop", { value: 640, configurable: true });
    const visibleSnapshot = row(120, 160);
    const visibleEvent = row(280, 320);
    const hiddenBar = row(20, 80);
    const staleDetachedSnapshot = row(0, 0);
    scrollPanel.append(visibleSnapshot, visibleEvent, hiddenBar);
    document.body.append(scrollPanel);
    visibleSnapshot.append(document.createElement("span"));

    const metrics = collectSequencerUiMetrics({
      scrollPanelRef: { current: scrollPanel },
      snapshotRowRefs: {
        current: new Map([
          ["snapshot", visibleSnapshot],
          ["stale-detached-snapshot", staleDetachedSnapshot],
        ]),
      },
      eventRowRefs: { current: new Map([["event", visibleEvent]]) },
      barRowRefs: {
        current: new Map([
          ["bar", hiddenBar],
          ["duplicate", visibleSnapshot],
        ]),
      },
    });

    expect(metrics).toMatchObject({
      snapshotRowCount: 1,
      eventRowCount: 1,
      structuralRowCount: 2,
      rowCount: 3,
      visibleRowCount: null,
      mountedNodeCount: 3,
      scrollTop: 640,
    });
    expect(scrollPanel.getBoundingClientRect).not.toHaveBeenCalled();
    expect(scrollPanel.querySelectorAll).not.toHaveBeenCalled();
    expect(visibleSnapshot.getBoundingClientRect).not.toHaveBeenCalled();
    expect(visibleEvent.getBoundingClientRect).not.toHaveBeenCalled();
    expect(hiddenBar.getBoundingClientRect).not.toHaveBeenCalled();
    expect(metrics.measurementDurationMs).toBeGreaterThanOrEqual(0);
  });
});
