/**
 * Owns the AudioContext shared by samples, FluidSynth, and DSF.
 * Backend voices and output gains remain owned by their engines.
 */

export let sharedAudioContext = null;

export function peekSharedAudioContext() {
  return sharedAudioContext;
}

export function ensureSharedAudioContext() {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    sharedAudioContext = new AudioContextClass({
      latencyHint: "interactive",
    });
  }

  return sharedAudioContext;
}

export function discardSharedAudioContext(expectedContext) {
  if (sharedAudioContext !== expectedContext) {
    return false;
  }

  sharedAudioContext = null;
  return true;
}

