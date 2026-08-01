export function deriveDragAutoscrollVelocity({
  pointerY,
  visibleTop,
  visibleBottom,
  edgeSize = 64,
  minimumSpeed = 120,
  maximumSpeed = 960,
} = {}) {
  const y = Number(pointerY);
  const top = Number(visibleTop);
  const bottom = Number(visibleBottom);
  if (!Number.isFinite(y) || !Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) {
    return 0;
  }
  const edge = Math.min(
    Math.max(24, Number(edgeSize) || 64),
    Math.max(1, (bottom - top) / 2),
  );
  let direction = 0;
  let penetration = 0;
  if (y < top + edge) {
    direction = -1;
    penetration = (top + edge - y) / edge;
  } else if (y > bottom - edge) {
    direction = 1;
    penetration = (y - (bottom - edge)) / edge;
  }
  if (direction === 0) return 0;
  const intensity = Math.min(1, Math.max(0, penetration));
  const slow = Math.max(0, Number(minimumSpeed) || 0);
  const fast = Math.max(slow, Number(maximumSpeed) || slow);
  return direction * (slow + (fast - slow) * intensity * intensity);
}
