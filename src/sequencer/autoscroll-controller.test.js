import { describe, expect, it } from "vitest";
import {
  derivePagedPanelScrollTop,
  derivePreferredTargetBounds,
  deriveTopAlignedPanelScrollTop,
  isLiveSequencerScrollTarget,
} from "./autoscroll-controller.js";
import { bottomOcclusionHeight } from "./viewport-geometry.js";

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
  it("top-aligns a selected transport target even when it is already visible", () => {
    expect(
      deriveTopAlignedPanelScrollTop({
        scrollTop: 300,
        scrollHeight: 2000,
        clientHeight: 500,
        panelTop: 100,
        targetTop: 240,
        stickyTop: 50,
        gap: 6,
      }),
    ).toBe(384);
  });

  it("uses the complete sounding range when it fits and the newest row when it does not", () => {
    const targets = [
      { top: 180, bottom: 240 },
      { top: 420, bottom: 480 },
    ];
    expect(derivePreferredTargetBounds(targets, 320)).toEqual({ top: 180, bottom: 480 });
    expect(derivePreferredTargetBounds(targets, 250)).toEqual({ top: 420, bottom: 480 });
  });

  it("does not scroll a target that is already visible below the sticky transport", () => {
    expect(
      derivePagedPanelScrollTop({
        ...baseGeometry,
        targetTop: 200,
        targetBottom: 260,
      }),
    ).toBe(400);
  });

  it("moves a target below the viewport to the top to restore look-ahead space", () => {
    expect(
      derivePagedPanelScrollTop({
        ...baseGeometry,
        targetTop: 570,
        targetBottom: 630,
      }),
    ).toBe(814);
  });

  it("turns the page as soon as a target reaches the usable bottom edge", () => {
    expect(
      derivePagedPanelScrollTop({
        ...baseGeometry,
        targetTop: 534,
        targetBottom: 594,
      }),
    ).toBe(778);
  });

  it("treats the sticky save footer as an unusable bottom strip", () => {
    expect(
      derivePagedPanelScrollTop({
        ...baseGeometry,
        stickyBottom: 80,
        targetTop: 520,
        targetBottom: 570,
      }),
    ).toBe(764);
    expect(bottomOcclusionHeight({ top: 100, bottom: 600 }, { top: 520, bottom: 580 })).toBe(80);
    expect(bottomOcclusionHeight({ top: 100, bottom: 500 }, { top: 520, bottom: 580 }, 64)).toBe(
      64,
    );
  });

  it("reveals a target hidden behind the sticky transport", () => {
    expect(
      derivePagedPanelScrollTop({
        ...baseGeometry,
        targetTop: 130,
        targetBottom: 190,
      }),
    ).toBe(374);
  });

  it("top-aligns a target that is taller than the usable viewport and clamps the result", () => {
    expect(
      derivePagedPanelScrollTop({
        ...baseGeometry,
        scrollTop: 20,
        targetTop: 80,
        targetBottom: 700,
      }),
    ).toBe(0);
  });

  it("rejects a queued target after virtualization detaches it", () => {
    const panel = document.createElement("div");
    const target = document.createElement("div");
    document.body.append(panel);
    panel.append(target);

    expect(isLiveSequencerScrollTarget(target, panel)).toBe(true);

    target.remove();

    expect(isLiveSequencerScrollTarget(target, panel)).toBe(false);
    panel.remove();
  });
});
