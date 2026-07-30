// Samples sequencer rendering and mounted row counts into the existing
// timed-transport diagnostic stream. Live samples deliberately avoid layout
// reads and DOM traversal so observing playback cannot create the stall being
// measured.

import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { isTimedTransportDiagnosticsEnabled } from "../debug/timed-transport-diagnostics.js";

const UI_SAMPLE_INTERVAL_MS = 1000;
const LONG_UI_INTERVAL_MS = 50;
const SLOW_COMMIT_MS = 16;

function uniqueNodes(ref) {
  return new Set(
    [...(ref?.current?.values?.() ?? [])].filter(
      (node) => node instanceof HTMLElement && node.isConnected,
    ),
  );
}

export function collectSequencerUiMetrics({
  scrollPanelRef,
  snapshotRowRefs,
  eventRowRefs,
  barRowRefs,
} = {}) {
  const measurementStartMs = performance.now();
  const scrollPanel = scrollPanelRef?.current ?? null;
  const snapshotRows = uniqueNodes(snapshotRowRefs);
  const eventRows = uniqueNodes(eventRowRefs);
  const structuralRows = uniqueNodes(barRowRefs);
  const allRows = new Set(snapshotRows);
  eventRows.forEach((node) => allRows.add(node));
  structuralRows.forEach((node) => allRows.add(node));

  return {
    snapshotRowCount: snapshotRows.size,
    eventRowCount: eventRows.size,
    structuralRowCount: structuralRows.size,
    rowCount: allRows.size,
    visibleRowCount: null,
    mountedNodeCount: allRows.size,
    scrollTop: scrollPanel == null ? null : Number(scrollPanel.scrollTop),
    measurementDurationMs: performance.now() - measurementStartMs,
  };
}

export default function useTimedUiDiagnostics({
  running,
  renderStartedAtMs,
  runtimeInstanceId,
  scrollPanelRef,
  snapshotRowRefs,
  eventRowRefs,
  barRowRefs,
  snapshotCount,
  eventCount,
  cueCount,
  recordDiagnostic,
} = {}) {
  const lastCommitSampleAtRef = useRef(-Infinity);
  const previousRuntimeInstanceIdRef = useRef(runtimeInstanceId ?? null);

  const collectMetrics = useCallback(
    () => ({
      ...collectSequencerUiMetrics({
        scrollPanelRef,
        snapshotRowRefs,
        eventRowRefs,
        barRowRefs,
      }),
      snapshotCount,
      eventCount,
      cueCount,
      runtimeInstanceId,
      status: running ? "running" : "stopped",
    }),
    [
      barRowRefs,
      cueCount,
      eventCount,
      eventRowRefs,
      running,
      runtimeInstanceId,
      scrollPanelRef,
      snapshotCount,
      snapshotRowRefs,
    ],
  );

  useLayoutEffect(() => {
    if (!running || !isTimedTransportDiagnosticsEnabled()) return;
    const nowMs = performance.now();
    const commitDurationMs = Math.max(0, nowMs - Number(renderStartedAtMs || nowMs));
    const sampleDue = nowMs - lastCommitSampleAtRef.current >= UI_SAMPLE_INTERVAL_MS;
    if (!sampleDue && commitDurationMs < SLOW_COMMIT_MS) return;
    if (sampleDue) lastCommitSampleAtRef.current = nowMs;
    recordDiagnostic?.({
      type: "ui-commit",
      clockSeconds: nowMs / 1000,
      commitDurationMs,
      ...collectMetrics(),
      detail:
        commitDurationMs >= SLOW_COMMIT_MS ? "slow sequencer commit" : "sampled sequencer commit",
    });
  });

  useEffect(() => {
    const previousRuntimeInstanceId = previousRuntimeInstanceIdRef.current;
    previousRuntimeInstanceIdRef.current = runtimeInstanceId ?? null;
    if (!running || !isTimedTransportDiagnosticsEnabled()) return;
    if (previousRuntimeInstanceId == null || previousRuntimeInstanceId === runtimeInstanceId)
      return;
    recordDiagnostic?.({
      type: "runtime-rebuild",
      clockSeconds: performance.now() / 1000,
      runtimeInstanceId,
      status: "running",
      snapshotCount,
      eventCount,
      cueCount,
      detail: `runtime instance changed from ${previousRuntimeInstanceId} to ${runtimeInstanceId} during timed playback`,
    });
  }, [cueCount, eventCount, recordDiagnostic, running, runtimeInstanceId, snapshotCount]);

  useEffect(() => {
    if (!running || !isTimedTransportDiagnosticsEnabled()) return undefined;
    let cancelled = false;
    let previousFrameMs = performance.now();
    let lastPeriodicSampleMs = -Infinity;

    const tick = () => {
      if (cancelled) return;
      const nowMs = performance.now();
      const frameIntervalMs = Math.max(0, nowMs - previousFrameMs);
      previousFrameMs = nowMs;
      const periodicSampleDue = nowMs - lastPeriodicSampleMs >= UI_SAMPLE_INTERVAL_MS;
      const longFrame = frameIntervalMs >= LONG_UI_INTERVAL_MS;
      if (periodicSampleDue || longFrame) {
        if (periodicSampleDue) lastPeriodicSampleMs = nowMs;
        recordDiagnostic?.({
          type: "ui-frame-sample",
          clockSeconds: nowMs / 1000,
          frameIntervalMs,
          ...collectMetrics(),
          detail: longFrame ? "long sequencer frame" : "sampled sequencer frame",
        });
      }
      window.requestAnimationFrame(tick);
    };

    const frameId = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [collectMetrics, recordDiagnostic, running]);
}
