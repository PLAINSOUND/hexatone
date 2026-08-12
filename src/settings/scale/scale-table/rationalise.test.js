import { parseExactInterval } from "../../../tuning/interval.js";
import { describe, expect, it } from "vitest";
import {
  buildBatchRationalisationReferenceMonzos,
  liftRationalCandidateToAbsoluteCents,
} from "./rationalise.js";

describe("scale-table batch rationalisation semantics", () => {
  it("keeps committed anchors in keep-existing mode", () => {
    const preCommittedMonzos = [[1], [2]];
    const pass1Monzos = [[10], [11], [12]];

    expect(
      buildBatchRationalisationReferenceMonzos({
        keepExisting: true,
        preCommittedMonzos,
        pass1Monzos,
        degreeIndex: 1,
      }),
    ).toEqual([[1], [2], [10], [12]]);
  });

  it("drops committed anchors in re-search-all mode", () => {
    const preCommittedMonzos = [[1], [2]];
    const pass1Monzos = [[10], [11], [12]];

    expect(
      buildBatchRationalisationReferenceMonzos({
        keepExisting: false,
        preCommittedMonzos,
        pass1Monzos,
        degreeIndex: 1,
      }),
    ).toEqual([[10], [12]]);
  });

  it("lifts a pitch-class candidate into the target octave before commit", () => {
    const interval = parseExactInterval("3/2");
    const lifted = liftRationalCandidateToAbsoluteCents(
      {
        ratio: interval.ratio,
        ratioText: "3/2",
        monzo: interval.monzo,
        cents: interval.cents,
        deviation: 0,
      },
      interval.cents + 1200,
    );

    expect(lifted.ratioText).toBe("3/1");
    expect(lifted.cents).toBeCloseTo(interval.cents + 1200, 6);
  });

  it("maps octave-equivalent unisons to 2/1, 4/1, etc at exact 1200-cent multiples", () => {
    const interval = parseExactInterval("1/1");
    const lifted = liftRationalCandidateToAbsoluteCents(
      {
        ratio: interval.ratio,
        ratioText: "1/1",
        monzo: interval.monzo,
        cents: interval.cents,
        deviation: 0,
      },
      2400,
    );

    expect(lifted.ratioText).toBe("4/1");
    expect(lifted.cents).toBe(2400);
  });

  it("preserves descending absolute ratios below unison", () => {
    const interval = parseExactInterval("32/33");
    const pitchClassCents = interval.cents + 1200;
    const lifted = liftRationalCandidateToAbsoluteCents(
      {
        ratio: parseExactInterval("64/33").ratio,
        ratioText: "64/33",
        monzo: parseExactInterval("64/33").monzo,
        cents: pitchClassCents,
        deviation: 0,
      },
      interval.cents,
    );

    expect(lifted.ratioText).toBe("32/33");
    expect(lifted.cents).toBeCloseTo(interval.cents, 6);
  });
});
