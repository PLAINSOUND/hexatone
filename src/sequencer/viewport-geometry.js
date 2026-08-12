// A sequencer scroll panel can extend below the browser viewport when controls
// above it wrap. Scroll decisions must use only the portion a user can see.

export function intersectRectWithViewport(
  rect,
  { viewportTop = 0, viewportBottom = Infinity } = {},
) {
  const rectTop = Number(rect?.top);
  const rectBottom = Number(rect?.bottom);
  if (!Number.isFinite(rectTop) || !Number.isFinite(rectBottom)) return null;
  const top = Math.max(rectTop, Number(viewportTop) || 0);
  const bottom = Math.min(
    rectBottom,
    Number.isFinite(Number(viewportBottom)) ? Number(viewportBottom) : rectBottom,
  );
  return {
    top,
    bottom: Math.max(top, bottom),
    height: Math.max(0, bottom - top),
  };
}

export function browserVisualViewportBounds() {
  const visualViewport = window.visualViewport;
  const top = Number.isFinite(Number(visualViewport?.offsetTop))
    ? Number(visualViewport.offsetTop)
    : 0;
  const fallbackHeight =
    Number(document.documentElement?.clientHeight) || Number(window.innerHeight) || 0;
  const height = Number(visualViewport?.height) || fallbackHeight;
  return {
    top,
    bottom: height > 0 ? top + height : Infinity,
  };
}

export function visibleElementBounds(element) {
  if (!(element instanceof HTMLElement)) return null;
  const viewport = browserVisualViewportBounds();
  const rect = element.getBoundingClientRect();
  const top = Number(rect?.top);
  const bottom = Number.isFinite(Number(rect?.bottom))
    ? Number(rect.bottom)
    : top + (Number(rect?.height) || Number(element.clientHeight) || 0);
  return intersectRectWithViewport(
    { top, bottom },
    {
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
    },
  );
}

export function bottomOcclusionHeight(containerBounds, occluder, minimumOcclusion = 0) {
  const containerTop = Number(containerBounds?.top);
  const containerBottom = Number(containerBounds?.bottom);
  const occluderRect =
    occluder instanceof HTMLElement ? occluder.getBoundingClientRect() : occluder;
  const occluderTop = Number(occluderRect?.top);
  const occluderBottom = Number(occluderRect?.bottom);
  const minimum = Math.max(0, Number(minimumOcclusion) || 0);
  if (
    !Number.isFinite(containerTop) ||
    !Number.isFinite(containerBottom) ||
    !Number.isFinite(occluderTop) ||
    !Number.isFinite(occluderBottom)
  )
    return 0;
  if (occluderTop >= containerBottom || occluderBottom <= containerTop) return minimum;
  // A bottom-sticky action also blocks its inset and fade below the element.
  // Treat the complete strip from its top to the visible panel bottom as
  // occluded rather than measuring only the button row's border box.
  return Math.max(minimum, containerBottom - Math.max(containerTop, occluderTop));
}
