// Viewport virtualization for the sequencer list. Snapshot groups remain the
// unit of rendering so their nested event rows, structural markers, and drag
// interactions keep their existing component ownership.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

export const SEQUENCE_VIRTUALIZATION_MIN_ITEMS = 40;
export const SEQUENCE_VIRTUALIZATION_OVERSCAN_PX = 900;

export function estimateSequenceGroupHeight({ eventCount = 0, structuralCount = 0, expanded = false } = {}) {
  const snapshotRowHeight = 30;
  const eventHeaderHeight = expanded ? 27 : 0;
  const eventRowsHeight = expanded ? Math.max(0, Number(eventCount) || 0) * 25 : 0;
  const structuralRowsHeight = Math.max(0, Number(structuralCount) || 0) * 30;
  return snapshotRowHeight + eventHeaderHeight + eventRowsHeight + structuralRowsHeight;
}

export function buildVirtualSequenceLayout({
  items = [],
  measuredSizes = new Map(),
  scrollTop = 0,
  viewportHeight = 0,
  overscan = SEQUENCE_VIRTUALIZATION_OVERSCAN_PX,
  pinnedIndexes = [],
  anchorIndex = null,
  enabled = true,
} = {}) {
  const sizes = items.map((item) => (
    measuredSizes.get(item.key) ?? Math.max(1, Number(item.estimatedSize) || 1)
  ));
  const offsets = [0];
  sizes.forEach((size) => offsets.push(offsets[offsets.length - 1] + size));
  const totalSize = offsets[offsets.length - 1] ?? 0;

  if (!enabled || items.length === 0) {
    return {
      rows: items.map((item, index) => ({ type: "item", key: item.key, item, index })),
      offsets,
      sizes,
      totalSize,
      visibleItemCount: items.length,
      mountedItemCount: items.length,
    };
  }

  const normalizedAnchorIndex = Number(anchorIndex);
  const effectiveScrollTop = Number.isInteger(normalizedAnchorIndex)
    && normalizedAnchorIndex >= 0
    && normalizedAnchorIndex < items.length
    ? offsets[normalizedAnchorIndex]
    : Number(scrollTop);
  const start = Math.max(0, effectiveScrollTop - overscan);
  const end = Math.max(start, effectiveScrollTop + Math.max(1, Number(viewportHeight) || 1) + overscan);
  const indexes = new Set();
  for (let index = 0; index < items.length; index += 1) {
    if (offsets[index + 1] >= start && offsets[index] <= end) indexes.add(index);
  }
  pinnedIndexes.forEach((index) => {
    const numeric = Number(index);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < items.length) indexes.add(numeric);
  });

  const orderedIndexes = [...indexes].sort((left, right) => left - right);
  const rows = [];
  let cursor = 0;
  orderedIndexes.forEach((index) => {
    const spacerSize = offsets[index] - offsets[cursor];
    if (spacerSize > 0) {
      rows.push({ type: "spacer", key: `spacer:${cursor}:${index}`, size: spacerSize });
    }
    rows.push({ type: "item", key: items[index].key, item: items[index], index });
    cursor = index + 1;
  });
  const trailingSize = totalSize - offsets[cursor];
  if (trailingSize > 0) {
    rows.push({ type: "spacer", key: `spacer:${cursor}:${items.length}`, size: trailingSize });
  }

  const visibleItemCount = orderedIndexes.filter((index) => (
    offsets[index + 1] >= effectiveScrollTop
    && offsets[index] <= effectiveScrollTop + Math.max(1, Number(viewportHeight) || 1)
  )).length;
  return {
    rows,
    offsets,
    sizes,
    totalSize,
    visibleItemCount,
    mountedItemCount: orderedIndexes.length,
  };
}

