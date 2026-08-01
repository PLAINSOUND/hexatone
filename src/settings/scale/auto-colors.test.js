import {
  buildResolvedAutoColorOptions,
  deriveAutoNoteColors,
  inferCenterMonzoCandidate,
  inferChromaticOverlayPrimes,
  inferColorMonzoOffset,
  inferNotationSide,
  inferNotationRole,
  inferPrimeChainRole,
} from "./auto-colors.js";
import { createScaleWorkspace } from "../../tuning/workspace.js";

describe("inferColorMonzoOffset", () => {
  it("factors out a shared raw denominator when reduced monzos no longer share the offset", () => {
    const workspace = {
      slots: [
        {
          degree: 0,
          exactRole: { monzo: [0, 0, 0, 0] },
          committedIdentity: { basis: [2, 3, 5, 11] },
        },
        {
          degree: 1,
          exactRole: { monzo: [0, 0, 0, -1] },
          committedIdentity: { basis: [2, 3, 5, 11] },
        }, // 56/55 -> 56:55
        {
          degree: 2,
          exactRole: { monzo: [0, 1, 0, -1] },
          committedIdentity: { basis: [2, 3, 5, 11] },
        }, // 57/55
        {
          degree: 3,
          exactRole: { monzo: [1, 0, 0, 0] },
          committedIdentity: { basis: [2, 3, 5, 11] },
        }, // 60/55 reduces away 5,11
      ],
    };
    const settings = {
      scale: ["56/55", "57/55", "60/55", "110/55"],
    };

    expect(inferColorMonzoOffset(workspace, settings)).toEqual([0, 0, -1, -1]);
  });
});

