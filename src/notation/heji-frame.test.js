import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { createScaleWorkspace } from "../tuning/workspace.js";
import { buildHejiNotationFrame, resolveTypedHejiLabel } from "./heji-frame.js";
import { buildPitchFrame, resolveStructurePitch } from "./pitch-frame.js";
import { parseHejiToStructure } from "./pitch-structure.js";
import KeyLabels from "../settings/scale/key-labels.js";

describe("buildHejiNotationFrame", () => {
  it("derives a D-centered reference monzo from the HEJI anchor frame", () => {
    const settings = {
      scale: ["9/8", "5/4", "4/3", "3/2", "5/3", "15/8", "2/1"],
      reference_degree: 0,
      fundamental: 440,
    };
    const workspace = createScaleWorkspace(settings);
    const frame = buildHejiNotationFrame({
      referenceDegree: 0,
      noteNames: ["C", "D", "E", "F", "G", "A", "B", ""],
      degreeTexts: ["1/1", ...settings.scale],
      fundamental: 440,
      scaleCents: (workspace?.slots ?? []).map((slot) => slot?.cents ?? 0),
      explicitAnchorLabel: "\uE261C",
      explicitAnchorRatio: "1/1",
      workspaceMonzos: (workspace?.slots ?? []).map((slot) => slot?.exactRole?.monzo ?? null),
    });

    expect(frame.anchorLabel).toBe("\uE261C");
    expect(frame.dReferenceDegree).toBe(1);
    expect(frame.dReferenceMonzo).toEqual(workspace.slots[1].exactRole.monzo);
  });

  it("keeps a derived Hamilton exact A anchor when explicit anchor fields are blank", () => {
    const settings = {
      scale: [
        "12/11",
        "8/7",
        "6/5",
        "5/4",
        "4/3",
        "45/32",
        "3/2",
        "8/5",
        "12/7",
        "24/13",
        "15/8",
        "2/1",
      ],
      note_names: [
        "B",
        "C",
        "C",
        "D",
        "*nD",
        "E",
        "*nE",
        "F",
        "G",
        "G",
        "A",
        "*nA",
      ],
      reference_degree: 7,
      fundamental: 440,
    };
    const workspace = createScaleWorkspace(settings);
    const frame = buildHejiNotationFrame({
      referenceDegree: settings.reference_degree,
      noteNames: settings.note_names,
      degreeTexts: ["1/1", ...settings.scale.slice(0, -1)],
      fundamental: settings.fundamental,
      scaleCents: (workspace?.slots ?? []).map((slot) => slot?.cents ?? 0),
      explicitAnchorLabel: "",
      explicitAnchorRatio: "",
      workspaceMonzos: (workspace?.slots ?? []).map((slot) => slot?.exactRole?.monzo ?? null),
    });

    expect(frame.anchorLabel).toBe("\uE261A");
    expect(frame.anchorRatioText).toBe("15/8");
  });

  it("uses abstract D from the HEJI anchor frame as the color center when explicit HEJI note names exist", () => {
    const settings = {
      scale: [
        "12/11",
        "8/7",
        "6/5",
        "5/4",
        "4/3",
        "45/32",
        "3/2",
        "8/5",
        "12/7",
        "24/13",
        "15/8",
        "2/1",
      ],
      note_names: [
        "B",
        "C",
        "C",
        "D",
        "D",
        "E",
        "F",
        "F",
        "G",
        "G",
        "A",
        "B",
      ],
      reference_degree: 7,
      fundamental: 352,
    };
    const workspace = createScaleWorkspace(settings);
    const frame = buildHejiNotationFrame({
      referenceDegree: settings.reference_degree,
      noteNames: settings.note_names,
      degreeTexts: ["1/1", ...settings.scale.slice(0, -1)],
      fundamental: settings.fundamental,
      scaleCents: (workspace?.slots ?? []).map((slot) => slot?.cents ?? 0),
      explicitAnchorLabel: "",
      explicitAnchorRatio: "",
      workspaceMonzos: (workspace?.slots ?? []).map((slot) => slot?.exactRole?.monzo ?? null),
    });

    expect(frame.anchorLabel).toBe("\uE261A");
    expect(frame.anchorRatioText).toBe("15/8");
    expect(frame.dReferenceDegree).toBe(4);
    expect(frame.dReferenceMonzo).toEqual([-2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(frame.dReferenceAbsoluteFifthSteps).toBe(-1);
  });

  it("still derives abstract D from the anchor frame when note names are plain letters", () => {
    const settings = {
      scale: ["9/8", "2/1"],
      note_names: ["A", "C"],
      reference_degree: 0,
      fundamental: 440,
      heji_anchor_label: "A",
      heji_anchor_ratio: "1/1",
    };
    const workspace = createScaleWorkspace(settings);
    const pitchFrame = buildPitchFrame(settings, workspace);
    const expectedResolved = resolveStructurePitch(pitchFrame, parseHejiToStructure("D"));
    const frame = buildHejiNotationFrame({
      referenceDegree: settings.reference_degree,
      noteNames: settings.note_names,
      degreeTexts: ["1/1", ...settings.scale],
      fundamental: settings.fundamental,
      scaleCents: (workspace?.slots ?? []).map((slot) => slot?.cents ?? 0),
      explicitAnchorLabel: settings.heji_anchor_label,
      explicitAnchorRatio: settings.heji_anchor_ratio,
      workspaceMonzos: (workspace?.slots ?? []).map((slot) => slot?.exactRole?.monzo ?? null),
      pitchFrame,
    });

    expect(frame.anchorLabel).toBe("A");
    expect(frame.dReferenceMonzo).toEqual(expectedResolved.degreeRelativeInterval.monzo);
  });

  it("emits structural degree metadata for HEJI-based role and side classification", () => {
    const settings = {
      scale: ["9/8", "5/4", "4/3", "45/32", "2/1"],
      note_names: ["*nC", "*nD", "*nF", "F", "*nC"],
      reference_degree: 0,
      fundamental: 440,
    };
    const workspace = createScaleWorkspace(settings);
    const frame = buildHejiNotationFrame({
      referenceDegree: settings.reference_degree,
      noteNames: settings.note_names,
      degreeTexts: ["1/1", ...settings.scale.slice(0, -1)],
      fundamental: settings.fundamental,
      scaleCents: (workspace?.slots ?? []).map((slot) => slot?.cents ?? 0),
      explicitAnchorLabel: "",
      explicitAnchorRatio: "",
      workspaceMonzos: (workspace?.slots ?? []).map((slot) => slot?.exactRole?.monzo ?? null),
    });

    expect(frame.degreeMetadata[1].notationSide).toBe("core");
    expect(frame.degreeMetadata[3].notationSide).toBe("sharp");
    expect(frame.degreeMetadata[3].notationRole).toBe("chromatic");
    expect(frame.degreeMetadata[4].notationRole).toBe("diatonic");
  });
});

describe("resolveTypedHejiLabel", () => {
  it("resolves an exact HEJI pitch-class label to an existing scale entry", () => {
    const result = resolveTypedHejiLabel({
      text: "\uE261D",
      degreeTexts: ["1/1", "9/8", "5/4", "2/1"],
      scaleCents: [0, 203.91, 386.31, 1200],
      renderedLabels: ["\uE261C", "\uE261D", "\uE261E", "\uE261C"],
    });

    expect(result).toEqual({
      degree: 1,
      scaleText: "9/8",
      matchedExactly: true,
    });
  });

  it("uses a tempered pitch-class target when a typed tempered label includes a deviation", () => {
    const result = resolveTypedHejiLabel({
      text: "\uE2F2D+5",
      degreeTexts: ["1/1", "9/8", "5/4", "2/1"],
      scaleCents: [0, 203.91, 386.31, 1200],
      renderedLabels: ["\uE261C", "\uE261D", "\uE261E", "\uE261C"],
      anchorLabel: "\uE2F2C",
      anchorRatioText: "1/1",
    });

    expect(result).toEqual({
      degree: null,
      scaleText: "205.000000",
      matchedExactly: false,
    });
  });

  it("ignores explicit cents deviation on non-tempered HEJI accidentals", () => {
    const result = resolveTypedHejiLabel({
      text: "\uE261D+5",
      degreeTexts: ["1/1", "9/8", "5/4", "2/1"],
      scaleCents: [0, 203.91, 386.31, 1200],
      renderedLabels: ["\uE261C", "\uE261D", "\uE261E", "\uE261C"],
    });

    expect(result).toEqual({
      degree: 1,
      scaleText: "9/8",
      matchedExactly: true,
    });
  });

  it("computes a tempered cents target from the notation frame when tempered input has no exact scale match", () => {
    const result = resolveTypedHejiLabel({
      text: "\uE2F2F",
      degreeTexts: ["1/1", "517.517706", "4/3", "2/1"],
      scaleCents: [0, 517.517706, 498.045, 1200],
      renderedLabels: ["\uE261C", "\uE261G+19", "\uE261D\u22122", "\uE261C"],
      anchorLabel: "\uE261C",
      anchorRatioText: "1/1",
      workspaceMonzos: [
        [0, 0, 0],
        [0, 1, 0],
        [-2, 0, 1],
        [1, 0, 0],
      ],
    });

    expect(result).toEqual({
      degree: null,
      scaleText: "500.000000",
      matchedExactly: false,
    });
  });

  it("treats a tempered accidental with zero deviation as a tempered pitch target, not an exact pythagorean row", () => {
    const result = resolveTypedHejiLabel({
      text: "\uE2F1B",
      degreeTexts: ["1/1", "16/15", "2/1"],
      scaleCents: [0, 111.731285, 1200],
      renderedLabels: ["\uE261A", "\uE260B", "\uE261A"],
      anchorLabel: "\uE2F2A",
      anchorRatioText: "1/1",
    });

    expect(result).toEqual({
      degree: null,
      scaleText: "100.000000",
      matchedExactly: false,
    });
  });

  it("derives an exact ratio from a non-tempered HEJI spelling when no exact scale row exists", () => {
    const result = resolveTypedHejiLabel({
      text: "\uE261F",
      degreeTexts: ["1/1", "517.517706", "2/1"],
      scaleCents: [0, 517.517706, 1200],
      renderedLabels: ["\uE261C", "\uE261G+19", "\uE261C"],
      anchorLabel: "\uE261C",
      anchorRatioText: "1/1",
      workspaceMonzos: [
        [0, 0, 0],
        [0, 1, 0],
        [1, 0, 0],
      ],
    });

    expect(result).toEqual({
      degree: null,
      scaleText: "4/3",
      matchedExactly: true,
    });
  });

  it("does not let an exact HEJI natural reuse a tempered rendered-label row", () => {
    const result = resolveTypedHejiLabel({
      text: "\uE261B",
      degreeTexts: ["1/1", "200.000000", "2/1"],
      scaleCents: [0, 200, 1200],
      renderedLabels: ["\uE2F2A", "\uE2F2B", "\uE2F2A"],
      anchorLabel: "\uE2F2A",
      anchorRatioText: "1/1",
    });

    expect(result).toEqual({
      degree: null,
      scaleText: "9/8",
      matchedExactly: true,
    });
  });

  it("prefers an exact ratio match over cents fallback for typed natural F", () => {
    const result = resolveTypedHejiLabel({
      text: "*nF",
      degreeTexts: ["1/1", "171/128", "43/32", "4/3", "2/1"],
      scaleCents: [0, 503.421571, 533.179108, 498.044999, 1200],
      renderedLabels: ["\uE261A", "\uE261D+3", "\uE261E+33", "\uE261F\u22128", "\uE261A"],
      anchorLabel: "\uE261A",
      anchorRatioText: "1/1",
      workspaceMonzos: [
        [0, 0, 0, 0],
        [-7, 2, 0, 1],
        [-5, -1, 0, 1],
        [2, -1, 0, 0],
        [1, 0, 0, 0],
      ],
    });

    expect(result).toEqual({
      degree: 3,
      scaleText: "4/3",
      matchedExactly: true,
    });
  });

  it("prefers an exact ratio row when multiple rendered labels share the same pitch class", () => {
    const result = resolveTypedHejiLabel({
      text: "*nF",
      degreeTexts: ["1/1", "517.517706", "4/3", "2/1"],
      scaleCents: [0, 517.517706, 498.044999, 1200],
      renderedLabels: ["\uE261A", "\uE261F+19", "\uE261F\u22128", "\uE261A"],
      anchorLabel: "\uE261A",
      anchorRatioText: "1/1",
      workspaceMonzos: [
        [0, 0, 0, 0],
        [-1, -1, 1, 0],
        [2, -1, 0, 0],
        [1, 0, 0, 0],
      ],
    });

    expect(result).toEqual({
      degree: 2,
      scaleText: "4/3",
      matchedExactly: true,
    });
  });

  it("resolves typed HEJI through pitch_frame before falling back to rendered labels", () => {
    const settings = {
      scale: ["171/128", "43/32", "4/3", "2/1"],
      reference_degree: 0,
      fundamental: 440,
      heji_anchor_label: "\uE261A",
      heji_anchor_ratio: "1/1",
    };
    const workspace = createScaleWorkspace(settings);
    const pitchFrame = buildPitchFrame(settings, workspace);
    const result = resolveTypedHejiLabel({
      text: "*nF",
      degreeTexts: ["1/1", ...settings.scale],
      scaleCents: (workspace?.slots ?? []).map((slot) => slot?.cents ?? 0),
      renderedLabels: ["\uE261A", "\uE261D+3", "\uE261E+33", "\uE261F\u22128", "\uE261A"],
      workspaceMonzos: (workspace?.slots ?? []).map((slot) => slot?.exactRole?.monzo ?? null),
      pitchFrame,
    });

    expect(result).toEqual({
      degree: 3,
      scaleText: "4/3",
      matchedExactly: true,
    });
  });
});

describe("KeyLabels HEJI panel", () => {
  it("shows the HEJI spelling fieldset even when HEJI labels are not selected", () => {
    render(
      <KeyLabels
        onChange={vi.fn()}
        onAtomicChange={vi.fn()}
        heji_names={["\uE261C", "\uE261D"]}
        heji_anchor_label_eff="\uE261C"
        heji_anchor_ratio_eff="1/1"
        heji_supported={true}
        settings={{
          key_labels: "note_names",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    expect(screen.getByText("HEJI Spelling with 0¢ Deviation")).not.toBeNull();
  });
});
