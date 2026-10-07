/**
 * sample_synth/prime-shared-audio.js
 *
 * Tiny lazy wrapper around the sample synth's shared AudioContext priming.
 * App-level callers can wake audio without statically importing the full
 * browser sample synth implementation into the main bundle.
 */

let sampleSynthModulePromise = null;
let sampleSynthModule = null;

async function loadSampleSynthModule() {
  sampleSynthModulePromise ??= import("./index.js").then(module => {
    sampleSynthModule = module;
    return module;
  });
  return sampleSynthModulePromise;
}

export async function primeSharedSampleAudio() {
  const { primeSharedSampleAudio: prime } = await loadSampleSynthModule();
  return prime();
}

export function recoverSharedAudioContext(options) {
  // Once audio has been used, context replacement/resume must start in the
  // gesture itself, before an await or dynamic import can lose activation.
  if (sampleSynthModule) return sampleSynthModule.recoverSharedAudioContext(options);
  return loadSampleSynthModule().then(module => module.recoverSharedAudioContext(options));
}

export function peekSharedAudioContextNow() {
  return sampleSynthModule?.peekSharedAudioContext() ?? null;
}

export async function peekSharedAudioContext() {
  const { peekSharedAudioContext: peek } = await loadSampleSynthModule();
  return peek();
}
