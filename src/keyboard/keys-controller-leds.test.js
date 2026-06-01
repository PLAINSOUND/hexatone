import { describe, expect, it } from "vitest";
import { buildLinnstrumentColorArray, buildLumatoneColorEntries } from "./keys-controller-leds.js";

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

describe("buildLumatoneColorEntries", () => {
  it("blanks degrees outside the active Lumatone filter", () => {
    const entries = buildLumatoneColorEntries.call({
      settings: {
        lumatone_degree_filter_mode: "filter",
        lumatone_degree_filter: "0,7",
      },
      controllerMap: new Map([
        ["3.10", { x: 0, y: 0 }],
        ["3.11", { x: 1, y: 0 }],
        ["3.12", { x: 2, y: 0 }],
      ]),
      hexCoordsToCents(coords) {
        return [coords.x * 100, coords.x === 0 ? 0 : coords.x === 1 ? 4 : 7];
      },
      _getLumatoneHexColor(coords) {
        return coords.x === 1 ? "#123456" : "#abcdef";
      },
    });

    expect(entries).toEqual([
      { board: 3, key: 10, hexColor: "#abcdef" },
      { board: 3, key: 11, hexColor: "#000000" },
      { board: 3, key: 12, hexColor: "#abcdef" },
    ]);
  });

  it("blanks every key in All Keys Dark mode", () => {
    const entries = buildLumatoneColorEntries.call({
      settings: {
        lumatone_degree_filter_mode: "dark",
        lumatone_degree_filter: "",
      },
      controllerMap: new Map([
        ["3.10", { x: 0, y: 0 }],
        ["3.11", { x: 1, y: 0 }],
      ]),
      hexCoordsToCents(coords) {
        return [coords.x * 100, coords.x];
      },
      _getLumatoneHexColor() {
        return "#abcdef";
      },
    });

    expect(entries).toEqual([
      { board: 3, key: 10, hexColor: "#000000" },
      { board: 3, key: 11, hexColor: "#000000" },
    ]);
  });
});
