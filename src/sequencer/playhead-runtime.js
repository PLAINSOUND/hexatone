// This module remains as a stable import surface for sequencer playhead/view
// state, but delegates the actual selector derivation to the transport
// selection runtime so app and view share the same transport semantics.

import { deriveTransportSelectionState } from "./transport-selection.js";

export function derivePlayheadNavigationState(args) {
  return deriveTransportSelectionState(args);
}
