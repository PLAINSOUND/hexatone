import { describe, expect, it } from "vitest";
import { createScaleWorkspace } from "./workspace.js";
import {
  applyGeometryShiftToCoords,
  createHarmonicFrame,
  createKeysFrame,
  deriveCurrentFundamentalForHistory,
  deriveFrameForHistory,
  deriveGeometryShiftForHistory,
  geometryDeltaFromCoords,
  normalizeGeometryDelta,
  replayModulationHistoryForFrame,
  spellWorkspaceForFrame,
} from "./modulation-frame-runtime.js";
import Point from "../keyboard/point.js";

describe("modulation-frame-runtime", () => {
  it("re-exports keyboard frame derivation helpers", () => {
    const frame = deriveFrameForHistory({
      history: [
        {
          sourceDegree: 0,
          targetDegree: 7,
          count: 1,
          transpositionDeltaCents: 700,
        },
      ],
      scale: Array.from({ length: 12 }, (_, i) => i * 100),
      referenceDegree: 0,
      fundamental: 440,
      makeFrame: (degree, extra = {}) =>
        createKeysFrame({
          degree,
          referenceDegree: 0,
          fundamental: 440,
          ...extra,
        }),
    });

    expect(frame.targetDegree).toBe(7);
    expect(frame.transpositionCents).toBe(700);
    expect(frame.effectiveFundamental).toBeCloseTo(440 * Math.pow(2, 700 / 1200), 8);
  });

  it("re-exports notation/history replay helpers", () => {
    const workspace = createScaleWorkspace({
      scale: ["9/8", "5/4", "3/2", "2/1"],
      reference_degree: 0,
      fundamental: 440,
    });
    const baseFrame = createHarmonicFrame(workspace, {
      anchorDegree: 0,
      anchorLabel: "nC",
      anchorRatioText: "1/1",
      anchorInterval: workspace.slots[0].committedIdentity,
    });

    const modulatedFrame = replayModulationHistoryForFrame(workspace, baseFrame, [
      {
        sourceDegree: 0,
        targetDegree: 3,
        strategy: "retune_surface_to_source",
        count: 1,
      },
    ]);
    const spelled = spellWorkspaceForFrame(workspace, modulatedFrame);
    const currentFundamental = deriveCurrentFundamentalForHistory(
      workspace,
      [
        {
          sourceDegree: 3,
          targetDegree: 2,
          strategy: "retune_surface_to_source",
          count: 1,
        },
      ],
      { fundamental: 440 },
    );

    expect(spelled.labelsByDegree[3]).toBeTruthy();
    expect(currentFundamental.fundamentalHz).not.toBe(440);
  });

  it("re-exports pure geometry helpers", () => {
    expect(normalizeGeometryDelta({ surfaceDeltaX: 2.7, surfaceDeltaY: -1.2 })).toEqual({
      deltaRSteps: 2,
      deltaDrSteps: -1,
    });

    expect(
      geometryDeltaFromCoords(new Point(1, 2), new Point(4, -1)),
    ).toEqual({
      deltaRSteps: 3,
      deltaDrSteps: -3,
    });

    expect(
      deriveGeometryShiftForHistory(
        [
          { count: 2, deltaRSteps: 1, deltaDrSteps: -1 },
          { count: -1, surfaceDeltaX: 3, surfaceDeltaY: 4 },
        ],
        true,
      ),
    ).toEqual({
      deltaRSteps: -1,
      deltaDrSteps: -6,
    });

    expect(
      applyGeometryShiftToCoords(new Point(2, 5), {
        geometryShiftRSteps: -3,
        geometryShiftDrSteps: 1,
      }),
    ).toEqual(new Point(-1, 6));
  });
});
