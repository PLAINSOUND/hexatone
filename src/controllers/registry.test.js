import { describe, it, expect } from "vitest";
import {
  CONTROLLER_REGISTRY,
  detectController,
  normalizeTonalPlexus41Input,
  normalizeTonalPlexus41InputWithSettings,
  normalizeTonalPlexus205Degree,
} from "./registry.js";

const getController = (id) => CONTROLLER_REGISTRY.find((controller) => controller.id === id);

describe("controller registry", () => {
  it("detects known controller device names", () => {
    expect(detectController("C-Thru AXIS-49 2A")?.id).toBe("axis49");
    expect(detectController("Lumatone MIDI Function")?.id).toBe("lumatone");
    expect(detectController("Tonal Plexus")?.id).toBe("tonalplexus");
    expect(detectController("Intuitive Instruments Exquis")?.id).toBe("exquis");
    expect(detectController("Roger Linn Design LinnStrument 128")?.id).toBe("linnstrument128");
    expect(detectController("Unknown Device")).toBeNull();
  });

  it("places the anchor key at (0, 0) for representative controllers", () => {
    const axis49 = getController("axis49");
    const lumatone = getController("lumatone");
    const tonalPlexus = getController("tonalplexus");
    const exquis = getController("exquis");

    expect(axis49.buildMap(53).get("1.53")).toEqual({ x: 0, y: 0 });
    expect(lumatone.buildMap(26, 3).get("3.26")).toEqual({ x: 0, y: 0 });
    expect(tonalPlexus.buildMap(7, 9).get("9.7")).toEqual({ x: 0, y: 0 });
    expect(exquis.buildMap(19).get("1.19")).toEqual({ x: 0, y: 0 });
  });

  it("builds maps with the expected key counts", () => {
    expect(getController("tonalplexus").buildMap(7, 9).size).toBe(1266);
    expect(getController("axis49").buildMap(53).size).toBe(98);
    expect(getController("ts41").buildMap(36).size).toBe(126);
    expect(getController("lumatone").buildMap(26, 3).size).toBe(280);
    expect(getController("push2").buildMap(36).size).toBe(43);
    expect(getController("launchpad").buildMap(36).size).toBe(64);
    expect(getController("exquis").buildMap(19).size).toBe(61);
    expect(getController("linnstrument128").buildMap(56).size).toBe(128);
    expect(getController("generic").buildMap).toBeUndefined();
  });

  it("collapses inferred TPX seam aliases onto shared physical coordinates", () => {
    const tonalPlexus = getController("tonalplexus");
    const map = tonalPlexus.buildMap(7, 9);

    expect(map.get("9.18")).toEqual(map.get("9.17"));
    expect(map.get("9.36")).toEqual(map.get("9.35"));
    expect(map.get("9.52")).toEqual(map.get("9.51"));
    expect(map.get("9.69")).toEqual(map.get("9.68"));
    expect(map.get("9.88")).toEqual(map.get("9.87"));

    const blockCoords = new Set(
      Array.from(map.entries())
        .filter(([key]) => key.startsWith("9.") || key.startsWith("10."))
        .map(([, { x, y }]) => `${x},${y}`),
    );
    expect(blockCoords.size).toBe(206);
  });

  it("normalizes Tonal Plexus raw addresses into 41 slots per block", () => {
    expect(normalizeTonalPlexus41Input(9, 7)).toEqual({ channel: 4, note: 2 });
    expect(normalizeTonalPlexus41Input(9, 103)).toEqual({ channel: 4, note: 21 });
    expect(normalizeTonalPlexus41Input(10, 1)).toEqual({ channel: 4, note: 21 });
    expect(normalizeTonalPlexus41Input(10, 75)).toEqual({ channel: 4, note: 36 });
  });

  it("adds TPX top-end bonus notes for 42–45 note scales without renumbering the 41 base slots", () => {
    expect(normalizeTonalPlexus41InputWithSettings(10, 105, { equivSteps: 42 })).toEqual({
      channel: 4,
      note: 42,
    });
    expect(normalizeTonalPlexus41InputWithSettings(10, 104, { equivSteps: 43 })).toEqual({
      channel: 4,
      note: 42,
    });
    expect(normalizeTonalPlexus41InputWithSettings(10, 105, { equivSteps: 43 })).toEqual({
      channel: 4,
      note: 43,
    });
    expect(normalizeTonalPlexus41InputWithSettings(10, 103, { equivSteps: 45 })).toEqual({
      channel: 4,
      note: 43,
    });
    expect(normalizeTonalPlexus41InputWithSettings(10, 101, { equivSteps: 45 })).toEqual({
      channel: 4,
      note: 41,
    });
  });

  it("adds TPX bottom-end bonus notes for 46–49 note scales while keeping the base 41 slots fixed", () => {
    expect(normalizeTonalPlexus41InputWithSettings(9, 0, { equivSteps: 46 })).toEqual({
      channel: 4,
      note: 0,
    });
    expect(normalizeTonalPlexus41InputWithSettings(9, 0, { equivSteps: 49 })).toEqual({
      channel: 4,
      note: -3,
    });
    expect(normalizeTonalPlexus41InputWithSettings(9, 3, { equivSteps: 49 })).toEqual({
      channel: 4,
      note: 0,
    });
    expect(normalizeTonalPlexus41InputWithSettings(9, 4, { equivSteps: 49 })).toEqual({
      channel: 4,
      note: 1,
    });
    expect(normalizeTonalPlexus41InputWithSettings(10, 105, { equivSteps: 49 })).toEqual({
      channel: 4,
      note: 45,
    });
  });

  it("fully splits both TPX extreme 5-note groups for 51+ note scales", () => {
    expect(normalizeTonalPlexus41InputWithSettings(10, 101, { equivSteps: 53 })).toEqual({
      channel: 4,
      note: 42,
    });
    expect(normalizeTonalPlexus41InputWithSettings(10, 105, { equivSteps: 53 })).toEqual({
      channel: 4,
      note: 46,
    });
    expect(normalizeTonalPlexus41InputWithSettings(9, 0, { equivSteps: 53 })).toEqual({
      channel: 4,
      note: -4,
    });
    expect(normalizeTonalPlexus41InputWithSettings(9, 4, { equivSteps: 53 })).toEqual({
      channel: 4,
      note: 0,
    });
  });

  it("normalizes TPX raw addresses into one 205edo cycle per block", () => {
    expect(normalizeTonalPlexus205Degree(9, 7)).toEqual({ block: 3, degree: 0 });
    expect(normalizeTonalPlexus205Degree(9, 17)).toEqual({ block: 3, degree: 10 });
    expect(normalizeTonalPlexus205Degree(9, 18)).toEqual({ block: 3, degree: 10 });
    expect(normalizeTonalPlexus205Degree(9, 68)).toEqual({ block: 3, degree: 60 });
    expect(normalizeTonalPlexus205Degree(9, 69)).toEqual({ block: 3, degree: 60 });
    expect(normalizeTonalPlexus205Degree(9, 104)).toEqual({ block: 3, degree: 95 });
    expect(normalizeTonalPlexus205Degree(10, 0)).toEqual({ block: 3, degree: 95 });
    expect(normalizeTonalPlexus205Degree(10, 35)).toEqual({ block: 3, degree: 130 });
    expect(normalizeTonalPlexus205Degree(10, 36)).toEqual({ block: 3, degree: 130 });
    expect(normalizeTonalPlexus205Degree(10, 105)).toEqual({ block: 3, degree: 197 });
  });

  it("places the LinnStrument anchor at (0,0) and maps all 128 pads", () => {
    const linn = getController("linnstrument128");
    // Default anchor note 56: col = 56 % 16 = 8, row = 56 / 16 = 3
    const map = linn.buildMap(56);
    const anchor = map.get("1.56");
    expect(anchor.x).toBe(0);
    expect(anchor.y).toBe(0);
    // Bottom-left pad: note 0, col=0 row=0. Relative to anchor: col-8=-8, dr=0-3=-3. x=-8+(-3)=-11, y=3
    expect(map.get("1.0")).toEqual({ x: -11, y: 3 });
    // Top-right pad: note 127, col=15 row=7. x=(15-8)+(7-3)=7+4=11, y=-4
    expect(map.get("1.127")).toEqual({ x: 11, y: -4 });
  });

  it("LinnStrument right-neighbour is always (x+1, y+0)", () => {
    const map = getController("linnstrument128").buildMap(56);
    // Notes 56 and 57 are adjacent columns in the same row
    const anchor = map.get("1.56");
    const right = map.get("1.57");
    expect(right.x - anchor.x).toBe(1);
    expect(right.y - anchor.y).toBe(0);
  });

  it("LinnStrument row-up neighbour is always (x+1, y-1)", () => {
    const map = getController("linnstrument128").buildMap(56);
    // Note 56 + 16 = 72 is one row above note 56
    const anchor = map.get("1.56");
    const above = map.get("1.72");
    expect(above.x - anchor.x).toBe(1);
    expect(above.y - anchor.y).toBe(-1);
  });

  it("LinnStrument uses channel 1 for all entries (multiChannel=false)", () => {
    const map = getController("linnstrument128").buildMap(56);
    for (const key of map.keys()) {
      expect(key.startsWith("1.")).toBe(true);
    }
  });

  it("LinnStrument detects case-insensitive device names", () => {
    expect(detectController("LinnStrument 128")?.id).toBe("linnstrument128");
    expect(detectController("linnstrument 128")?.id).toBe("linnstrument128");
    expect(detectController("Roger Linn Design LinnStrument 128")?.id).toBe("linnstrument128");
  });

  it("LinnStrument defaults to anchor note 56 when no anchor given", () => {
    const linn = getController("linnstrument128");
    const anchor = linn.buildMap().get("1.56");
    expect(anchor.x).toBe(0);
    expect(anchor.y).toBe(0);
    expect(linn.anchorDefault).toBe(56);
  });

  it("LinnStrument resolveMode returns mpe when midiin_mpe_input is true", () => {
    const linn = getController("linnstrument128");
    expect(linn.resolveMode({ midiin_mpe_input: true })).toBe("mpe");
    expect(linn.resolveMode({ midiin_mpe_input: false })).toBe("single");
    expect(linn.resolveMode({})).toBe("single");
  });

  it("anchors TPX 205edo pitch mapping to the current center degree", () => {
    const tonalPlexus = getController("tonalplexus");
    expect(
      tonalPlexus.resolveScaleInputPitchCents(9, 7, {
        tonalplexus_input_mode: "layout_205",
        center_degree: 5,
        equivInterval: 1200,
        scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
      }),
    ).toBe(500);
  });

  it("transposes TPX 205edo mode by one equave per block around channels 9-10", () => {
    const tonalPlexus = getController("tonalplexus");
    const settings = {
      tonalplexus_input_mode: "layout_205",
      center_degree: 5,
      equivInterval: 1200,
      scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
    };

    expect(tonalPlexus.resolveScaleInputPitchCents(9, 7, settings)).toBe(500);
    expect(tonalPlexus.resolveScaleInputPitchCents(7, 7, settings)).toBe(-700);
    expect(tonalPlexus.resolveScaleInputPitchCents(11, 7, settings)).toBe(1700);
  });
});
