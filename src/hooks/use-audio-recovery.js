import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createAudioRecovery, saveAudioReport } from "../audio/recovery.js";
import { getPendingSuperSonicDiagnostics } from "../supersonic_synth/startup-diagnostics.js";
import { audioRuntimeReport, recordAudioRuntime, captureInputTiming, recordEventLoopGap,
  getLatencyMeasurementEnabled, subscribeLatencyMeasurement } from "../audio/runtime-diagnostics.js";
import { blockAudioAttacks } from "../audio/attack-gate.js";
import { needsMobileBackgroundRecovery } from "../audio/background-policy.js";
import { serviceWorkerDiagnostics } from "../audio/report-environment.js";

export function needsInitialAudioStart(synth, settings = {}) {
  const outputs = (synth?.childSynths?.() ?? [synth]).filter(Boolean);
  const ready = backend => outputs.some(output => {
    if ((output.audioBackend ?? (output.family === "sample" ? "samples" : null)) !== backend) return false;
    try {
      const state = output.getAudioContext?.()?.state ?? output.getDiagnostics?.()?.audioContext?.state;
      return state === "running";
    } catch { return false; }
  });
  if (settings.output_sample && settings.instrument !== "OFF" && !ready("samples")) return true;
  if (settings.output_osc && !settings.osc_server_off && settings.osc_local && !ready("supersonic")) return true;
  // A remembered bank awaits activation/restoration, even before its worklet
  // appears in the live graph. A genuinely unselected bank needs a file picker.
  if (settings.output_fluidsynth && !outputs.some(output => output.audioBackend === "fluidsynth")) {
    try {
      if (JSON.parse(localStorage.getItem("fluidsynth_last_soundfont_source") || "null")?.name ||
          localStorage.getItem("fluidsynth_last_hosted_soundfont")) return true;
    } catch { /* Malformed or unavailable storage is not an audio engine. */ }
  }
  return !!settings.output_fluidsynth && outputs.some(output =>
    output.audioBackend === "fluidsynth" && !ready("fluidsynth"));
}

