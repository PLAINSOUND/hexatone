/**
 * sample_synth/prime-shared-audio.js
 *
 * Tiny lazy wrapper around the sample synth's shared AudioContext priming.
 * App-level callers can wake audio without statically importing the full
 * browser sample synth implementation into the main bundle.
 */

let sampleSynthModulePromise = null;

async function loadSampleSynthModule() {
  sampleSynthModulePromise ??= import("./index.js");
  return sampleSynthModulePromise;
}

export async function primeSharedSampleAudio() {
  const { primeSharedSampleAudio: prime } = await loadSampleSynthModule();
  return prime();
}
