import { describe, it, expect } from "vitest";
import { CONTROLLER_REGISTRY, detectController } from "./registry.js";

const getController = (id) => CONTROLLER_REGISTRY.find((controller) => controller.id === id);

describe("controller registry", () => {
  it("detects known controller device names", () => {
    expect(detectController("C-Thru AXIS-49 2A")?.id).toBe("axis49");
    expect(detectController("Lumatone MIDI Function")?.id).toBe("lumatone");
    expect(detectController("Intuitive Instruments Exquis")?.id).toBe("exquis");
    expect(detectController("Roger Linn Design LinnStrument 128")?.id).toBe("linnstrument128");
    expect(detectController("Unknown Device")).toBeNull();
  });

  it("places the anchor key at (0, 0) for representative controllers", () => {
    const axis49 = getController("axis49");
    const lumatone = getController("lumatone");
    const exquis = getController("exquis");

    expect(axis49.buildMap(53).get("1.53")).toEqual({ x: 0, y: 0 });
    expect(lumatone.buildMap(26, 3).get("3.26")).toEqual({ x: 0, y: 0 });
    expect(exquis.buildMap(19).get("1.19")).toEqual({ x: 0, y: 0 });
  });

  it("builds maps with the expected key counts", () => {
    expect(getController("axis49").buildMap(53).size).toBe(98);
    expect(getController("ts41").buildMap(36).size).toBe(126);
    expect(getController("lumatone").buildMap(26, 3).size).toBe(280);
    expect(getController("push2").buildMap(36).size).toBe(43);
    expect(getController("launchpad").buildMap(36).size).toBe(64);
    expect(getController("exquis").buildMap(19).size).toBe(61);
    expect(getController("generic").buildMap(60).size).toBe(128);
  });
});
