import { expect, it } from "vitest";
import { presentSnapshotPalette } from "./snapshot-palette-presenter.js";

it("moves the palette highlight and stop affordance without scrolling", () => {
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
