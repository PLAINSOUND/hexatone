import { describe, expect, it } from "vitest";
import { derivePagedPanelScrollTop } from "./autoscroll-controller.js";

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
    expect(derivePagedPanelScrollTop({
      ...baseGeometry,
      targetTop: 200,
      targetBottom: 260,
    })).toBe(400);
  });

  it("moves a target below the viewport to the top to restore look-ahead space", () => {
    expect(derivePagedPanelScrollTop({
      ...baseGeometry,
      targetTop: 570,
      targetBottom: 630,
    })).toBe(814);
  });

  it("reveals a target hidden behind the sticky transport", () => {
    expect(derivePagedPanelScrollTop({
      ...baseGeometry,
      targetTop: 130,
      targetBottom: 190,
    })).toBe(374);
  });

  it("top-aligns a target that is taller than the usable viewport and clamps the result", () => {
    expect(derivePagedPanelScrollTop({
      ...baseGeometry,
      scrollTop: 20,
      targetTop: 80,
      targetBottom: 700,
    })).toBe(0);
  });
});
