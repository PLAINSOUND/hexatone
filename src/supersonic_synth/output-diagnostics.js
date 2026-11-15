// Read a bounded summary of SuperSonic's device scope, never export audio PCM.
// In postMessage mode the first read requests a copy; later reads observe it.
export function createOutputDiagnostics(sonic) {
  let previous = null;
  return () => {
    const meaning = "Signal at SuperSonic's device output, before Hexatone's recovery gate and browser output buffering. Does not prove audible speaker output or measure speaker latency. Device dropout counters are native-only; browser zeros do not establish absence of dropouts.";
    if (typeof sonic.getDeviceScope !== "function") return { status: "unsupported", meaning };
    try {
      const scope = sonic.getDeviceScope(0, 512);
      if (!scope) return { status: "awaiting-copy", meaning };
      const observedAtMs = performance.now();
      const position = BigInt(scope.writePosition);
      const elapsedMs = previous ? observedAtMs - previous.observedAtMs : null;
      const frameDelta = previous ? position - previous.position : null;
      let peak = 0;
      let sumSquares = 0;
      let nonFiniteSamples = 0;
      const samples = scope.interleaved;
      const count = Math.min(samples.length, 512 * scope.channels);
      for (let i = 0; i < count; i++) {
        const value = samples[i];
        if (!Number.isFinite(value)) { nonFiniteSamples++; continue; }
        peak = Math.max(peak, Math.abs(value));
        sumSquares += value * value;
      }
      previous = { position, observedAtMs };
      return {
        status: "ready", observedAtMs, frames: scope.frames, channels: scope.channels,
        writePosition: position.toString(),
        elapsedMs, framesAdvanced: frameDelta == null ? null : frameDelta.toString(),
        clockAdvanced: frameDelta == null ? null : frameDelta > 0n,
        peak, rms: count > nonFiniteSamples ? Math.sqrt(sumSquares / (count - nonFiniteSamples)) : null,
        nonFiniteSamples, meaning,
      };
    } catch (error) { return { status: "error", error: String(error.message ?? error), meaning }; }
  };
}
