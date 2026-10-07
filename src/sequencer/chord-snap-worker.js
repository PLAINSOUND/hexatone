// No audio, clocks or voices here: only bounded, immutable pitch decisions.
import { chooseChordSteps } from "./chord-snap.js";

self.onmessage = ({ data }) => {
  const { id, pitches, runtime, drift, held } = data;
  try {
    self.postMessage({ id, steps: chooseChordSteps(pitches, runtime, drift, held) });
  } catch {
    self.postMessage({ id, failed: true });
  }
};
