// Channel-specific pressure/timbre does not imply channel-specific pitch.
// Lumatone bypass encodes layout position in channels but has a global wheel.
export function usesPerChannelPitchBend(runtime) {
  return !!(runtime?.mpeInput ||
    (runtime?.perChannelExpression && runtime?.perChannelPitchBend !== false));
}
