// Automatic input forwarding is deliberately limited to performance controls.
// Device configuration, bank selection, RPN/NRPN and channel-mode commands
// require explicit routing rather than leaking into every output synth.
const PERFORMANCE_CCS = new Set([1, 2, 3, 4, 7, 11, 64, 66, 67, 74]);

export function allowsPerformanceCC(cc) {
  return PERFORMANCE_CCS.has(Number(cc));
}