export default function useAudioRecovery(synthRef, keysRef, settings = {}, initialiseRef, engineLifecycleRef) {
  const recorder = useRef(null);
  if (!recorder.current) recorder.current = createAudioRecovery();
  const [status, setStatus] = useState("");
  const [restoring, setRestoring] = useState(false);
  const dismiss = useCallback(() => {
    recorder.current.record("alert-dismissed");
    setStatus("");
  }, []);
  const busy = useRef(false);
  const retryRequested = useRef(false);
  const startupFailed = useCallback((backend, error) => {
    const message = String(error.message ?? error);
    recorder.current.record("engine-startup-failed", { backend, error: message });
    setStatus(`${backend} could not start: ${message}. Tap Retry, or Report to save diagnostics.`);
  }, []);
  useEffect(() => {
    const log = recorder.current;
    const inputTypes = ["touchstart", "touchmove", "pointerdown", "pointermove", "mousedown", "mousemove", "keydown"];
    const capture = event => {
      if (event.type === "keydown" || event.target?.tagName === "CANVAS") captureInputTiming(event);
    };
    let heartbeatAt = performance.now();
    const heartbeatTick = () => {
      const now = performance.now();
      if (!document.hidden && now - heartbeatAt - 25 > 4)
        recordEventLoopGap(heartbeatAt + 25, now);
      heartbeatAt = now;
    };
    let heartbeat;
    let taskObserver;
    const stopLatency = () => {
      clearInterval(heartbeat);
      heartbeat = undefined;
      for (const type of inputTypes) window.removeEventListener(type, capture, true);
      taskObserver?.disconnect();
      taskObserver = undefined;
    };
    const updateLatency = () => {
      stopLatency();
      if (!getLatencyMeasurementEnabled()) return;
      heartbeatAt = performance.now();
      for (const type of inputTypes) window.addEventListener(type, capture, { capture: true, passive: true });
      heartbeat = setInterval(heartbeatTick, 25);
      if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
        taskObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) recordAudioRuntime("main-thread-long-task",
            { startTimeMs: entry.startTime, durationMs: entry.duration });
        });
        taskObserver.observe({ entryTypes: ["longtask"] });
      }
      recordAudioRuntime("latency-diagnostics-capabilities", {
        longTasks: !!taskObserver, pointerEvents: "PointerEvent" in globalThis,
      });
    };
    updateLatency();
    const unsubscribeLatency = subscribeLatencyMeasurement(updateLatency);
    let previous = new Map();
    let wasHidden = false;
    let reportedStartupErrors = "";
    const lifecycle = (event) => {
      // Background timer throttling is not foreground input-processing delay.
      heartbeatAt = performance.now();
      log.record(event.type, {
        visibility: document.visibilityState,
        persisted: event.persisted ?? null,
        outputs: log.snapshot(synthRef.current),
      });
      if (document.hidden || event.type === "pagehide") {
        wasHidden = true;
        if (event.type === "pagehide" || needsMobileBackgroundRecovery()) log.hide(synthRef.current);
      }
      else if (wasHidden || event.persisted) {
        wasHidden = false;
        if (needsMobileBackgroundRecovery() && log.snapshot(synthRef.current).length)
          setStatus("Audio may have been interrupted. Tap Retry if sound is missing.");
        else if (log.snapshot(synthRef.current).some(output =>
          ["suspended", "interrupted", "closed"].includes(
            (output.audioContext ?? output.engine?.audioContext)?.state)))
          setStatus("Audio paused while away. Tap Retry to resume.");
      }
      if (!document.hidden && log.needsRestore(synthRef.current) && !busy.current)
        setStatus("Audio paused while away. Tap Retry to resume.");
    };
    document.addEventListener("visibilitychange", lifecycle);
    window.addEventListener("pagehide", lifecycle);
    window.addEventListener("pageshow", lifecycle);
    const timer = setInterval(() => {
      if (document.hidden) {
        previous = new Map();
        return;
      }
      const outputs = log.snapshot(synthRef.current);
      if (engineLifecycleRef?.current?.loading) {
        log.record("engines-loading", { outputs, pending: getPendingSuperSonicDiagnostics(),
          pendingImports: audioRuntimeReport().pendingImports });
      }
      const startupErrors = (engineLifecycleRef?.current?.errors ?? []).join("; ");
      if (startupErrors && startupErrors !== reportedStartupErrors) {
        reportedStartupErrors = startupErrors;
        startupFailed("Built-in audio", new Error(startupErrors));
      }
      if (log.needsRestore(synthRef.current) && !busy.current)
        setStatus("Audio paused while away. Tap Retry to resume.");
      const next = new Map();
      for (const output of outputs) {
        const context = output.audioContext ?? output.engine?.audioContext;
        if (!context) continue;
        const last = previous.get(`${output.backend}:${output.contextId}`);
        const processCount = output.engine?.metrics?.engineProcessCount;
        const stalled =
          context.state === "running" &&
          last?.state === "running" &&
          context.currentTime === last.currentTime;
        const rendererStalled =
          context.state === "running" &&
          last?.state === "running" && Number.isFinite(processCount) &&
          last?.processCount === processCount;
        next.set(`${output.backend}:${output.contextId}`, { ...context, processCount });
        if (
          stalled ||
          rendererStalled ||
          output.processorFailed ||
          ["interrupted", "closed"].includes(context.state) ||
          (context.state === "suspended" && last?.state === "running")
        ) {
          const children = synthRef.current?.getRecoveryOutputs?.() ?? synthRef.current?.childSynths?.() ?? [synthRef.current];
          for (const child of children) {
            if ((child?.audioBackend ?? (child?.family === "sample" ? "samples" : null)) === output.backend)
              blockAudioAttacks(child.getAudioContext?.());
          }
          // Before the first gesture, suspension is normal browser policy,
          // not an interruption requiring a recovery popup.
          if (!busy.current && !initialiseRef?.current?.needed?.())
            setStatus("Built-in audio needs attention.");
          log.record("audio-needs-attention", {
            backend: output.backend,
            context,
            stalled,
            rendererStalled,
          });
        }
      }
      previous = next;
      log.record("sample", { outputs });
    }, 2000);
    return () => {
      unsubscribeLatency();
      stopLatency();
      log.cancelHide();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", lifecycle);
      window.removeEventListener("pagehide", lifecycle);
      window.removeEventListener("pageshow", lifecycle);
    };
  }, [synthRef, initialiseRef, engineLifecycleRef, startupFailed]);
  const restore = useCallback(async ({ forceRecreate = false } = {}) => {
    if (busy.current) {
      // Serialize retries: concurrent context/worklet replacements can orphan
      // voices. Repeated taps coalesce into one fresh attempt, not a no-op.
      retryRequested.current = true;
      setStatus("Retry requested… Waiting for the current audio attempt to finish.");
      return;
    }
    busy.current = true;
    const starting = !!initialiseRef?.current?.needed?.();
    setRestoring(true);
    setStatus(starting ? "Starting audio…" : "Restoring audio…");
    try {
      keysRef.current?.recoverCanvas?.();
      let startupErrors = [];
      if (initialiseRef?.current &&
          (!recorder.current.snapshot(synthRef.current).length || initialiseRef.current.needed?.())) {
        recorder.current.record("audio-initialisation-start");
        let timer;
        const controller = new AbortController();
        try {
          const result = await Promise.race([
            initialiseRef.current(controller.signal),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                reject(new Error("Audio initialisation timed out"));
                controller.abort();
              }, 45000);
            }),
          ]);
          recorder.current.record("audio-initialisation-result", {
            ...result,
            outputs: recorder.current.snapshot(synthRef.current),
          });
          startupErrors = result?.errors?.map((entry) => entry.error) ?? [];
        } finally {
          clearTimeout(timer);
        }
      }
      // Initial preparation already wakes/builds the enabled outputs. Do not
      // immediately cycle those fresh contexts as though they had interrupted.
      const results = starting ? [] : await recorder.current.restore(synthRef.current, {
        releaseNotes: () => keysRef.current?.releaseActiveBrowserNotes?.(),
        forceRecreate,
      });
      const failed = results.filter((result) => !result.ok);
      const recoveredBackends = starting
        ? recorder.current.snapshot(synthRef.current).filter(output =>
          output.audioContext?.state === "running").map(output => output.backend)
        : results.filter(result => result.ok).map(result => result.backend);
      keysRef.current?.rejoinRecoveredAudio?.(recoveredBackends);
      setStatus(
        startupErrors.length
          ? `Audio startup failed: ${[...new Set(startupErrors)].join("; ")}. Tap Retry, or Report to save diagnostics.`
          : failed.length
          ? `Could not restore ${failed.map((result) => result.backend).join(", ")}. Retry?`
          : "Audio engines restored. Try a note; if silent, save a diagnostic report.",
      );
    } catch (error) {
      recorder.current.record("recovery-error", { error: String(error.message ?? error) });
      setStatus(`Audio recovery failed: ${error.message ?? error}. Retry?`);
    } finally {
      busy.current = false;
      setRestoring(false);
      if (retryRequested.current) {
        retryRequested.current = false;
        void restore();
      }
    }
  }, [synthRef, keysRef, initialiseRef]);
  const save = useCallback(async () => {
    const audioSettings = Object.fromEntries(
      Object.entries(settings).filter(
        ([key]) =>
          key.startsWith("output_") ||
          key.startsWith("osc_") ||
          key.startsWith("fluidsynth_") ||
          ["volume", "instrument"].includes(key),
      ),
    );
    const report = { ...recorder.current.report(synthRef.current, audioSettings),
      canvas: keysRef.current?.getCanvasDiagnostics?.() ?? null,
      pending: getPendingSuperSonicDiagnostics() };
    report.serviceWorker = await serviceWorkerDiagnostics();
    saveAudioReport(report);
  }, [synthRef, keysRef, settings]);
  return { status, restoring, restore, save, dismiss, startupFailed,
    needsStart: () => needsInitialAudioStart(synthRef.current, settings) };
}
