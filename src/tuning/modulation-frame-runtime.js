// Pure modulation/frame derivation entrypoint.
//
// This module centralizes the derived runtime helpers that sit between
// committed tuning (`ScaleWorkspace`) and live modulation consumers.
// It does not own gesture/history state transitions and it does not own
// keyboard/audio side effects; those remain in modulation-runtime and Keys.

export {
  createKeysFrame,
  deriveFrameForHistory,
  deriveFrameForHistoryIndex,
} from "../keyboard/keys-frame-runtime.js";

export {
  normalizeGeometryDelta,
  geometryDeltaFromCoords,
  deriveGeometryShiftForHistory,
  applyGeometryShiftToCoords,
} from "./modulation-geometry-runtime.js";

export {
  createHarmonicFrame,
  mutateHarmonicFrame,
  spellSlotForFrame,
  spellWorkspaceForFrame,
  spellDegreeForFrame,
  deriveDegreeColorsForFrame,
  deriveCurrentFundamentalForHistory,
  replayModulationHistoryForFrame,
} from "../notation/notation-frame-runtime.js";
