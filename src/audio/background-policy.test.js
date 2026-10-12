import { expect, it } from "vitest";
import { needsMobileBackgroundRecovery } from "./background-policy.js";

it("keeps preventive background recovery on phones and tablets, not touch laptops", () => {
  expect(needsMobileBackgroundRecovery({ userAgent: "iPhone", maxTouchPoints: 5 })).toBe(true);
  expect(needsMobileBackgroundRecovery({ userAgent: "Android", maxTouchPoints: 5 })).toBe(true);
  expect(needsMobileBackgroundRecovery({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  expect(needsMobileBackgroundRecovery({ userAgent: "Windows NT", maxTouchPoints: 10 })).toBe(false);
  expect(needsMobileBackgroundRecovery({ userAgent: "Macintosh", maxTouchPoints: 0 })).toBe(false);
});
