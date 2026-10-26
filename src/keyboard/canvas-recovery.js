import { recordAudioRuntime } from "../audio/runtime-diagnostics.js";

export function canvasDiagnostics(keys) {
  const { canvas, context, pixelRatio, viewportWidth, viewportHeight } = keys.state;
  const matrix = context.getTransform?.();
  const rect = canvas.getBoundingClientRect?.();
  return {
    backing: { width: canvas.width, height: canvas.height },
    css: rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top } : null,
    pixelRatio, viewportWidth, viewportHeight,
    devicePixelRatio: window.devicePixelRatio,
    rotation: keys.settings.rotation, hexSize: keys.settings.hexSize,
    transform: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : null,
    expectedTransform: keys._canvasTransform,
    contextLost: context.isContextLost?.() ?? null,
    staticContextLost: keys._staticGridContext?.isContextLost?.() ?? null,
    staticGridValid: keys._staticGridValid ?? false,
    snapshotHighlights: keys._snapshotHighlights?.getDiagnostics() ?? null,
    viewport: window.visualViewport ? {
      width: window.visualViewport.width, height: window.visualViewport.height,
      scale: window.visualViewport.scale,
      offsetLeft: window.visualViewport.offsetLeft, offsetTop: window.visualViewport.offsetTop,
    } : { width: window.innerWidth, height: window.innerHeight },
  };
}

export function recoverCanvas(keys, reason) {
  recordAudioRuntime("canvas-before-recovery", { reason, canvas: canvasDiagnostics(keys) });
  // iOS may reset the drawing state without changing the backing dimensions.
  // Bypass the resize signature cache and regenerate both drawing surfaces.
  keys._lastResizeSignature = null;
  keys._staticGridValid = false;
  keys.resizeHandler();
  keys.scheduleViewportResizeSettlement();
  recordAudioRuntime("canvas-after-recovery", { reason, canvas: canvasDiagnostics(keys) });
}

export function bindCanvasRecovery(keys) {
  const canvas = keys.state.canvas;
  const lost = event => {
    event.preventDefault();
    recordAudioRuntime("canvas-context-lost", { canvas: canvasDiagnostics(keys) });
  };
  const restored = () => recoverCanvas(keys, "contextrestored");
  const visible = () => {
    if (document.visibilityState === "visible") recoverCanvas(keys, "visibilitychange");
  };
  const shown = () => recoverCanvas(keys, "pageshow");
  canvas.addEventListener("contextlost", lost);
  canvas.addEventListener("contextrestored", restored);
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("pageshow", shown);
  return () => {
    canvas.removeEventListener("contextlost", lost);
    canvas.removeEventListener("contextrestored", restored);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("pageshow", shown);
  };
}
