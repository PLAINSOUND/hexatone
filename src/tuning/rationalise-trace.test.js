import { describe, it } from "vitest";
import { findRationalCandidates, enumerateCandidatesFromBounds, scoreRationalCandidate, selectRationalisationContext } from "./rationalise.js";
import { createScaleWorkspace } from "./workspace.js";

describe("12-EDO degree 4 trace", () => {
  it("prints candidate list and key interval cents", () => {
    const scale12 = ["100.0","200.0","300.0","400.0","500.0","600.0","700.0","800.0","900.0","1000.0","1100.0","1200.0"];
    const settings = { scale: scale12, reference_degree: 0, fundamental: 261.63 };
    const workspace = createScaleWorkspace(settings);

    const targetDegree = 4;
    const targetCents = 400.0;
    const primeBounds = { 3:8, 5:3, 7:2, 11:2, 13:2, 17:1, 19:1 };
    const options = {
      primeLimit: 19,
      primeBounds,
      primeBoundsUt: { ...primeBounds },
      oddLimit: 255,
      centsTolerance: 6,
      contextTolerance: 14,
      maxCandidates: 8,
      region: "symmetric",
      workspace,
      targetDegree,
    };

    // Key interval cents
    const intervals = {
      "5/4":   1200 * Math.log2(5/4),
      "81/64": 1200 * Math.log2(81/64),
      "121/96":1200 * Math.log2(121/96),
      "9/7":   1200 * Math.log2(9/7),
      "14/11": 1200 * Math.log2(14/11),
    };
    console.log("\n=== Key interval cents vs 400¢ ===");
    for (const [r, c] of Object.entries(intervals)) {
      console.log(`  ${r.padEnd(8)} ${c.toFixed(3)}¢  dev: ${(c - 400).toFixed(3)}¢`);
    }

    // Full enumeration before context scoring
    console.log("\n=== Raw enumeration (sorted by cheapBaseScore) ===");
    const raw = enumerateCandidatesFromBounds(targetCents, options);
    for (const c of raw.slice(0, 16)) {
      console.log(`  ${c.ratioText?.padEnd(12)} ${c.cents.toFixed(2)}¢  dev:${c.deviation.toFixed(2)}  hr:${c.harmonicRadius.toFixed(3)}`);
    }

    // Context-scored final list
    console.log("\n=== Final candidates (sorted by aggregateScore) ===");
    const candidates = findRationalCandidates(targetCents, options);
    for (const c of candidates) {
      console.log(
        `  ${c.ratioText?.padEnd(12)} ${c.cents.toFixed(2)}¢` +
        `  dev:${c.deviation.toFixed(2)}` +
        `  hr:${c.harmonicRadius.toFixed(3)}` +
        `  s_ctx:${c.contextualConsonance.toFixed(3)}` +
        `  s_oton:${c.branchExtent.toFixed(3)}` +
        `  agg:${c.aggregateScore.toFixed(3)}` +
        `  s:${c.globalScore.toFixed(3)}`
      );
    }

    // Specifically check if 81/64 is in the raw enumeration
    const has8164 = raw.some(c => c.ratioText === "81/64");
    console.log(`\n81/64 in raw enumeration: ${has8164}`);
    const r8164 = raw.find(c => c.ratioText === "81/64");
    if (r8164) {
      console.log(`  81/64: cents=${r8164.cents.toFixed(3)} dev=${r8164.deviation.toFixed(3)} hr=${r8164.harmonicRadius.toFixed(3)} oddLimit=${r8164.oddLimit}`);
    } else {
      // Why not? deviation = 407.82 - 400 = 7.82¢ > 6¢ tolerance
      const dev8164 = 1200 * Math.log2(81/64) - targetCents;
      console.log(`  81/64 deviation from 400¢ = ${dev8164.toFixed(3)}¢  (centsTolerance = ${options.centsTolerance}¢)`);
    }

    // What is the context scoring doing for 121/96 vs 5/4?
    console.log("\n=== Context scoring: 5/4 vs 121/96 ===");
    const context = selectRationalisationContext(workspace, targetDegree, options);
    console.log(`  Context slots: ${context.committedSlots.map(s => s.cents?.toFixed(1) + "¢").join(", ")}`);
    for (const ratioText of ["5/4", "121/96", "81/64", "9/7", "14/11"]) {
      const c = raw.find(r => r.ratioText === ratioText);
      if (!c) { console.log(`  ${ratioText}: not in enumeration`); continue; }
      const scored = scoreRationalCandidate({ ...c }, context, options);
      console.log(
        `  ${ratioText.padEnd(10)} s_ctx:${scored.contextualConsonance.toFixed(3)}` +
        `  s_oton:${scored.branchExtent.toFixed(3)}` +
        `  agg:${scored.aggregateScore.toFixed(3)}`
      );
    }
  });
});
