import { describe, expect, it, vi } from "vitest";
import Point from "./point.js";
import { createTransferredHex, shouldSuppressTransferredSourceRelease } from "./note-transfer-runtime.js";

function makeSourceHex() {
  return {
    coords: new Point(2, 0),
    cents: 200,
    _baseCents: 200,
    noteOff: vi.fn(),
    retune: vi.fn(function retune(newCents) {
      this.cents = newCents;
    }),
    aftertouch: vi.fn(),
    pressure: vi.fn(),
    cc74: vi.fn(),
    modwheel: vi.fn(),
    expression: vi.fn(),
  };
}

describe("keyboard/note-transfer-runtime", () => {
  it("creates a transfer proxy that forwards control without rearticulation", () => {
    const sourceHex = makeSourceHex();
    const proxy = createTransferredHex(sourceHex, {
      coords: new Point(5, 0),
      cents: 500,
      cents_prev: 400,
      cents_next: 600,
      onsetFrameId: "frame:new",
    });

    expect(proxy.coords).toEqual(new Point(5, 0));
    expect(proxy.noteOn()).toBeUndefined();
    expect(shouldSuppressTransferredSourceRelease(sourceHex)).toBe(true);

    proxy.retune(520, true);
    expect(sourceHex.retune).toHaveBeenCalledWith(520, true);
    expect(proxy.cents).toBe(520);

    proxy.aftertouch(10);
    proxy.pressure(20);
    proxy.cc74(30);
    proxy.modwheel(40);
    proxy.expression(50);
    expect(sourceHex.aftertouch).toHaveBeenCalledWith(10);
    expect(sourceHex.pressure).toHaveBeenCalledWith(20);
    expect(sourceHex.cc74).toHaveBeenCalledWith(30);
    expect(sourceHex.modwheel).toHaveBeenCalledWith(40);
    expect(sourceHex.expression).toHaveBeenCalledWith(50);
  });

  it("suppresses source release until the transferred target releases", () => {
    const sourceHex = makeSourceHex();
    const onTransferredRelease = vi.fn();
    const proxy = createTransferredHex(sourceHex, {
      coords: new Point(5, 0),
      cents: 500,
      onTransferredRelease,
    });

    expect(shouldSuppressTransferredSourceRelease(sourceHex)).toBe(true);
    proxy.noteOff(64);

    expect(sourceHex.noteOff).toHaveBeenCalledWith(64);
    expect(shouldSuppressTransferredSourceRelease(sourceHex)).toBe(false);
    expect(onTransferredRelease).toHaveBeenCalledWith(proxy, sourceHex, 64);
  });
});
