import { expect, it } from "vitest";
import { exportFilename } from "./export-filename.js";

it.each([
  ["Étude — Skies (take 2)", "etude-skies-take-2"],
  ["  Seeds___of / Skies!!! ", "seeds-of-skies"],
  ["Straße Æther Œuvre Ø Ł", "strasse-aether-oeuvre-o-l"],
  ["𝓢𝓴𝓲𝓮𝓼 １２", "skies-12"],
  ["", "preset"],
  ["🎵", "preset"],
])("simplifies %s to %s", (name, expected) => {
  expect(exportFilename(name)).toBe(expected);
});

it("uses the exporter-specific fallback for an empty name", () => {
  expect(exportFilename(null, "sequence")).toBe("sequence");
});
