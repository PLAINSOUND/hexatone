import { parseExactInterval } from "./interval.js";
import {
  clearWorkspacePreview,
  commitWorkspacePreview,
  createScaleWorkspace,
  getWorkspaceSlot,
  normalizeWorkspaceForKeys,
  setWorkspacePreview,
} from "./workspace.js";

describe("tuning/workspace", () => {
  const settings = {
    scale: ["9/8", "5/4", "7\\12", "2/1"],
    reference_degree: 0,
    fundamental: 440,
  };

  it("builds degree 0 as exact 1/1", () => {
    const workspace = createScaleWorkspace(settings);
    const degree0 = getWorkspaceSlot(workspace, 0);
    expect(degree0.committedIdentity.ratio.toFraction()).toBe("1");
    expect(degree0.exactRole.exact).toBe(true);
  });

  it("separates equave from slots", () => {
    const workspace = createScaleWorkspace(settings);
    expect(workspace.baseScale.equaveText).toBe("2/1");
    expect(workspace.baseScale.equaveInterval.ratio.toFraction()).toBe("2");
    expect(workspace.slots).toHaveLength(4);
  });

  it("preserves exact ratios where entered", () => {
    const workspace = createScaleWorkspace(settings);
    const slot = getWorkspaceSlot(workspace, 2);
    expect(slot.sourceText).toBe("5/4");
    expect(slot.exactRole.ratioText).toBe("5/4");
    expect(slot.analysis.support).toBe("exact");
  });

  it("marks EDO entries inexact", () => {
    const workspace = createScaleWorkspace(settings);
    const slot = getWorkspaceSlot(workspace, 3);
    expect(slot.analysis.support).toBe("edo");
    expect(slot.exactRole.exact).toBe(false);
  });

  it("keeps preview identity separate from committed identity", () => {
    const workspace = createScaleWorkspace(settings);
    const preview = parseExactInterval("81/64");
    const updated = setWorkspacePreview(workspace, 2, preview, preview.cents);
    expect(getWorkspaceSlot(updated, 2).previewIdentity.ratio.toFraction()).toBe("81/64");
    expect(getWorkspaceSlot(updated, 2).committedIdentity.ratio.toFraction()).toBe("5/4");
  });

  it("clearWorkspacePreview removes only preview state", () => {
    const workspace = createScaleWorkspace(settings);
    const preview = parseExactInterval("81/64");
    const updated = setWorkspacePreview(workspace, 2, preview, preview.cents);
    const cleared = clearWorkspacePreview(updated, 2);
    expect(getWorkspaceSlot(cleared, 2).previewIdentity).toBeNull();
    expect(getWorkspaceSlot(cleared, 2).committedIdentity.ratio.toFraction()).toBe("5/4");
  });

  it("commitWorkspacePreview promotes preview into committed identity", () => {
    const workspace = createScaleWorkspace(settings);
    const preview = parseExactInterval("81/64");
    const updated = setWorkspacePreview(workspace, 2, preview, preview.cents);
    const committed = commitWorkspacePreview(updated, 2);
    const slot = getWorkspaceSlot(committed, 2);
    expect(slot.committedIdentity.ratio.toFraction()).toBe("81/64");
    expect(slot.previewIdentity).toBeNull();
    expect(slot.sourceText).toBe("81/64");
  });

  it("normalizes committed intervals into the Keys-facing runtime shape", () => {
    const workspace = createScaleWorkspace(settings);
    const runtime = normalizeWorkspaceForKeys(workspace);
    expect(runtime.degreeIntervals).toHaveLength(4);
    expect(runtime.degreeIntervals[0].ratio.toFraction()).toBe("1");
    expect(runtime.degreeIntervals[2].ratio.toFraction()).toBe("5/4");
    expect(runtime.equaveInterval.ratio.toFraction()).toBe("2");
  });
});
