import { describe, it, expect } from "vitest";
import { BASE_BY_ID } from "./heji.js";
import { createReferenceFrame } from "./reference-frame.js";
import { temperedLabel, spelledHejiLabel, spellScaleAsHejiLabels } from "./key-label.js";

// Tempered accidental glyphs (Plainsound font U+E2F1–E2F3).
// Used in the fallback path for non-rational or out-of-basis pitches.
const tb = "\uE2F1"; // tempered flat
const tn = "\uE2F2"; // tempered natural
const ts = "\uE2F3"; // tempered sharp

// Exact HEJI chromatic glyphs — used in the rational HEJI spelling path.
//const xb = BASE_BY_ID["flat:0"].glyph;
const xn = BASE_BY_ID["natural:0"].glyph;

// ── temperedLabel ─────────────────────────────────────────────────────────────
//
// The anchor letter defines which 12-EDO note is at 0 cents.  The chromatic
// table is rotated so that letter aligns with semitone 0.
//
// With anchor A (semitone 9 from C):
//   0¢    → A  (tnA)
//   100¢  → Bb (tbB)
//   200¢  → B  (tnB)
//   300¢  → C  (tnC)
//   400¢  → C# (tsC)
//   500¢  → D  (tnD)
//   600¢  → Eb (tbE)
//   700¢  → E  (tnE)
//   800¢  → F  (tnF)
//   900¢  → F# (tsF)
//   1000¢ → G  (tnG)
//   1100¢ → G# (tsG)

describe("temperedLabel", () => {
  describe("anchor = A", () => {
    it("returns tempered natural A at unison (0¢)", () => {
      expect(temperedLabel(0, "A")).toBe(`${tn}A`);
    });

    it("returns tempered natural E at 700¢ (perfect fifth above A)", () => {
      expect(temperedLabel(700, "A")).toBe(`${tn}E`);
    });

    it("returns tempered natural D at 500¢ (perfect fourth above A)", () => {
      expect(temperedLabel(500, "A")).toBe(`${tn}D`);
    });

    it("returns tempered flat B at 100¢ (minor second above A)", () => {
      expect(temperedLabel(100, "A")).toBe(`${tb}B`);
    });

    it("returns tempered sharp C at 400¢ (major third above A)", () => {
      expect(temperedLabel(400, "A")).toBe(`${ts}C`);
    });

    it("returns tempered natural G at 1000¢ (minor seventh above A)", () => {
      expect(temperedLabel(1000, "A")).toBe(`${tn}G`);
    });
  });

  describe("anchor = C", () => {
    it("returns tempered natural C at 0¢", () => {
      expect(temperedLabel(0, "C")).toBe(`${tn}C`);
    });

    it("returns tempered natural G at 700¢", () => {
      expect(temperedLabel(700, "C")).toBe(`${tn}G`);
    });

    it("returns tempered flat E at 300¢", () => {
      expect(temperedLabel(300, "C")).toBe(`${tb}E`);
    });
  });

  describe("deviation from nearest semitone", () => {
    it("appends +N for cents above the nearest semitone", () => {
      // 718¢ is 18¢ above 700¢ (tnE with anchor A)
      expect(temperedLabel(718, "A")).toBe(`${tn}E+18`);
    });

    it("appends \u2212N for cents below the nearest semitone", () => {
      // 684¢ is 16¢ below 700¢ (tnE with anchor A)
      expect(temperedLabel(684, "A")).toBe(`${tn}E\u221216`);
    });

    it("omits deviation suffix when exactly on a semitone", () => {
      expect(temperedLabel(700, "A")).toBe(`${tn}E`);
    });

    it("can force a +0 suffix when zero-deviation cents must stay visible", () => {
      expect(temperedLabel(700, "A", "natural", { forceZeroDeviation: true })).toBe(`${tn}E+0`);
    });

    it("rounds deviation to nearest integer cent", () => {
      // 700.7¢ → rounds to tnE+1
      expect(temperedLabel(700.7, "A")).toBe(`${tn}E+1`);
    });

    it("snaps to the closer of two equidistant semitones at +50¢", () => {
      // 750¢ is exactly between 700 and 800 — Math.round picks 800 → tnF−50
      expect(temperedLabel(750, "A")).toBe(`${tn}F\u221250`);
    });
  });

  describe("wrapping", () => {
    it("wraps values >= 1200¢ back into range", () => {
      expect(temperedLabel(1200, "A")).toBe(`${tn}A`);
      expect(temperedLabel(1400, "A")).toBe(`${tn}B`);
    });

    it("wraps negative values into range", () => {
      // -200¢ = 1000¢ → tnG with anchor A
      expect(temperedLabel(-200, "A")).toBe(`${tn}G`);
    });
  });
});

// ── spelledHejiLabel — HEJI rational path ─────────────────────────────────────

