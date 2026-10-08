import { afterEach, expect, it, vi } from "vitest";
import { retainPalettePosition, watchPaletteLayout } from "./palette-layout.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function layoutHarness(frames = 1) {
  const queue = new Map();
  let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    queue.set(++id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(key => queue.delete(key));
  let resized;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { resized = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  let fontsReady;
  const fonts = new EventTarget();
  fonts.ready = new Promise(resolve => { fontsReady = resolve; });
  const sidebar = document.createElement("nav");
  const palette = document.createElement("div");
  vi.stubGlobal("document", { fonts });
  const update = vi.fn();
  const stop = watchPaletteLayout([sidebar, palette, null], update, frames);
  const frame = () => {
    const pending = [...queue.values()];
    queue.clear();
    pending.forEach(callback => callback());
  };
  return { queue, observe, disconnect, resized, fonts, fontsReady, sidebar,
    update, stop, frame };
}

it("repositions after late layout, sidebar transitions, and font loading", async () => {
  const h = layoutHarness();
  expect(h.observe).toHaveBeenCalledTimes(2);
  h.frame();
  expect(h.update).toHaveBeenCalledTimes(1);
  h.resized();
  h.sidebar.dispatchEvent(new Event("transitionend"));
  h.fonts.dispatchEvent(new Event("loadingdone"));
  expect(h.queue.size).toBe(1);
  h.frame();
  expect(h.update).toHaveBeenCalledTimes(2);
  h.fontsReady();
  await Promise.resolve();
  h.frame();
  expect(h.update).toHaveBeenCalledTimes(3);
  h.stop();
});

it("waits two frames to stack snapshots after modulation positioning", () => {
  const h = layoutHarness(2);
  h.frame();
  expect(h.update).not.toHaveBeenCalled();
  h.frame();
  expect(h.update).toHaveBeenCalledOnce();
  h.stop();
});

it("cancels pending frames and ignores late fonts after unmount", async () => {
  const h = layoutHarness();
  h.stop();
  expect(h.disconnect).toHaveBeenCalledOnce();
  h.fontsReady();
  await Promise.resolve();
  h.resized();
  window.dispatchEvent(new Event("resize"));
  h.sidebar.dispatchEvent(new Event("transitionend"));
  h.frame();
  expect(h.update).not.toHaveBeenCalled();
  expect(h.queue.size).toBe(0);
});

it("retains state identity for unchanged geometry to avoid resize feedback", () => {
  const current = { x: 616, y: 58 };
  expect(retainPalettePosition(current, { ...current })).toBe(current);
  expect(retainPalettePosition(current, { x: 620, y: 58 })).toEqual({ x: 620, y: 58 });
});
