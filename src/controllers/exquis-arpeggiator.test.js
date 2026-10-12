import { afterEach, describe, expect, it, vi } from "vitest";
import { ExquisLEDs } from "./exquis-leds.js";

afterEach(() => vi.useRealTimers());

describe("Exquis arpeggiator commands", () => {
  it("remembers a pre-handshake selection, sends native slider and pattern, and restores it", () => {
    vi.useFakeTimers();
    const out = { send: vi.fn() };
    const driver = new ExquisLEDs(out, null);
    out.send.mockClear();
    driver.setArpeggiatorPattern(5);
    expect(out.send).not.toHaveBeenCalled();
    driver._onMessage({ data: [0xf0, 0, 0x21, 0x7e, 0, 3, 0, 0, 0xf7] });
    expect(out.send.mock.calls.map(([frame]) => [...frame])).toContainEqual([
      0xf0, 0, 0x21, 0x7e, 0x3c, 0, 0xf7,
    ]);
    expect(out.send.mock.calls.map(([frame]) => [...frame])).toContainEqual([
      0xf0, 0, 0x21, 0x7e, 0x40, 5, 0xf7,
    ]);
    out.send.mockClear();
    driver.setArpeggiatorPattern(2);
    expect([...out.send.mock.calls[1][0]]).toEqual([0xf0, 0, 0x21, 0x7e, 0x40, 2, 0xf7]);
    out.send.mockClear();
    driver._enterAppMode();
    expect(out.send.mock.calls.map(([frame]) => [...frame])).toContainEqual([
      0xf0, 0, 0x21, 0x7e, 0x40, 2, 0xf7,
    ]);
    expect(out.send.mock.calls.some(([frame]) => frame[4] === 0x01)).toBe(false);
    driver.exit();
  });
});