describe("inferPrimeChainRole", () => {
  it("prefers explicit notation roles for sparse Breed-style overtonal 5 chains", () => {
    const basis = [2, 3, 5];
    const workspace = {
      slots: [
        { committedIdentity: { basis, monzo: [4, -4, 1] } },
        { committedIdentity: { basis, monzo: [3, -3, 1] } },
        { committedIdentity: { basis, monzo: [1, -2, 1] } },
        { committedIdentity: { basis, monzo: [0, -1, 1] } },
        { committedIdentity: { basis, monzo: [-2, 0, 1] } },
        { committedIdentity: { basis, monzo: [-4, 1, 1] } },
        { committedIdentity: { basis, monzo: [-5, 2, 1] } },
        { committedIdentity: { basis, monzo: [-7, 3, 1] } },
      ],
    };
    const autoColorOptions = {
      noteRoleLabels: ["D", "A", "E", "B", "F", "C", "G", "D"],
    };

    expect(inferPrimeChainRole(workspace, 4, autoColorOptions)).toBe("chromatic");
    expect(inferPrimeChainRole(workspace, 5, autoColorOptions)).toBe("chromatic");
    expect(inferPrimeChainRole(workspace, 6, autoColorOptions)).toBe("chromatic");
    expect(inferPrimeChainRole(workspace, 7, autoColorOptions)).toBe("chromatic");
    expect(inferPrimeChainRole(workspace, 0, autoColorOptions)).toBe("diatonic");
  });

  it("keeps Oliveros 4/3 F on the white D-centered pythagorean spine", () => {
    const settings = {
      name: "18-Oliveros Septimal-Quintal",
      short_description: "18-JI-7L",
      key_labels: "note_names",
      fundamental: 440,
      reference_degree: 31,
      scale: [
        "135/128",
        "16/15",
        "9/8",
        "7/6",
        "6/5",
        "5/4",
        "4/3",
        "45/32",
        "64/45",
        "3/2",
        "14/9",
        "8/5",
        "5/3",
        "27/16",
        "7/4",
        "16/9",
        "15/8",
        "15/8",
        "2/1",
      ],
      note_names: [
        "C",
        "C",
        "D",
        "D",
        "C",
        "E",
        "E",
        "F",
        "G",
        "C",
        "G",
        "C",
        "A",
        "A",
        "C",
        "B",
        "C",
        "B",
        "C",
      ],
    };
    const workspace = createScaleWorkspace(settings);
    const autoColorOptions = buildResolvedAutoColorOptions(settings, workspace, {
      keyLabels: settings.key_labels,
      noteNames: settings.note_names,
    });

    expect(autoColorOptions.centerAbsoluteFifthSteps).toBe(2);
    expect(deriveAutoNoteColors(settings, { workspace })[7]).toBe("#ffffff");
    expect(inferPrimeChainRole(workspace, 8, autoColorOptions)).toBe("chromatic");
    expect(deriveAutoNoteColors(settings, { workspace })[8]).toBe("#dad5c1");
    expect(deriveAutoNoteColors(settings, { workspace })[9]).toBe("#e9e1b4");
  });

  it("keeps natural-base septimal notes on the diatonic 7-family in 41-Septimal-Tertial", () => {
    const settings = {
      name: "41-Septimal-Tertial",
      short_description: "41-JI-7L(MS-LMY)",
      key_labels: "note_names",
      fundamental: 440,
      reference_degree: 24,
      scale: [
        "64/63",
        "49/48",
        "36/35",
        "28/27",
        "256/243",
        "8/7",
        "7/6",
        "32/27",
        "49/40",
        "6/5",
        "21/16",
        "4/3",
        "7/5",
        "10/7",
        "1029/686",
        "3/2",
        "32/21",
        "14/9",
        "8/5",
        "49/30",
        "5/3",
        "12/7",
        "7/4",
        "16/9",
        "686/384",
        "15/8",
        "40/21",
        "1029/512",
        "48/25",
        "2/1",
      ],
      note_names: [
        "C",
        "C",
        "D",
        "D",
        "C",
        "C",
        "D",
        "D",
        "D",
        "E",
        "E",
        "D",
        "D",
        "E",
        "E",
        "E",
        "F",
        "F",
        "F",
        "G",
        "G",
        "F",
        "F",
        "G",
        "G",
        "G",
        "A",
        "A",
        "G",
        "G",
        "A",
        "A",
        "A",
        "B",
        "B",
        "A",
        "A",
        "B",
        "B",
        "B",
        "C",
      ],
    };
    const workspace = createScaleWorkspace(settings);
    const autoColorOptions = buildResolvedAutoColorOptions(settings, workspace, {
      keyLabels: settings.key_labels,
      noteNames: settings.note_names,
    });
    const colors = deriveAutoNoteColors(settings, { workspace });

    expect(inferPrimeChainRole(workspace, 6, autoColorOptions)).toBe("diatonic");
    expect(inferPrimeChainRole(workspace, 18, autoColorOptions)).toBe("diatonic");
    expect(inferPrimeChainRole(workspace, 23, autoColorOptions)).toBe("diatonic");
    expect(colors[6]).toBe("#e5b9bb");
    expect(colors[18]).toBe("#ffe5e5");
    expect(colors[23]).toBe("#ffe5e5");
  });

  it("keeps undertonal septimal naturals and chromatics coherent in 41-Septimal-Tertial", () => {
    const settings = {
      name: "41-Septimal-Tertial",
      short_description: "41-JI-7L(MS-LMY)",
      key_labels: "note_names",
      fundamental: 440,
      reference_degree: 24,
      scale: [
        "64/63",
        "28/27",
        "256/243",
        "2187/2048",
        "243/224",
        "567/512",
        "9/8",
        "8/7",
        "7/6",
        "32/27",
        "19683/16384",
        "2187/1792",
        "5103/4096",
        "81/64",
        "9/7",
        "21/16",
        "4/3",
        "256/189",
        "112/81",
        "1024/729",
        "729/512",
        "81/56",
        "189/128",
        "3/2",
        "32/21",
        "14/9",
        "128/81",
        "6561/4096",
        "729/448",
        "1701/1024",
        "27/16",
        "12/7",
        "7/4",
        "16/9",
        "59049/32768",
        "6561/3584",
        "15309/8192",
        "243/128",
        "27/14",
        "63/32",
        "2/1",
      ],
      note_names: [
        "C",
        "C",
        "D",
        "D",
        "C",
        "C",
        "D",
        "D",
        "D",
        "E",
        "E",
        "D",
        "D",
        "E",
        "E",
        "E",
        "F",
        "F",
        "F",
        "G",
        "G",
        "F",
        "F",
        "G",
        "G",
        "G",
        "A",
        "A",
        "G",
        "G",
        "A",
        "A",
        "A",
        "B",
        "B",
        "A",
        "A",
        "B",
        "B",
        "B",
        "C",
      ],
    };
    const workspace = createScaleWorkspace(settings);
    const colors = deriveAutoNoteColors(settings, { workspace });

    expect(colors[15]).toBe("#e5b9bb");
    expect(colors[32]).toBe("#e5b9bb");
    expect(colors[39]).toBe("#e5b9bb");
    expect(colors[5]).toBe("#bfaaa9");
    expect(colors[22]).toBe("#bfaaa9");
    expect(colors[29]).toBe("#bfaaa9");
  });
});

describe("auto-colour label mode consistency", () => {
  it("does not treat a rational scale as an EDO merely because equivSteps matches its size", () => {
    const settings = {
      scale: ["7/6", "3/2", "7/4", "2/1"],
      equivSteps: 4,
      note_names: ["C", "E", "G", "B"],
      note_colors: ["#ffffff", "#d3c6c5", "#ffffff", "#ffe5e5"],
      reference_degree: 0,
      fundamental: 440,
      heji_anchor_ratio: "1/1",
      heji_anchor_label: "C",
    };

    const hejiColors = deriveAutoNoteColors({ ...settings, key_labels: "heji" });
    const nameColors = deriveAutoNoteColors({ ...settings, key_labels: "note_names" });

    expect(nameColors).toEqual(hejiColors);
    expect(nameColors[1]).toBe("#ffe5e5");
    expect(nameColors[3]).toBe("#ffe5e5");
  });
});

