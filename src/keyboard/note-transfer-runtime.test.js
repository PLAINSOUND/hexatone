import { describe, expect, it, vi } from "vitest";
import Point from "./point.js";
import {
  applyTransferredCC74,
  applyTransferredPitchBend,
  applyTransferredSourceAftertouch,
  createTransferredHex,
  releaseTransferredSourceExpression,
  shouldSuppressTransferredSourceRelease,
} from "./note-transfer-runtime.js";

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

  it("soft-handoffs polyphonic aftertouch from source to target at the pressure threshold", () => {
    const sourceHex = makeSourceHex();
    sourceHex._lastAftertouch = 80;
    const proxy = createTransferredHex(sourceHex, {
      coords: new Point(5, 0),
      cents: 500,
    });
    sourceHex.aftertouch.mockClear();

    proxy.aftertouch(20);
    expect(sourceHex.aftertouch).not.toHaveBeenCalled();

    expect(applyTransferredSourceAftertouch(sourceHex, 90)).toBe(true);
    expect(sourceHex.aftertouch).toHaveBeenLastCalledWith(90);

    proxy.aftertouch(89);
    expect(sourceHex.aftertouch).toHaveBeenCalledTimes(1);

    proxy.aftertouch(90);
    expect(sourceHex.aftertouch).toHaveBeenLastCalledWith(90);

    applyTransferredSourceAftertouch(sourceHex, 127);
    expect(sourceHex.aftertouch).toHaveBeenCalledTimes(2);

    proxy.aftertouch(70);
    expect(sourceHex.aftertouch).toHaveBeenLastCalledWith(70);
  });

  it("hands aftertouch to the target when the source key releases", () => {
    const sourceHex = makeSourceHex();
    sourceHex._lastAftertouch = 96;
    const proxy = createTransferredHex(sourceHex, {
      coords: new Point(5, 0),
      cents: 500,
    });
    sourceHex.aftertouch.mockClear();

    proxy.aftertouch(24);
    expect(sourceHex.aftertouch).not.toHaveBeenCalled();

    applyTransferredSourceAftertouch(sourceHex, 0);
    expect(sourceHex.aftertouch).toHaveBeenLastCalledWith(24);
  });

  it("soft-handoffs CC74 from source to target at the timbre threshold", () => {
    const sourceHex = makeSourceHex();
    sourceHex._lastCC74 = 80;
    const proxy = createTransferredHex(sourceHex, {
      coords: new Point(5, 0),
      cents: 500,
    });
    sourceHex.cc74.mockClear();

    proxy.cc74(20);
    expect(sourceHex.cc74).not.toHaveBeenCalled();

    expect(applyTransferredCC74(sourceHex, 90)).toBe(true);
    expect(sourceHex.cc74).toHaveBeenLastCalledWith(90);

    proxy.cc74(89);
    expect(sourceHex.cc74).toHaveBeenCalledTimes(1);

    proxy.cc74(90);
    expect(sourceHex.cc74).toHaveBeenLastCalledWith(90);

    applyTransferredCC74(sourceHex, 127);
    expect(sourceHex.cc74).toHaveBeenCalledTimes(2);

    proxy.cc74(60);
    expect(sourceHex.cc74).toHaveBeenLastCalledWith(60);
  });

  it("soft-handoffs bipolar pitch bend by bend magnitude", () => {
    const sourceHex = makeSourceHex();
    sourceHex._lastPitchBend14 = 12000;
    sourceHex._lastPitchBendCents = 250;
    const proxy = createTransferredHex(sourceHex, {
      coords: new Point(5, 0),
      cents: 500,
    });
    sourceHex.retune.mockClear();

    proxy._transferTargetPitchBend({ value14: 9000, cents: 220 });
    expect(sourceHex.retune).not.toHaveBeenCalled();

    expect(applyTransferredPitchBend(sourceHex, { value14: 11000, cents: 240 })).toBe(true);
    expect(sourceHex.retune).toHaveBeenLastCalledWith(240, true);

    proxy._transferTargetPitchBend({ value14: 4096, cents: 160 });
    expect(sourceHex.retune).toHaveBeenLastCalledWith(160, true);

    applyTransferredPitchBend(sourceHex, { value14: 16383, cents: 320 });
    expect(sourceHex.retune).toHaveBeenCalledTimes(2);

    proxy._transferTargetPitchBend({ value14: 8192, cents: 200 });
    expect(sourceHex.retune).toHaveBeenLastCalledWith(200, true);
  });

  it("hands all transfer expressions to the target when the source key releases", () => {
    const sourceHex = makeSourceHex();
    sourceHex._lastAftertouch = 96;
    sourceHex._lastCC74 = 80;
    sourceHex._lastPitchBend14 = 12000;
    sourceHex._lastPitchBendCents = 260;
    const proxy = createTransferredHex(sourceHex, {
      coords: new Point(5, 0),
      cents: 500,
    });
    proxy.aftertouch(24);
    proxy.cc74(30);
    proxy._transferTargetPitchBend({ value14: 10000, cents: 230 });
    sourceHex.aftertouch.mockClear();
    sourceHex.cc74.mockClear();
    sourceHex.retune.mockClear();

    releaseTransferredSourceExpression(sourceHex);

    expect(sourceHex.aftertouch).toHaveBeenLastCalledWith(24);
    expect(sourceHex.cc74).toHaveBeenLastCalledWith(30);
    expect(sourceHex.retune).toHaveBeenLastCalledWith(230, true);
  });
});
