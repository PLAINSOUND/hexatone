import { expect, it } from "vitest";
import { ignoresIncomingPitchBend } from "./expression-routing.js";

it("ignores only non-MPE Exquis pitch bend in either mapping mode", () => {
  for (const target of ["scale", "hex_layout"]) {
    expect(ignoresIncomingPitchBend({ id: "exquis" }, { target, mpeInput: false })).toBe(true);
    expect(ignoresIncomingPitchBend({ id: "exquis" }, { target, mpeInput: true })).toBe(false);
  }
  expect(ignoresIncomingPitchBend({ id: "generic" }, { mpeInput: false })).toBe(false);
});
