// Session-only, bounded diagnostics. Never include audio assets or MIDI traffic.
import { restartAudioContext, verifyAudioClock } from "./restart-context.js";
export function createAudioRecovery({ timeoutMs = 45000, historyLimit = 180 } = {}) {
  const startedAt = new Date().toISOString();
  const history = [];
  let pending = null;
  let hideTimer;
  const mutedOutputs = new Set();
  const contextIds = new WeakMap();
  let nextContextId = 0;
  const record = (name, detail = {}) => {
    history.push({ at: new Date().toISOString(), name, ...detail });
    if (history.length > historyLimit) history.shift();
  };
  const outputs = (synth) =>
    (synth?.childSynths?.() ?? [synth]).filter(
      (s) => s && (s.family === "sample" || s.audioBackend),
    );
  const snapshot = (synth) =>
    outputs(synth).map((s) => {
      try {
        const context = s.getAudioContext?.();
        if (context && !contextIds.has(context)) contextIds.set(context, ++nextContextId);
        return { backend: s.audioBackend ?? "samples", ...s.getDiagnostics?.(),
          contextId: context ? contextIds.get(context) : null };
      } catch (error) {
        return { backend: s.audioBackend ?? "samples", error: String(error.message ?? error) };
      }
    });
  const run = async (s, action, restart) => {
    const backend = s.audioBackend ?? "samples";
    record("recovery-start", { backend });
    let timer;
    try {
      // Invoke before awaiting: independent engines receive the original gesture.
      const work = (async () => {
        let reused = false;
        if (restart) {
          try {
            await restart;
            await (s.resumeAfterAudioRestart ?? s.ensureAwake ?? s.prepare)?.call(s);
            await verifyAudioClock(s.getAudioContext());
            record("existing-context-recovered", { backend });
            reused = true;
          } catch (error) {
            record("existing-context-restart-failed", {
              backend,
              error: String(error.message ?? error),
            });
          }
        }
        if (!reused) {
          await action.call(s);
          if (s.getAudioContext) await verifyAudioClock(s.getAudioContext());
        }
        record("recovery-clock-verified", { backend });
        const cleared = await s.clearRecoveryEvents?.();
        record("recovery-events-cleared", {
          backend,
          droppedEvents: cleared?.droppedEvents ?? null,
        });
        const context = s.getAudioContext?.();
        if (context) {
          const drainMs = Math.max(120, Math.ceil(((context.baseLatency ?? 0) + (context.outputLatency ?? 0)) * 1000));
          await new Promise((resolve) => setTimeout(resolve, drainMs));
          await verifyAudioClock(context);
          record("recovery-silent-drain", { backend, durationMs: drainMs });
        }
      })();
      await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Audio recovery timed out")), timeoutMs);
        }),
      ]);
      const diagnostic = s.getDiagnostics?.();
      const context = diagnostic?.audioContext ?? diagnostic?.engine?.audioContext;
      if (context?.state && context.state !== "running") {
        throw new Error(`AudioContext is ${context.state} after recovery`);
      }
      const result = { backend, ok: true };
      const outputRoute = s.fadeAfterRecovery?.();
      mutedOutputs.delete(s);
      if (outputRoute) record("recovery-output-reconnected", { backend, ...outputRoute });
      record("recovery-fade-in", { backend, durationMs: 80 });
      record("recovery-result", result);
      return result;
    } catch (error) {
      const result = { backend, ok: false, error: String(error.message ?? error) };
      record("recovery-result", result);
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    record,
    snapshot,
    needsRestore(synth) {
      return outputs(synth).some((child) => mutedOutputs.has(child));
    },
    hide(synth) {
      clearTimeout(hideTimer);
      const children = outputs(synth);
      for (const child of children) {
        try {
          const route = child.muteForRecovery?.(40);
          if (child.muteForRecovery) mutedOutputs.add(child);
          record("hide-fade-out", { backend: child.audioBackend ?? "samples", ...route });
        } catch (error) {
          record("hide-fade-error", { error: String(error.message ?? error) });
        }
      }
      // Best effort: iOS may freeze both rendering and timers before this runs.
      hideTimer = setTimeout(() => {
        for (const child of children) {
          try {
            child.muteForRecovery?.();
            child.allSoundOff?.();
            Promise.resolve(child.clearRecoveryEvents?.()).then(
              (result) => record("hide-events-cleared", { backend: child.audioBackend ?? "samples", droppedEvents: result?.droppedEvents ?? null }),
              (error) => record("hide-cleanup-error", { error: String(error.message ?? error) }),
            );
          } catch (error) {
            record("hide-cleanup-error", { error: String(error.message ?? error) });
          }
        }
      }, 40);
    },
    cancelHide() {
      clearTimeout(hideTimer);
    },
    restore(synth, { releaseNotes } = {}) {
      clearTimeout(hideTimer);
      if (pending) return pending;
      const children = outputs(synth);
      record("before-recovery", { outputs: snapshot(synth) });
      if (!children.length) {
        const result = {
          backend: "built-in audio",
          ok: false,
          error: "No active audio engines were found",
        };
        record("recovery-result", result);
        return Promise.resolve([result]);
      }
      for (const child of children) {
        const outputRoute = child.muteForRecovery?.();
        if (outputRoute)
          record("recovery-output-disconnected", {
            backend: child.audioBackend ?? "samples",
            ...outputRoute,
          });
        record("recovery-muted", { backend: child.audioBackend ?? "samples" });
      }
      releaseNotes?.();
      for (const child of children) {
        try {
          child.allSoundOff?.();
        } catch (error) {
          record("silence-error", {
            backend: child.audioBackend ?? "samples",
            error: String(error.message ?? error),
          });
        }
      }
      const restarts = new Map();
      const restartFor = (s) => {
        const context = s.getAudioContext?.();
        if (!context) return null;
        if (!restarts.has(context)) {
          const restart = restartAudioContext(context);
          // Shared FluidSynth processing may be reached after sample recovery.
          // Handle rejection now, while retaining it for that backend's result.
          restart.catch(() => {});
          restarts.set(context, restart);
        }
        return restarts.get(context);
      };
      const restartBySynth = new Map(children.map((s) => [s, restartFor(s)]));
      const samples = children.filter((s) => s.family === "sample");
      const independent = children.filter(
        (s) => s.audioBackend !== "fluidsynth" && s.family !== "sample",
      );
      const sampleWork = Promise.all(
        samples.map((s) =>
          run(s, s.forceAudioRebuild ?? s.ensureAwake ?? s.prepare, restartBySynth.get(s)),
        ),
      );
      const otherWork = independent.map((s) =>
        run(s, s.forceAudioRebuild ?? s.ensureAwake ?? s.prepare, restartBySynth.get(s)),
      );
      // FluidSynth shares the sample context; rebind after its owner replaces it.
      const fluidWork = sampleWork.then(() =>
        Promise.all(
          children
            .filter((s) => s.audioBackend === "fluidsynth")
            .map((s) => run(s, s.forceAudioRebuild ?? s.ensureAwake, restartBySynth.get(s))),
        ),
      );
      pending = Promise.all([sampleWork, Promise.all(otherWork), fluidWork])
        .then((groups) => {
          record("after-recovery", { outputs: snapshot(synth) });
          return groups.flat();
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    report(synth, settings = {}) {
      return {
        schema: "hexatone-audio-recovery/v1",
        startedAt,
        exportedAt: new Date().toISOString(),
        browser: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints,
          crossOriginIsolated: globalThis.crossOriginIsolated,
        },
        settings,
        outputs: snapshot(synth),
        events: [...history],
        note: "Context state and clock progress do not prove audible speaker output.",
      };
    },
  };
}

export function saveAudioReport(report) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `hexatone-audio-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