describe("inferCenterMonzoCandidate", () => {
  it("prefers a pure-3 D candidate over a plainer non-3-limit D in Taylor-style labels", () => {
    const workspace = {
      slots: [
        { exactRole: { monzo: [-1, -1, 0, 1] } }, // plain-looking but septimal 7/6 D
        { exactRole: { monzo: [-3, 2, 0, 0] } }, // pure-3 9/8 D
      ],
    };
    const labels = ["D", "D"];

    expect(inferCenterMonzoCandidate(workspace, labels)?.monzo).toEqual([-3, 2, 0, 0]);
  });
});

describe("inferChromaticOverlayPrimes", () => {
  it("requires a pure undertonal 7 dimension before enabling septimal chromatic darkening", () => {
    const basis = [2, 3, 5, 7, 11];
    const workspace = {
      slots: [
        {
          exactRole: { monzo: [-4, 1, 0, 1, 0] },
          committedIdentity: { basis, monzo: [-4, 1, 0, 1, 0] },
        },
        {
          exactRole: { monzo: [-3, 0, 1, -1, 0] },
          committedIdentity: { basis, monzo: [-3, 0, 1, -1, 0] },
        },
        {
          exactRole: { monzo: [-2, 0, 0, 0, 1] },
          committedIdentity: { basis, monzo: [-2, 0, 0, 0, 1] },
        },
      ],
    };

    expect(inferChromaticOverlayPrimes(workspace)).toMatchObject({
      5: true,
      7: false,
      11: false,
    });
  });
});

describe("buildResolvedAutoColorOptions", () => {
  it("keeps the default A-anchored D center when plain note names do not explicitly name D", () => {
    const settings = {
      key_labels: "note_names",
      note_names: ["A", "C"],
      scale: ["9/8", "2/1"],
      reference_degree: 0,
      fundamental: 440,
      heji_anchor_label: "A",
      heji_anchor_ratio: "1/1",
    };
    const workspace = createScaleWorkspace(settings);
    const autoColorOptions = buildResolvedAutoColorOptions(settings, workspace, {
      keyLabels: settings.key_labels,
      noteNames: settings.note_names,
    });

    expect(autoColorOptions.centerAbsoluteFifthSteps).toBe(-1);
  });

  it("does not re-center harmonic-series and odd-partial color analysis around an inferred D", () => {
    const workspace = {
      slots: [
        {
          exactRole: { monzo: [0, 0, 0] },
          committedIdentity: { basis: [2, 3, 5], monzo: [0, 0, 0] },
        },
        {
          exactRole: { monzo: [-2, 0, 1] },
          committedIdentity: { basis: [2, 3, 5], monzo: [-2, 0, 1] },
        },
      ],
    };
    const settings = {
      name: "55-Critical Band",
      short_description: "55-HS_A_TenneyCB",
      key_labels: "note_names",
      note_names: ["A", "D"],
      prime_family_colors: [],
      scale: ["5/4", "2/1"],
    };

    const resolved = buildResolvedAutoColorOptions(settings, workspace, {
      keyLabels: settings.key_labels,
      noteNames: settings.note_names,
    });

    expect(resolved.structuralOverlay).toBe("none");
    expect(resolved.centerMonzo).toBeUndefined();
    expect(resolved.centerAbsoluteFifthSteps).toBeUndefined();
  });

  it("still infers a notation-relative center for structural fifths overlays", () => {
    const workspace = {
      slots: [
        {
          exactRole: { monzo: [0, 0, 0] },
          committedIdentity: { basis: [2, 3, 5], monzo: [0, 0, 0] },
        },
        {
          exactRole: { monzo: [-2, 0, 1] },
          committedIdentity: { basis: [2, 3, 5], monzo: [-2, 0, 1] },
        },
      ],
    };
    const settings = {
      name: "Elsie Hamilton Subharmonic Modes",
      short_description: "12-HamiltonModes",
      key_labels: "note_names",
      note_names: ["A", "D"],
      prime_family_colors: [],
      scale: ["5/4", "2/1"],
    };

    const resolved = buildResolvedAutoColorOptions(settings, workspace, {
      keyLabels: settings.key_labels,
      noteNames: settings.note_names,
    });

    expect(resolved.structuralOverlay).toBe("fifths");
    expect(resolved.centerMonzo).toBeUndefined();
    expect(resolved.centerAbsoluteFifthSteps).toBe(-1);
  });

  it("disables structural chromatic darkening for non-octave equaves", () => {
    const settings = {
      name: "31-Divided Fifth (ratios repeating at the 3/2)",
      short_description: "31-JI-7L",
      key_labels: "note_names",
      note_names: ["C", "D", "E", "F", "G"],
      prime_family_colors: [],
      scale: ["8/7", "7/6", "5/4", "35/24", "3/2"],
    };
    const workspace = createScaleWorkspace(settings);

    const resolved = buildResolvedAutoColorOptions(settings, workspace, {
      keyLabels: settings.key_labels,
      noteNames: settings.note_names,
    });

    expect(workspace.baseScale.equaveCents).not.toBeCloseTo(1200, 3);
    expect(resolved.structuralOverlay).toBe("none");
  });
});

