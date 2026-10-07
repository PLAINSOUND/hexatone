import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createAudioRecovery, saveAudioReport } from "../audio/recovery.js";

export default function useAudioRecovery(synthRef, keysRef, settings = {}, initialiseRef) {
  const recorder = useRef(null);
  if (!recorder.current) recorder.current = createAudioRecovery();
  const [status, setStatus] = useState("");
  const [restoring, setRestoring] = useState(false);
  const dismiss = useCallback(() => {
    recorder.current.record("alert-dismissed");
    setStatus("");
  }, []);
  const busy = useRef(false);
  useEffect(() => {
    const log = recorder.current;
    let previous = new Map();
    let wasHidden = false;
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
      if (log.needsRestore(synthRef.current) && !busy.current)
        setStatus("Audio paused while away. Tap Restore Audio.");
      const next = new Map();
      for (const output of outputs) {
        const context = output.audioContext ?? output.engine?.audioContext;
        if (!context) continue;
        const last = previous.get(output.backend);
        const processCount = output.engine?.metrics?.engineProcessCount;
        const stalled =
          context.state === "running" &&
          last?.state === "running" &&
          context.currentTime === last.currentTime;
        const rendererStalled =
          context.state === "running" &&
          Number.isFinite(processCount) &&
          last?.processCount === processCount;
        next.set(output.backend, { ...context, processCount });
        if (
          stalled ||
          rendererStalled ||
          output.processorFailed ||
          ["suspended", "interrupted", "closed"].includes(context.state)
        ) {
          if (!busy.current) setStatus("Built-in audio needs attention. Tap Restore Audio.");
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
  }, [synthRef]);
  const restore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRestoring(true);
    setStatus("Restoring audio…");
    try {
      if (!recorder.current.snapshot(synthRef.current).length && initialiseRef?.current) {
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
        } finally {
          clearTimeout(timer);
        }
      }
      const results = await recorder.current.restore(synthRef.current, {
        releaseNotes: () => keysRef.current?.releaseActiveBrowserNotes?.(),
      });
      const failed = results.filter((result) => !result.ok);
      setStatus(
        failed.length
          ? `Could not restore ${failed.map((result) => result.backend).join(", ")}. Save a diagnostic report; you can retry.`
          : "Audio engines restored. Try a note; if silent, save a diagnostic report.",
      );
    } catch (error) {
      recorder.current.record("recovery-error", { error: String(error.message ?? error) });
      setStatus("Audio recovery failed. Save a diagnostic report; you can retry.");
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
    saveAudioReport(recorder.current.report(synthRef.current, audioSettings));
  }, [synthRef, settings]);
  return { status, restoring, restore, save, dismiss };
}
