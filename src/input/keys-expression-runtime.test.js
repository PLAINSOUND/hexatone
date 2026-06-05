import { describe, expect, it, vi } from "vitest";
import { applyTimbreCC74 } from "./keys-expression-runtime.js";

describe("input/keys-expression-runtime timbre routing", () => {
  it("routes MPE-input CC74 through polyTimbre instead of generic cc74", () => {
    const polyTimbre = vi.fn();
    const cc74 = vi.fn();
    const hex = {
      release: false,
      polyTimbre,
      cc74,
    };

    applyTimbreCC74.call({ inputRuntime: { mpeInput: true } }, hex, 91, 12000);

    expect(hex._lastCC74).toBe(91);
    expect(hex._lastCC7414).toBe(12000);
    expect(polyTimbre).toHaveBeenCalledWith(91, 12000);
    expect(cc74).not.toHaveBeenCalled();
  });

  it("keeps non-MPE CC74 on the generic cc74 path", () => {
    const polyTimbre = vi.fn();
    const cc74 = vi.fn();
    const hex = {
      release: false,
      polyTimbre,
      cc74,
    };

    applyTimbreCC74.call({ inputRuntime: { mpeInput: false } }, hex, 72);

    expect(hex._lastCC74).toBe(72);
    expect(hex._lastCC7414).toBeNull();
    expect(polyTimbre).not.toHaveBeenCalled();
    expect(cc74).toHaveBeenCalledWith(72);
  });
});
