/** Assembles the built-in FluidSynth voice adapter and its audio lifecycle. */
import { createInternalVoiceSynth } from "./voices.js";
import { smoothOutputToggle } from "../audio/output-toggle.js";
import {
  ensureFluidSynthEngineAwake,
  forceFluidSynthEngineRebuild,
  getFluidSynthAudioDiagnostics,
  getFluidSynthAudioContext,
  resumeFluidSynthAfterAudioRestart,
  muteFluidSynthForRecovery,
  fadeFluidSynthAfterRecovery,
  prepareFluidSynthOutput,
  clearFluidSynthRecoveryEvents,
  peekFluidSynthEngine,
} from "./index.js";

// Serialize replacement against the previous adapter's fade and channel cleanup.
let internalOutputShutdown = Promise.resolve();

export async function createFluidSynth({ outputMode, tuningContext }) {
  await internalOutputShutdown;
  await prepareFluidSynthOutput();
  const synth = createInternalVoiceSynth({ outputMode, tuningContext,
    ensureAwake: ensureFluidSynthEngineAwake, forceAudioRebuild: forceFluidSynthEngineRebuild });
  synth.audioBackend = "fluidsynth";
  synth.usesSharedAudioContext = true;
  synth.getAudioContext = getFluidSynthAudioContext;
  synth.resumeAfterAudioRestart = resumeFluidSynthAfterAudioRestart;
  synth.muteForRecovery = muteFluidSynthForRecovery;
  synth.fadeAfterRecovery = (...args) => {
    if (!synth.isOutputPaused?.()) return fadeFluidSynthAfterRecovery(...args);
  };
  synth.clearRecoveryEvents = clearFluidSynthRecoveryEvents;
  synth.getDiagnostics = getFluidSynthAudioDiagnostics;
  // A retired wrapper must never mute a newly loaded FluidSynth instance.
  const ownsEngine = () => peekFluidSynthEngine()?.output === outputMode.output;
  smoothOutputToggle(synth, { mute: (...args) => {
    if (ownsEngine()) return muteFluidSynthForRecovery(...args);
  },
  fadeIn: () => {
    if (ownsEngine()) return fadeFluidSynthAfterRecovery({ fromCurrent: true, durationMs: 40 });
  }, keepWarm: true });
  const shutdown = synth.shutdown;
  synth.shutdown = (options) => {
    const pending = shutdown(options);
    internalOutputShutdown = Promise.resolve(pending);
    return pending;
  };
  return synth;
}
