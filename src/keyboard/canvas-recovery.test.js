import { describe, expect, it, vi } from "vitest";
import { bindCanvasRecovery, canvasDiagnostics, recoverCanvas } from "./canvas-recovery.js";

function makeKeys() {
  return {
    state: { canvas: document.createElement("canvas"), pixelRatio: 3,
      viewportWidth: 390, viewportHeight: 844,
      context: { getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        isContextLost: () => false } },
    settings: { rotation: -16, hexSize: 42 },
    _canvasTransform: [1, 0, 0, 1, 20, 30],
    _lastResizeSignature: "unchanged", _staticGridValid: true,
    resizeHandler: vi.fn(), scheduleViewportResizeSettlement: vi.fn(),
  };
}

describe("canvas recovery", () => {
  it("reports backing size, transforms, geometry and context loss", () => {
    expect(canvasDiagnostics(makeKeys())).toMatchObject({
      pixelRatio: 3, rotation: -16, hexSize: 42, contextLost: false,
      transform: [1, 0, 0, 1, 0, 0], expectedTransform: [1, 0, 0, 1, 20, 30],
    });
  });
  it("invalidates cached geometry and forces a resize even with unchanged dimensions", () => {
    const keys = makeKeys();
    recoverCanvas(keys, "test");
    expect(keys._lastResizeSignature).toBeNull();
    expect(keys._staticGridValid).toBe(false);
    expect(keys.resizeHandler).toHaveBeenCalledOnce();
    expect(keys.scheduleViewportResizeSettlement).toHaveBeenCalledOnce();
  });
  it("recovers on context restoration and removes its listeners on disposal", () => {
    const keys = makeKeys();
    const unbind = bindCanvasRecovery(keys);
    const lost = new Event("contextlost", { cancelable: true });
    keys.state.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    keys.state.canvas.dispatchEvent(new Event("contextrestored"));
    expect(keys.resizeHandler).toHaveBeenCalledOnce();
    unbind();
    keys.state.canvas.dispatchEvent(new Event("contextrestored"));
    expect(keys.resizeHandler).toHaveBeenCalledOnce();
  });
});
