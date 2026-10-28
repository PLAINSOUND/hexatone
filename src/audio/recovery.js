// Session-only, bounded diagnostics. Never include audio assets or MIDI traffic.
import { restartAudioContext, verifyAudioClock } from "./restart-context.js";
import { audioRuntimeReport } from "./runtime-diagnostics.js";
import { blockAudioAttacks, allowAudioAttacks } from "./attack-gate.js";
import { buildDiagnostics, playbackClockDiagnostics } from "./report-environment.js";
import { recoverSharedAudioContext } from "../sample_synth/prime-shared-audio.js";
export function createAudioRecovery({ timeoutMs = 45000, historyLimit = 180,
  recoverSharedContext = recoverSharedAudioContext } = {}) {
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
    (synth?.getRecoveryOutputs?.() ?? synth?.childSynths?.() ?? [synth]).filter(
      (s) => s && (s.family === "sample" || s.audioBackend),
    );
  const snapshot = (synth) =>
    outputs(synth).map((s) => {
      try {
        const context = s.getAudioContext?.();
        if (context && !contextIds.has(context)) contextIds.set(context, ++nextContextId);
        return { backend: s.audioBackend ?? "samples", ...s.getDiagnostics?.(),
          contextId: context ? contextIds.get(context) : null,
          playbackClock: playbackClockDiagnostics(context) };
      } catch (error) {
        return { backend: s.audioBackend ?? "samples", error: String(error.message ?? error) };
      }
    });
  const run = async (s, action, restart, { restartOnly = false } = {}) => {
    const backend = s.audioBackend ?? "samples";
    const originalContext = restartOnly ? s.getAudioContext?.() : null;
    record("recovery-start", { backend });
    let timer;
    try {
      // Invoke before awaiting: independent engines receive the original gesture.
      const work = (async () => {
        let reused = false;
        let cleared;
        if (restart) {
          try {
            await restart;
            // Diagnostic cycling must not enter a backend preparation path:
            // those may replace a processor or reload its SoundFont.
            if (!restartOnly)
              await (s.resumeAfterAudioRestart ?? s.ensureAwake ?? s.prepare)?.call(s);
            if (restartOnly && s.getAudioContext?.() !== originalContext)
              throw new Error("AudioContext changed during diagnostic suspend/resume");
            await verifyAudioClock(s.getAudioContext());
            await verifyEngineProgress(s);
            // A moving context clock cannot prove that its worklet responds.
            // Failure here must enter the rebuild path, not just fail Retry.
            cleared = await s.clearRecoveryEvents?.();
            record("existing-context-recovered", { backend });
            reused = true;
          } catch (error) {
            record("existing-context-restart-failed", {
              backend,
              error: String(error.message ?? error),
            });
            if (restartOnly) throw error;
          }
        }
        if (!reused) {
          if (restartOnly) throw new Error("No existing AudioContext is available to suspend and resume");
          await action.call(s);
          if (s.getAudioContext) await verifyAudioClock(s.getAudioContext());
          await verifyEngineProgress(s);
        }
        record("recovery-clock-verified", { backend });
        if (!reused) cleared = await s.clearRecoveryEvents?.();
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
        blockAudioAttacks(child.getAudioContext?.());
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
    restore(synth, { releaseNotes, forceRecreate = false, restartOnly = false } = {}) {
      if (forceRecreate && restartOnly) throw new Error("Diagnostic suspend/resume cannot replace audio contexts");
      clearTimeout(hideTimer);
      if (pending) return pending;
      const children = outputs(synth);
      record("before-recovery", { forceRecreate, restartOnly, outputs: snapshot(synth) });
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
        blockAudioAttacks(child.getAudioContext?.());
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
        if (forceRecreate) return null;
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
      const rebuild = s => forceRecreate
        ? () => s.forceAudioRebuild({ forceRecreate: true })
        : s.forceAudioRebuild ?? s.ensureAwake ?? s.prepare;
      const samples = children.filter((s) => s.family === "sample");

      const dependents = children.filter(
        (s) => s.usesSharedAudioContext && s.family !== "sample",
      );

      const independent = children.filter(
        (s) => !s.usesSharedAudioContext && s.family !== "sample",
      );
      let sharedContextWork;
      const shared = [...samples, ...dependents];
      if (forceRecreate && shared.length) {
        // Start in the original gesture. One replacement is shared by all
        // engines, including a graph containing only a worklet backend.
        let timer;
        let contextWork;
        record("shared-context-recovery-start");
        try {
          contextWork = recoverSharedContext({ forceRecreate: true });
        } catch (error) {
          contextWork = Promise.reject(error);
        }
        sharedContextWork = Promise.race([
          contextWork,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Shared audio context recovery timed out")), timeoutMs);
          }),
        ]).then(context => {
          if (!context || context.state !== "running")
            throw new Error(`Shared AudioContext is ${context?.state ?? "unavailable"} after recovery`);
          blockAudioAttacks(context);
          record("shared-context-recovered");
          return context;
        }).finally(() => clearTimeout(timer));
      }
      const recoverSharedEngine = s => run(s, async () => {
        const context = await sharedContextWork;
        await s.forceAudioRebuild({ sharedContext: context });
        if (s.getAudioContext && s.getAudioContext() !== context)
          throw new Error("Audio engine did not adopt the recovered shared context");
      });
      const sampleWork = Promise.all(
        samples.map((s) =>
          sharedContextWork ? recoverSharedEngine(s) : run(s, rebuild(s), restartBySynth.get(s), { restartOnly }),
        ),
      );
      const otherWork = independent.map((s) =>
        run(s, rebuild(s), restartBySynth.get(s), { restartOnly }),
      );
      // Automatic recovery retains the existing sample-first handoff. Explicit
      // replacement lets every engine rebind independently to the same context.
      const dependentWork = (sharedContextWork ? Promise.resolve() : sampleWork).then(() =>
        Promise.all(
          dependents.map((s) =>
            sharedContextWork ? recoverSharedEngine(s) : run(s, rebuild(s), restartBySynth.get(s), { restartOnly }),
          ),
        ),
      );
      pending = Promise.all([sampleWork, Promise.all(otherWork), dependentWork])
        .then((groups) => {
          const results = groups.flat();
          for (const child of children) {
            const context = child.getAudioContext?.();
            const siblings = children.filter(s => s.getAudioContext?.() === context);
            if (siblings.every(s => results.some(result =>
              result.backend === (s.audioBackend ?? "samples") && result.ok)))
              allowAudioAttacks(context);
          }
          record("after-recovery", { outputs: snapshot(synth) });
          return results;
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
        build: buildDiagnostics(),
        browser: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints,
          crossOriginIsolated: globalThis.crossOriginIsolated,
        },
        settings,
        outputs: snapshot(synth),
        events: [...history],
        runtime: audioRuntimeReport(),
        note: "Context state and clock progress do not prove audible speaker output.",
      };
    },
  };
}

export async function verifyEngineProgress(synth, timeoutMs = 1200) {
  const count = () => synth.getDiagnostics?.()?.engine?.metrics?.engineProcessCount;
  const initial = count();
  if (!Number.isFinite(initial)) return;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 50));
    if (count() > initial) return;
  }
  throw new Error("Audio engine processing did not advance despite its context clock");
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
