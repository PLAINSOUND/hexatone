// iPadOS can identify as a Mac. Touchscreen laptops remain desktop devices.
export function isAppleTouchDevice(device = globalThis.navigator) {
  const identity = `${device?.userAgent ?? ""} ${device?.platform ?? ""}`;
  return (
    /iPhone|iPad|iPod/i.test(identity) ||
    (/Macintosh|MacIntel/i.test(identity) && device?.maxTouchPoints > 1)
  );
}

export function isMobileDevice(device = globalThis.navigator) {
  return /Android/i.test(String(device?.userAgent ?? "")) || isAppleTouchDevice(device);
}
