// This hook owns sequencer viewport tracking and auto-scroll behavior.
// It manages row refs, transport offsets, and the logic that decides
// which snapshot/bar/event should be brought into view during navigation.

import { useCallback, useEffect, useRef } from "preact/hooks";
import {
  appendPersistedSequenceRuntimeDiagnostic,
  isSequenceRuntimeDiagnosticsEnabled,
} from "../debug/sequence-runtime-diagnostics.js";
import { appendPersistedSequencerCrashDiagnostic } from "../debug/sequencer-crash-diagnostics.js";
import { structuralEventRenderKey } from "./value-runtime.js";
import {
  deriveCueScrollAnchorTarget,
  resolveCueAnchorSnapshotId,
} from "./view-runtime.js";

export default function useSequencerAutoscroll({
  autoScrollEnabled,
  activeCueIndex,
  activeSnapshotId,
  playheadStepIndex,
  playheadIsOff,
  selectedBarIndex,
  sortedBars,
  snapshots,
  sequenceEvents,
  sequenceCueGroups,
  sequenceRepeatSections,
  cueExpandedSnapshotIds,
  cueExpandedSnapshotIdsAt,
  firstCueTimeBySnapshotIndex,
  firstEventIdByCueIndex,
  firstRepeatStartMarker,
  firstStructuralScrollKey,
  repeatStartBySnapshotId,
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

  const scrollNodeIntoPanel = useCallback((targetNode) => {
    if (!autoScrollEnabled) return;
    const scrollPanel = scrollPanelRef.current;
    if (!(scrollPanel instanceof HTMLElement) || !(targetNode instanceof HTMLElement)) return;

    appendPersistedSequencerCrashDiagnostic({
      type: "sequencer-autoscroll-requested",
      detail: "Requested sequencer autoscroll target",
      context: {
        source: "sequencer",
        autoScrollEnabled,
        scrollTop: scrollPanel.scrollTop,
        targetTop: targetNode.getBoundingClientRect?.().top ?? null,
      },
    });

    window.requestAnimationFrame(() => {
      const scrollStartMs = performance.now();
      const panelRect = scrollPanel.getBoundingClientRect();
      const playbackRect = playbackRowRef.current instanceof HTMLElement
        ? playbackRowRef.current.getBoundingClientRect()
        : null;
      const targetRect = targetNode.getBoundingClientRect();
      const gap = 6;
      const stickyTransportOverlap = playbackRect == null
        ? 0
        : Math.max(0, Math.min(playbackRect.bottom, panelRect.bottom) - panelRect.top);
      const targetTop = scrollPanel.scrollTop
        + (targetRect.top - panelRect.top)
        - stickyTransportOverlap
        - gap;
      const maxTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, targetTop));
      if (Math.abs(nextTop - scrollPanel.scrollTop) < 2) return;
      scrollPanel.scrollTop = nextTop;
      appendPersistedSequencerCrashDiagnostic({
        type: "sequencer-autoscroll-applied",
        detail: "Applied sequencer autoscroll target",
        context: {
          source: "sequencer",
          autoScrollEnabled,
          scrollTop: scrollPanel.scrollTop,
          targetTop: nextTop,
        },
      });
      const durationMs = performance.now() - scrollStartMs;
      if (durationMs > 8) {
        recordTimedTransportDiagnostic?.({
          type: "scroll",
          clockSeconds: performance.now() / 1000,
          durationMs,
          detail: "scrollNodeIntoPanel",
        });
      }
    });
  }, [autoScrollEnabled, recordTimedTransportDiagnostic]);

  const armPendingSnapshot = useCallback((snapshotIndex) => {
    transportScrollTargetRef.current = "snapshot";
    const nextSnapshotIndex = Number(snapshotIndex);
    if (!Number.isFinite(nextSnapshotIndex)) return;
    const snapshotTime = firstCueTimeBySnapshotIndex.get(nextSnapshotIndex) ?? (nextSnapshotIndex + 1);
    onCueSequenceSnapshot?.(nextSnapshotIndex);
    const repeatStartKey = repeatStartKeyAtPosition(snapshotTime);
    if (repeatStartKey != null) {
      const repeatRow = barRowRefs.current.get(repeatStartKey) ?? null;
      scrollNodeIntoPanel(repeatRow);
    } else {
      const snapshotId = snapshots[nextSnapshotIndex]?.id ?? null;
      if (snapshotId != null) {
        const snapshotRow = snapshotRowRefs.current.get(snapshotId) ?? null;
        scrollNodeIntoPanel(snapshotRow);
      }
    }
  }, [
    firstCueTimeBySnapshotIndex,
    onCueSequenceSnapshot,
    repeatStartKeyAtPosition,
    scrollNodeIntoPanel,
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
    const repeatStartKey = activeSnapshotId != null
      ? (repeatStartBySnapshotId.get(activeSnapshotId) ?? (
        playheadStepIndex === 0 && firstRepeatStartMarker != null
          ? structuralEventRenderKey({
            type: "repeat-start",
            repeatId: firstRepeatStartMarker.id,
          })
          : null
      ))
      : (
        playheadStepIndex === 0 && firstRepeatStartMarker != null
          ? structuralEventRenderKey({
            type: "repeat-start",
            repeatId: firstRepeatStartMarker.id,
          })
          : null
      );
    if (repeatStartKey != null) {
      if (lastAutoScrolledSnapshotIdRef.current === repeatStartKey) return;
      const repeatRow = barRowRefs.current.get(repeatStartKey) ?? null;
      if (!(repeatRow instanceof HTMLElement)) return;
      lastAutoScrolledSnapshotIdRef.current = repeatStartKey;
      scrollNodeIntoPanel(repeatRow);
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
    const frame = window.requestAnimationFrame(() => {
      const panelRect = scrollPanel.getBoundingClientRect();
      const playbackRect = playbackRowRef.current instanceof HTMLElement
        ? playbackRowRef.current.getBoundingClientRect()
        : null;
      const snapshotRect = snapshotRow.getBoundingClientRect();
      const gap = 6;
      const stickyTransportOverlap = playbackRect == null
        ? 0
        : Math.max(0, Math.min(playbackRect.bottom, panelRect.bottom) - panelRect.top);
      const targetTop = scrollPanel.scrollTop
        + (snapshotRect.top - panelRect.top)
        - stickyTransportOverlap
        - gap;
      const maxTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, targetTop));
      if (Math.abs(nextTop - scrollPanel.scrollTop) < 2) return;
      scrollPanel.scrollTop = nextTop;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeCueIndex, activeSnapshotId, autoScrollEnabled, firstRepeatStartMarker, playheadStepIndex, repeatStartBySnapshotId, scrollNodeIntoPanel]);

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
    const scrollPanel = scrollPanelRef.current;
    const barRow = barRowRefs.current.get(targetKey) ?? null;
    if (!(scrollPanel instanceof HTMLElement) || !(barRow instanceof HTMLElement)) return;

    lastAutoScrolledBarIdRef.current = targetKey;
    const frame = window.requestAnimationFrame(() => {
      const panelRect = scrollPanel.getBoundingClientRect();
      const playbackRect = playbackRowRef.current instanceof HTMLElement
        ? playbackRowRef.current.getBoundingClientRect()
        : null;
      const barRect = barRow.getBoundingClientRect();
      const gap = 6;
      const stickyTransportOverlap = playbackRect == null
        ? 0
        : Math.max(0, Math.min(playbackRect.bottom, panelRect.bottom) - panelRect.top);
      const targetTop = scrollPanel.scrollTop
        + (barRect.top - panelRect.top)
        - stickyTransportOverlap
        - gap;
      const maxTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, targetTop));
      if (Math.abs(nextTop - scrollPanel.scrollTop) < 2) return;
      scrollPanel.scrollTop = nextTop;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoScrollEnabled, playheadIsOff, selectedBarIndex, sortedBars, structuralScrollKeyAtPosition]);

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
  };
}