describe("deriveAutoNoteColors", () => {
  it("colors zero-deviation tempered chromatics like the 12edo preset even when the row is cents-only", () => {
    const settings = {
      key_labels: "heji",
      note_names: ["A", "B"],
      scale: ["100.000000", "2/1"],
      reference_degree: 0,
      fundamental: 440,
      heji_anchor_label: "A",
      heji_anchor_ratio: "1/1",
      auto_colors: true,
    };
    const workspace = createScaleWorkspace(settings);

    expect(deriveAutoNoteColors(settings, { workspace })[1]).toBe("#c3c3d5");
  });

  it("matches the built-in 12edo tempered auto-colour palette for note-name labels", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "C",
        "C D",
        "D",
        "D E",
        "E",
        "F",
        "F G",
        "G",
        "G A",
        "A",
        "A B",
        "B",
      ],
      scale: [
        "100.000000",
        "200.000000",
        "300.000000",
        "400.000000",
        "500.000000",
        "600.000000",
        "700.000000",
        "800.000000",
        "900.000000",
        "1000.000000",
        "1100.000000",
        "2/1",
      ],
      reference_degree: 9,
      fundamental: 440,
      auto_colors: true,
    };
    const workspace = createScaleWorkspace(settings);

    expect(deriveAutoNoteColors(settings, { workspace })).toEqual([
      "#ff9d9d",
      "#c3c3d5",
      "#ededf7",
      "#c3c3d5",
      "#ededf7",
      "#ededf7",
      "#c3c3d5",
      "#ededf7",
      "#c3c3d5",
      "#ededf7",
      "#c3c3d5",
      "#ededf7",
    ]);
  });

  it("splits flats and sharps for 19edo-style traditional tempered note names", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "♯c",
        "♭d",
        "d",
        "♯d",
        "♭e",
        "e",
        "♯e ♭f",
        "f",
        "♯f",
        "♭g",
        "g",
        "♯g",
        "♭a",
        "a",
        "♯a",
        "♭b",
        "b",
        "♯b ♭c",
      ],
      scale: Array.from({ length: 19 }, (_, index) =>
        index === 18 ? "2/1" : `${(((index + 1) * 1200) / 19).toFixed(6)}`,
      ),
      equivSteps: 19,
      reference_degree: 14,
      fundamental: 440,
      auto_colors: true,
      name: "19edo (Salinas 1577)",
      short_description: "19edo (Salinas)",
    };
    const workspace = createScaleWorkspace(settings);

    expect(deriveAutoNoteColors(settings, { workspace })).toEqual([
      "#ff9d9d",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#d1d5dd",
      "#ffffff",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#d1d5dd",
    ]);
  });

  it("matches Salinas-style auto colors for 19edo enharmonic septimal notation", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "c d",
        "c d",
        "d",
        "d e",
        "d e",
        "e",
        "e f",
        "f",
        "f g",
        "f g",
        "g",
        "g a",
        "g a",
        "a",
        "a b",
        "a b",
        "b",
        "b c",
      ],
      scale: Array.from({ length: 19 }, (_, index) =>
        index === 18 ? "2/1" : `${(((index + 1) * 1200) / 19).toFixed(6)}`,
      ),
      equivSteps: 19,
      reference_degree: 14,
      fundamental: 440,
      auto_colors: true,
      name: "19edo (enharmonic Septimal notation)",
      short_description: "19edo (Salinas)",
    };
    const workspace = createScaleWorkspace(settings);

    expect(deriveAutoNoteColors(settings, { workspace })).toEqual([
      "#ff9d9d",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#d1d5dd",
      "#ffffff",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#cfdad8",
      "#d2cfe1",
      "#ffffff",
      "#d1d5dd",
    ]);
  });

  it("keeps 22edo HEJI naturals white while darkening altered D/F/G-region spellings", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "C",
        "D",
        "C D",
        "D",
        "D",
        "E",
        "E",
        "E",
        "E",
        "F",
        "F G",
        "F G",
        "F G",
        "G",
        "A",
        "A",
        "A",
        "A",
        "B",
        "B",
        "B",
        "B",
      ],
      scale: Array.from({ length: 22 }, (_, index) =>
        index === 21 ? "2/1" : `${(((index + 1) * 1200) / 22).toFixed(6)}`,
      ),
      equivSteps: 22,
      reference_degree: 17,
      fundamental: 440,
      auto_colors: true,
      name: "22edo (HEJI)",
      short_description: "22edo",
    };
    const workspace = createScaleWorkspace(settings);
    const colors = deriveAutoNoteColors(settings, { workspace });

    expect(colors[4]).toBe("#ffffff");
    expect(colors[9]).toBe("#ffffff");
    expect(colors[13]).toBe("#ffffff");
    expect(colors[1]).toBe("#d0d0d7");
    expect(colors[3]).toBe("#fffae5");
    expect(colors[7]).toBe("#fffae5");
    expect(colors[16]).toBe("#fffae5");
    expect(colors[20]).toBe("#fffae5");
    expect(colors[11]).toBe("#d1d5dd");
    expect(colors[12]).toBe("#e7eadf");
  });

  it("copies the curated Tonal Plexus palette for 205ed2 in auto mode", () => {
    const settings = {
      key_labels: "note_names",
      note_names: ["0", "1"],
      note_colors: ["#112233", "#445566"],
      scale: ["100.000000", "2/1"],
      equivSteps: 2,
      reference_degree: 0,
      fundamental: 440,
      auto_colors: true,
      name: "205ed2 (TonalPlexus)",
      short_description: "205ed2",
    };
    const workspace = createScaleWorkspace(settings);

    expect(deriveAutoNoteColors(settings, { workspace })).toEqual(["#112233", "#445566"]);
  });

  it("inherits manual accidental-rank families for 31edo traditional notation", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "♭♭d",
        "♯c",
        "♭d",
        "♯♯c",
        "d",
        "♭♭e",
        "♯d",
        "♭e",
        "♯♯d",
        "e",
        "♭f",
        "♯e",
        "f",
        "♭♭g",
        "♯f",
        "♭g",
        "♯♯f",
        "g",
        "♭♭a",
        "♯g",
        "♭a",
        "♯♯g",
        "a",
        "♭♭b",
        "♯a",
        "♭b",
        "♯♯a",
        "b",
        "♭c",
        "♯b",
      ],
      note_colors: [
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#e2dfcf",
        "#eee9d3",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#e2dfcf",
        "#eee9d3",
      ],
      scale: Array.from({ length: 31 }, (_, index) =>
        index === 30 ? "2/1" : `${(((index + 1) * 1200) / 31).toFixed(6)}`,
      ),
      equivSteps: 31,
      reference_degree: 23,
      fundamental: 440,
      auto_colors: true,
      name: "31edo (gbb-a##)",
      short_description: "31edo",
    };
    const workspace = createScaleWorkspace(settings);
    const colors = deriveAutoNoteColors(settings, { workspace });

    expect(colors[1]).toBe("#eff4e7");
    expect(colors[3]).toBe("#e2dfcf");
    expect(colors[4]).toBe("#dddae2");
    expect(colors[30]).toBe("#eee9d3");
  });

  it("inherits quartertone accidental families and hybrids for 31edo quartertone notation", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "c",
        "♯c",
        "♭d",
        "d",
        "d",
        "d",
        "♯d",
        "♭e",
        "e",
        "e",
        "e ♭f",
        "♯e f",
        "f",
        "f",
        "♯f",
        "♭g",
        "g",
        "g",
        "g",
        "♯g",
        "♭a",
        "a",
        "a",
        "a",
        "♯a",
        "♭b",
        "b",
        "b",
        "b ♭c",
        "♯b c",
      ],
      note_colors: [
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#e7e9d7",
        "#e5e2db",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#e7e9d7",
        "#e5e2db",
      ],
      scale: Array.from({ length: 31 }, (_, index) =>
        index === 30 ? "2/1" : `${(((index + 1) * 1200) / 31).toFixed(6)}`,
      ),
      equivSteps: 31,
      reference_degree: 23,
      fundamental: 440,
      auto_colors: true,
      name: "31edo (quartertone notation)",
      short_description: "31edo",
    };
    const workspace = createScaleWorkspace(settings);
    const colors = deriveAutoNoteColors(settings, { workspace });

    expect(colors[1]).toBe("#eff4e7");
    expect(colors[4]).toBe("#dddae2");
    expect(colors[11]).toBe("#e7e9d7");
    expect(colors[30]).toBe("#e5e2db");
  });

  it("inherits Vicentino accidental families for 31edo Vicentino notation", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "c",
        "c",
        "d",
        "d",
        "d",
        "d",
        "d",
        "e",
        "e",
        "e",
        "e",
        "e",
        "f",
        "f",
        "f",
        "g",
        "g",
        "g",
        "g",
        "g",
        "a",
        "a",
        "a",
        "a",
        "a",
        "b",
        "b",
        "b",
        "b",
        "b",
      ],
      note_colors: [
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
        "#e2dfcf",
        "#dddae2",
        "#f9f7eb",
        "#eff4e7",
        "#eee9d3",
      ],
      scale: Array.from({ length: 31 }, (_, index) =>
        index === 30 ? "2/1" : `${(((index + 1) * 1200) / 31).toFixed(6)}`,
      ),
      equivSteps: 31,
      reference_degree: 23,
      fundamental: 440,
      auto_colors: true,
      name: "31edo (in Vicentino Notation, 1555)",
      short_description: "31edo",
    };
    const workspace = createScaleWorkspace(settings);
    const colors = deriveAutoNoteColors(settings, { workspace });

    expect(colors[1]).toBe("#eff4e7");
    expect(colors[3]).toBe("#e2dfcf");
    expect(colors[4]).toBe("#dddae2");
    expect(colors[30]).toBe("#eee9d3");
  });

  it("inherits triple-rank traditional accidental families for 43edo notation", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "♭♭d",
        "♯♯b",
        "♯c",
        "♭d",
        "♭♭♭e",
        "♯♯c",
        "d",
        "♭♭e",
        "♯♯♯c",
        "♯d",
        "♭e",
        "♭♭f",
        "♯♯d",
        "e",
        "♭f",
        "♯♯♯d",
        "♯e",
        "f",
        "♭♭g",
        "♯♯e",
        "♯f",
        "♭g",
        "♭♭♭a",
        "♯♯f",
        "g",
        "♭♭a",
        "♯♯♯f",
        "♯g",
        "♭a",
        "♭♭♭b",
        "♯♯g",
        "a",
        "♭♭b",
        "♯♯♯g",
        "♯a",
        "♭b",
        "♭♭c",
        "♯♯a",
        "b",
        "♭c",
        "♭♭♭d",
        "♯b",
      ],
      note_colors: [
        "#ffffff",
        "#ffe5e5",
        "#fffae5",
        "#dee2da",
        "#d0d0d7",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#dee2da",
        "#d0d0d7",
        "#ffe5e5",
        "#fffae5",
        "#ffffff",
        "#d0d0d7",
        "#e4fbe6",
        "#dee2da",
        "#ffffff",
        "#ffe5e5",
        "#fffae5",
        "#dee2da",
        "#d0d0d7",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#dee2da",
        "#d0d0d7",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#dee2da",
        "#d0d0d7",
        "#ffe5e5",
        "#fffae5",
        "#ffffff",
        "#d0d0d7",
        "#cee3e2",
        "#dee2da",
      ],
      scale: Array.from({ length: 43 }, (_, index) =>
        index === 42 ? "2/1" : `${(((index + 1) * 1200) / 43).toFixed(6)}`,
      ),
      equivSteps: 43,
      reference_degree: 32,
      fundamental: 440,
      auto_colors: true,
      name: "43edo (Sauveur 1696, dbbb-d###)",
      short_description: "43edo",
    };
    const workspace = createScaleWorkspace(settings);
    const colors = deriveAutoNoteColors(settings, { workspace });

    expect(colors[1]).toBe("#ffe5e5");
    expect(colors[5]).toBe("#cee3e2");
    expect(colors[9]).toBe("#e4fbe6");
    expect(colors[10]).toBe("#dee2da");
  });

  it("inherits four-rank traditional accidental families for 55edo Telemann notation", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "♭♭d",
        "♭♭♭♭e",
        "♯♯b",
        "♯c",
        "♭d",
        "♭♭♭e",
        "♯♯♯b",
        "♯♯c",
        "d",
        "♭♭e",
        "♭♭♭f",
        "♯♯♯c",
        "♯d",
        "♭e",
        "♭♭f",
        "♯♯♯♯c",
        "♯♯d",
        "e",
        "♭f",
        "♭♭♭g",
        "♯♯♯d",
        "♯e",
        "f",
        "♭♭g",
        "♭♭♭♭a",
        "♯♯e",
        "♯f",
        "♭g",
        "♭♭♭a",
        "♯♯♯e",
        "♯♯f",
        "g",
        "♭♭a",
        "♭♭♭♭b",
        "♯♯♯f",
        "♯g",
        "♭a",
        "♭♭♭b",
        "♯♯♯♯f",
        "♯♯g",
        "a",
        "♭♭b",
        "♭♭♭c",
        "♯♯♯g",
        "♯a",
        "♭b",
        "♭♭c",
        "♯♯♯♯g",
        "♯♯a",
        "b",
        "♭c",
        "♭♭♭d",
        "♯♯♯a",
        "♯b",
      ],
      note_colors: [
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#fffae5",
        "#dee2da",
        "#d0d0d7",
        "#dce1d0",
        "#f8ffeb",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#dce1d0",
        "#f8ffeb",
        "#dee2da",
        "#d0d0d7",
        "#ffe5e5",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#d0d0d7",
        "#dce1d0",
        "#f8ffeb",
        "#dee2da",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#fffae5",
        "#dee2da",
        "#d0d0d7",
        "#dce1d0",
        "#f8ffeb",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#f8ffeb",
        "#dee2da",
        "#d0d0d7",
        "#dce1d0",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#dce1d0",
        "#f8ffeb",
        "#dee2da",
        "#d0d0d7",
        "#ffe5e5",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#d0d0d7",
        "#dce1d0",
        "#f8ffeb",
        "#dee2da",
      ],
      scale: Array.from({ length: 55 }, (_, index) =>
        index === 54 ? "2/1" : `${(((index + 1) * 1200) / 55).toFixed(6)}`,
      ),
      equivSteps: 55,
      reference_degree: 41,
      fundamental: 440,
      auto_colors: true,
      name: "55edo (Telemann 1767, abbbb-g####)",
      short_description: "55edo",
    };
    const workspace = createScaleWorkspace(settings);
    const colors = deriveAutoNoteColors(settings, { workspace });

    expect(colors[2]).toBe("#e4fbe6");
    expect(colors[7]).toBe("#f8ffeb");
    expect(colors[16]).toBe("#cee3e2");
    expect(colors[48]).toBe("#cee3e2");
  });

  it("keeps committed auto colours stable when 43edo accidental families are re-derived", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "♭♭d",
        "♯♯b",
        "♯c",
        "♭d",
        "♭♭♭e",
        "♯♯c",
        "d",
        "♭♭e",
        "♯♯♯c",
        "♯d",
        "♭e",
        "♭♭f",
        "♯♯d",
        "e",
        "♭f",
        "♯♯♯d",
        "♯e",
        "f",
        "♭♭g",
        "♯♯e",
        "♯f",
        "♭g",
        "♭♭♭a",
        "♯♯f",
        "g",
        "♭♭a",
        "♯♯♯f",
        "♯g",
        "♭a",
        "♭♭♭b",
        "♯♯g",
        "a",
        "♭♭b",
        "♯♯♯g",
        "♯a",
        "♭b",
        "♭♭c",
        "♯♯a",
        "b",
        "♭c",
        "♭♭♭d",
        "♯b",
      ],
      note_colors: [
        "#ffffff",
        "#ffe5e5",
        "#fffae5",
        "#dee2da",
        "#d0d0d7",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#dee2da",
        "#d0d0d7",
        "#ffe5e5",
        "#fffae5",
        "#ffffff",
        "#d0d0d7",
        "#e4fbe6",
        "#dee2da",
        "#ffffff",
        "#ffe5e5",
        "#fffae5",
        "#dee2da",
        "#d0d0d7",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#dee2da",
        "#d0d0d7",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#dee2da",
        "#d0d0d7",
        "#ffe5e5",
        "#fffae5",
        "#ffffff",
        "#d0d0d7",
        "#cee3e2",
        "#dee2da",
      ],
      scale: Array.from({ length: 43 }, (_, index) =>
        index === 42 ? "2/1" : `${(((index + 1) * 1200) / 43).toFixed(6)}`,
      ),
      equivSteps: 43,
      reference_degree: 32,
      fundamental: 440,
      auto_colors: true,
      name: "43edo (Sauveur 1696, dbbb-d###)",
      short_description: "43edo",
    };
    const workspace = createScaleWorkspace(settings);
    const first = deriveAutoNoteColors(settings, { workspace });
    const second = deriveAutoNoteColors({ ...settings, note_colors: first }, { workspace });

    expect(second).toEqual(first);
  });

  it("keeps committed auto colours stable when 55edo accidental families are re-derived", () => {
    const settings = {
      key_labels: "note_names",
      note_names: [
        "c",
        "♭♭d",
        "♭♭♭♭e",
        "♯♯b",
        "♯c",
        "♭d",
        "♭♭♭e",
        "♯♯♯b",
        "♯♯c",
        "d",
        "♭♭e",
        "♭♭♭f",
        "♯♯♯c",
        "♯d",
        "♭e",
        "♭♭f",
        "♯♯♯♯c",
        "♯♯d",
        "e",
        "♭f",
        "♭♭♭g",
        "♯♯♯d",
        "♯e",
        "f",
        "♭♭g",
        "♭♭♭♭a",
        "♯♯e",
        "♯f",
        "♭g",
        "♭♭♭a",
        "♯♯♯e",
        "♯♯f",
        "g",
        "♭♭a",
        "♭♭♭♭b",
        "♯♯♯f",
        "♯g",
        "♭a",
        "♭♭♭b",
        "♯♯♯♯f",
        "♯♯g",
        "a",
        "♭♭b",
        "♭♭♭c",
        "♯♯♯g",
        "♯a",
        "♭b",
        "♭♭c",
        "♯♯♯♯g",
        "♯♯a",
        "b",
        "♭c",
        "♭♭♭d",
        "♯♯♯a",
        "♯b",
      ],
      note_colors: [
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#fffae5",
        "#dee2da",
        "#d0d0d7",
        "#dce1d0",
        "#f8ffeb",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#dce1d0",
        "#f8ffeb",
        "#dee2da",
        "#d0d0d7",
        "#ffe5e5",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#d0d0d7",
        "#dce1d0",
        "#f8ffeb",
        "#dee2da",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#fffae5",
        "#dee2da",
        "#d0d0d7",
        "#dce1d0",
        "#f8ffeb",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#e4fbe6",
        "#f8ffeb",
        "#dee2da",
        "#d0d0d7",
        "#dce1d0",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#ffe5e5",
        "#dce1d0",
        "#f8ffeb",
        "#dee2da",
        "#d0d0d7",
        "#ffe5e5",
        "#cee3e2",
        "#fffae5",
        "#ffffff",
        "#d0d0d7",
        "#dce1d0",
        "#f8ffeb",
        "#dee2da",
      ],
      scale: Array.from({ length: 55 }, (_, index) =>
        index === 54 ? "2/1" : `${(((index + 1) * 1200) / 55).toFixed(6)}`,
      ),
      equivSteps: 55,
      reference_degree: 41,
      fundamental: 440,
      auto_colors: true,
      name: "55edo (Telemann 1767, abbbb-g####)",
      short_description: "55edo",
    };
    const workspace = createScaleWorkspace(settings);
    const first = deriveAutoNoteColors(settings, { workspace });
    const second = deriveAutoNoteColors({ ...settings, note_colors: first }, { workspace });

    expect(second).toEqual(first);
  });
});

