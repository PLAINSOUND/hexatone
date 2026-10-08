// Palette defaults depend on DOM geometry, which can settle after lazy manual
// loading, font loading, or the sidebar's opening transition. Observe layout,
// not playback state; callers retain ownership of manually dragged positions.
export function watchPaletteLayout(elements, onLayout, frames = 1) {
  let disposed = false;
  let frameId = null;
  const schedule = () => {
    if (disposed) return;
    if (frameId != null) window.cancelAnimationFrame(frameId);
    let remaining = frames;
    const tick = () => {
      frameId = null;
      if (disposed) return;
      if (--remaining > 0) frameId = window.requestAnimationFrame(tick);
      else onLayout();
    };
    frameId = window.requestAnimationFrame(tick);
  };
  const observed = elements.filter(Boolean);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  for (const element of observed) {
    observer?.observe(element);
    element.addEventListener("transitionend", schedule);
  }
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  document.fonts?.addEventListener?.("loadingdone", schedule);
  document.fonts?.ready?.then(schedule);
  schedule();
  return () => {
    disposed = true;
    if (frameId != null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    for (const element of observed) element.removeEventListener("transitionend", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    document.fonts?.removeEventListener?.("loadingdone", schedule);
  };
}

export function retainPalettePosition(current, next) {
  return current.x === next.x && current.y === next.y ? current : next;
}
