import { describe, expect, it } from "vitest";
import { deriveMinimalPanelScrollTop } from "./autoscroll-controller.js";

const baseGeometry = {
  scrollTop: 400,
  scrollHeight: 2000,
  clientHeight: 500,
  panelTop: 100,
  panelBottom: 600,
  stickyTop: 50,
  gap: 6,
};

describe("sequencer autoscroll geometry", () => {
  it("does not scroll a target that is already visible below the sticky transport", () => {
    expect(deriveMinimalPanelScrollTop({
      ...baseGeometry,
      targetTop: 200,
      targetBottom: 260,
    })).toBe(400);
  });

  it("reveals a target below the viewport with the smallest possible scroll", () => {
    expect(deriveMinimalPanelScrollTop({
      ...baseGeometry,
      targetTop: 570,
      targetBottom: 630,
    })).toBe(436);
  });

  it("reveals a target hidden behind the sticky transport", () => {
    expect(deriveMinimalPanelScrollTop({
      ...baseGeometry,
      targetTop: 130,
      targetBottom: 190,
    })).toBe(374);
  });

  it("top-aligns a target that is taller than the usable viewport and clamps the result", () => {
    expect(deriveMinimalPanelScrollTop({
      ...baseGeometry,
      scrollTop: 20,
      targetTop: 80,
      targetBottom: 700,
    })).toBe(0);
  });
});
