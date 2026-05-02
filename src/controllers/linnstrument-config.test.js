import { describe, expect, it, vi } from "vitest";
import {
  LinnStrumentLEDs,
  buildLinnstrumentDegreeMap,
  hexToLinnsPaletteValue,
} from "./linnstrument-config.js";

describe("LinnStrumentLEDs", () => {
  it("sends bottom-origin row coordinates for UF cell colors", () => {
    const send = vi.fn();
    const leds = new LinnStrumentLEDs({ send });
    leds.userFirmwareActive = true;

    leds.sendPaletteValues([
      5, ...new Array(127).fill(7),
    ]);

    expect(send).toHaveBeenNthCalledWith(1, [0xb0, 20, 1]);
    expect(send).toHaveBeenNthCalledWith(2, [0xb0, 21, 0]);
    expect(send).toHaveBeenNthCalledWith(3, [0xb0, 22, 5]);
  });

  it("maps the first pad of UF row 5 to LED row 4", () => {
    const send = vi.fn();
    const leds = new LinnStrumentLEDs({ send });
    leds.userFirmwareActive = true;

    const values = new Array(128).fill(7);
    values[64] = 3; // first pad of UF row 5: (5-1)*16 + 0
    leds.sendPaletteValues(values);

    const base = 64 * 3;
    expect(send.mock.calls[base]?.[0]).toEqual([0xb0, 20, 1]);
    expect(send.mock.calls[base + 1]?.[0]).toEqual([0xb0, 21, 4]);
    expect(send.mock.calls[base + 2]?.[0]).toEqual([0xb0, 22, 3]);
  });

  it("maps identical tonic and center-degree screen colors to the same palette value", () => {
    const degreeMap = buildLinnstrumentDegreeMap(new Map([
      [0, "#ffffff"],
      [9, "#ffffff"],
      [7, "#fceec5"],
    ]));

    expect(degreeMap.get(0)).toBe(8);
    expect(degreeMap.get(9)).toBe(8);
    expect(degreeMap.get(0)).toBe(degreeMap.get(9));
    expect(degreeMap.get(7)).toBe(8);
  });

  it("maps non-exact greenish colors to a lit green-family palette value", () => {
    const value = hexToLinnsPaletteValue("#9acd32");

    expect([3, 10]).toContain(value);
  });

  it("maps the exact pale silver-blue u19 color to cyan", () => {
    expect(hexToLinnsPaletteValue("#bedce4")).toBe(4);
  });

  it("maps genuinely dark colors to Off", () => {
    expect(hexToLinnsPaletteValue("#222222")).toBe(7);
  });
});
