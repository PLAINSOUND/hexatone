import { describe, expect, it } from "vitest";
import { deriveLiveHexPitch } from "./keys-geometry-runtime.js";

describe("keyboard/keys-geometry-runtime", () => {
  const basePitch = {
    reducedSteps: 5,
    reducedStepsPrev: 4,
    reducedStepsNext: 6,
    distance: 5,
    octs: 0,
    octsPrev: 0,
    octsNext: 0,
  };

  it("keeps moveable-surface geometry on committed scale indices", () => {
    const live = deriveLiveHexPitch(basePitch, {
      scale: [0, 100, 200, 300, 400, 500, 600, 700],
      scaleLength: 8,
      equivSteps: 8,
      equivInterval: 1200,
      frame: {
        strategy: "retune_surface_to_source",
        transpositionCents: 50,
      },
    });

    expect(live.cents).toBe(550);
    expect(live.liveReducedSteps).toBe(5);
    expect(live.centsPrev).toBe(450);
    expect(live.centsNext).toBe(650);
  });

  it("reinterprets stable-surface geometry through the frame mapping", () => {
    const live = deriveLiveHexPitch(basePitch, {
      scale: [0, 100, 200, 300, 400, 500, 600, 700],
      scaleLength: 8,
      equivSteps: 8,
      equivInterval: 1200,
      frame: {
        strategy: "reinterpret_surface_from_target",
        transpositionSteps: 2,
        transpositionCents: 50,
      },
    });

    expect(live.cents).toBe(750);
    expect(live.liveReducedSteps).toBe(7);
    expect(live.centsPrev).toBe(650);
    expect(live.centsNext).toBe(50);
  });
});
