// This hook owns sequencer viewport tracking and auto-scroll behavior.
// It manages row refs, transport offsets, and the logic that decides
// which snapshot/bar/event should be brought into view during navigation.

import { useCallback, useEffect, useRef } from "preact/hooks";
import {
  appendPersistedSequenceRuntimeDiagnostic,
  isSequenceRuntimeDiagnosticsEnabled,
} from "../debug/sequence-runtime-diagnostics.js";
import { appendPersistedSequencerCrashDiagnostic } from "../debug/sequencer-crash-diagnostics.js";
import {
  deriveCueScrollAnchorTarget,
  resolveCueAnchorSnapshotId,
} from "./view-runtime.js";

export function derivePagedPanelScrollTop({
  scrollTop,
  scrollHeight,
  clientHeight,
  panelTop,
  panelBottom,
  targetTop,
  targetBottom,
  stickyTop = 0,
  gap = 6,
}) {
  const visibleTop = panelTop + stickyTop + gap;
  const visibleBottom = Math.max(visibleTop, panelBottom - gap);
  const targetIsVisible = targetTop >= visibleTop && targetBottom <= visibleBottom;
  const nextTop = targetIsVisible
    ? scrollTop
    : scrollTop + targetTop - visibleTop;

  const maxTop = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, Math.min(maxTop, nextTop));
}

export function deriveTopAlignedPanelScrollTop({
  scrollTop,
  scrollHeight,
  clientHeight,
  panelTop,
  targetTop,
  stickyTop = 0,
  gap = 6,
}) {
  const nextTop = Number(scrollTop)
    + (Number(targetTop) - Number(panelTop))
    - Number(stickyTop)
    - Number(gap);
  const maxTop = Math.max(0, Number(scrollHeight) - Number(clientHeight));
  return Math.max(0, Math.min(maxTop, nextTop));
}

export function derivePreferredTargetBounds(targetRects = [], usableHeight = 0) {
  const rects = targetRects.filter((rect) => (
    Number.isFinite(Number(rect?.top)) && Number.isFinite(Number(rect?.bottom))
  ));
  if (rects.length === 0) return null;
  const rangeTop = Math.min(...rects.map((rect) => Number(rect.top)));
  const rangeBottom = Math.max(...rects.map((rect) => Number(rect.bottom)));
  if (rangeBottom - rangeTop <= Math.max(0, Number(usableHeight))) {
    return { top: rangeTop, bottom: rangeBottom };
  }
  const preferredRect = rects.at(-1);
  return { top: Number(preferredRect.top), bottom: Number(preferredRect.bottom) };
}

