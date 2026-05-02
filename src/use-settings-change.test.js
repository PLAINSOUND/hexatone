import { resizeScaleWithEquavePadding } from "./use-settings-change.js";

describe("resizeScaleWithEquavePadding", () => {
  it("grows by repeating the current equave and padding names/colors from degree 0", () => {
    const settings = {
      scale: ["100.", "200.", "3/1"],
      note_names: ["C", "D", "E"],
      note_colors: ["#111111", "#222222", "#333333"],
    };

    expect(resizeScaleWithEquavePadding(settings, 5)).toEqual({
      scale: ["100.", "200.", "3/1", "3/1", "3/1"],
      note_names: ["C", "D", "E", "C", "C"],
      note_colors: ["#111111", "#222222", "#333333", "#111111", "#111111"],
    });
  });

  it("truncates scale, names, and colors when shrinking", () => {
    const settings = {
      scale: ["100.", "200.", "300.", "2/1"],
      note_names: ["C", "D", "E", "F"],
      note_colors: ["#111111", "#222222", "#333333", "#444444"],
    };

    expect(resizeScaleWithEquavePadding(settings, 2)).toEqual({
      scale: ["100.", "200."],
      note_names: ["C", "D"],
      note_colors: ["#111111", "#222222"],
    });
  });

  it("falls back to a default equave and root metadata when scale data is sparse", () => {
    const settings = {
      scale: [],
      note_names: [],
      note_colors: [],
    };

    expect(resizeScaleWithEquavePadding(settings, 3)).toEqual({
      scale: ["2/1", "2/1", "2/1"],
      note_names: ["", "", ""],
      note_colors: ["#ffffff", "#ffffff", "#ffffff"],
    });
  });
});