describe("inferNotationRole", () => {
  it("treats composite comma-altered labels as chromatic when they include chromatic markers", () => {
    expect(inferNotationRole("F")).toBe("chromatic");
    expect(inferNotationRole("D")).toBe("chromatic");
    expect(inferNotationRole("B")).toBe("chromatic");
  });

  it("does not classify bare letter names, but does classify explicit naturals", () => {
    expect(inferNotationRole("D")).toBe(null);
    expect(inferNotationRole("G")).toBe(null);
    expect(inferNotationRole("D")).toBe("diatonic");
    expect(inferNotationRole("*nD")).toBe("diatonic");
  });

  it("treats lowercase traditional natural note names as diatonic and accidental forms as chromatic", () => {
    expect(inferNotationRole("d")).toBe("diatonic");
    expect(inferNotationRole("a")).toBe("diatonic");
    expect(inferNotationRole("♯c")).toBe("chromatic");
    expect(inferNotationRole("♭e")).toBe("chromatic");
  });

  it("classifies accidentals by sounding white-key pitch rather than by the symbol alone", () => {
    expect(inferNotationRole("F")).toBe("diatonic");
    expect(inferNotationRole("C")).toBe("diatonic");
    expect(inferNotationRole("E")).toBe("diatonic");
    expect(inferNotationRole("B")).toBe("diatonic");
    expect(inferNotationRole("F")).toBe("chromatic");
    expect(inferNotationRole("B")).toBe("chromatic");
    expect(inferNotationRole("Fb")).toBe("diatonic");
    expect(inferNotationRole("E#")).toBe("diatonic");
  });

  it("keeps traditional white-key enharmonics white in the final EDO palette", () => {
    const scale = Array.from({ length: 12 }, (_, index) => `${(index + 1) * 100}.0`);
    const noteNames = ["C", "C#", "D", "D#", "Fb", "E#", "F#", "G", "G#", "A", "A#", "Cb"];
    const colors = deriveAutoNoteColors({
      scale,
      equivSteps: 12,
      note_names: noteNames,
      note_colors: noteNames.map((name) =>
        name.includes("b") || name.includes("#") ? "#777777" : "#ffffff",
      ),
      key_labels: "note_names",
      reference_degree: 0,
      fundamental: 440,
    });

    expect(colors[4]).toBe("#ffffff");
    expect(colors[5]).toBe("#ffffff");
    expect(colors[11]).toBe("#ffffff");
    expect(colors[6]).not.toBe("#ffffff");
  });
});

describe("inferNotationSide", () => {
  it("treats D-flat-family HEJI notes as flat-side rather than core", () => {
    expect(inferNotationSide("D")).toBe("flat");
    expect(inferNotationSide("D")).toBe("flat");
    expect(inferNotationSide("D")).toBe("sharp");
    expect(inferNotationSide("D")).toBe("core");
  });

  it("does not classify bare letter names, but can still allow implicit natural when requested", () => {
    expect(inferNotationSide("D")).toBe(null);
    expect(inferNotationSide("G")).toBe(null);
    expect(inferNotationSide("D", { allowImplicitNatural: true })).toBe("core");
    expect(inferNotationSide("G", { allowImplicitNatural: true })).toBe("flat");
  });

  it("classifies lowercase traditional note names by side", () => {
    expect(inferNotationSide("d")).toBe("core");
    expect(inferNotationSide("g")).toBe("flat");
    expect(inferNotationSide("a")).toBe("sharp");
    expect(inferNotationSide("♭e")).toBe("flat");
    expect(inferNotationSide("♯c")).toBe("sharp");
  });
});
