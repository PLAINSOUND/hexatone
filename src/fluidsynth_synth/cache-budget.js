import { isMobileDevice } from "../ui/device.js";

// Use the same mobile/tablet detection as audio recovery, independent of zoom
// and viewport size. Touchscreen laptops retain the desktop allowance.
export function soundfontCacheBudget(device = globalThis.navigator) {
  return (isMobileDevice(device) ? 384 : 2048) * 1024 * 1024;
}
