import { describe, expect, it } from "vitest";
import { createScaleWorkspace } from "./workspace.js";
import {
  clearAllTuningPreviews,
  createTuningPreviewState,
  getDegreeDeviationCents,
  getEffectiveDegreeCents,
  getEffectiveFrequencyAtDegree,
  getEffectiveFundamentalHz,
  getEffectiveScaleRuntime,
  hasFundamentalPreview,
  isDegreeComparing,
  isFundamentalComparing,
  setDegreeComparing,
  setDegreePreview,
  setFundamentalComparing,
  setFundamentalPreview,
} from "./tuning-preview-runtime.js";

const workspace = createScaleWorkspace({
  fundamental: 440,
  reference_degree: 1,
  scale: ["100.", "200.", "1200."],
});

describe("tuning-preview-runtime", () => {
  it("starts empty", () => {
    const state = createTuningPreviewState();
    expect(hasFundamentalPreview(state)).toBe(false);
    expect(getEffectiveFundamentalHz(workspace, state)).toBe(440);
  });

  it("applies fundamental preview unless comparing", () => {
    let state = createTuningPreviewState();
    state = setFundamentalPreview(state, 100);

    expect(hasFundamentalPreview(state)).toBe(true);
    expect(getEffectiveFundamentalHz(workspace, state)).toBeCloseTo(440 * Math.pow(2, 100 / 1200), 8);

    state = setFundamentalComparing(state, true);
    expect(isFundamentalComparing(state)).toBe(true);
    expect(getEffectiveFundamentalHz(workspace, state)).toBe(440);
  });

  it("applies degree preview unless comparing", () => {
    let state = createTuningPreviewState();
    state = setDegreePreview(state, 1, 250);

    expect(getEffectiveDegreeCents(workspace, state, 1)).toBe(250);
    expect(getDegreeDeviationCents(workspace, state, 1)).toBe(150);

    state = setDegreeComparing(state, 1, true);
    expect(isDegreeComparing(state, 1)).toBe(true);
    expect(getEffectiveDegreeCents(workspace, state, 1)).toBe(100);
  });

  it("never previews the equave", () => {
    const state = setDegreePreview(createTuningPreviewState(), 3, 1400);
    expect(getEffectiveDegreeCents(workspace, state, 3)).toBe(1200);
    expect(getDegreeDeviationCents(workspace, state, 3)).toBeNull();
  });

  it("resolves effective frequencies from combined preview state", () => {
    let state = createTuningPreviewState();
    state = setFundamentalPreview(state, 50);
    state = setDegreePreview(state, 1, 250);

    const referenceFrequency = getEffectiveFrequencyAtDegree(workspace, state, 1);
    const degreeZeroFrequency = getEffectiveFrequencyAtDegree(workspace, state, 0);

    expect(referenceFrequency).toBeCloseTo(getEffectiveFundamentalHz(workspace, state), 8);
    expect(degreeZeroFrequency).toBeCloseTo(
      getEffectiveFundamentalHz(workspace, state) * Math.pow(2, (0 - 250) / 1200),
      8,
    );
  });

  it("emits effective scale runtime for keyboard consumers", () => {
    let state = createTuningPreviewState();
    state = setFundamentalPreview(state, 25);
    state = setDegreePreview(state, 0, 10);

    const runtime = getEffectiveScaleRuntime(workspace, state);

    expect(runtime.scale).toEqual([10, 100, 200]);
    expect(runtime.equivInterval).toBe(1200);
    expect(runtime.fundamental).toBeCloseTo(440 * Math.pow(2, 25 / 1200), 8);
  });

  it("clears all preview state", () => {
    let state = createTuningPreviewState();
    state = setFundamentalComparing(setFundamentalPreview(state, 50), true);
    state = setDegreeComparing(setDegreePreview(state, 0, 10), 0, true);

    const cleared = clearAllTuningPreviews(state);
    expect(cleared).toEqual(createTuningPreviewState());
  });
});
