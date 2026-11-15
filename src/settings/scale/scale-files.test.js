import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseScale, scalaToCents } from "./parse-scale.js";

const directory = resolve("scales");
const files = readdirSync(directory).filter((name) => name.endsWith(".scl"));

// Validate the portable .scl format, independently of Hexatone's extended parser.
// https://www.huygens-fokker.org/scala/scl_format.html
describe("bundled Scala files", () => {
  it.each(files)("%s has a description, note count and standard pitch values", (name) => {
    const text = readFileSync(`${directory}/${name}`, "utf8");
    const lines = text.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("!"));
    const [description, count, ...remaining] = lines;
    expect(description).toBeDefined();
    expect(count.trim()).toMatch(/^\d+$/);
    const pitches = remaining.filter((line) => line.trim() !== "");
    expect(pitches).toHaveLength(Number(count));
    for (const line of pitches) {
      const token = line.trim().split(/\s+/)[0];
      // Decimal cents, an integer ratio, or an integer interpreted as n/1.
      expect(token).toMatch(/^(?:[+-]?(?:\d+\.\d*|\.\d+)|\d+(?:\/\d+)?)$/);
      if (!token.includes(".")) {
        const [numerator, denominator = 1] = token.split("/").map(Number);
        expect(numerator).toBeGreaterThan(0);
        expect(denominator).toBeGreaterThan(0);
      }
      expect(Number.isFinite(scalaToCents(token))).toBe(true);
    }
    const parsed = parseScale(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.scale).toHaveLength(Number(count));
  });

  it.each([12, 19, 22, 31, 41, 43, 53, 55, 72])(
    "%iedo retains its equal divisions after conversion to cents",
    (divisions) => {
      const text = readFileSync(`${directory}/${divisions}edo.scl`, "utf8");
      const parsed = parseScale(text);
      parsed.scale.forEach((pitch, index) => {
        expect(scalaToCents(pitch)).toBeCloseTo((1200 * (index + 1)) / divisions, 8);
      });
    },
  );
});
