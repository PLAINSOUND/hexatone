import { describe, expect, it, vi } from "vitest";
import { LinnStrumentLEDs } from "./linnstrument-config.js";

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
});
