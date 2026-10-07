/** Optional browser scsynth output. Reuses OSC's voice/controller implementation.
 * Owns an isolated AudioContext and engine; stale async candidates are disposed
 * by the existing output-request lifecycle. Assets are staged locally, no CDN.
 */
import { create_osc_synth } from "../osc_synth/index.js";
import { createLocalOscTransport } from "./transport.js";
import { warnLog } from "../debug/logging.js";
import { createRecoveryGate } from "../audio/recovery-gate.js";

export async function create_supersonic_synth(...args) {
  const base = new URL(`${import.meta.env.BASE_URL}supersonic/`, location.href).href;
  const { SuperSonic } = await import(/* @vite-ignore */ `${base}client/supersonic.js`);
  return createSuperSonicOutput(SuperSonic, base, args);
}

// Separate construction from asset loading so recovery can be exercised with
// a deterministic audio engine, without a real device or WASM in unit tests.
export async function createSuperSonicOutput(SuperSonic, base, args) {
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
  const wake = () => {
    if (context && context.state !== "closed") void context.resume().catch(() => {});
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("pointerdown", wake, true);
    document.removeEventListener("keydown", wake, true);
    closeCurrent();
  };
  try {
    const build = async () => {
      const ticket = ++generation;
      const nextContext = new AudioContext({ latencyHint: "interactive" });
      void nextContext.resume().catch(() => {});
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
        void nextContext.close().catch(() => {});
        throw error;
      }
      let closed = false;
      let nextGate;
      const closeNext = () => {
        if (closed) return;
        closed = true;
        nextGate?.disconnect();
        void Promise.resolve(nextSonic.destroy()).catch((error) =>
          warnLog("SuperSonic shutdown:", error),
        );
        if (nextContext.state !== "closed") void nextContext.close().catch(() => {});
      };
      let deadline;
      const expired = new Promise((_, reject) => {
        deadline = setTimeout(() => {
          if (ticket === generation) generation += 1;
          reject(new Error("SuperSonic engine initialisation timed out"));
        }, 30000);
      });
      const step = (work) => Promise.race([work, expired]);
      try {
        let failure = null;
        nextSonic.on("in", (msg) => {
          if (msg[0] === "/fail" && msg[1] === "/d_recv") failure = msg[2];
        });
        await step(nextSonic.init());
        nextGate = createRecoveryGate(nextContext, recoveryMuted);
        nextSonic.node.disconnect();
        nextSonic.node.connect(nextGate.node);
        nextSonic.send("/notify", 1);
        for (const name of args[1] ?? ["pluck", "string", "formant", "tone"]) {
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
        closeCurrent = closeNext;
        recoveryGate = nextGate;
        currentTransport = createLocalOscTransport(sonic, SuperSonic.osc.encodeBundle, () => {
          closeNext();
          if (sonic === nextSonic) dispose();
        });
        currentTransport.setTailPruning(pruning);
        closeOld();
      } catch (error) {
        closeNext();
        throw error;
      } finally {
        clearTimeout(deadline);
      }
    };
    // Restored settings may initialise before a gesture. Resume synchronously
    // from real input, alongside the composite prepare/ensureAwake hooks.
    document.addEventListener("pointerdown", wake, true);
    document.addEventListener("keydown", wake, true);
    wake();
    await build();
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
      return shutdown(options);
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
