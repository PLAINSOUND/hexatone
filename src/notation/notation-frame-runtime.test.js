import { createScaleWorkspace } from "../tuning/workspace.js";
import {
  createHarmonicFrame,
  deriveDegreeColorsForFrame,
  mutateHarmonicFrame,
  spellSlotForFrame,
  spellWorkspaceForFrame,
} from "./notation-frame-runtime.js";

const xn = "\uE261";

describe("notation-frame-runtime", () => {
  const workspace = createScaleWorkspace({
    scale: ["9/8", "5/4", "3/2", "2/1"],
    reference_degree: 0,
    fundamental: 440,
  });

  it("creates a harmonic frame anchored to a workspace degree", () => {
    const frame = createHarmonicFrame(workspace, {
      anchorDegree: 3,
      anchorLabel: "nA",
    });

    expect(frame.anchorDegree).toBe(3);
    expect(frame.anchorRatioText).toBe("3/2");
    expect(frame.anchorInterval?.ratio?.toFraction()).toBe("3/2");
    expect(frame.referenceFrame?.anchorRatio?.toFraction()).toBe("3/2");
  });

  it("spells the workspace relative to the current anchor", () => {
    const frame = createHarmonicFrame(workspace, {
      anchorDegree: 0,
      anchorLabel: "nA",
    });
    const spelled = spellWorkspaceForFrame(workspace, frame);

    expect(spelled.labelsByDegree[0]).toBe(`${xn}A`);
    expect(spelled.labelsByDegree[1]).toBe(`${xn}B`);
    expect(spelled.labelsByDegree[3]).toBe(`${xn}E`);
  });

  it("mutates the frame by anchor substitution and respells slots accordingly", () => {
    const frame = createHarmonicFrame(workspace, {
      anchorDegree: 0,
      anchorLabel: "nA",
    });
    const mutated = mutateHarmonicFrame(frame, {
      workspace,
      anchorDegree: 3,
    });
    const degree0 = spellSlotForFrame(workspace.slots[0], mutated);
    const degree3 = spellSlotForFrame(workspace.slots[3], mutated);

    expect(mutated.anchorRatioText).toBe("3/2");
    expect(degree3.label).toBe(`${xn}A`);
    expect(degree0.label).toBe(`${xn}D`);
  });

  it("permutes degree colors with the frame anchor", () => {
    const frame = createHarmonicFrame(workspace, {
      anchorDegree: 2,
      anchorLabel: "nA",
    });
    const colors = deriveDegreeColorsForFrame(workspace, frame, {
      baseColors: ["c0", "c1", "c2", "c3"],
    });

    expect(colors).toEqual(["c2", "c3", "c0", "c1"]);
  });
});
