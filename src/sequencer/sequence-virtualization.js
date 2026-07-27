// Viewport virtualization for the sequencer list. Snapshot groups remain the
// unit of rendering so their nested event rows, structural markers, and drag
// interactions keep their existing component ownership.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { visibleElementBounds } from "./viewport-geometry.js";

export const SEQUENCE_VIRTUALIZATION_MIN_ITEMS = 40;
export const SEQUENCE_VIRTUALIZATION_OVERSCAN_PX = 900;

export function estimateSequenceGroupHeight({
  eventCount = 0,
  structuralCount = 0,
  transitionCueCount = 0,
  expanded = false,
} = {}) {
  const snapshotRowHeight = 30;
  const eventHeaderHeight = expanded ? 27 : 0;
  const eventRowsHeight = expanded ? Math.max(0, Number(eventCount) || 0) * 25 : 0;
  const structuralRowsHeight = Math.max(0, Number(structuralCount) || 0) * 30;
  const transitionCueHeight = Math.max(0, Number(transitionCueCount) || 0) * 12;
  return snapshotRowHeight
    + eventHeaderHeight
    + eventRowsHeight
    + structuralRowsHeight
    + transitionCueHeight;
}

export function deriveRecentFittingEventBounds(eventRects = [], usableHeight = 0) {
  const rects = eventRects.filter((rect) => (
    Number.isFinite(Number(rect?.top)) && Number.isFinite(Number(rect?.bottom))
  ));
  if (rects.length === 0) return null;
  const boundsFor = (targets) => ({
    top: Math.min(...targets.map((rect) => Number(rect.top))),
    bottom: Math.max(...targets.map((rect) => Number(rect.bottom))),
  });
  const allBounds = boundsFor(rects);
  if (allBounds.bottom - allBounds.top <= Math.max(0, Number(usableHeight))) {
    return { ...allBounds, allFit: true, includedCount: rects.length };
  }

  const recentRects = [rects.at(-1)];
  for (let index = rects.length - 2; index >= 0; index -= 1) {
    const candidate = [rects[index], ...recentRects];
    const candidateBounds = boundsFor(candidate);
    if (candidateBounds.bottom - candidateBounds.top > Math.max(0, Number(usableHeight))) break;
    recentRects.unshift(rects[index]);
  }
  return {
    ...boundsFor(recentRects),
    allFit: false,
    includedCount: recentRects.length,
  };
}

