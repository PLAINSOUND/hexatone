/**
 * Clone data constrained to the app's JSON persistence format. The name makes
 * it explicit that Dates, Maps, undefined properties, and similar values are
 * outside the supported record contract.
 */
export function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}
