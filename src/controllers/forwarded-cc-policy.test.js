// Exhaustive controller-forwarding boundary; raw decoding must precede this policy.
import { describe, expect, it } from "vitest";
import { allowsForwardedCC } from "./forwarded-cc-policy.js";

describe("forwarded controller policy", () => {
  it.each([undefined, "lumatone", "exquis", "linnstrument"])(
    "keeps the standard automatic allowlist for %s",
    (controller) => {
      const accepted = Array.from({ length: 128 }, (_, cc) => cc).filter((cc) =>
        allowsForwardedCC(cc, controller, 67),
      );
      expect(accepted).toEqual([1, 2, 3, 4, 7, 11, 64, 66, 67, 74]);
    },
  );
  it("keeps Continuum engine/pedal reports and MPE+ LSB out of automatic forwarding", () => {
    const accepted = Array.from({ length: 128 }, (_, cc) => cc).filter((cc) =>
      allowsForwardedCC(cc, "hakenaudio", 4),
    );
    expect(accepted).toEqual([1, 2, 3, 7, 11, 74]);
  });
});
