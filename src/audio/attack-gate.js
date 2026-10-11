// A running state alone cannot reopen an interrupted/frozen renderer.
const blocked = new WeakSet();
const clocks = new WeakMap();
export function blockAudioAttacks(context) {
  if (context) blocked.add(context);
}
export function allowAudioAttacks(context) {
  if (context) {
    blocked.delete(context);
    clocks.delete(context);
  }
}
export function audioAttackAllowed(context) {
  if (!context) return false;
  if (context.state !== "running") {
    // Initial autoplay suspension is normal; it has not interrupted playback.
    if (context.state !== "suspended" || clocks.has(context)) blockAudioAttacks(context);
    return false;
  }
  const now = performance.now();
  const previous = clocks.get(context);
  if (!previous || previous.time !== context.currentTime)
    clocks.set(context, { time: context.currentTime, at: now });
  else if (Number.isFinite(context.currentTime) && now - previous.at > 250)
    blockAudioAttacks(context);
  return !blocked.has(context);
}
