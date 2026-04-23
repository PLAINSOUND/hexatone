import { describe, it, expect } from "vitest";
import { normalizeColors, normalizeStructural } from "./normalize-settings.js";

describe("normalizeColors", () => {
  it("auto-generates note colors from the spectrum hue when none are present", () => {
    const normalized = normalizeColors({
      spectrum_colors: false,
      fundamental_color: "#f2e3e3",
      note_colors: [],
      equivSteps: 205,
    });

    expect(normalized.fundamental_color).toBe("f2e3e3");
    expect(normalized.note_colors).toHaveLength(205);
    expect(normalized.note_colors.every((color) => /^[0-9a-f]{6}$/i.test(color))).toBe(true);
  });

  it("preserves explicit note colors when they exist", () => {
    const normalized = normalizeColors({
      spectrum_colors: false,
      fundamental_color: "#f2e3e3",
      note_colors: ["#112233", "abcdef"],
      equivSteps: 2,
    });

    expect(normalized.note_colors).toEqual(["112233", "abcdef"]);
  });
});

describe("normalizeStructural", () => {
  it("derives the Keys tuning shape from workspace committed cents", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "no_labels",
      scale: ["9/8", "5/4", "7\\12", "2/1"],
      equivSteps: 4,
      note_names: [],
    });

    expect(normalized.scale).toHaveLength(4);
    expect(normalized.scale[0]).toBe(0);
    expect(normalized.scale[1]).toBeCloseTo(203.91000173077484, 6);
    expect(normalized.scale[2]).toBeCloseTo(386.3137138648348, 6);
    expect(normalized.scale[3]).toBeCloseTo(700, 6);
    expect(normalized.equivInterval).toBeCloseTo(1200, 6);
    expect(normalized.equivSteps).toBe(4);
  });

  it("keeps scala_names sourced from the entered scale text", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "scala_names",
      scale: ["9/8", "5/4", "2/1"],
      equivSteps: 3,
      note_names: [],
    });

    expect(normalized.scala_names).toEqual(["1/1", "9/8", "5/4"]);
  });

  it("supports equave numbers as an independent display toggle", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "no_labels",
      show_equaves: true,
      scale: ["9/8", "5/4", "2/1"],
      equivSteps: 3,
      note_names: [],
    });

    expect(normalized.equaves).toBe(true);
    expect(normalized.no_labels).toBe(true);
  });

  it("prefers an injected tuning runtime for the Keys-facing cents payload", () => {
    const normalized = normalizeStructural(
      {
        rotation: 0,
        key_labels: "no_labels",
        scale: ["9/8", "5/4", "2/1"],
        equivSteps: 3,
        note_names: [],
      },
      {
        tuningRuntime: {
          scale: [0, 111, 222],
          equivInterval: 999,
          equivSteps: 3,
        },
      },
    );

    expect(normalized.scale).toEqual([0, 111, 222]);
    expect(normalized.equivInterval).toBe(999);
  });

  it("derives a tempered A anchor from the computed 440 Hz degree when note_names are non-HEJI", () => {
    const edo22 = Array.from({ length: 22 }, (_, i) => (((i + 1) * 1200) / 22).toFixed(6));
    const noteNames = [
      " Sa ",
      " ReL- ",
      " ReL+ ",
      " Re- ",
      " Re ",
      " GaL ",
      " Ga♭ ",
      " Ga ",
      " Ga+ ",
      " Ma ",
      " Ma+ ",
      " MaL- ",
      " MaL+ ",
      " Pa ",
      " DhaL ",
      " Dha♭ ",
      "Dha",
      " Dha+ ",
      " NiL ",
      " Ni♭ ",
      " Ni ",
      " Ni+ ",
    ];

    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "heji",
      scale: edo22,
      equivSteps: 22,
      note_names: noteNames,
      fundamental: 440,
      reference_degree: 17,
    });

    expect(normalized.heji_anchor_ratio_effective).toBe("927.272727");
    expect(normalized.heji_anchor_label_effective).toBe("\uE2F2A");
  });

  it("derives an exact A anchor from Elsie Hamilton's explicit *nA note name", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "heji",
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
      equivSteps: 12,
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
      fundamental: 441,
      reference_degree: 11,
    });

    expect(normalized.heji_anchor_ratio_effective).toBe("15/8");
    expect(normalized.heji_anchor_label_effective).toBe("A");
  });

  it("falls back to a degree-0-to-440 tempered A anchor for Hamilton 19-limit", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "heji",
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
      equivSteps: 12,
      note_names: ["B", "C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "B"],
      fundamental: 352,
      reference_degree: 7,
    });

    expect(parseFloat(normalized.heji_anchor_ratio_effective)).toBeCloseTo(1088.268712, 5);
    expect(normalized.heji_anchor_label_effective).toBe("A");
  });

  it("prefers an actual 440 Hz scale degree over the degree-0 C fallback in 22-Sruti", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "heji",
      scale: [
        "256/243",
        "16/15",
        "10/9",
        "9/8",
        "32/27",
        "6/5",
        "81/64",
        "5/4",
        "32/25",
        "4/3",
        "1024/729",
        "45/32",
        "64/45",
        "3/2",
        "128/81",
        "8/5",
        "27/16",
        "16/9",
        "9/5",
        "15/8",
        "243/128",
        "2/1",
      ],
      equivSteps: 22,
      note_names: [
        "Sa",
        "ReL-",
        "ReL+",
        "Re-",
        "Re",
        "GaL",
        "Ga♭",
        "Ga",
        "Ga+",
        "Ma",
        "Ma+",
        "MaL-",
        "MaL+",
        "Pa",
        "DhaL",
        "Dha♭",
        "Dha",
        "Dha+",
        "NiL",
        "Ni♭",
        "Ni",
        "Ni+",
      ],
      fundamental: 440,
      reference_degree: 17,
    });

    expect(normalized.heji_anchor_ratio_effective).toBe("27/16");
    expect(normalized.heji_anchor_label_effective).toBe("A");
  });

  it("suppresses HEJI generation on non-octave equaves", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "heji",
      scale: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55"],
      equivSteps: 55,
      note_names: Array.from({ length: 55 }, (_, i) => String(i)),
      fundamental: 294,
      reference_degree: 0,
    });

    expect(normalized.heji_supported).toBe(false);
    expect(normalized.heji_warning).toBe("Non-octave equave cannot generate consistent note names.");
    expect(normalized.heji_anchor_ratio_effective).toBe("");
    expect(normalized.heji_anchor_label_effective).toBe("");
    expect(normalized.heji_names).toEqual([]);
    expect(normalized.heji_names_keys).toEqual([]);
  });
});
