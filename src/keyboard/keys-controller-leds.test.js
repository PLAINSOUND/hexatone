import { describe, expect, it } from "vitest";
import { buildLinnstrumentColorArray } from "./keys-controller-leds.js";

describe("buildLinnstrumentColorArray", () => {
  it("colors degree 0 red on LinnStrument", () => {
    const values = buildLinnstrumentColorArray.call({
      settings: { center_degree: 9 },
      controllerMap: new Map([
        ["1.1", { x: 0, y: 0 }],
        ["1.2", { x: 1, y: 0 }],
      ]),
      hexCoordsToCents(coords) {
        return [0, coords.x === 0 ? 0 : 9];
      },
      _getScreenHexColor() {
        return "#ffffff";
      },
    });

    expect(values[0]).toBe(1);
    expect(values[1]).toBe(8);
  });
});
