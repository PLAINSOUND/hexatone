/**
 * mts-helpers.js — re-export shim
 *
 * All functions have moved to src/tuning/. This file re-exports them for
 * backwards compatibility while callers are migrated to the new import paths.
 *
 * TODO: migrate all callers to import from src/tuning/ directly, then delete
 * this file. Tracked callers:
 *   - src/keyboard/keys.js
 *   - src/use-synth-wiring.js
 *   - src/midi_synth/index.js
 *   - src/settings/midi/midioutputs.js
 */

export {
  centsToMTS,
  mtsToMidiFloat,
  sanitizeBulkDumpName,
  resolveBulkDumpName,
  buildRealtimeSingleNoteMessage,
  buildBulkDumpMessage,
} from "../tuning/mts-format.js";

export {
  degree0ToRef,
  computeNaturalAnchor,
  computeCenterPitchHz,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
} from "../tuning/center-anchor.js";

export {
  buildTuningMapEntries,
  patchTuningEntry,
  mtsTuningMap,
} from "../tuning/tuning-map.js";
