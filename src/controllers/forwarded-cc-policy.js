/**
 * Automatic external forwarding/replay AFTER device decoding and local bindings.
 * Not a raw-input filter: learning, Exquis sustain, LinnStrument UF messages and
 * Continuum MPE+ must be consumed by keys-midi-listeners before this boundary.
 * Explicit RPN/device configuration and Eagan mappings use separate paths.
 */
import { allowsPerformanceCC } from "../midi/performance-cc-policy.js";
import { allowsContinuumPerformanceCC } from "./continuum-cc-policy.js";

export function allowsForwardedCC(cc, controllerId, continuumPedalCC) {
  return (
    allowsPerformanceCC(cc) &&
    (controllerId !== "hakenaudio" || allowsContinuumPerformanceCC(cc, continuumPedalCC))
  );
}