export default function useSequencerAutoscroll({
  autoScrollEnabled,
  activeCueIndex,
  activeSnapshotId,
  playheadIsOff,
  selectedBarIndex,
  sortedBars,
  snapshots,
  sequenceEvents,
  sequenceCueGroups,
  sequenceRepeatSections,
  cueExpandedSnapshotIds,
  cueExpandedSnapshotIdsAt,
  firstEventIdByCueIndex,
  firstStructuralScrollKey,
  repeatStartKeyAtPosition,
  structuralScrollKeyAtPosition,
  showAllEvents,
  setExpandedIds,
  onCueSequenceSnapshot,
  onCueSequenceCue,
  onResetSequencePlayhead,
  onJumpSequenceEnd,
  recordTimedTransportDiagnostic,
} = {}) {
  const playbackRowRef = useRef(null);
  const scrollPanelRef = useRef(null);
  const snapshotRowRefs = useRef(new Map());
  const barRowRefs = useRef(new Map());
  const eventRowRefs = useRef(new Map());
  const lastAutoScrolledSnapshotIdRef = useRef(null);
  const lastAutoScrolledBarIdRef = useRef(null);
  const lastAutoScrolledCueTargetRef = useRef(null);
  const pendingResetScrollTargetRef = useRef(null);
  const suppressNextBarAutoScrollRef = useRef(false);
  const transportScrollTargetRef = useRef("snapshot");
  const lastScrollInputAtRef = useRef(0);
  const awaitingScrollResponseRef = useRef(false);
  const lastObservedScrollTopRef = useRef(0);
  const pendingAutoScrollFrameRef = useRef(null);
  const pendingSnapshotAnchorFrameRef = useRef(null);
  const pendingSnapshotAnchorIdRef = useRef(null);
  const pendingSnapshotAnchorExpiresAtRef = useRef(0);
  const autoScrollEnabledRef = useRef(autoScrollEnabled);
  const recordTimedTransportDiagnosticRef = useRef(recordTimedTransportDiagnostic);
  autoScrollEnabledRef.current = autoScrollEnabled;
  recordTimedTransportDiagnosticRef.current = recordTimedTransportDiagnostic;

  const scrollNodesIntoPanel = useCallback((targetNodes) => {
    if (!autoScrollEnabledRef.current) return;
    const scrollPanel = scrollPanelRef.current;
    const nodes = (Array.isArray(targetNodes) ? targetNodes : [targetNodes])
      .filter((node) => node instanceof HTMLElement);
    if (!(scrollPanel instanceof HTMLElement) || nodes.length === 0) return;

    if (pendingAutoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(pendingAutoScrollFrameRef.current);
    }
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (!autoScrollEnabledRef.current) return;
      const scrollStartMs = performance.now();
      const panelRect = scrollPanel.getBoundingClientRect();
      const playbackRect = playbackRowRef.current instanceof HTMLElement
        ? playbackRowRef.current.getBoundingClientRect()
        : null;
      const targetRects = nodes.map((node) => node.getBoundingClientRect());
      const gap = 6;
      const stickyTransportOverlap = playbackRect == null
        ? 0
        : Math.max(0, Math.min(playbackRect.bottom, panelRect.bottom) - panelRect.top);
      const usableHeight = Math.max(0, panelRect.height - stickyTransportOverlap - (2 * gap));
      const targetBounds = derivePreferredTargetBounds(targetRects, usableHeight);
      if (targetBounds == null) return;
      const nextTop = derivePagedPanelScrollTop({
        scrollTop: scrollPanel.scrollTop,
        scrollHeight: scrollPanel.scrollHeight,
        clientHeight: scrollPanel.clientHeight,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
        targetTop: targetBounds.top,
        targetBottom: targetBounds.bottom,
        stickyTop: stickyTransportOverlap,
        gap,
      });
      if (Math.abs(nextTop - scrollPanel.scrollTop) < 2) return;
      appendPersistedSequencerCrashDiagnostic({
        type: "sequencer-autoscroll-requested",
        detail: "Requested sequencer autoscroll target",
        context: {
          source: "sequencer",
          autoScrollEnabled: autoScrollEnabledRef.current,
          scrollTop: scrollPanel.scrollTop,
          targetTop: nextTop,
        },
      });
      scrollPanel.scrollTop = nextTop;
      appendPersistedSequencerCrashDiagnostic({
        type: "sequencer-autoscroll-applied",
        detail: "Applied sequencer autoscroll target",
        context: {
          source: "sequencer",
          autoScrollEnabled: autoScrollEnabledRef.current,
          scrollTop: scrollPanel.scrollTop,
          targetTop: nextTop,
        },
      });
      const durationMs = performance.now() - scrollStartMs;
      if (durationMs > 8) {
        recordTimedTransportDiagnosticRef.current?.({
          type: "scroll",
          clockSeconds: performance.now() / 1000,
          durationMs,
          detail: "scrollNodeIntoPanel",
        });
      }
    });
  }, []);

  const scrollNodeIntoPanel = useCallback((targetNode) => {
    scrollNodesIntoPanel([targetNode]);
  }, [scrollNodesIntoPanel]);

  const alignNodeToPanelTopNow = useCallback((targetNode) => {
    if (!autoScrollEnabledRef.current) return;
    const scrollPanel = scrollPanelRef.current;
    if (!(scrollPanel instanceof HTMLElement) || !(targetNode instanceof HTMLElement)) return;
    const panelRect = scrollPanel.getBoundingClientRect();
    const playbackRect = playbackRowRef.current instanceof HTMLElement
      ? playbackRowRef.current.getBoundingClientRect()
      : null;
    const targetRect = targetNode.getBoundingClientRect();
    const stickyTransportOverlap = playbackRect == null
      ? 0
      : Math.max(0, Math.min(playbackRect.bottom, panelRect.bottom) - panelRect.top);
    const nextTop = deriveTopAlignedPanelScrollTop({
      scrollTop: scrollPanel.scrollTop,
      scrollHeight: scrollPanel.scrollHeight,
      clientHeight: scrollPanel.clientHeight,
      panelTop: panelRect.top,
      targetTop: targetRect.top,
      stickyTop: stickyTransportOverlap,
    });
    const delta = Math.abs(nextTop - scrollPanel.scrollTop);
    if (delta >= 2) scrollPanel.scrollTop = nextTop;
    return delta;
  }, []);

  const alignNodeToPanelTop = useCallback((targetNode) => {
    if (!autoScrollEnabledRef.current) return;
    if (pendingAutoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(pendingAutoScrollFrameRef.current);
    }
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (!autoScrollEnabledRef.current) return;
      alignNodeToPanelTopNow(targetNode);
    });
  }, [alignNodeToPanelTopNow]);

  const alignSnapshotToPanelTop = useCallback((snapshotId) => {
    // A queued alignment for the previous playhead must not be allowed to
    // restore the old viewport while a distant virtual row is mounting.
    if (pendingAutoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(pendingAutoScrollFrameRef.current);
      pendingAutoScrollFrameRef.current = null;
    }
    if (pendingSnapshotAnchorFrameRef.current != null) {
      window.cancelAnimationFrame(pendingSnapshotAnchorFrameRef.current);
      pendingSnapshotAnchorFrameRef.current = null;
    }
    if (!autoScrollEnabledRef.current || snapshotId == null) return;
    pendingSnapshotAnchorIdRef.current = snapshotId;
    pendingSnapshotAnchorExpiresAtRef.current = performance.now() + 1500;

    const tryAlign = (remainingFrames) => {
      if (!autoScrollEnabledRef.current) return;
      const snapshotRow = snapshotRowRefs.current.get(snapshotId) ?? null;
      if (snapshotRow instanceof HTMLElement) {
        alignNodeToPanelTop(snapshotRow);
        return;
      }
      if (remainingFrames <= 0) return;
      pendingSnapshotAnchorFrameRef.current = window.requestAnimationFrame(() => {
        pendingSnapshotAnchorFrameRef.current = null;
        tryAlign(remainingFrames - 1);
      });
    };

    // A distant virtualized row is mounted on the render following the
    // viewport move. Retry only until it exists; later virtual-layout changes
    // are reconciled by refreshPendingSnapshotAlignment.
    tryAlign(3);
  }, [alignNodeToPanelTop]);

  const refreshPendingSnapshotAlignment = useCallback(() => {
    if (!autoScrollEnabledRef.current) return;
    const snapshotId = pendingSnapshotAnchorIdRef.current;
    if (snapshotId == null) return;
    if (performance.now() > pendingSnapshotAnchorExpiresAtRef.current) {
      pendingSnapshotAnchorIdRef.current = null;
      return;
    }
    const snapshotRow = snapshotRowRefs.current.get(snapshotId) ?? null;
    if (snapshotRow instanceof HTMLElement) alignNodeToPanelTopNow(snapshotRow);
  }, [alignNodeToPanelTopNow]);

  useEffect(() => () => {
    if (pendingAutoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(pendingAutoScrollFrameRef.current);
      pendingAutoScrollFrameRef.current = null;
    }
    if (pendingSnapshotAnchorFrameRef.current != null) {
      window.cancelAnimationFrame(pendingSnapshotAnchorFrameRef.current);
      pendingSnapshotAnchorFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    const scrollPanel = scrollPanelRef.current;
    if (!(scrollPanel instanceof HTMLElement)) return undefined;
    const releaseManualSnapshotAnchor = () => {
      pendingSnapshotAnchorIdRef.current = null;
      pendingSnapshotAnchorExpiresAtRef.current = 0;
      if (pendingSnapshotAnchorFrameRef.current != null) {
        window.cancelAnimationFrame(pendingSnapshotAnchorFrameRef.current);
        pendingSnapshotAnchorFrameRef.current = null;
      }
    };
    scrollPanel.addEventListener("wheel", releaseManualSnapshotAnchor, { passive: true });
    scrollPanel.addEventListener("touchmove", releaseManualSnapshotAnchor, { passive: true });
    return () => {
      scrollPanel.removeEventListener("wheel", releaseManualSnapshotAnchor);
      scrollPanel.removeEventListener("touchmove", releaseManualSnapshotAnchor);
    };
  }, []);

  const armPendingSnapshot = useCallback((snapshotIndex) => {
    transportScrollTargetRef.current = "snapshot";
    const nextSnapshotIndex = Number(snapshotIndex);
    if (!Number.isFinite(nextSnapshotIndex)) return;
    onCueSequenceSnapshot?.(nextSnapshotIndex);
    const snapshotId = snapshots[nextSnapshotIndex]?.id ?? null;
    alignSnapshotToPanelTop(snapshotId);
  }, [
    alignSnapshotToPanelTop,
    onCueSequenceSnapshot,
    snapshots,
  ]);

  const armPendingCue = useCallback((cueIndex) => {
    transportScrollTargetRef.current = "cue";
    const nextCueIndex = Number(cueIndex);
    if (!Number.isFinite(nextCueIndex)) return;
    const cueGroup = sequenceCueGroups[nextCueIndex];
    if (!cueGroup) return;
    onCueSequenceCue?.(nextCueIndex);
    const repeatStartKey = repeatStartKeyAtPosition(cueGroup.time);
    if (repeatStartKey != null) {
      const repeatRow = barRowRefs.current.get(repeatStartKey) ?? null;
      scrollNodeIntoPanel(repeatRow);
      return;
    }
    const previewExpandedIds = cueExpandedSnapshotIdsAt(nextCueIndex);
    const anchorSnapshotId = resolveCueAnchorSnapshotId({
      activeCueIndex: nextCueIndex + 1,
      sequenceCueGroups,
      sequenceEvents,
      snapshots,
      cueExpandedSnapshotIds: previewExpandedIds,
    });
    if (showAllEvents) {
      if (anchorSnapshotId != null) {
        const snapshotRow = snapshotRowRefs.current.get(anchorSnapshotId) ?? null;
        scrollNodeIntoPanel(snapshotRow);
      }
    } else {
      if (previewExpandedIds.size > 0) {
        setExpandedIds(previewExpandedIds);
        if (anchorSnapshotId != null) {
          const snapshotRow = snapshotRowRefs.current.get(anchorSnapshotId) ?? null;
          scrollNodeIntoPanel(snapshotRow);
        }
      } else {
        const eventId = firstEventIdByCueIndex.get(nextCueIndex + 1) ?? null;
        if (eventId != null) {
          const eventRow = eventRowRefs.current.get(eventId) ?? null;
          scrollNodeIntoPanel(eventRow);
        }
      }
    }
  }, [
    cueExpandedSnapshotIdsAt,
    firstEventIdByCueIndex,
    onCueSequenceCue,
    repeatStartKeyAtPosition,
    scrollNodeIntoPanel,
    sequenceCueGroups,
    sequenceEvents,
    setExpandedIds,
    showAllEvents,
    snapshots,
  ]);

  const ensureExpanded = useCallback((id) => {
    setExpandedIds((prev) => {
      if (prev.size === 1 && prev.has(id)) return prev;
      return new Set([id]);
    });
  }, [setExpandedIds]);

  useEffect(() => {
    if (!isSequenceRuntimeDiagnosticsEnabled()) return undefined;
    const scrollPanel = scrollPanelRef.current;
    if (!(scrollPanel instanceof HTMLElement)) return undefined;

    const recordInput = () => {
      lastScrollInputAtRef.current = performance.now();
      awaitingScrollResponseRef.current = true;
    };

    const handleScroll = () => {
      const now = performance.now();
      const nextScrollTop = scrollPanel.scrollTop;
      const previousScrollTop = lastObservedScrollTopRef.current;
      const delta = Math.abs(nextScrollTop - previousScrollTop);
      lastObservedScrollTopRef.current = nextScrollTop;
      if (!awaitingScrollResponseRef.current) return;
      awaitingScrollResponseRef.current = false;
      appendPersistedSequenceRuntimeDiagnostic({
        type: "scroll-hitch",
        step: "sequencer-scroll-response",
        latencyMs: now - lastScrollInputAtRef.current,
        scrollTop: nextScrollTop,
        detail: delta > 0 ? "first scroll response after input" : "scroll input without position change",
      });
    };

    scrollPanel.addEventListener("wheel", recordInput, { passive: true });
    scrollPanel.addEventListener("touchmove", recordInput, { passive: true });
    scrollPanel.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollPanel.removeEventListener("wheel", recordInput);
      scrollPanel.removeEventListener("touchmove", recordInput);
      scrollPanel.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    if (Number.isFinite(activeCueIndex)) {
      const anchorTarget = deriveCueScrollAnchorTarget({
        showAllEvents,
        activeCueIndex,
        sequenceCueGroups,
        sequenceEvents,
        snapshots,
        cueExpandedSnapshotIds,
        repeatSections: sequenceRepeatSections,
      });
      if (anchorTarget == null) return;
      const targetRefKey = `${anchorTarget.kind}:${anchorTarget.targetKey}`;
      if (lastAutoScrolledCueTargetRef.current === targetRefKey) return;
      const targetNode = anchorTarget.kind === "structural"
        ? (barRowRefs.current.get(anchorTarget.targetKey) ?? null)
        : (snapshotRowRefs.current.get(anchorTarget.targetKey) ?? null);
      if (!(targetNode instanceof HTMLElement)) return;

      lastAutoScrolledCueTargetRef.current = targetRefKey;
      scrollNodeIntoPanel(targetNode);
      return;
    }
    lastAutoScrolledCueTargetRef.current = null;
  }, [activeCueIndex, autoScrollEnabled, cueExpandedSnapshotIds, scrollNodeIntoPanel, sequenceCueGroups, sequenceEvents, sequenceRepeatSections, showAllEvents, snapshots]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    if (Number.isFinite(activeCueIndex)) {
      lastAutoScrolledSnapshotIdRef.current = null;
      return;
    }
    const snapshotId = activeSnapshotId ?? null;
    if (snapshotId == null) {
      lastAutoScrolledSnapshotIdRef.current = null;
      return;
    }
    if (lastAutoScrolledSnapshotIdRef.current === snapshotId) return;
    const scrollPanel = scrollPanelRef.current;
    const snapshotRow = snapshotRowRefs.current.get(snapshotId) ?? null;
    if (!(scrollPanel instanceof HTMLElement) || !(snapshotRow instanceof HTMLElement)) return;

    lastAutoScrolledSnapshotIdRef.current = snapshotId;
    alignNodeToPanelTop(snapshotRow);
  }, [activeCueIndex, activeSnapshotId, alignNodeToPanelTop, autoScrollEnabled]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    const pendingTarget = pendingResetScrollTargetRef.current;
    if (!playheadIsOff || pendingTarget == null) return;
    pendingResetScrollTargetRef.current = null;
    if (pendingTarget === "__first_structural__") {
      const keyedStructuralRow = firstStructuralScrollKey != null
        ? (barRowRefs.current.get(firstStructuralScrollKey) ?? null)
        : null;
      const firstStructuralRow = keyedStructuralRow instanceof HTMLElement
        ? keyedStructuralRow
        : ([...barRowRefs.current.values()]
          .filter((node) => node instanceof HTMLElement)
          .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0] ?? null);
      if (!(firstStructuralRow instanceof HTMLElement)) {
        const scrollPanel = scrollPanelRef.current;
        if (scrollPanel instanceof HTMLElement) {
          scrollPanel.scrollTop = 0;
        }
        return;
      }
      suppressNextBarAutoScrollRef.current = true;
      scrollNodeIntoPanel(firstStructuralRow);
      return;
    }
    if (pendingTarget === "__top__") {
      const scrollPanel = scrollPanelRef.current;
      if (scrollPanel instanceof HTMLElement) {
        scrollPanel.scrollTop = 0;
      }
      return;
    }
    const repeatRow = barRowRefs.current.get(pendingTarget) ?? null;
    if (!(repeatRow instanceof HTMLElement)) return;
    suppressNextBarAutoScrollRef.current = true;
    lastAutoScrolledSnapshotIdRef.current = pendingTarget;
    scrollNodeIntoPanel(repeatRow);
  }, [autoScrollEnabled, firstStructuralScrollKey, playheadIsOff, scrollNodeIntoPanel]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    if (!playheadIsOff || transportScrollTargetRef.current !== "bar") {
      lastAutoScrolledBarIdRef.current = null;
      return;
    }
    if (pendingResetScrollTargetRef.current != null) return;
    if (suppressNextBarAutoScrollRef.current) {
      suppressNextBarAutoScrollRef.current = false;
      return;
    }
    const selectedBar = sortedBars[selectedBarIndex] ?? null;
    const selectedBarId = selectedBar?.id ?? null;
    if (selectedBarId == null) return;
    const structuralKey = structuralScrollKeyAtPosition(selectedBar.position);
    const targetKey = structuralKey ?? selectedBarId;
    if (lastAutoScrolledBarIdRef.current === targetKey) return;
    const barRow = barRowRefs.current.get(targetKey) ?? null;
    if (!(barRow instanceof HTMLElement)) return;

    lastAutoScrolledBarIdRef.current = targetKey;
    alignNodeToPanelTop(barRow);
  }, [alignNodeToPanelTop, autoScrollEnabled, playheadIsOff, selectedBarIndex, sortedBars, structuralScrollKeyAtPosition]);

  const resetSequencePlayheadAndScrollTop = useCallback(() => {
    transportScrollTargetRef.current = "bar";
    lastAutoScrolledBarIdRef.current = null;
    pendingResetScrollTargetRef.current = "__first_structural__";
    const scrollPanel = scrollPanelRef.current;
    if (scrollPanel instanceof HTMLElement) {
      scrollPanel.scrollTop = 0;
    }
    onResetSequencePlayhead?.();
  }, [onResetSequencePlayhead]);

  const jumpSequencePlayheadToEndAndScrollBottom = useCallback(() => {
    transportScrollTargetRef.current = "bar";
    lastAutoScrolledBarIdRef.current = null;
    pendingResetScrollTargetRef.current = null;
    const scrollPanel = scrollPanelRef.current;
    if (scrollPanel instanceof HTMLElement) {
      scrollPanel.scrollTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
    }
    onJumpSequenceEnd?.();
  }, [onJumpSequenceEnd]);

  return {
    playbackRowRef,
    scrollPanelRef,
    snapshotRowRefs,
    barRowRefs,
    eventRowRefs,
    transportScrollTargetRef,
    armPendingSnapshot,
    armPendingCue,
    ensureExpanded,
    resetSequencePlayheadAndScrollTop,
    jumpSequencePlayheadToEndAndScrollBottom,
    scrollNodeIntoPanel,
    scrollNodesIntoPanel,
    refreshPendingSnapshotAlignment,
  };
}
