// Transport elapsed time must not jump between AudioContext and wall-clock
// epochs when an output is toggled. Voice scheduling keeps its own timestamps.
export function createTransportClock() {
  let previous = null;
  let offset = 0;
  return (synth, wallSeconds) => {
    let source = null;
    let raw = wallSeconds;
    // Use the actual clock-owning child, not the composite wrapper: graph
    // publication creates a new wrapper even when its audio engine is retained.
    for (const child of synth?.childSynths?.() ?? [synth]) {
      const time = child?.currentTime?.();
      if (!Number.isFinite(time)) continue;
      source = child;
      raw = time;
      break;
    }
    if (previous && (source !== previous.source || raw < previous.raw)) {
      // Carry elapsed time across a source change or a recreated audio clock.
      offset = previous.time + Math.max(0, wallSeconds - previous.wall) - raw;
    }
    const time = Math.max(previous?.time ?? -Infinity, raw + offset);
    previous = { source, raw, wall: wallSeconds, time };
    return time;
  };
}
