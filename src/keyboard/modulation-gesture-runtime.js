// This module owns live modulation-gesture interpretation on top of the
// modulation state machine. It derives source tracking and pending target
// commit data from the current Keys runtime, but it does not emit UI events,
// redraw, or mutate history by itself. Callers decide how to apply the
// returned decision and side effects.

import {
  cancelModulation,
  setModulationSource,
} from "../tuning/modulation-runtime.js";
import { geometryDeltaFromCoords } from "../tuning/modulation-geometry-runtime.js";

export function setAwaitingModulationSource(keys, sourceHex = null, sourceDegree = null, sourceCoords = null) {
  if (keys._modulationState.mode !== "awaiting_target") return keys._modulationState;
  return setModulationSource(keys._modulationState, {
    sourceHex,
    sourceDegree,
    sourceCoords,
  });
}

export function syncAwaitingModulationSource(keys) {
  if (keys._modulationState.mode !== "awaiting_target") return keys._modulationState;
  const sourceHex = keys.recencyStack.front ?? null;
  const sourceDegree = sourceHex ? keys._degreeForHex(sourceHex) : null;
  return setAwaitingModulationSource(keys, sourceHex, sourceDegree, sourceHex?.coords ?? null);
}

export function derivePendingModulationCommit(keys, coords) {
  if (keys._modulationState.mode !== "awaiting_target") {
    return { type: "noop", suppressNoteOn: false };
  }

  const activeFrame = keys._activeFrame();
  const isFixedDo = keys._isFixedDoStrategy(keys._modulationState.strategy);
  const sourceCoords = keys._modulationState.sourceHex?.coords ?? null;
  const targetDegree = keys._degreeForCoords(coords);
  const sourceStillSounding = keys._isHexStillSounding(keys._modulationState.sourceHex);

  if (keys._modulationState.sourceDegree == null || !sourceStillSounding) {
    return {
      type: "rearm_source",
      targetDegree,
      suppressNoteOn: false,
    };
  }

  if ((keys._modulationState.sourceDegree ?? targetDegree) === targetDegree) {
    return {
      type: "cancel",
      reason: "no_op_modulation",
      suppressNoteOn: false,
      nextState: cancelModulation(keys._modulationState, "no_op_modulation"),
    };
  }

  const targetCents = keys.hexCoordsToCents(coords)[0];
  const sourceCents =
    keys._modulationState.sourceHex?._baseCents ??
    keys._modulationState.sourceHex?.cents ??
    keys._sourceCentsForDegree(keys._modulationState.sourceDegree, activeFrame);
  const transpositionDeltaCents = sourceCents - targetCents;
  const transpositionCents = (activeFrame?.transpositionCents ?? 0) + transpositionDeltaCents;
  const transpositionSteps = (keys._modulationState.sourceDegree ?? targetDegree) - targetDegree;
  const geometryDelta = geometryDeltaFromCoords(sourceCoords, coords);
  const effectiveFundamental =
    (activeFrame?.effectiveFundamental ?? keys.settings.fundamental) *
    Math.pow(2, transpositionDeltaCents / 1200);
  const pendingFrame = keys._makeFrameForDegree(targetDegree, {
    strategy: keys._modulationState.strategy,
    sourceDegree: keys._modulationState.sourceDegree,
    targetDegree,
    transpositionSteps,
    transpositionCents,
    geometryShiftRSteps:
      (activeFrame?.geometryShiftRSteps ?? 0) + (isFixedDo ? geometryDelta?.deltaRSteps ?? 0 : 0),
    geometryShiftDrSteps:
      (activeFrame?.geometryShiftDrSteps ?? 0) + (isFixedDo ? geometryDelta?.deltaDrSteps ?? 0 : 0),
    effectiveFundamental,
  });

  if (isFixedDo && !geometryDelta) {
    return {
      type: "cancel",
      reason: "fixed_do_requires_overlap",
      suppressNoteOn: false,
      nextState: cancelModulation(keys._modulationState, "fixed_do_requires_overlap"),
    };
  }

  return {
    type: "commit",
    suppressNoteOn: isFixedDo,
    isFixedDo,
    sourceStillSounding,
    targetDegree,
    pendingFrame,
    transpositionDeltaCents,
    geometryDelta,
  };
}
