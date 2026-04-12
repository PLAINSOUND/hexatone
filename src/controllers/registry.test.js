import { describe, it, expect } from "vitest";
import {
  CONTROLLER_REGISTRY,
  detectController,
  normalizeTonalPlexus41Input,
  normalizeTonalPlexus41InputWithSettings,
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
    expect(normalizeTonalPlexus41InputWithSettings(10, 105, { equivSteps: 42 })).toEqual({ channel: 4, note: 42 });
    expect(normalizeTonalPlexus41InputWithSettings(10, 104, { equivSteps: 43 })).toEqual({ channel: 4, note: 42 });
    expect(normalizeTonalPlexus41InputWithSettings(10, 105, { equivSteps: 43 })).toEqual({ channel: 4, note: 43 });
    expect(normalizeTonalPlexus41InputWithSettings(10, 103, { equivSteps: 45 })).toEqual({ channel: 4, note: 43 });
    expect(normalizeTonalPlexus41InputWithSettings(10, 101, { equivSteps: 45 })).toEqual({ channel: 4, note: 41 });
  });

  it("adds TPX bottom-end bonus notes for 46–49 note scales while keeping the base 41 slots fixed", () => {
    expect(normalizeTonalPlexus41InputWithSettings(9, 0, { equivSteps: 46 })).toEqual({ channel: 4, note: 0 });
    expect(normalizeTonalPlexus41InputWithSettings(9, 0, { equivSteps: 49 })).toEqual({ channel: 4, note: -3 });
    expect(normalizeTonalPlexus41InputWithSettings(9, 3, { equivSteps: 49 })).toEqual({ channel: 4, note: 0 });
    expect(normalizeTonalPlexus41InputWithSettings(9, 4, { equivSteps: 49 })).toEqual({ channel: 4, note: 1 });
    expect(normalizeTonalPlexus41InputWithSettings(10, 105, { equivSteps: 49 })).toEqual({ channel: 4, note: 45 });
  });

  it("fully splits both TPX extreme 5-note groups for 51+ note scales", () => {
    expect(normalizeTonalPlexus41InputWithSettings(10, 101, { equivSteps: 53 })).toEqual({ channel: 4, note: 42 });
    expect(normalizeTonalPlexus41InputWithSettings(10, 105, { equivSteps: 53 })).toEqual({ channel: 4, note: 46 });
    expect(normalizeTonalPlexus41InputWithSettings(9, 0, { equivSteps: 53 })).toEqual({ channel: 4, note: -4 });
    expect(normalizeTonalPlexus41InputWithSettings(9, 4, { equivSteps: 53 })).toEqual({ channel: 4, note: 0 });
  });
});
