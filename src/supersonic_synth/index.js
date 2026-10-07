/** Optional browser scsynth output. Reuses OSC's voice/controller implementation.
 * Owns an isolated AudioContext and engine; stale async candidates are disposed
 * by the existing output-request lifecycle. Assets are staged locally, no CDN.
 */
import { create_osc_synth } from "../osc_synth/index.js";
import { createLocalOscTransport } from "./transport.js";
import { warnLog } from "../debug/logging.js";
import { createRecoveryGate } from "../audio/recovery-gate.js";
import { pendingSuperSonicStartups as pendingStartups } from "./startup-diagnostics.js";
export { getPendingSuperSonicDiagnostics } from "./startup-diagnostics.js";

const liveOutputs = new Set();
export function disposeSuperSonicOutputs() {
  for (const dispose of [...liveOutputs]) dispose();
}
if (import.meta.hot) {
  import.meta.hot.dispose(disposeSuperSonicOutputs);
  import.meta.hot.on("vite:beforeFullReload", disposeSuperSonicOutputs);
}

export async function create_supersonic_synth(...args) {
  const signal = args[10]?.signal;
  signal?.throwIfAborted();
  const base = new URL(`${import.meta.env.BASE_URL}supersonic/`, location.href).href;
  const { SuperSonic } = await import(/* @vite-ignore */ `${base}client/supersonic.js`);
  signal?.throwIfAborted();
  return createSuperSonicOutput(SuperSonic, base, args);
}