export function useSequenceVirtualization({
  scrollPanelRef,
  contentRef,
  items = [],
  pinnedIndexes = [],
} = {}) {
  const enabled = items.length >= SEQUENCE_VIRTUALIZATION_MIN_ITEMS;
  const observedNodesRef = useRef(new Map());
  const resizeObserverRef = useRef(null);
  const pendingFrameRef = useRef(null);
  const pendingMeasurementFrameRef = useRef(null);
  const pendingMeasurementsRef = useRef(new Map());
  const layoutRef = useRef(null);
  const pendingStartAnchorRef = useRef(null);
  const [measuredSizes, setMeasuredSizes] = useState(() => new Map());
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 640 });
  const [startAnchorIndex, setStartAnchorIndex] = useState(null);

  const flushMeasurements = useCallback(() => {
    pendingMeasurementFrameRef.current = null;
    const pendingMeasurements = pendingMeasurementsRef.current;
    pendingMeasurementsRef.current = new Map();
    if (pendingMeasurements.size === 0) return;
    setMeasuredSizes((previous) => {
      let next = previous;
      pendingMeasurements.forEach((numeric, key) => {
        const previousSize = previous.get(key);
        if (previousSize != null && Math.abs(previousSize - numeric) < 0.5) return;
        if (next === previous) next = new Map(previous);
        next.set(key, numeric);
      });
      return next;
    });
  }, []);

  const queueMeasurement = useCallback((key, size) => {
    const numeric = Number(size);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    pendingMeasurementsRef.current.set(key, numeric);
    if (pendingMeasurementFrameRef.current != null) return;
    pendingMeasurementFrameRef.current = window.requestAnimationFrame(flushMeasurements);
  }, [flushMeasurements]);

  const measureItem = useCallback((key, node) => {
    const previousNode = observedNodesRef.current.get(key) ?? null;
    if (previousNode && previousNode !== node) resizeObserverRef.current?.unobserve?.(previousNode);
    if (!(node instanceof HTMLElement)) {
      observedNodesRef.current.delete(key);
      pendingMeasurementsRef.current.delete(key);
      return;
    }
    observedNodesRef.current.set(key, node);
    resizeObserverRef.current?.observe?.(node);
    queueMeasurement(key, node.getBoundingClientRect().height || node.offsetHeight);
  }, [queueMeasurement]);

  useLayoutEffect(() => {
    if (!enabled || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        for (const [key, node] of observedNodesRef.current.entries()) {
          if (node !== entry.target) continue;
          // ResizeObserver callbacks run during layout delivery. Updating the
          // virtual spacers here can resize the observed row again in the same
          // delivery cycle, producing an observer loop. Apply all row sizes in
          // one state update on the next animation frame instead.
          queueMeasurement(key, entry.contentRect?.height ?? node.getBoundingClientRect().height);
          break;
        }
      });
    });
    resizeObserverRef.current = observer;
    observedNodesRef.current.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [enabled, queueMeasurement]);

  useEffect(() => () => {
    if (pendingMeasurementFrameRef.current != null) {
      window.cancelAnimationFrame(pendingMeasurementFrameRef.current);
    }
    pendingMeasurementFrameRef.current = null;
    pendingMeasurementsRef.current.clear();
  }, []);

  useEffect(() => {
    const keys = new Set(items.map((item) => item.key));
    pendingMeasurementsRef.current.forEach((_, key) => {
      if (!keys.has(key)) pendingMeasurementsRef.current.delete(key);
    });
    setMeasuredSizes((previous) => {
      const staleKeys = [...previous.keys()].filter((key) => !keys.has(key));
      if (staleKeys.length === 0) return previous;
      const next = new Map(previous);
      staleKeys.forEach((key) => next.delete(key));
      return next;
    });
  }, [items]);

  useLayoutEffect(() => {
    const panel = scrollPanelRef?.current;
    if (!(panel instanceof HTMLElement)) return undefined;
    const updateViewport = () => {
      pendingFrameRef.current = null;
      const next = { scrollTop: panel.scrollTop, height: panel.clientHeight || 640 };
      setViewport((previous) => (
        previous.scrollTop === next.scrollTop && previous.height === next.height ? previous : next
      ));
    };
    const scheduleUpdate = () => {
      if (pendingFrameRef.current != null) return;
      pendingFrameRef.current = window.requestAnimationFrame(updateViewport);
    };
    updateViewport();
    panel.addEventListener("scroll", scheduleUpdate, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleUpdate) : null;
    observer?.observe(panel);
    return () => {
      panel.removeEventListener("scroll", scheduleUpdate);
      observer?.disconnect();
      if (pendingFrameRef.current != null) window.cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    };
  }, [scrollPanelRef]);

  const layout = useMemo(() => buildVirtualSequenceLayout({
    items,
    measuredSizes,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    pinnedIndexes,
    anchorIndex: startAnchorIndex,
    enabled,
  }), [enabled, items, measuredSizes, pinnedIndexes, startAnchorIndex, viewport.height, viewport.scrollTop]);
  layoutRef.current = layout;

  const clearPendingStartAnchor = useCallback(() => {
    pendingStartAnchorRef.current = null;
    setStartAnchorIndex(null);
  }, []);

  const applyStartAnchor = useCallback((anchor, activeLayout = layoutRef.current) => {
    const panel = scrollPanelRef?.current;
    const contentNode = contentRef?.current;
    if (!(panel instanceof HTMLElement) || !(contentNode instanceof HTMLElement)) return false;
    const panelRect = panel.getBoundingClientRect();
    const mountedTarget = contentNode.querySelector(
      `[data-sequence-virtual-index="${anchor.index}"]`,
    );
    let targetContentTop;
    if (mountedTarget instanceof HTMLElement) {
      targetContentTop = panel.scrollTop + mountedTarget.getBoundingClientRect().top - panelRect.top;
    } else {
      const top = activeLayout?.offsets?.[anchor.index];
      if (!Number.isFinite(top)) return false;
      targetContentTop = panel.scrollTop
        + contentNode.getBoundingClientRect().top
        - panelRect.top
        + top;
    }
    const nextTop = Math.max(0, targetContentTop - anchor.topOffset);
    if (Math.abs(nextTop - panel.scrollTop) >= 1) panel.scrollTop = nextTop;
    setViewport((previous) => (
      previous.scrollTop === nextTop
        ? previous
        : { scrollTop: nextTop, height: panel.clientHeight || 640 }
    ));
    return true;
  }, [contentRef, scrollPanelRef]);

  useLayoutEffect(() => {
    const anchor = pendingStartAnchorRef.current;
    if (anchor == null) return;
    applyStartAnchor(anchor, layout);
  }, [
    applyStartAnchor,
    layout,
  ]);

  useEffect(() => {
    const panel = scrollPanelRef?.current;
    if (!(panel instanceof HTMLElement)) return undefined;
    panel.addEventListener("wheel", clearPendingStartAnchor, { passive: true });
    panel.addEventListener("touchmove", clearPendingStartAnchor, { passive: true });
    return () => {
      panel.removeEventListener("wheel", clearPendingStartAnchor);
      panel.removeEventListener("touchmove", clearPendingStartAnchor);
    };
  }, [clearPendingStartAnchor, scrollPanelRef]);

  const scrollIndexIntoView = useCallback((index, {
    align = "nearest",
    topOffset = 0,
  } = {}) => {
    const numeric = Number(index);
    const panel = scrollPanelRef?.current;
    if (!enabled || !Number.isInteger(numeric) || !(panel instanceof HTMLElement)) return false;
    const top = layoutRef.current?.offsets?.[numeric];
    const bottom = layoutRef.current?.offsets?.[numeric + 1];
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return false;
    const viewportHeight = panel.clientHeight || 640;
    if (align === "start") {
      const anchor = {
        index: numeric,
        topOffset: Math.max(0, Number(topOffset) || 0),
      };
      pendingStartAnchorRef.current = anchor;
      setStartAnchorIndex(numeric);
      const applied = applyStartAnchor(anchor);
      return applied;
    }
    clearPendingStartAnchor();
    const contentNode = contentRef?.current;
    const contentTop = contentNode instanceof HTMLElement
      ? panel.scrollTop
        + contentNode.getBoundingClientRect().top
        - panel.getBoundingClientRect().top
      : 0;
    const viewportBottom = panel.scrollTop + viewportHeight;
    const absoluteTop = contentTop + top;
    const absoluteBottom = contentTop + bottom;
    if (absoluteTop >= panel.scrollTop && absoluteBottom <= viewportBottom) return false;
    const nextTop = Math.max(0, absoluteTop - Math.min(120, SEQUENCE_VIRTUALIZATION_OVERSCAN_PX / 2));
    panel.scrollTop = nextTop;
    setViewport({ scrollTop: nextTop, height: viewportHeight });
    return true;
  }, [
    applyStartAnchor,
    clearPendingStartAnchor,
    contentRef,
    enabled,
    scrollPanelRef,
  ]);

  return {
    enabled,
    layout,
    measureItem,
    scrollIndexIntoView,
    cancelPendingStartAnchor: clearPendingStartAnchor,
  };
}
