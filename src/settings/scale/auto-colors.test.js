import {
  inferCenterMonzoCandidate,
  inferColorMonzoOffset,
  inferNotationRole,
  inferPrimeChainRole,
} from "./auto-colors.js";

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

describe("inferNotationRole", () => {
  it("treats composite comma-altered labels as chromatic when they include chromatic markers", () => {
    expect(inferNotationRole("F")).toBe("chromatic");
    expect(inferNotationRole("D")).toBe("chromatic");
    expect(inferNotationRole("B")).toBe("chromatic");
  });
});
