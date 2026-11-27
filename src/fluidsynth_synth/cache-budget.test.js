import { expect, it } from "vitest";
import { soundfontCacheBudget } from "./cache-budget.js";

it.each([
  [{ userAgent: "iPhone" }, 256],
  [{ userAgent: "Android" }, 256],
  [{ userAgent: "iPad" }, 256],
  [{ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 }, 256],
  [{ userAgent: "Macintosh", maxTouchPoints: 0 }, 512],
  [{ userAgent: "Windows NT", maxTouchPoints: 10 }, 512],
])("chooses a cache budget for %j", (device, mib) => {
  expect(soundfontCacheBudget(device)).toBe(mib * 1024 * 1024);
});
