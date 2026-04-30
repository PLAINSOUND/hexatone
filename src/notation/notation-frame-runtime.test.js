import fs from "fs";
import { createScaleWorkspace } from "../tuning/workspace.js";
import { parseScale } from "../settings/scale/parse-scale.js";
import { deriveHejiAnchor } from "./heji-normalization.js";
import {
  createHarmonicFrame,
  deriveCurrentFundamentalForHistory,
  deriveDegreeColorsForFrame,
  mutateHarmonicFrame,
  replayModulationHistoryForFrame,
  spellSlotForFrame,
  spellWorkspaceForFrame,
} from "./notation-frame-runtime.js";
import { parseExactInterval } from "../tuning/interval.js";

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

  it("replays modulation history by moving the source spelling onto the target degree", () => {
    const baseFrame = createHarmonicFrame(workspace, {
      anchorDegree: 0,
      anchorLabel: "nC",
      anchorRatioText: "1/1",
      anchorInterval: workspace.slots[0].committedIdentity,
    });
    const mutated = replayModulationHistoryForFrame(workspace, baseFrame, [
      {
        sourceDegree: 0,
        targetDegree: 3,
        strategy: "retune_surface_to_source",
        count: 1,
      },
    ]);
    const spelled = spellWorkspaceForFrame(workspace, mutated);

    expect(spelled.labelsByDegree[3]).toBe(`${xn}C`);
    expect(spelled.labelsByDegree[0]).toBe(`${xn}F`);
  });

  it("replays later modulation-history steps on top of earlier notation mutations", () => {
    const baseFrame = createHarmonicFrame(workspace, {
      anchorDegree: 0,
      anchorLabel: "nC",
      anchorRatioText: "1/1",
      anchorInterval: workspace.slots[0].committedIdentity,
    });
    const mutated = replayModulationHistoryForFrame(workspace, baseFrame, [
      {
        sourceDegree: 0,
        targetDegree: 3,
        strategy: "retune_surface_to_source",
        count: 1,
      },
      {
        sourceDegree: 3,
        targetDegree: 1,
        strategy: "retune_surface_to_source",
        count: 1,
      },
    ]);
    const spelled = spellWorkspaceForFrame(workspace, mutated);

    expect(spelled.labelsByDegree[1]).toBe(`${xn}C`);
  });

  it("replays modulation history when degree ids arrive as strings", () => {
    const baseFrame = createHarmonicFrame(workspace, {
      anchorDegree: 0,
      anchorLabel: "nC",
      anchorRatioText: "1/1",
      anchorInterval: workspace.slots[0].committedIdentity,
    });
    const mutated = replayModulationHistoryForFrame(workspace, baseFrame, [
      {
        sourceDegree: "0",
        targetDegree: "3",
        strategy: "retune_surface_to_source",
        count: 1,
      },
    ]);
    const spelled = spellWorkspaceForFrame(workspace, mutated);

    expect(spelled.labelsByDegree[3]).toBe(`${xn}C`);
    expect(spelled.labelsByDegree[0]).toBe(`${xn}F`);
  });

  it("derives the compounded current fundamental as ratio and cents when routes are exact", () => {
    const derived = deriveCurrentFundamentalForHistory(workspace, [
      {
        sourceDegree: 3,
        targetDegree: 2,
        strategy: "retune_surface_to_source",
        count: 1,
      },
      {
        sourceDegree: 2,
        targetDegree: 1,
        strategy: "retune_surface_to_source",
        count: 1,
      },
    ], {
      fundamental: 440,
    });

    expect(derived.ratioText).toBe("4/3");
    expect(derived.cents).toBeCloseTo(workspace.slots[3].cents - workspace.slots[1].cents, 6);
    expect(derived.fundamentalHz).toBeCloseTo(440 * (4 / 3), 6);
  });

  it("uses stored octave-aware route intervals for the current fundamental", () => {
    const derived = deriveCurrentFundamentalForHistory(workspace, [
      {
        sourceDegree: 0,
        targetDegree: 3,
        strategy: "retune_surface_to_source",
        count: 2,
        transpositionDeltaCents: 231.174093530875,
        transpositionRatioText: "8/7",
      },
    ], {
      fundamental: 440,
    });

    expect(derived.ratioText).toBe("64/49");
    expect(derived.cents).toBeCloseTo(462.34818706175, 8);
    expect(derived.fundamentalHz).toBeCloseTo(440 * (64 / 49), 6);
  });

  it("falls back to cents-only current fundamental when a route uses an inexact degree", () => {
    const inexactWorkspace = createScaleWorkspace({
      scale: ["100.", "5/4", "2/1"],
      reference_degree: 0,
      fundamental: 440,
    });
    const derived = deriveCurrentFundamentalForHistory(inexactWorkspace, [
      {
        sourceDegree: 1,
        targetDegree: 0,
        strategy: "retune_surface_to_source",
        count: 1,
      },
    ]);

    expect(derived.ratioText).toBeNull();
    expect(derived.exact).toBe(false);
    expect(derived.cents).toBeCloseTo(100, 6);
  });

  it("relabels Sabat: The Tree by moving degree 0 onto degree 23", () => {
    const scala = parseScale(fs.readFileSync("scales/81-HS-odd-47L.scl", "utf8")).scale;
    const degreeTexts = ["1/1", ...scala.slice(0, -1)];
    const noteNames = Array.from({ length: degreeTexts.length }, (_, index) => String(index));
    const workspace = createScaleWorkspace({
      scale: scala,
      reference_degree: 56,
      fundamental: 441,
    });
    const anchor = deriveHejiAnchor(56, noteNames, degreeTexts, 441, workspace.slots.map((slot) => slot.cents));
    const baseFrame = createHarmonicFrame(workspace, {
      anchorDegree: 56,
      anchorLabel: anchor.label,
      anchorRatioText: anchor.ratio,
      anchorInterval: parseExactInterval(String(anchor.ratio)),
      referenceDegree: 56,
      strategy: "anchor_substitution",
    });
    const mutated = replayModulationHistoryForFrame(workspace, baseFrame, [
      {
        sourceDegree: 0,
        targetDegree: 23,
        strategy: "retune_surface_to_source",
        count: 1,
      },
    ]);
    const spelled = spellWorkspaceForFrame(workspace, mutated, { suppressDeviation: true });

    expect(anchor.label).toBe(`${xn}A`);
    expect(spelled.labelsByDegree[23]).toBe(`${xn}C`);
  });
});
