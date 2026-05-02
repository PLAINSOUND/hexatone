import { deleteScaleDegree, moveScaleDegree, sortScaleDegreesAscending } from "./sort-scale.js";

describe("sortScaleDegreesAscending", () => {
  it("sorts interior scale degrees and remaps coupled metadata", () => {
    const settings = {
      scale: ["700.", "100.", "500.", "2/1"],
      note_names: ["root", "fifth", "second", "fourth"],
      note_colors: ["#000000", "#555555", "#111111", "#333333"],
      reference_degree: 2,
      center_degree: 3,
    };

    expect(sortScaleDegreesAscending(settings)).toEqual({
      scale: ["100.", "500.", "700.", "2/1"],
      note_names: ["root", "second", "fourth", "fifth"],
      note_colors: ["#000000", "#111111", "#333333", "#555555"],
      reference_degree: 1,
      center_degree: 2,
    });
  });

  it("keeps degree 0 and the equave fixed", () => {
    const settings = {
      scale: ["300.", "100.", "2/1"],
      note_names: ["1/1", "third", "second"],
      note_colors: ["#ffffff", "#333333", "#111111"],
      reference_degree: 0,
      center_degree: 2,
    };

    expect(sortScaleDegreesAscending(settings)).toEqual({
      scale: ["100.", "300.", "2/1"],
      note_names: ["1/1", "second", "third"],
      note_colors: ["#ffffff", "#111111", "#333333"],
      reference_degree: 0,
      center_degree: 1,
    });
  });

  it("returns null when there are no sortable interior degrees", () => {
    expect(sortScaleDegreesAscending({ scale: ["2/1"] })).toBeNull();
    expect(sortScaleDegreesAscending({ scale: ["100.", "2/1"] })).toBeNull();
  });
});

describe("moveScaleDegree", () => {
  it("moves an interior degree and remaps coupled metadata", () => {
    const settings = {
      scale: ["700.", "100.", "500.", "2/1"],
      note_names: ["root", "fifth", "second", "fourth"],
      note_colors: ["#000000", "#555555", "#111111", "#333333"],
      reference_degree: 2,
      center_degree: 3,
    };

    expect(moveScaleDegree(settings, 3, 1)).toEqual({
      scale: ["500.", "700.", "100.", "2/1"],
      note_names: ["root", "fourth", "fifth", "second"],
      note_colors: ["#000000", "#333333", "#555555", "#111111"],
      reference_degree: 3,
      center_degree: 1,
    });
  });

  it("returns null for invalid or no-op moves", () => {
    const settings = { scale: ["100.", "200.", "2/1"] };
    expect(moveScaleDegree(settings, 1, 1)).toBeNull();
    expect(moveScaleDegree(settings, 0, 1)).toBeNull();
    expect(moveScaleDegree(settings, 1, 3)).toBeNull();
  });
});

describe("deleteScaleDegree", () => {
  it("deletes an interior degree, shrinks the scale, and remaps coupled metadata", () => {
    const settings = {
      scale: ["700.", "100.", "500.", "2/1"],
      note_names: ["root", "fifth", "second", "fourth"],
      note_colors: ["#000000", "#555555", "#111111", "#333333"],
      reference_degree: 2,
      center_degree: 3,
      equivSteps: 4,
    };

    expect(deleteScaleDegree(settings, 2)).toEqual({
      equivSteps: 3,
      scale: ["700.", "500.", "2/1"],
      note_names: ["root", "fifth", "fourth"],
      note_colors: ["#000000", "#555555", "#333333"],
      reference_degree: 1,
      center_degree: 2,
    });
  });

  it("returns null for invalid deletions", () => {
    const settings = { scale: ["100.", "200.", "2/1"] };
    expect(deleteScaleDegree(settings, 0)).toBeNull();
    expect(deleteScaleDegree(settings, 3)).toBeNull();
  });
});
