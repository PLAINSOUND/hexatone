// This hook owns the live timed-transport state machine for the sequencer.
// It coordinates the lookahead scheduler, pause/resume/seek behavior, runtime
// diagnostics, and handoff to the existing cue-trigger path.

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { barContextForPosition } from "./transport.js";
import {
  createTimedTransportDiagnostics,
  isTimedTransportDiagnosticsEnabled,
  loadPersistedTimedTransportDiagnostics,
  persistTimedTransportDiagnostics,
  pushTimedTransportDiagnostic,
  resetTimedTransportDiagnostics,
  summarizeTimedTransportDiagnostics,
} from "./timed-transport-diagnostics.js";
import {
  advanceTimedTransport,
  createTimedTransportState,
  currentTimedTransportElapsedSeconds,
  findPlaybackStartIndex,
  pauseTimedTransport,
  resumeTimedTransport,
  startTimedTransport,
  stopTimedTransport,
  updateTimedTransportSpeed,
} from "./timed-transport-runtime.js";
import { clampSequencePlaybackSpeed } from "./playback-modifiers-runtime.js";

const TIMED_TRANSPORT_WAKE_SLICE_MS = 25;

export default function useTimedTransportController({
  timedPlaybackBursts,
  timedCueTriggers,
  timedCueTriggerBySourceIndex,
  sequencePlaybackSpeed = 1,
  pendingTransportSelection = null,
  playheadMarkerIndex,
  playheadStepIndex,
  playheadIsEnd,
  selectedBarIndex,
  sortedBars,
  formatTransportClock,
  formatTransportBarBeat,
  describeTransportTempo,
  onCueSequenceCue,
  onCueSequenceSnapshot,
  onSelectSequenceBar,
  onPlayCue,
  onPlayTimedCue,
  onStopSnapshot,
  getTimedTransportClockSeconds,
} = {}) {
  const timedTransportStateRef = useRef(createTimedTransportState([]));
  const timedTransportSchedulerTokenRef = useRef(0);
  const timedTransportTimeoutRef = useRef(null);
  const timedTransportStartTargetRef = useRef(null);
  const onPlayCueRef = useRef(onPlayCue);
  const onPlayTimedCueRef = useRef(onPlayTimedCue);
  const onStopSnapshotRef = useRef(onStopSnapshot);
  const getTimedTransportClockSecondsRef = useRef(getTimedTransportClockSeconds);
  const timedPlaybackBurstsRef = useRef([]);
  const timedCueTriggerBySourceIndexRef = useRef(new Map());
  const timedTransportDiagnosticsRef = useRef(createTimedTransportDiagnostics());
  const [timedTransportState, setTimedTransportState] = useState(() => createTimedTransportState([]));

  useEffect(() => {
    timedTransportStateRef.current = timedTransportState;
  }, [timedTransportState]);

  useEffect(() => {
    onPlayCueRef.current = onPlayCue;
  }, [onPlayCue]);

  useEffect(() => {
    onPlayTimedCueRef.current = onPlayTimedCue;
  }, [onPlayTimedCue]);

  useEffect(() => {
    onStopSnapshotRef.current = onStopSnapshot;
  }, [onStopSnapshot]);

  useEffect(() => {
    getTimedTransportClockSecondsRef.current = getTimedTransportClockSeconds;
  }, [getTimedTransportClockSeconds]);

  useEffect(() => {
    timedPlaybackBurstsRef.current = timedPlaybackBursts;
  }, [timedPlaybackBursts]);

  useEffect(() => {
    timedCueTriggerBySourceIndexRef.current = timedCueTriggerBySourceIndex;
  }, [timedCueTriggerBySourceIndex]);

  useEffect(() => {
    setTimedTransportState((previous) => {
      const freshState = createTimedTransportState(timedPlaybackBursts, {
        speedMultiplier: previous?.speedMultiplier ?? sequencePlaybackSpeed,
      });
      if (
        previous?.status !== "running"
        && previous?.status !== "paused"
      ) {
        timedTransportStateRef.current = freshState;
        return freshState;
      }

      const lastPlaybackIndex = Math.max(0, timedPlaybackBursts.length - 1);
      const nextPlaybackIndex = timedPlaybackBursts.length === 0
        ? -1
        : Math.max(0, Math.min(lastPlaybackIndex, Number(previous?.nextPlaybackIndex ?? 0)));
      const lastDispatchedPlaybackIndex = timedPlaybackBursts.length === 0
        ? -1
        : Math.max(-1, Math.min(lastPlaybackIndex, Number(previous?.lastDispatchedPlaybackIndex ?? -1)));
      const preservedState = {
        ...previous,
        status: timedPlaybackBursts.length === 0 ? "empty" : previous.status,
        nextPlaybackIndex,
        lastDispatchedPlaybackIndex,
      };
      timedTransportStateRef.current = preservedState;
      return preservedState;
    });
  }, [sequencePlaybackSpeed, timedPlaybackBursts]);

  const clearScheduledTimedCueCallbacks = useCallback(() => {
    timedTransportSchedulerTokenRef.current += 1;
    if (timedTransportTimeoutRef.current != null) {
      window.clearTimeout(timedTransportTimeoutRef.current);
      timedTransportTimeoutRef.current = null;
    }
  }, []);

  const recordTimedTransportDiagnostic = useCallback((entry) => {
    if (!isTimedTransportDiagnosticsEnabled()) return;
    timedTransportDiagnosticsRef.current = pushTimedTransportDiagnostic(
      timedTransportDiagnosticsRef.current,
      entry,
    );
    persistTimedTransportDiagnostics(timedTransportDiagnosticsRef.current);
  }, []);

  useEffect(() => {
    if (!isTimedTransportDiagnosticsEnabled()) return undefined;
    if (typeof PerformanceObserver === "undefined") return undefined;
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          recordTimedTransportDiagnostic({
            type: "longtask",
            clockSeconds: performance.now() / 1000,
            durationMs: entry.duration,
            detail: entry.name || "long task",
          });
        });
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      observer = null;
    }
    return () => observer?.disconnect?.();
  }, [recordTimedTransportDiagnostic]);

  useEffect(() => {
    if (!isTimedTransportDiagnosticsEnabled()) return undefined;
    if (timedTransportState.status !== "running") return undefined;
    let cancelled = false;
    let previousFrameSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;

    const tickFrame = () => {
      if (cancelled) return;
      const nowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
      const gapMs = (nowSeconds - previousFrameSeconds) * 1000;
      previousFrameSeconds = nowSeconds;
      if (gapMs > 34) {
        recordTimedTransportDiagnostic({
          type: "frame-gap",
          clockSeconds: nowSeconds,
          elapsedSeconds: currentTimedTransportElapsedSeconds(timedTransportStateRef.current, nowSeconds),
          durationMs: gapMs,
          nextPlaybackIndex: timedTransportStateRef.current?.nextPlaybackIndex ?? null,
          detail: "requestAnimationFrame gap exceeded 34ms",
        });
      }
      window.requestAnimationFrame(tickFrame);
    };

    const frameId = window.requestAnimationFrame(tickFrame);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [recordTimedTransportDiagnostic, timedTransportState.status]);

  const deriveTimedTransportStartTarget = useCallback((playbackIndex) => {
    const burst = timedPlaybackBursts[playbackIndex] ?? null;
    if (!burst) return null;
    if (Number.isFinite(burst?.sourceCueIndex)) {
      return { kind: "cue", index: Number(burst.sourceCueIndex) - 1 };
    }
    if (Array.isArray(burst?.sourceSnapshotIndexes) && burst.sourceSnapshotIndexes.length > 0) {
      return { kind: "snapshot", index: Number(burst.sourceSnapshotIndexes[0]) };
    }
    const barContext = barContextForPosition(Number(burst?.sequenceTime ?? 1), sortedBars);
    return { kind: "bar", index: Number(barContext?.barIndex ?? 0) };
  }, [sortedBars, timedPlaybackBursts]);

  const restoreTimedTransportStartTarget = useCallback(() => {
    const target = timedTransportStartTargetRef.current;
    if (!target) return;
    if (target.kind === "cue") {
      onCueSequenceCue?.(target.index);
      return;
    }
    if (target.kind === "snapshot") {
      onCueSequenceSnapshot?.(target.index);
      return;
    }
    onSelectSequenceBar?.(target.index);
  }, [onCueSequenceCue, onCueSequenceSnapshot, onSelectSequenceBar]);

  const resolveTimedTransportStartIndex = useCallback(() => {
    if (Number.isFinite(pendingTransportSelection?.cueIndex)) {
      return findPlaybackStartIndex(timedPlaybackBursts, {
        cueIndex: Number(pendingTransportSelection.cueIndex) + 1,
      });
    }
    if (Number.isFinite(pendingTransportSelection?.snapshotIndex)) {
      return findPlaybackStartIndex(timedPlaybackBursts, {
        snapshotIndex: Number(pendingTransportSelection.snapshotIndex),
      });
    }
    if (Number.isFinite(playheadMarkerIndex)) {
      return findPlaybackStartIndex(timedPlaybackBursts, { cueIndex: Number(playheadMarkerIndex) + 1 });
    }
    if (Number.isFinite(playheadStepIndex) && playheadStepIndex >= 0 && !playheadIsEnd) {
      return findPlaybackStartIndex(timedPlaybackBursts, { snapshotIndex: Number(playheadStepIndex) });
    }
    const selectedBarPosition = Number(sortedBars[selectedBarIndex]?.position ?? 1);
    return findPlaybackStartIndex(timedPlaybackBursts, { sequenceTime: selectedBarPosition });
  }, [
    pendingTransportSelection,
    playheadIsEnd,
    playheadMarkerIndex,
    playheadStepIndex,
    selectedBarIndex,
    sortedBars,
    timedPlaybackBursts,
  ]);

  const dispatchTimedCueBurst = useCallback((burst) => {
    if (!Number.isFinite(burst?.sourceCueIndex)) return;
    const cueIndex = Number(burst.sourceCueIndex) - 1;
    const trigger = timedCueTriggerBySourceIndexRef.current.get(Number(burst.sourceCueIndex)) ?? null;
    const dispatchStart = performance.now();
    if (onPlayTimedCueRef.current) {
      onPlayTimedCueRef.current(cueIndex, trigger, {
        hardRestart: burst.repeatJump != null,
      });
    } else {
      onPlayCueRef.current?.(cueIndex);
    }
    recordTimedTransportDiagnostic({
      type: "dispatch",
      clockSeconds: (getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000),
      elapsedSeconds: currentTimedTransportElapsedSeconds(
        timedTransportStateRef.current,
        getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000,
      ),
      cueIndex: Number(burst.sourceCueIndex),
      playbackIndex: burst.playbackIndex,
      durationMs: performance.now() - dispatchStart,
      activeNotes: Array.isArray(burst.soundingAfter) ? burst.soundingAfter.length : null,
      noteCount: Array.isArray(burst.events) ? burst.events.filter((event) => event?.type === "note").length : null,
    });
  }, [recordTimedTransportDiagnostic]);

  const armNextTimedCueDispatch = useCallback(() => {
    if (timedTransportStateRef.current.status !== "running") return;
    if (timedTransportTimeoutRef.current != null) {
      window.clearTimeout(timedTransportTimeoutRef.current);
      timedTransportTimeoutRef.current = null;
    }

    const playbackIndex = Number(timedTransportStateRef.current.nextPlaybackIndex);
    if (!Number.isFinite(playbackIndex) || playbackIndex < 0) {
      return;
    }

    const burst = timedPlaybackBurstsRef.current[playbackIndex] ?? null;
    if (!burst) {
      const stoppedState = stopTimedTransport(timedPlaybackBurstsRef.current, {
        speedMultiplier: timedTransportStateRef.current?.speedMultiplier ?? sequencePlaybackSpeed,
      });
      timedTransportStateRef.current = stoppedState;
      setTimedTransportState(stoppedState);
      return;
    }

    const schedulerToken = timedTransportSchedulerTokenRef.current;
    const nowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
    const currentElapsed = currentTimedTransportElapsedSeconds(timedTransportStateRef.current, nowSeconds);
    const targetDelayMs = Math.max(0, (Number(burst.elapsedSeconds) - currentElapsed) * 1000);
    const delayMs = Math.min(targetDelayMs, TIMED_TRANSPORT_WAKE_SLICE_MS);

    recordTimedTransportDiagnostic({
      type: "schedule",
      clockSeconds: nowSeconds,
      elapsedSeconds: burst.elapsedSeconds,
      cueIndex: Number.isFinite(burst.sourceCueIndex) ? Number(burst.sourceCueIndex) : null,
      playbackIndex: burst.playbackIndex,
      scheduledDelayMs: delayMs,
      queueDepth: 1,
      activeNotes: Array.isArray(burst.soundingBefore) ? burst.soundingBefore.length : null,
      noteCount: Array.isArray(burst.events) ? burst.events.filter((event) => event?.type === "note").length : null,
    });

    timedTransportTimeoutRef.current = window.setTimeout(() => {
      timedTransportTimeoutRef.current = null;
      if (timedTransportSchedulerTokenRef.current !== schedulerToken) return;
      if (timedTransportStateRef.current.status !== "running") return;

      const fireNowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
      const fireElapsedSeconds = currentTimedTransportElapsedSeconds(timedTransportStateRef.current, fireNowSeconds);
      if (fireElapsedSeconds + 1e-9 < Number(burst.elapsedSeconds)) {
        armNextTimedCueDispatch();
        return;
      }
      const previous = timedTransportStateRef.current;
      const result = advanceTimedTransport(previous, timedPlaybackBurstsRef.current, fireNowSeconds);
      timedTransportStateRef.current = result.state;

      if (result.dueBursts.length > 1) {
        const latestBurst = result.dueBursts.at(-1) ?? null;
        recordTimedTransportDiagnostic({
          type: "late-tick",
          clockSeconds: fireNowSeconds,
          elapsedSeconds: currentTimedTransportElapsedSeconds(result.state, fireNowSeconds),
          cueIndex: Number.isFinite(latestBurst?.sourceCueIndex) ? Number(latestBurst.sourceCueIndex) : null,
          playbackIndex: latestBurst?.playbackIndex ?? null,
          queueDepth: result.dueBursts.length,
          nextPlaybackIndex: result.state.nextPlaybackIndex,
          detail: "multiple bursts became due before the next scheduled wakeup",
        });
      }

      result.dueBursts.forEach((dueBurst) => {
        const actualElapsed = currentTimedTransportElapsedSeconds(timedTransportStateRef.current, fireNowSeconds);
        recordTimedTransportDiagnostic({
          type: "fire",
          clockSeconds: fireNowSeconds,
          elapsedSeconds: actualElapsed,
          cueIndex: Number.isFinite(dueBurst.sourceCueIndex) ? Number(dueBurst.sourceCueIndex) : null,
          playbackIndex: dueBurst.playbackIndex,
          scheduledDelayMs: targetDelayMs,
          latenessMs: (actualElapsed - Number(dueBurst.elapsedSeconds)) * 1000,
          queueDepth: 0,
          activeNotes: Array.isArray(dueBurst.soundingBefore) ? dueBurst.soundingBefore.length : null,
          noteCount: Array.isArray(dueBurst.events) ? dueBurst.events.filter((event) => event?.type === "note").length : null,
        });
        dispatchTimedCueBurst(dueBurst);
      });

      const stateChanged = (
        result.state.status !== previous.status ||
        result.state.nextPlaybackIndex !== previous.nextPlaybackIndex ||
        result.state.lastDispatchedPlaybackIndex !== previous.lastDispatchedPlaybackIndex
      );

      if (stateChanged) {
        setTimedTransportState(result.state);
      }

      if (result.state.status === "finished") {
        onStopSnapshotRef.current?.();
        return;
      }

      armNextTimedCueDispatch();
    }, delayMs);
  }, [dispatchTimedCueBurst, recordTimedTransportDiagnostic, sequencePlaybackSpeed]);

  useEffect(() => {
    const nextSpeedMultiplier = clampSequencePlaybackSpeed(sequencePlaybackSpeed);
    const previous = timedTransportStateRef.current;
    if (clampSequencePlaybackSpeed(previous?.speedMultiplier ?? 1) === nextSpeedMultiplier) return;
    const nowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
    const nextState = updateTimedTransportSpeed(previous, nowSeconds, nextSpeedMultiplier);
    timedTransportStateRef.current = nextState;
    setTimedTransportState(nextState);
    if (nextState?.status === "running") {
      clearScheduledTimedCueCallbacks();
      armNextTimedCueDispatch();
    }
  }, [
    armNextTimedCueDispatch,
    clearScheduledTimedCueCallbacks,
    sequencePlaybackSpeed,
  ]);

  const replayPausedTimedTransportCue = useCallback((state) => {
    const playbackIndex = Number(state?.lastDispatchedPlaybackIndex);
    if (!Number.isFinite(playbackIndex) || playbackIndex < 0) return;
    const burst = timedPlaybackBurstsRef.current[playbackIndex] ?? null;
    if (!burst || !Number.isFinite(burst?.sourceCueIndex)) return;
    const cueIndex = Number(burst.sourceCueIndex) - 1;
    const trigger = timedCueTriggerBySourceIndexRef.current.get(Number(burst.sourceCueIndex)) ?? null;
    if (onPlayTimedCueRef.current) {
      onPlayTimedCueRef.current(cueIndex, trigger, { hardRestart: true });
      return;
    }
    onPlayCueRef.current?.(cueIndex);
  }, []);

  useEffect(() => {
    if (timedTransportState.status !== "running") return undefined;
    clearScheduledTimedCueCallbacks();
    armNextTimedCueDispatch();

    return () => {
      clearScheduledTimedCueCallbacks();
    };
  }, [
    armNextTimedCueDispatch,
    clearScheduledTimedCueCallbacks,
    timedTransportState.status,
  ]);

  const handleTimedTransportPlayPause = useCallback(() => {
    if (!timedPlaybackBursts.length) return;
    const nowSeconds = getTimedTransportClockSeconds?.() ?? performance.now() / 1000;
    const previous = timedTransportStateRef.current;

    if (previous.status === "running") {
      clearScheduledTimedCueCallbacks();
      onStopSnapshotRef.current?.();
      recordTimedTransportDiagnostic({
        type: "pause",
        clockSeconds: nowSeconds,
        elapsedSeconds: currentTimedTransportElapsedSeconds(previous, nowSeconds),
        status: previous.status,
      });
      const pausedState = pauseTimedTransport(previous, nowSeconds);
      timedTransportStateRef.current = pausedState;
      setTimedTransportState(pausedState);
      return;
    }

    if (previous.status === "paused") {
      clearScheduledTimedCueCallbacks();
      replayPausedTimedTransportCue(previous);
      recordTimedTransportDiagnostic({
        type: "resume",
        clockSeconds: nowSeconds,
        elapsedSeconds: currentTimedTransportElapsedSeconds(previous, nowSeconds),
        status: previous.status,
      });
      const resumedState = resumeTimedTransport(previous, nowSeconds);
      timedTransportStateRef.current = resumedState;
      setTimedTransportState(resumedState);
      return;
    }

    const startIndex = resolveTimedTransportStartIndex();
    timedTransportDiagnosticsRef.current = resetTimedTransportDiagnostics(timedTransportDiagnosticsRef.current);
    const startedState = startTimedTransport(previous, timedPlaybackBursts, {
      playbackIndex: startIndex < 0 ? 0 : startIndex,
      clockSeconds: nowSeconds,
      speedMultiplier: sequencePlaybackSpeed,
    });
    recordTimedTransportDiagnostic({
      type: "start",
      clockSeconds: nowSeconds,
      elapsedSeconds: startedState.pausedElapsedSeconds,
      playbackIndex: startIndex < 0 ? 0 : startIndex,
      status: startedState.status,
    });
    timedTransportStartTargetRef.current = deriveTimedTransportStartTarget(startIndex < 0 ? 0 : startIndex);
    timedTransportStateRef.current = startedState;
    setTimedTransportState(startedState);
  }, [
    deriveTimedTransportStartTarget,
    clearScheduledTimedCueCallbacks,
    getTimedTransportClockSeconds,
    recordTimedTransportDiagnostic,
    replayPausedTimedTransportCue,
    resolveTimedTransportStartIndex,
    sequencePlaybackSpeed,
    timedPlaybackBursts,
  ]);

  const handleTimedTransportStop = useCallback(() => {
    const nowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
    clearScheduledTimedCueCallbacks();
    onStopSnapshot?.();
    recordTimedTransportDiagnostic({
      type: "stop",
      clockSeconds: nowSeconds,
      elapsedSeconds: currentTimedTransportElapsedSeconds(timedTransportStateRef.current, nowSeconds),
      status: timedTransportStateRef.current.status,
    });
    const stoppedState = stopTimedTransport(timedPlaybackBursts, {
      speedMultiplier: timedTransportStateRef.current?.speedMultiplier ?? sequencePlaybackSpeed,
    });
    timedTransportStateRef.current = stoppedState;
    setTimedTransportState(stoppedState);
    restoreTimedTransportStartTarget();
  }, [
    clearScheduledTimedCueCallbacks,
    onStopSnapshot,
    recordTimedTransportDiagnostic,
    restoreTimedTransportStartTarget,
    sequencePlaybackSpeed,
    timedPlaybackBursts,
  ]);

  useEffect(() => {
    if (typeof globalThis === "undefined") return undefined;
    if (!isTimedTransportDiagnosticsEnabled()) {
      delete globalThis.__hexatoneTimedTransportDiagnostics;
      return undefined;
    }
    const api = {
      enabled: true,
      get: () => summarizeTimedTransportDiagnostics(timedTransportDiagnosticsRef.current),
      getPersisted: () => loadPersistedTimedTransportDiagnostics(),
      reset: () => {
        timedTransportDiagnosticsRef.current = resetTimedTransportDiagnostics(timedTransportDiagnosticsRef.current);
        persistTimedTransportDiagnostics(timedTransportDiagnosticsRef.current);
        return summarizeTimedTransportDiagnostics(timedTransportDiagnosticsRef.current);
      },
    };
    globalThis.__hexatoneTimedTransportDiagnostics = api;
    return () => {
      delete globalThis.__hexatoneTimedTransportDiagnostics;
    };
  }, []);

  const timedTransportUiState = useMemo(() => {
    return {
      running: timedTransportState.status === "running",
      paused: timedTransportState.status === "paused",
      canPlay: timedCueTriggers.length > 0,
      canStop: timedTransportState.status === "running" || timedTransportState.status === "paused",
    };
  }, [timedCueTriggers.length, timedTransportState.status]);

  const getTimedTransportDisplay = useCallback(() => {
    const clockSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
    const currentState = timedTransportStateRef.current;
    const runningElapsed = currentTimedTransportElapsedSeconds(currentState, clockSeconds);
    const queuedPlaybackIndex = currentState.status === "stopped" || currentState.status === "empty"
      ? resolveTimedTransportStartIndex()
      : currentState.nextPlaybackIndex >= 0
        ? Math.max(0, currentState.nextPlaybackIndex)
        : Math.max(0, timedPlaybackBurstsRef.current.length - 1);
    const queuedBurst = queuedPlaybackIndex >= 0 ? timedPlaybackBurstsRef.current[queuedPlaybackIndex] ?? null : null;
    const lastDispatchedBurst = currentState.lastDispatchedPlaybackIndex >= 0
      ? (timedPlaybackBurstsRef.current[currentState.lastDispatchedPlaybackIndex] ?? null)
      : null;
    const displaySequenceTime = (
      lastDispatchedBurst?.sequenceTime
      ?? queuedBurst?.sequenceTime
      ?? (Number(sortedBars[selectedBarIndex]?.position) || 1)
    );

    return {
      clock: formatTransportClock(runningElapsed),
      barBeat: formatTransportBarBeat(displaySequenceTime),
      tempo: describeTransportTempo?.(
        displaySequenceTime,
        currentState.speedMultiplier ?? sequencePlaybackSpeed,
      ) ?? null,
    };
  }, [
    describeTransportTempo,
    formatTransportBarBeat,
    formatTransportClock,
    resolveTimedTransportStartIndex,
    sequencePlaybackSpeed,
    selectedBarIndex,
    sortedBars,
  ]);

  return {
    timedTransportUiState,
    getTimedTransportDisplay,
    handleTimedTransportPlayPause,
    handleTimedTransportStop,
    recordTimedTransportDiagnostic,
  };
}