describe("spelledHejiLabel — rational HEJI path", () => {
  // Anchor: nA = 1/1
  const frame = createReferenceFrame({ anchorLabel: "nA", anchorRatio: "1/1" });

  it("spells 3/2 as exact natural E (pure fifth above A, +2¢ from 12-EDO)", () => {
    // 701.955¢ − 700¢ (12-EDO E) = +2¢ rounded deviation
    const label = spelledHejiLabel(frame, "3/2", 701.955);
    expect(label).toBe(`${xn}E+2`);
  });

  it("spells 1/1 as exact natural A (unison)", () => {
    const label = spelledHejiLabel(frame, "1/1", 0);
    expect(label).toBe(`${xn}A`);
  });

  it("spells 2/1 as exact natural A (octave, pitch-class = unison)", () => {
    const label = spelledHejiLabel(frame, "2/1", 0);
    expect(label).toBe(`${xn}A`);
  });

  it("spells 4/3 as exact natural D (pure fourth above A, −2¢ from 12-EDO)", () => {
    // 498.045¢ − 500¢ (12-EDO D) = −2¢ rounded deviation
    const label = spelledHejiLabel(frame, "4/3", 498.045);
    expect(label).toBe(`${xn}D\u22122`);
  });

  it("spells 5/4 — result contains C (major third, syntonic-down arrow)", () => {
    // 5/4 above A is C# with syntonic-down arrow in HEJI
    const label = spelledHejiLabel(frame, "5/4", 386.314);
    expect(label).toContain("C");
  });

  it("spells 7/4 — result contains G (septimal seventh, septimal-down arrow)", () => {
    const label = spelledHejiLabel(frame, "7/4", 968.826);
    expect(label).toContain("G");
  });
});

// ── spelledHejiLabel — tempered fallback ──────────────────────────────────────

describe("spelledHejiLabel — tempered fallback", () => {
  const frame = createReferenceFrame({ anchorLabel: "nA", anchorRatio: "1/1" });

  it("falls back when ratioText is null (cents-only degree)", () => {
    // 700¢ from anchor → tempered natural E, no deviation
    const label = spelledHejiLabel(frame, null, 700);
    expect(label).toBe(`${tn}E`);
  });

  it("falls back for a cents-only degree with deviation", () => {
    // 386.314¢ — no ratio; nearest semitone 400¢ (tsC), deviation −14
    const label = spelledHejiLabel(frame, null, 386.314);
    expect(label).toBe(`${ts}C\u221214`);
  });

  it("falls back for EDO steps expressed as cents (12-EDO minor third = 300¢)", () => {
    const label = spelledHejiLabel(frame, null, 300);
    expect(label).toBe(`${tn}C`);
  });

  it("falls back for unsupported high-prime ratio (beyond 47-limit)", () => {
    // 53/32 ≈ 872¢ → nearest semitone 900¢ → tsF♯, deviation −28
    const label = spelledHejiLabel(frame, "53/32", 872.0);
    expect(label).toBe(`${ts}F\u221228`);
  });

  it("uses tempered accidentals for rational notes when temperedOnly is enabled", () => {
    const label = spelledHejiLabel(frame, "3/2", 701.955, { temperedOnly: true });
    expect(label).toBe(`${tn}E+2`);
  });

  it("shows +0 in temperedOnly mode when zero-deviation cents are forced visible", () => {
    const label = spelledHejiLabel(frame, "7\\12", 700, {
      temperedOnly: true,
      forceShowZeroDeviation: true,
    });
    expect(label).toBe(`${tn}E+0`);
  });
});

// ── spellScaleAsHejiLabels — mixed rational + tempered ───────────────────────

describe("spellScaleAsHejiLabels", () => {
  const frame = createReferenceFrame({ anchorLabel: "nA", anchorRatio: "1/1" });

  it("spells a purely tempered 12-EDO chromatic scale (all null ratioText)", () => {
    // Degree 0 has ratioText "1/1" so it gets the exact HEJI path; the rest are
    // tempered (null ratioText) and get tempered glyphs.
    const degrees = [
      { ratioText: "1/1", cents: 0    },
      { ratioText: null,  cents: 100  },
      { ratioText: null,  cents: 200  },
      { ratioText: null,  cents: 300  },
      { ratioText: null,  cents: 400  },
      { ratioText: null,  cents: 500  },
      { ratioText: null,  cents: 600  },
      { ratioText: null,  cents: 700  },
      { ratioText: null,  cents: 800  },
      { ratioText: null,  cents: 900  },
      { ratioText: null,  cents: 1000 },
      { ratioText: null,  cents: 1100 },
    ];
    const labels = spellScaleAsHejiLabels(degrees, frame);
    expect(labels[0]).toBe(`${xn}A`);   // exact HEJI 1/1
    expect(labels[1]).toBe(`${tb}B`);
    expect(labels[2]).toBe(`${tn}B`);
    expect(labels[3]).toBe(`${tn}C`);
    expect(labels[4]).toBe(`${ts}C`);
    expect(labels[5]).toBe(`${tn}D`);
    expect(labels[6]).toBe(`${tb}E`);
    expect(labels[7]).toBe(`${tn}E`);
    expect(labels[8]).toBe(`${tn}F`);
    expect(labels[9]).toBe(`${ts}F`);
    expect(labels[10]).toBe(`${tn}G`);
    expect(labels[11]).toBe(`${ts}G`);
  });

  it("spells a mixed JI + tempered scale correctly", () => {
    // 1/1 (exact HEJI), 204¢ (tempered), 3/2 (exact HEJI)
    const degrees = [
      { ratioText: "1/1", cents: 0 },
      { ratioText: null,  cents: 204.0 },
      { ratioText: "3/2", cents: 701.955 },
    ];
    const labels = spellScaleAsHejiLabels(degrees, frame);
    expect(labels[0]).toBe(`${xn}A`);      // exact HEJI 1/1 = A natural, 0¢ deviation
    expect(labels[1]).toBe(`${tn}B+4`);    // 204¢ tempered → nearest 200¢ (tnB), +4¢
    expect(labels[2]).toBe(`${xn}E+2`);   // exact HEJI 3/2 = E natural, +2¢ from 12-EDO
  });
});
