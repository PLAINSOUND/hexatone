// A touch-capable laptop is still a desktop. iPadOS can identify as a Mac,
// so retain the established Mac + multitouch exception for Apple tablets.
export function needsMobileBackgroundRecovery(device = globalThis.navigator) {
  const ua = String(device?.userAgent ?? "");
  return /Android|iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh|MacIntel/i.test(`${ua} ${device?.platform ?? ""}`) && device?.maxTouchPoints > 1);
}
