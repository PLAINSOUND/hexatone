import { needsMobileBackgroundRecovery } from "../audio/background-policy.js";

// Use the same mobile/tablet detection as audio recovery, independent of zoom
// and viewport size. Touchscreen laptops retain the desktop allowance.
export function soundfontCacheBudget(device = globalThis.navigator) {
  return (needsMobileBackgroundRecovery(device) ? 256 : 512) * 1024 * 1024;
}
