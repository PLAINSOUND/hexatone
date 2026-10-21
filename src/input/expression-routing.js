// Channel-specific pressure/timbre does not imply channel-specific pitch.
// Lumatone bypass encodes layout position in channels but has a global wheel.
export function ignoresIncomingPitchBend(controller, runtime) {
  // Single-channel Exquis bends have no source-note identity: concurrent
  // touches cannot safely be routed to either individual or recent notes.
  return controller?.id === "exquis" && !runtime?.mpeInput;
}

export function usesPerChannelPitchBend(runtime) {
  return !!(runtime?.mpeInput ||
    (runtime?.perChannelExpression && runtime?.perChannelPitchBend !== false));
}
