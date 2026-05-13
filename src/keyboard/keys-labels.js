// This module owns user-facing labels for the current keyboard frame.
// It turns reduced degrees and active frame state into display labels/cents
// text, and applies label-setting toggles. It does not decide geometry or note
// triggering; it only formats what the current runtime frame already means.

import {
  displayLabelForDegree,
  labelDegreeFromFrame,
  scaleCentsLabelForDegree,
} from "./keys-display-runtime.js";

export function labelDegreeFromActiveFrame(reducedNote, frame = this._activeFrame()) {
  return labelDegreeFromFrame(reducedNote, {
    frame,
    geometryMode: this._modulationState?.geometryMode,
    scaleLength: this.tuning.scale.length || 1,
  });
}

export function scaleCentsLabelForActiveDegree(reducedNote) {
  return scaleCentsLabelForDegree(reducedNote, this.tuning.scale || []);
}

export function getDisplayLabelAtCoords(coords, options = {}) {
  const note = coords.x * this.settings.rSteps + coords.y * this.settings.drSteps;
  const equivSteps = this.tuning.scale.length || 1;
  let reducedNote = note % equivSteps;
  if (reducedNote < 0) reducedNote += equivSteps;
  return displayLabelForDegree(reducedNote, {
    settings: options.settings ?? this.settings,
    frame: options.frame ?? this._activeFrame(),
    geometryMode: options.geometryMode ?? this._modulationState?.geometryMode,
    scaleLength: equivSteps,
    scale: this.tuning.scale,
  });
}

export function updateLabels(labels) {
  for (const flag of ["degree", "note", "scala", "cents", "heji", "equaves", "no_labels"]) {
    this.settings[flag] = false;
  }
  Object.assign(this.settings, labels);
  this.scheduleImmediateGridRedraw();
}
