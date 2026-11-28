import { expect, it } from "vitest";
import { soundfontCacheBudget } from "./cache-budget.js";

it.each([
  [{ userAgent: "iPhone" }, 384],
  [{ userAgent: "Android" }, 384],
  [{ userAgent: "iPad" }, 384],
  [{ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 }, 384],
  [{ userAgent: "Macintosh", maxTouchPoints: 0 }, 2048],
  [{ userAgent: "Windows NT", maxTouchPoints: 10 }, 2048],
])("chooses a cache budget for %j", (device, mib) => {
  expect(soundfontCacheBudget(device)).toBe(mib * 1024 * 1024);
});
