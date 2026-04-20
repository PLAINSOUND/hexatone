import { describe, expect, it } from "vitest";
import { buildBatchRationalisationReferenceMonzos } from "./rationalise.js";

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
});
