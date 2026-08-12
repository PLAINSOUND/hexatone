import { createScaleWorkspace } from "../tuning/workspace.js";
import {
  buildPitchFrame,
  pitchToDisplayCents,
  pitchToDisplayRatio,
  pitchToFrequency,
  resolveDegreePitch,
  resolveStructurePitch,
} from "./pitch-frame.js";

describe("notation/pitch-frame", () => {
  const workspace = createScaleWorkspace({
    scale: ["9/8", "5/4", "3/2", "2/1"],
    reference_degree: 3,
    fundamental: 440,
    heji_anchor_label: "A",
    heji_anchor_ratio: "3/2",
  });

  it("builds a frame from HEJI anchor spelling, anchor ratio, and reference degree", () => {
    const frame = buildPitchFrame(
      {
        heji_anchor_label: "A",
        heji_anchor_ratio: "3/2",
        reference_degree: 3,
        fundamental: 440,
      },
      workspace,
    );

    expect(frame.notationZero.label).toBe("A");
    expect(frame.degree0ToNotationZeroInterval.ratioText).toBe("3/2");
    expect(frame.notationZeroToDegree0Interval.ratioText).toBe("2/3");
    expect(frame.degree0ToReferenceInterval?.ratio?.toFraction()).toBe("3/2");
    expect(frame.referenceFrequencyHz).toBe(440);
  });

  it("resolves a workspace degree relative to notation zero", () => {
    const frame = buildPitchFrame(
      {
        heji_anchor_label: "A",
        heji_anchor_ratio: "3/2",
        reference_degree: 3,
        fundamental: 440,
      },
      workspace,
    );
    const degreePitch = resolveDegreePitch(frame, 3);

    expect(pitchToDisplayRatio(degreePitch)).toBe("1/1");
    expect(pitchToDisplayCents(degreePitch)).toBeCloseTo(0, 8);
    expect(pitchToFrequency(degreePitch)).toBeCloseTo(440, 8);
  });

  it("resolves a spelled structure through the central frame", () => {
    const frame = buildPitchFrame(
      {
        heji_anchor_label: "A",
        heji_anchor_ratio: "3/2",
        reference_degree: 3,
        fundamental: 440,
      },
      workspace,
    );
    const pitch = resolveStructurePitch(frame, {
      letter: "B",
      accidentalCount: 0,
      syntonic: 0,
      primeExponents: {},
      cautionaryNatural: true,
      useDoubles: true,
      useDoubleSeptimals: true,
    });

    expect(pitch.notationRelativeInterval.ratioText).toBe("9/8");
    expect(pitch.degreeRelativeInterval?.ratio?.toFraction()).toBe("27/16");
    expect(pitch.cents).toBeCloseTo(
      workspace.lookup.byDegree.get(1).cents + workspace.lookup.byDegree.get(3).cents,
      8,
    );
    expect(pitch.frequencyHz).toBeCloseTo(495, 6);
  });
});
