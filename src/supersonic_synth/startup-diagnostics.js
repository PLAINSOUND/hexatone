// Keep report access independent of the lazily loaded engine adapter.
export const pendingSuperSonicStartups = new Set();
export function getPendingSuperSonicDiagnostics() {
  return [...pendingSuperSonicStartups].map((startup) => startup());
}
