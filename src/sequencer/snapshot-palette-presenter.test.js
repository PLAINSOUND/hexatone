import { afterEach, expect, it, vi } from "vitest";
import { presentSnapshotPalette, revealSnapshotPalette } from "./snapshot-palette-presenter.js";

afterEach(() => vi.unstubAllGlobals());

function palette() {
  const body = document.createElement("div");
  body.innerHTML = [1, 2, 3].map(id => `<div class="snapshot-row" data-snapshot-id="${id}"></div>`).join("");
  Object.defineProperties(body, { clientHeight: { configurable: true, value: 100 }, clientTop: { value: 2 } });
  body.getBoundingClientRect = () => ({ top: 100, bottom: 204 });
  [...body.children].forEach((row, index) => {
    row.getBoundingClientRect = () => {
      const top = 112 + index * 100 - body.scrollTop;
      return { top, bottom: top + 30, height: 30 };
    };
  });
  return body;
}

it("reveals offscreen snapshots in either direction without moving visible rows", () => {
  const body = palette();
  revealSnapshotPalette(body, 1);
  expect(body.scrollTop).toBe(0);
  revealSnapshotPalette(body, 3);
  expect(body.scrollTop).toBe(140);
  revealSnapshotPalette(body, 3);
  expect(body.scrollTop).toBe(140);
  revealSnapshotPalette(body, 1);
  expect(body.scrollTop).toBe(10);
});

it("coalesces timed cue reveals to the latest snapshot outside immediate dispatch", () => {
  const frames = [];
  vi.stubGlobal("requestAnimationFrame", callback => frames.push(callback));
  const body = palette();
  presentSnapshotPalette(body, 3);
  presentSnapshotPalette(body, 2);
  expect(body.scrollTop).toBe(0);
  expect(frames).toHaveLength(1);
  frames.shift()();
  expect(body.scrollTop).toBe(40);
  presentSnapshotPalette(body, 3);
  presentSnapshotPalette(body, null);
  frames.shift()();
  expect(body.scrollTop).toBe(40); // stopping cancels pending scrolling
});

it("does not scroll collapsed palettes, deleted targets or stopped transport", () => {
  const body = palette();
  Object.defineProperty(body, "clientHeight", { value: 0 });
  revealSnapshotPalette(body, 3);
  expect(body.scrollTop).toBe(0);
  Object.defineProperty(body, "clientHeight", { value: 100 });
  revealSnapshotPalette(body, 42);
  revealSnapshotPalette(body, null);
  expect(body.scrollTop).toBe(0);
});

it("moves the palette highlight and stop affordance without synchronous scrolling", () => {
  const body = document.createElement("div");
  body.innerHTML = [1, 2].map(id => `<div data-snapshot-id="${id}" class="snapshot-row${id === 1 ? " snapshot-playing" : ""}"><button class="snapshot-stop-btn" ${id === 2 ? "disabled" : ""}></button></div>`).join("");
  body.scrollTop = 80;
  presentSnapshotPalette(body, 2);
  expect(body.children[0].classList.contains("snapshot-playing")).toBe(false);
  expect(body.children[0].firstChild.disabled).toBe(true);
  expect(body.children[1].classList.contains("snapshot-playing")).toBe(true);
  expect(body.children[1].firstChild.disabled).toBe(false);
  expect(body.scrollTop).toBe(80);
  presentSnapshotPalette(body, null);
  expect(body.querySelector(".snapshot-playing")).toBeNull();
  expect(body.children[1].firstChild.disabled).toBe(true);
});

it("tolerates a collapsed palette and deleted targets", () => {
  expect(() => presentSnapshotPalette(null, 1)).not.toThrow();
  const body = document.createElement("div");
  expect(() => presentSnapshotPalette(body, 1)).not.toThrow();
});