export function isSequenceAnchorTargetReady(contentNode, anchor) {
  if (!(contentNode instanceof HTMLElement) || anchor == null) return false;
  const preferredRow = contentNode.querySelector(
    `[data-sequence-virtual-index="${anchor.preferredIndex}"]`,
  );
  if (!(preferredRow instanceof HTMLElement)) return false;
  if (anchor.preferredEventId != null) {
    const mountedEventIds = new Set(
      [...contentNode.querySelectorAll("[data-sequence-event-id]")]
        .map((node) => node.dataset.sequenceEventId),
    );
    const preferredEventReady = mountedEventIds.has(String(anchor.preferredEventId));
    if (!preferredEventReady) return false;
    if (
      anchor.requireMountedEventTargets
      && !anchor.targetEventIds.every((eventId) => mountedEventIds.has(String(eventId)))
    ) return false;
  }
  if (anchor.preferredStructuralKey != null) {
    return [...contentNode.querySelectorAll("[data-sequence-structural-key]")]
      .some((node) => (
        node.dataset.sequenceStructuralKey === String(anchor.preferredStructuralKey)
      ));
  }
  return true;
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

  const normalizedAnchorIndex = anchorIndex == null ? null : Number(anchorIndex);
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
  revision = null,
  measureRows = true,
} = {}) {
  const enabled = items.length >= SEQUENCE_VIRTUALIZATION_MIN_ITEMS;
  const observedNodesRef = useRef(new Map());
  const resizeObserverRef = useRef(null);
  const pendingFrameRef = useRef(null);
  const pendingMeasurementFrameRef = useRef(null);
  const pendingMeasurementsRef = useRef(new Map());
  const measuredTokenByKeyRef = useRef(new Map());
  const pendingStartAnchorReleaseFramesRef = useRef([]);
  const measurementTokensRef = useRef(new Map());
  if (measurementTokensRef.current.size === 0 && items.length > 0) {
    measurementTokensRef.current = new Map(items.map((item) => [
      item.key,
      item.measurementToken ?? item.estimatedSize,
    ]));
  }
  const appliedRevisionRef = useRef(revision);
  const layoutRef = useRef(null);
  const pendingStartAnchorRef = useRef(null);
  const [measuredSizes, setMeasuredSizes] = useState(() => new Map());
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 640 });
  const [startAnchor, setStartAnchor] = useState(null);
  const [stabilizedIndexes, setStabilizedIndexes] = useState([]);

  const flushMeasurements = useCallback(() => {
    pendingMeasurementFrameRef.current = null;
    const pendingMeasurements = pendingMeasurementsRef.current;
    pendingMeasurementsRef.current = new Map();
    if (pendingMeasurements.size === 0) return;
    setMeasuredSizes((previous) => {
      let next = previous;
      pendingMeasurements.forEach(({ size: numeric, token }, key) => {
        const previousSize = previous.get(key);
        const tokenMatches = Object.is(measuredTokenByKeyRef.current.get(key), token);
        if (previousSize != null && Math.abs(previousSize - numeric) < 0.5 && tokenMatches) return;
        if (next === previous) next = new Map(previous);
        next.set(key, numeric);
        measuredTokenByKeyRef.current.set(key, token);
      });
      return next;
    });
  }, []);

  const queueMeasurement = useCallback((key, size) => {
    const numeric = Number(size);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    pendingMeasurementsRef.current.set(key, {
      size: numeric,
      token: measurementTokensRef.current.get(key),
    });
    if (pendingMeasurementFrameRef.current != null) return;
    pendingMeasurementFrameRef.current = window.requestAnimationFrame(flushMeasurements);
  }, [flushMeasurements]);

  const measureItem = useCallback((key, node) => {
    if (!measureRows) return;
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
  }, [measureRows, queueMeasurement]);

  useLayoutEffect(() => {
    if (!enabled || !measureRows || typeof ResizeObserver !== "function") return undefined;
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
  }, [enabled, measureRows, queueMeasurement]);

  useEffect(() => () => {
    if (pendingMeasurementFrameRef.current != null) {
      window.cancelAnimationFrame(pendingMeasurementFrameRef.current);
    }
    pendingMeasurementFrameRef.current = null;
    pendingMeasurementsRef.current.clear();
    pendingStartAnchorReleaseFramesRef.current.forEach((frameId) => {
      window.cancelAnimationFrame(frameId);
    });
    pendingStartAnchorReleaseFramesRef.current = [];
  }, []);

  useEffect(() => {
    const keys = new Set(items.map((item) => item.key));
    pendingMeasurementsRef.current.forEach((_, key) => {
      if (!keys.has(key)) {
        pendingMeasurementsRef.current.delete(key);
        measuredTokenByKeyRef.current.delete(key);
      }
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
    const nextTokens = new Map(items.map((item) => [
      item.key,
      item.measurementToken ?? item.estimatedSize,
    ]));
    const changedKeys = items
      .filter((item) => (
        measurementTokensRef.current.has(item.key)
        && measurementTokensRef.current.get(item.key) !== nextTokens.get(item.key)
      ))
      .map((item) => item.key);
    measurementTokensRef.current = nextTokens;
    if (changedKeys.length === 0) return;
    changedKeys.forEach((key) => measuredTokenByKeyRef.current.delete(key));

    // A structural edit can change an unmounted virtual row. Its old measured
    // height would otherwise override the new estimate until manual scrolling
    // mounts the row again. Invalidate it immediately and remeasure any changed
    // row that is already mounted.
    setMeasuredSizes((previous) => {
      const staleKeys = changedKeys.filter((key) => previous.has(key));
      if (staleKeys.length === 0) return previous;
      const next = new Map(previous);
      staleKeys.forEach((key) => next.delete(key));
      return next;
    });
    changedKeys.forEach((key) => {
      if (!measureRows) return;
      const node = observedNodesRef.current.get(key);
      if (node instanceof HTMLElement) {
        queueMeasurement(key, node.getBoundingClientRect().height || node.offsetHeight);
      }
    });
  }, [items, measureRows, queueMeasurement]);

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

  const revisionChanged = !Object.is(appliedRevisionRef.current, revision);
  const layout = useMemo(() => {
    const activeMeasurements = revisionChanged ? new Map() : measuredSizes;
    return buildVirtualSequenceLayout({
      items,
      measuredSizes: activeMeasurements,
      scrollTop: viewport.scrollTop,
      viewportHeight: viewport.height,
      pinnedIndexes: [
        ...pinnedIndexes,
        ...stabilizedIndexes,
        ...(startAnchor?.targetIndexes ?? []),
      ],
      anchorIndex: startAnchor?.preferredIndex ?? null,
      enabled,
    });
  }, [
    enabled,
    items,
    measuredSizes,
    pinnedIndexes,
    revisionChanged,
    stabilizedIndexes,
    startAnchor,
    viewport.height,
    viewport.scrollTop,
  ]);
  layoutRef.current = layout;

  useLayoutEffect(() => {
    if (Object.is(appliedRevisionRef.current, revision)) return;
    appliedRevisionRef.current = revision;

    if (pendingMeasurementFrameRef.current != null) {
      window.cancelAnimationFrame(pendingMeasurementFrameRef.current);
      pendingMeasurementFrameRef.current = null;
    }
    pendingMeasurementsRef.current.clear();
    pendingStartAnchorRef.current = null;
    setStartAnchor(null);
    setStabilizedIndexes([]);
    setMeasuredSizes(new Map());

    const panel = scrollPanelRef?.current;
    if (panel instanceof HTMLElement) {
      setViewport({
        scrollTop: panel.scrollTop,
        height: panel.clientHeight || 640,
      });
    }

    // Rebuild cheaply: estimates are already active for the full list, while
    // only mounted rows are measured again on the next frame.
    observedNodesRef.current.forEach((node, key) => {
      if (measureRows && node instanceof HTMLElement) {
        queueMeasurement(key, node.getBoundingClientRect().height || node.offsetHeight);
      }
    });
  }, [measureRows, queueMeasurement, revision, scrollPanelRef]);

  const clearPendingStartAnchor = useCallback(() => {
    pendingStartAnchorReleaseFramesRef.current.forEach((frameId) => {
      window.cancelAnimationFrame(frameId);
    });
    pendingStartAnchorReleaseFramesRef.current = [];
    pendingStartAnchorRef.current = null;
    setStartAnchor(null);
    // Do not release the rows that established the current scroll geometry.
    // Stabilized rows do not move the viewport; they only keep the measured
    // layout from being replaced by estimates while the user scrolls it.
    // Releasing them on pointer/wheel input made the visible content jump or
    // disappear before the scroll event could establish its next window.
  }, []);
  const releaseStartAnchorLayout = useCallback(() => {
    clearPendingStartAnchor();
    setStabilizedIndexes([]);
    const panel = scrollPanelRef?.current;
    if (panel instanceof HTMLElement) {
      setViewport({
        scrollTop: panel.scrollTop,
        height: panel.clientHeight || 640,
      });
    }
  }, [clearPendingStartAnchor, scrollPanelRef]);

  const applyStartAnchor = useCallback((anchor, activeLayout = layoutRef.current) => {
    const panel = scrollPanelRef?.current;
    const contentNode = contentRef?.current;
    if (!(panel instanceof HTMLElement) || !(contentNode instanceof HTMLElement)) return false;
    const visiblePanel = visibleElementBounds(panel);
    if (visiblePanel == null || visiblePanel.height <= 0) return false;
    const targetIndexes = anchor.targetIndexes.length > 0
      ? anchor.targetIndexes
      : [anchor.preferredIndex];
    const mountedTargets = targetIndexes.map((index) => contentNode.querySelector(
      `[data-sequence-virtual-index="${index}"]`,
    ));
    const mountedTargetRects = mountedTargets.map((target) => (
      target instanceof HTMLElement ? target.getBoundingClientRect() : null
    ));
    const allTargetsMeasured = mountedTargetRects.every((rect) => rect != null && rect.height > 0);
    let mountedTargetRect = mountedTargetRects[
      Math.max(0, targetIndexes.indexOf(anchor.preferredIndex))
    ] ?? null;
    let alignToBottom = false;
    const eventNodesById = new Map(
      [...contentNode.querySelectorAll("[data-sequence-event-id]")]
        .map((node) => [node.dataset.sequenceEventId, node]),
    );
    const mountedEventRects = anchor.targetEventIds.map((eventId) => {
      const node = eventNodesById.get(String(eventId));
      return node instanceof HTMLElement ? node.getBoundingClientRect() : null;
    });
    const structuralNodesByKey = new Map(
      [...contentNode.querySelectorAll("[data-sequence-structural-key]")]
        .map((node) => [node.dataset.sequenceStructuralKey, node]),
    );
    const mountedStructuralRects = anchor.targetStructuralKeys.map((structuralKey) => {
      const node = structuralNodesByKey.get(String(structuralKey));
      return node instanceof HTMLElement ? node.getBoundingClientRect() : null;
    });
    const allStructuralTargetsMeasured = (
      mountedStructuralRects.length > 0
      && mountedStructuralRects.every((rect) => rect != null && rect.height > 0)
    );
    const allEventsMeasured = (
      mountedEventRects.length > 0
      && mountedEventRects.every((rect) => rect != null && rect.height > 0)
    );
    if (enabled && anchor.requireMeasuredLayout && !allTargetsMeasured) return false;
    if (
      anchor.requireMountedEventTargets
      && anchor.targetEventIds.length > 0
      && !allEventsMeasured
    ) return false;
    if (anchor.targetStructuralKeys.length > 0) {
      if (allStructuralTargetsMeasured) {
        const rangeTop = Math.min(...mountedStructuralRects.map((rect) => rect.top));
        const rangeBottom = Math.max(...mountedStructuralRects.map((rect) => rect.bottom));
        mountedTargetRect = {
          top: rangeTop,
          bottom: rangeBottom,
          height: rangeBottom - rangeTop,
        };
        const usableHeight = Math.max(0, visiblePanel.height - anchor.topOffset - 6);
        alignToBottom = rangeBottom - rangeTop > usableHeight;
      } else {
        const preferredNode = structuralNodesByKey.get(String(anchor.preferredStructuralKey));
        const preferredRect = preferredNode instanceof HTMLElement
          ? preferredNode.getBoundingClientRect()
          : null;
        if (preferredRect != null && preferredRect.height > 0) {
          mountedTargetRect = preferredRect;
        }
      }
    } else if (anchor.targetEventIds.length > 0) {
      if (allEventsMeasured) {
        const usableHeight = Math.max(0, visiblePanel.height - anchor.topOffset - 6);
        const rangeTop = Math.min(...mountedEventRects.map((rect) => rect.top));
        const rangeBottom = Math.max(...mountedEventRects.map((rect) => rect.bottom));
        if (rangeBottom - rangeTop <= usableHeight) {
          mountedTargetRect = {
            top: rangeTop,
            bottom: rangeBottom,
            height: rangeBottom - rangeTop,
          };
        } else {
          const preferredEventNode = eventNodesById.get(String(anchor.preferredEventId));
          const preferredEventRect = preferredEventNode instanceof HTMLElement
            ? preferredEventNode.getBoundingClientRect()
            : null;
          mountedTargetRect = preferredEventRect != null && preferredEventRect.height > 0
            ? preferredEventRect
            : mountedEventRects.at(-1);
          alignToBottom = true;
        }
      } else {
        const preferredEventNode = eventNodesById.get(String(anchor.preferredEventId));
        const preferredEventRect = preferredEventNode instanceof HTMLElement
          ? preferredEventNode.getBoundingClientRect()
          : null;
        if (preferredEventRect != null && preferredEventRect.height > 0) {
          mountedTargetRect = preferredEventRect;
        }
        // A partial sounding set must never favor an old attack. Keep the
        // newest available event at the bottom until every row can be judged.
        alignToBottom = true;
      }
    } else if (allTargetsMeasured) {
      const topmostRect = mountedTargetRects.reduce((topmost, rect) => (
        topmost == null || rect.top < topmost.top ? rect : topmost
      ), null);
      const rangeTop = Math.min(...mountedTargetRects.map((rect) => rect.top));
      const rangeBottom = Math.max(...mountedTargetRects.map((rect) => rect.bottom));
      const usableHeight = Math.max(0, visiblePanel.height - anchor.topOffset - 6);
      if (rangeBottom - rangeTop <= usableHeight) {
        mountedTargetRect = topmostRect;
      } else if (anchor.overflowAlignment === "end") {
        const preferredEventNode = [...contentNode.querySelectorAll("[data-sequence-event-id]")]
          .find((node) => node.dataset.sequenceEventId === String(anchor.preferredEventId));
        const preferredEventRect = preferredEventNode instanceof HTMLElement
          ? preferredEventNode.getBoundingClientRect()
          : null;
        if (preferredEventRect != null && preferredEventRect.height > 0) {
          mountedTargetRect = preferredEventRect;
        }
        alignToBottom = true;
      }
    }
    let targetContentTop;
    if (mountedTargetRect != null && mountedTargetRect.height > 0) {
      targetContentTop = alignToBottom
        ? panel.scrollTop + mountedTargetRect.bottom - visiblePanel.bottom + 6
        : panel.scrollTop + mountedTargetRect.top - visiblePanel.top - anchor.topOffset;
    } else {
      const top = activeLayout?.offsets?.[anchor.preferredIndex];
      if (!Number.isFinite(top)) return false;
      targetContentTop = panel.scrollTop
        + contentNode.getBoundingClientRect().top
        - visiblePanel.top
        + top
        - anchor.topOffset;
    }
    const nextTop = Math.max(0, targetContentTop);
    if (Math.abs(nextTop - panel.scrollTop) >= 1) panel.scrollTop = nextTop;
    const appliedTop = panel.scrollTop;
    setViewport((previous) => (
      previous.scrollTop === appliedTop
        ? previous
        : { scrollTop: appliedTop, height: panel.clientHeight || 640 }
    ));
    return true;
  }, [contentRef, enabled, scrollPanelRef]);

  const retainAnchorWindow = useCallback((anchor, activeLayout) => {
    const anchorTop = activeLayout?.offsets?.[anchor.preferredIndex];
    if (!Number.isFinite(anchorTop)) return;
    const windowStart = Math.max(0, anchorTop - SEQUENCE_VIRTUALIZATION_OVERSCAN_PX);
    const windowEnd = anchorTop
      + Math.max(1, Number(viewport.height) || 1)
      + SEQUENCE_VIRTUALIZATION_OVERSCAN_PX;
    const retainedIndexes = new Set(
      anchor.retainedIndexes.length > 0
        ? anchor.retainedIndexes
        : anchor.targetIndexes,
    );
    // Mounted rows before the target contributed their real DOM height to the
    // coordinate used by applyStartAnchor. Preserve that small prefix window
    // as well; replacing it with estimates after the scroll would move the
    // target. Mounted rows after the target cannot affect its coordinate.
    const firstTargetIndex = anchor.targetIndexes.length > 0
      ? Math.min(...anchor.targetIndexes)
      : anchor.preferredIndex;
    (activeLayout?.rows ?? []).forEach((row) => {
      if (row.type === "item" && row.index < firstTargetIndex) {
        retainedIndexes.add(row.index);
      }
    });
    setStabilizedIndexes((activeLayout?.rows ?? [])
      .filter((row) => (
        row.type === "item"
        && (
          retainedIndexes.has(row.index)
          || (
            activeLayout.offsets[row.index + 1] >= windowStart
            && activeLayout.offsets[row.index] <= windowEnd
          )
        )
      ))
      .map((row) => row.index));
  }, [viewport.height]);

  const commitAnchorMeasurements = useCallback((anchor) => {
    const contentNode = contentRef?.current;
    if (!(contentNode instanceof HTMLElement)) return false;
    const exactSizes = new Map();
    anchor.targetIndexes.forEach((index) => {
      const item = items[index];
      const node = contentNode.querySelector(`[data-sequence-virtual-index="${index}"]`);
      const height = node instanceof HTMLElement
        ? Number(node.getBoundingClientRect().height)
        : 0;
      if (item?.key == null || !Number.isFinite(height) || height <= 0) return;
      exactSizes.set(item.key, height);
      measuredTokenByKeyRef.current.set(
        item.key,
        measurementTokensRef.current.get(item.key),
      );
    });
    if (exactSizes.size === 0) return false;
    const changed = [...exactSizes].some(([key, height]) => (
      Math.abs(Number(measuredSizes.get(key)) - height) >= 0.5
      || !Number.isFinite(Number(measuredSizes.get(key)))
    ));
    if (!changed) return false;
    setMeasuredSizes((previous) => {
      const next = new Map(previous);
      exactSizes.forEach((height, key) => next.set(key, height));
      return next;
    });
    return true;
  }, [contentRef, items, measuredSizes]);

  useLayoutEffect(() => {
    const anchor = pendingStartAnchorRef.current;
    if (anchor == null) return;
    // The browser has already performed layout before this effect. Direct DOM
    // rectangles are the authoritative readiness signal; waiting for a fresh
    // ResizeObserver delivery can deadlock when a previously mounted row keeps
    // the same size and therefore emits no callback.
    if (anchor.requireMeasuredLayout && anchor.measurementsCommitted !== true) {
      const contentNode = contentRef?.current;
      const targetRowsReady = contentNode instanceof HTMLElement
        && anchor.targetIndexes.every((index) => {
          const node = contentNode.querySelector(`[data-sequence-virtual-index="${index}"]`);
          return node instanceof HTMLElement && node.getBoundingClientRect().height > 0;
        });
      const targetReady = isSequenceAnchorTargetReady(contentNode, anchor);
      if (!targetRowsReady || !targetReady) return;
      anchor.measurementsCommitted = true;
      if (commitAnchorMeasurements(anchor)) return;
    }
    if (anchor.applyOnce && anchor.applyScheduled !== true) {
      anchor.applyScheduled = true;
      const sampleAndApply = () => {
        pendingStartAnchorReleaseFramesRef.current = [];
        if (pendingStartAnchorRef.current !== anchor) return;
        const panel = scrollPanelRef?.current;
        const contentNode = contentRef?.current;
        if (!(panel instanceof HTMLElement) || !(contentNode instanceof HTMLElement)) return;
        const panelRect = visibleElementBounds(panel);
        const eventNodesById = new Map(
          [...contentNode.querySelectorAll("[data-sequence-event-id]")]
            .map((node) => [node.dataset.sequenceEventId, node]),
        );
        const eventRects = anchor.targetEventIds.map((eventId) => {
          const node = eventNodesById.get(String(eventId));
          const rect = node instanceof HTMLElement ? node.getBoundingClientRect() : null;
          return rect == null ? null : [rect.top, rect.bottom];
        });
        const geometrySignature = JSON.stringify({
          panel: panelRect == null ? null : [panelRect.top, panelRect.bottom],
          events: eventRects,
          scrollHeight: panel.scrollHeight,
        });
        if (
          anchor.geometrySignature == null
          || anchor.geometrySignature !== geometrySignature
        ) {
          anchor.geometrySignature = geometrySignature;
          const nextFrame = window.requestAnimationFrame(sampleAndApply);
          pendingStartAnchorReleaseFramesRef.current = [nextFrame];
          return;
        }
        const applied = applyStartAnchor(anchor, layoutRef.current);
        if (!applied) {
          anchor.geometrySignature = null;
          const nextFrame = window.requestAnimationFrame(sampleAndApply);
          pendingStartAnchorReleaseFramesRef.current = [nextFrame];
          return;
        }
        retainAnchorWindow(anchor, layoutRef.current);
        anchor.onApplied?.();
        pendingStartAnchorRef.current = null;
        setStartAnchor((current) => (current === anchor ? null : current));
      };
      const firstFrame = window.requestAnimationFrame(sampleAndApply);
      pendingStartAnchorReleaseFramesRef.current = [firstFrame];
      return;
    }
    applyStartAnchor(anchor, layout);
    const contentNode = contentRef?.current;
    if (!isSequenceAnchorTargetReady(contentNode, anchor)) return;
    pendingStartAnchorReleaseFramesRef.current.forEach((frameId) => {
      window.cancelAnimationFrame(frameId);
    });
    pendingStartAnchorReleaseFramesRef.current = [];
    const firstFrame = window.requestAnimationFrame(() => {
      pendingStartAnchorReleaseFramesRef.current = [];
      const secondFrame = window.requestAnimationFrame(() => {
        pendingStartAnchorReleaseFramesRef.current = [];
        if (pendingStartAnchorRef.current !== anchor) return;
        pendingStartAnchorRef.current = null;
        setStartAnchor((current) => (current === anchor ? null : current));
      });
      pendingStartAnchorReleaseFramesRef.current = [secondFrame];
    });
    pendingStartAnchorReleaseFramesRef.current = [firstFrame];
  }, [
    applyStartAnchor,
    commitAnchorMeasurements,
    contentRef,
    layout,
    retainAnchorWindow,
    scrollPanelRef,
  ]);

  useEffect(() => {
    const panel = scrollPanelRef?.current;
    if (!(panel instanceof HTMLElement)) return undefined;
    panel.addEventListener("wheel", clearPendingStartAnchor, { passive: true });
    panel.addEventListener("touchmove", clearPendingStartAnchor, { passive: true });
    panel.addEventListener("pointerdown", clearPendingStartAnchor, { passive: true });
    return () => {
      panel.removeEventListener("wheel", clearPendingStartAnchor);
      panel.removeEventListener("touchmove", clearPendingStartAnchor);
      panel.removeEventListener("pointerdown", clearPendingStartAnchor);
    };
  }, [clearPendingStartAnchor, scrollPanelRef]);

  const scrollIndexIntoView = useCallback((index, {
    align = "nearest",
    topOffset = 0,
    targetIndexes = null,
    retainedIndexes = null,
    overflowAlignment = "start",
    preferredEventId = null,
    targetEventIds = null,
    requireMountedEventTargets = false,
    requireMeasuredLayout = false,
    applyOnce = false,
    onApplied = null,
    preferredStructuralKey = null,
    targetStructuralKeys = null,
  } = {}) => {
    const numeric = Number(index);
    const panel = scrollPanelRef?.current;
    if (!Number.isInteger(numeric) || !(panel instanceof HTMLElement)) return false;
    const top = layoutRef.current?.offsets?.[numeric];
    const bottom = layoutRef.current?.offsets?.[numeric + 1];
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return false;
    const viewportHeight = panel.clientHeight || 640;
    if (align === "start") {
      const normalizedTargetIndexes = [...new Set(
        (Array.isArray(targetIndexes) ? targetIndexes : [numeric])
          .map((targetIndex) => Number(targetIndex))
          .filter((targetIndex) => (
            Number.isInteger(targetIndex)
            && targetIndex >= 0
            && targetIndex < items.length
          )),
      )];
      const anchor = {
        preferredIndex: numeric,
        targetIndexes: normalizedTargetIndexes,
        retainedIndexes: [...new Set(
          (Array.isArray(retainedIndexes) ? retainedIndexes : normalizedTargetIndexes)
            .map((targetIndex) => Number(targetIndex))
            .filter((targetIndex) => (
              Number.isInteger(targetIndex)
              && targetIndex >= 0
              && targetIndex < items.length
            )),
        )],
        topOffset: Math.max(0, Number(topOffset) || 0),
        overflowAlignment,
        preferredEventId,
        targetEventIds: Array.isArray(targetEventIds)
          ? targetEventIds.filter((eventId) => eventId != null)
          : [],
        requireMountedEventTargets: requireMountedEventTargets === true,
        requireMeasuredLayout: requireMeasuredLayout === true,
        applyOnce: applyOnce === true,
        onApplied: typeof onApplied === "function" ? onApplied : null,
        preferredStructuralKey,
        targetStructuralKeys: Array.isArray(targetStructuralKeys)
          ? targetStructuralKeys.filter((key) => key != null)
          : [],
      };
      if (!enabled) {
        const applied = applyStartAnchor(anchor);
        if (anchor.applyOnce && applied) anchor.onApplied?.();
        return applied;
      }
      pendingStartAnchorRef.current = anchor;
      setStartAnchor(anchor);
      const applied = anchor.requireMeasuredLayout ? false : applyStartAnchor(anchor);
      if (anchor.applyOnce && applied) {
        const activeLayout = layoutRef.current;
        retainAnchorWindow(anchor, activeLayout);
        anchor.onApplied?.();
        pendingStartAnchorRef.current = null;
        setStartAnchor(null);
      }
      return applied;
    }
    if (!enabled) return false;
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
    setViewport({ scrollTop: panel.scrollTop, height: viewportHeight });
    return true;
  }, [
    applyStartAnchor,
    clearPendingStartAnchor,
    contentRef,
    enabled,
    items.length,
    retainAnchorWindow,
    scrollPanelRef,
  ]);

  return {
    enabled,
    layout,
    measureItem,
    scrollIndexIntoView,
    cancelPendingStartAnchor: clearPendingStartAnchor,
    releaseStartAnchorLayout,
  };
}
