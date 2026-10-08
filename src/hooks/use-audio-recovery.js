import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createAudioRecovery, saveAudioReport } from "../audio/recovery.js";
import { getPendingSuperSonicDiagnostics } from "../supersonic_synth/startup-diagnostics.js";

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
  if (settings.output_osc && settings.osc_local && !ready("supersonic")) return true;
  // A missing SoundFont needs a file selection, not an audio activation prompt.
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
  const startupFailed = useCallback((backend, error) => {
    const message = String(error.message ?? error);
    recorder.current.record("engine-startup-failed", { backend, error: message });
    setStatus(`${backend} could not start: ${message}. Save a report; you can retry.`);
  }, []);
  useEffect(() => {
    const log = recorder.current;
    let previous = new Map();
    let wasHidden = false;
    let reportedStartupErrors = "";
    const lifecycle = (event) => {
      log.record(event.type, {
        visibility: document.visibilityState,
        persisted: event.persisted ?? null,
        outputs: log.snapshot(synthRef.current),
      });
      if (document.hidden || event.type === "pagehide") {
        wasHidden = true;
        log.hide(synthRef.current);
      }
      else if (wasHidden || event.persisted) {
        wasHidden = false;
        if (log.snapshot(synthRef.current).length)
          setStatus("Audio interrupted? Tap Restore Audio if sound is missing.");
      }
      if (!document.hidden && log.needsRestore(synthRef.current) && !busy.current)
        setStatus("Audio paused while away. Tap Restore Audio.");
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
        previous = new Map();
        log.record("engines-loading", { outputs, pending: getPendingSuperSonicDiagnostics() });
        return;
      }
      const startupErrors = (engineLifecycleRef?.current?.errors ?? []).join("; ");
      if (startupErrors && startupErrors !== reportedStartupErrors) {
        reportedStartupErrors = startupErrors;
        startupFailed("Built-in audio", new Error(startupErrors));
      }
      if (log.needsRestore(synthRef.current) && !busy.current)
        setStatus("Audio paused while away. Tap Restore Audio.");
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
          // Before the first gesture, suspension is normal browser policy,
          // not an interruption requiring a recovery popup.
          if (!busy.current && !initialiseRef?.current?.needed?.())
            setStatus("Built-in audio needs attention. Tap Restore Audio.");
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
      log.cancelHide();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", lifecycle);
      window.removeEventListener("pagehide", lifecycle);
      window.removeEventListener("pageshow", lifecycle);
    };
  }, [synthRef, initialiseRef, engineLifecycleRef, startupFailed]);
  const restore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const starting = !!initialiseRef?.current?.needed?.();
    setRestoring(true);
    setStatus(starting ? "Starting audio…" : "Restoring audio…");
    try {
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
      });
      const failed = results.filter((result) => !result.ok);
      setStatus(
        startupErrors.length
          ? `Audio startup failed: ${[...new Set(startupErrors)].join("; ")}. Save a report; you can retry.`
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
    }
  }, [synthRef, keysRef, initialiseRef]);
  const save = useCallback(() => {
    const audioSettings = Object.fromEntries(
      Object.entries(settings).filter(
        ([key]) =>
          key.startsWith("output_") ||
          key.startsWith("osc_") ||
          key.startsWith("fluidsynth_") ||
          ["volume", "instrument"].includes(key),
      ),
    );
    saveAudioReport({ ...recorder.current.report(synthRef.current, audioSettings),
      pending: getPendingSuperSonicDiagnostics() });
  }, [synthRef, settings]);
  return { status, restoring, restore, save, dismiss, startupFailed,
    needsStart: () => needsInitialAudioStart(synthRef.current, settings) };
}
