import { describe, expect, it } from "vitest";
import { deriveDragAutoscrollVelocity } from "./drag-autoscroll.js";

describe("sequence drag edge scrolling", () => {
  it("stays idle away from the viewport edges", () => {
    expect(
      deriveDragAutoscrollVelocity({ pointerY: 300, visibleTop: 100, visibleBottom: 500 }),
    ).toBe(0);
  });

  it("accelerates upward and downward as the pointer reaches an edge", () => {
    const nearTop = deriveDragAutoscrollVelocity({
      pointerY: 150,
      visibleTop: 100,
      visibleBottom: 500,
    });
    const atTop = deriveDragAutoscrollVelocity({
      pointerY: 100,
      visibleTop: 100,
      visibleBottom: 500,
    });
    const nearBottom = deriveDragAutoscrollVelocity({
      pointerY: 450,
      visibleTop: 100,
      visibleBottom: 500,
    });
    const atBottom = deriveDragAutoscrollVelocity({
      pointerY: 500,
      visibleTop: 100,
      visibleBottom: 500,
    });

    expect(atTop).toBeLessThan(nearTop);
    expect(nearTop).toBeLessThan(0);
    expect(atBottom).toBeGreaterThan(nearBottom);
    expect(nearBottom).toBeGreaterThan(0);
    expect(atTop).toBe(-960);
    expect(atBottom).toBe(960);
  });

  it("uses the supplied visible bottom above a sticky footer", () => {
    expect(
      deriveDragAutoscrollVelocity({ pointerY: 430, visibleTop: 100, visibleBottom: 450 }),
    ).toBeGreaterThan(0);
    expect(
      deriveDragAutoscrollVelocity({ pointerY: 430, visibleTop: 100, visibleBottom: 550 }),
    ).toBe(0);
  });
});
