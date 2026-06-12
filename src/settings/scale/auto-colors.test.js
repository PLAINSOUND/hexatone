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
        { degree: 0, exactRole: { monzo: [0, 0, 0, 0] }, committedIdentity: { basis: [2, 3, 5, 11] } },
        { degree: 1, exactRole: { monzo: [0, 0, 0, -1] }, committedIdentity: { basis: [2, 3, 5, 11] } }, // 56/55 -> 56:55
        { degree: 2, exactRole: { monzo: [0, 1, 0, -1] }, committedIdentity: { basis: [2, 3, 5, 11] } }, // 57/55
        { degree: 3, exactRole: { monzo: [1, 0, 0, 0] }, committedIdentity: { basis: [2, 3, 5, 11] } }, // 60/55 reduces away 5,11
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
        "64/63", "49/48", "36/35", "28/27", "256/243", "8/7", "7/6", "32/27", "49/40", "6/5",
        "21/16", "4/3", "7/5", "10/7", "1029/686", "3/2", "32/21", "14/9", "8/5", "49/30",
        "5/3", "12/7", "7/4", "16/9", "686/384", "15/8", "40/21", "1029/512", "48/25", "2/1",
      ],
      note_names: [
        "C", "C", "D", "D", "C", "C", "D", "D", "D", "E",
        "E", "D", "D", "E", "E", "E", "F", "F", "F", "G",
        "G", "F", "F", "G", "G", "G", "A", "A", "G", "G",
        "A", "A", "A", "B", "B", "A", "A", "B", "B", "B", "C",
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
        "64/63", "28/27", "256/243", "2187/2048", "243/224", "567/512", "9/8", "8/7", "7/6", "32/27",
        "19683/16384", "2187/1792", "5103/4096", "81/64", "9/7", "21/16", "4/3", "256/189", "112/81", "1024/729",
        "729/512", "81/56", "189/128", "3/2", "32/21", "14/9", "128/81", "6561/4096", "729/448", "1701/1024",
        "27/16", "12/7", "7/4", "16/9", "59049/32768", "6561/3584", "15309/8192", "243/128", "27/14", "63/32", "2/1",
      ],
      note_names: [
        "C", "C", "D", "D", "C", "C", "D", "D", "D", "E",
        "E", "D", "D", "E", "E", "E", "F", "F", "F", "G",
        "G", "F", "F", "G", "G", "G", "A", "A", "G", "G",
        "A", "A", "A", "B", "B", "A", "A", "B", "B", "B", "C",
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

describe("inferCenterMonzoCandidate", () => {
  it("prefers a pure-3 D candidate over a plainer non-3-limit D in Taylor-style labels", () => {
    const workspace = {
      slots: [
        { exactRole: { monzo: [-1, -1, 0, 1] } }, // plain-looking but septimal 7/6 D
        { exactRole: { monzo: [-3, 2, 0, 0] } },  // pure-3 9/8 D
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
        { exactRole: { monzo: [-4, 1, 0, 1, 0] }, committedIdentity: { basis, monzo: [-4, 1, 0, 1, 0] } },
        { exactRole: { monzo: [-3, 0, 1, -1, 0] }, committedIdentity: { basis, monzo: [-3, 0, 1, -1, 0] } },
        { exactRole: { monzo: [-2, 0, 0, 0, 1] }, committedIdentity: { basis, monzo: [-2, 0, 0, 0, 1] } },
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
  it("does not re-center harmonic-series and odd-partial color analysis around an inferred D", () => {
    const workspace = {
      slots: [
        { exactRole: { monzo: [0, 0, 0] }, committedIdentity: { basis: [2, 3, 5], monzo: [0, 0, 0] } },
        { exactRole: { monzo: [-2, 0, 1] }, committedIdentity: { basis: [2, 3, 5], monzo: [-2, 0, 1] } },
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
        { exactRole: { monzo: [0, 0, 0] }, committedIdentity: { basis: [2, 3, 5], monzo: [0, 0, 0] } },
        { exactRole: { monzo: [-2, 0, 1] }, committedIdentity: { basis: [2, 3, 5], monzo: [-2, 0, 1] } },
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
});