// Separate construction from asset loading so recovery can be exercised with
// a deterministic audio engine, without a real device or WASM in unit tests.
export async function createSuperSonicOutput(SuperSonic, base, args) {
  const signal = args[10]?.signal;
  signal?.throwIfAborted();
  let sonic;
  let context;
  let disposed = false;
  let stopping = false;
  let rebuilding = null;
  let generation = 0;
  let currentTransport;
  let pruning = 0;
  let recoveryGate;
  let recoveryMuted = false;
  let closeCurrent = () => {};
  const pendingCloses = new Set();
  const pendingContexts = new Set();
  let phase = "creating-context";
  let gestureAt = null;
  const startupSince = performance.now();
  const startupDiagnostic = () => ({ backend: "supersonic", version: "0.88", phase,
    elapsedMs: performance.now() - startupSince,
    gestureReceived: gestureAt != null,
    contexts: [...pendingContexts].map((candidate) => ({ state: candidate.state, currentTime: candidate.currentTime })),
  });
  pendingStartups.add(startupDiagnostic);
  const wake = () => {
    if (gestureAt == null) gestureAt = performance.now();
    for (const candidate of new Set([context, ...pendingContexts])) {
      if (candidate && candidate.state !== "closed") void candidate.resume().catch(() => {});
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopping = true;
    generation += 1;
    liveOutputs.delete(dispose);
    pendingStartups.delete(startupDiagnostic);
    signal?.removeEventListener("abort", dispose);
    window.removeEventListener("beforeunload", dispose);
    document.removeEventListener("pointerdown", wake, true);
    document.removeEventListener("keydown", wake, true);
    closeCurrent();
    for (const close of pendingCloses) close();
  };
  liveOutputs.add(dispose);
  signal?.addEventListener("abort", dispose, { once: true });
  window.addEventListener("beforeunload", dispose);
  try {
    const build = async () => {
      const ticket = ++generation;
      const nextContext = new AudioContext({ latencyHint: "interactive" });
      pendingContexts.add(nextContext);
      void nextContext.resume().catch(() => {});
      // A hard recovery must release the previous WASM engine before allocating
      // another one. Context activation above still begins on the user gesture.
      await closeCurrent();
      if (disposed || stopping) {
        pendingContexts.delete(nextContext);
        await nextContext.close();
        throw new Error("SuperSonic output is shutting down");
      }
      let nextSonic;
      try {
        nextSonic = new SuperSonic({
        baseURL: `${base}client/`,
        coreBaseURL: `${base}core/`,
        mode: "postMessage",
        audioContext: nextContext,
        scsynthOptions: { maxNodes: 4096, realTimeMemorySize: 64 * 1024 },
        });
      } catch (error) {
        // Constructor allocation can fail before normal engine cleanup exists.
        pendingContexts.delete(nextContext);
        await nextContext.close().catch(() => {});
        throw error;
      }
      let closed = false;
      let closing;
      let nextGate;
      let nextTransport;
      const closeNext = () => {
        if (closed) return closing;
        closed = true;
        pendingCloses.delete(closeNext);
        pendingContexts.delete(nextContext);
        nextGate?.disconnect();
        const purge = nextTransport?.pendingPurge();
        const destroying = (purge ? Promise.resolve(purge) : Promise.resolve())
          .then(() => nextSonic.destroy()).catch((error) =>
          warnLog("SuperSonic shutdown:", error),
        );
        const closingContext = nextContext.state !== "closed" ? nextContext.close().catch(() => {}) : Promise.resolve();
        closing = Promise.all([destroying, closingContext]);
        return closing;
      };
      pendingCloses.add(closeNext);
      let deadline;
      // Initial iOS/private-browser activation may be blocked until another
      // gesture. NTPTiming requires a running clock; do not start its timeout
      // while waiting for browser permission. Hard recovery remains bounded.
      try {
        phase = "waiting-for-context";
        const waitingSince = performance.now();
        while (nextContext.state !== "running") {
          if (disposed || stopping || ticket !== generation || nextContext.state === "closed")
            throw new Error("SuperSonic recovery superseded");
          const activeWaitSince = context ? waitingSince : gestureAt;
          if (activeWaitSince != null && performance.now() - activeWaitSince > 30000)
            throw new Error(`SuperSonic audio context did not resume (${nextContext.state})`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (error) {
        await closeNext();
        throw error;
      }
      const expired = new Promise((_, reject) => {
        deadline = setTimeout(() => {
          if (ticket === generation) generation += 1;
          reject(new Error("SuperSonic engine initialisation timed out"));
        }, 30000);
      });
      const step = async (work) => {
        let abort;
        const cancellation = new Promise((_, reject) => {
          abort = () => reject(new Error("SuperSonic startup cancelled"));
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        });
        try {
          const result = await Promise.race([work, expired, cancellation]);
          if (disposed || stopping || ticket !== generation)
            throw new Error("SuperSonic recovery superseded");
          return result;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      };
      try {
        let failure = null;
        nextSonic.on("in", (msg) => {
          if (msg[0] === "/fail" && msg[1] === "/d_recv") failure = msg[2];
        });
        phase = "initialising-engine";
        await step(nextSonic.init());
        nextGate = createRecoveryGate(nextContext, recoveryMuted);
        nextSonic.node.disconnect();
        nextSonic.node.connect(nextGate.node);
        nextSonic.send("/notify", 1);
        for (const name of args[1] ?? ["pluck", "string", "formant", "tone"]) {
          phase = `loading-synthdef:${name}`;
          if (!["pluck", "string", "formant", "tone"].includes(name))
            throw new Error(`Local SuperSonic does not include SynthDef ${name}`);
          failure = null;
          await step(nextSonic.loadSynthDef(`${base}synthdefs/hexlab_${name}.scsyndef`));
          await step(nextSonic.sync());
          if (failure) throw new Error(failure);
        }
        if (disposed || stopping || ticket !== generation)
          throw new Error("SuperSonic recovery superseded");
        const closeOld = closeCurrent;
        sonic = nextSonic;
        context = nextContext;
        pendingContexts.delete(nextContext);
        closeCurrent = closeNext;
        recoveryGate = nextGate;
        currentTransport = createLocalOscTransport(sonic, SuperSonic.osc.encodeBundle, () => {
          closeNext();
          if (sonic === nextSonic) dispose();
        });
        nextTransport = currentTransport;
        currentTransport.setTailPruning(pruning);
        closeOld();
      } catch (error) {
        await closeNext();
        throw error;
      } finally {
        clearTimeout(deadline);
      }
    };
    // Restored settings may initialise before a gesture. Resume synchronously
    // from real input, alongside the composite prepare/ensureAwake hooks.
    document.addEventListener("pointerdown", wake, true);
    document.addEventListener("keydown", wake, true);
    // Passive page startup is allowed to wait for browser permission. Only
    // an actual pointer/key gesture starts the context-activation deadline.
    await build();
    phase = "ready";
    pendingStartups.delete(startupDiagnostic);
    signal?.removeEventListener("abort", dispose);
    // Stable transport keeps the OSC voice implementation and live fader values.
    const transport = {
      send: (...values) => currentTransport.send(...values),
      cancelScheduled: (...values) => currentTransport.cancelScheduled(...values),
      release: (...values) => currentTransport.release(...values),
      _flushBundles: () => currentTransport._flushBundles(),
      prepare: () => context.resume(),
      getDiagnostics: () => currentTransport.getDiagnostics(),
      setTailPruning: (value) => {
        pruning = value;
        currentTransport.setTailPruning(value);
      },
    };
    args[10] = { ...args[10], transport };
    const synth = await create_osc_synth(...args);
    synth.audioBackend = "supersonic";
    synth.getAudioContext = () => context;
    synth.muteForRecovery = (durationMs) => { recoveryMuted = true; return recoveryGate?.mute(durationMs); };
    synth.fadeAfterRecovery = () => { recoveryMuted = false; return recoveryGate?.fadeIn(); };
    synth.clearRecoveryEvents = async () => {
      await currentTransport.cancelScheduled();
      if (currentTransport.getDiagnostics().transport?.closed) throw new Error("SuperSonic purge failed");
    };
    const diagnostics = synth.getDiagnostics;
    synth.getDiagnostics = () => ({
      ...diagnostics(),
      audioContext: {
        state: context?.state,
        currentTime: context?.currentTime,
        sampleRate: context?.sampleRate,
        baseLatency: context?.baseLatency,
      },
    });
    const shutdown = synth.shutdown;
    synth.shutdown = (options) => {
      stopping = true;
      document.removeEventListener("pointerdown", wake, true);
      document.removeEventListener("keydown", wake, true);
      try { return shutdown(options); }
      finally { if (options?.panic) dispose(); }
    };
    synth.forceAudioRebuild = () => {
      if (stopping) return Promise.reject(new Error("SuperSonic output is shutting down"));
      if (rebuilding) return rebuilding;
      // Do not wait for a stale engine's purge acknowledgement.
      rebuilding = build().finally(() => {
        rebuilding = null;
      });
      return rebuilding;
    };
    return synth;
  } catch (error) {
    dispose();
    throw new Error(`SuperSonic could not start: ${error.message}`, { cause: error });
  }
}
