// Engine/configuration reports must not loop back through performance outputs.
// CC87 is consumed separately as MPE+ expression LSB, never forwarded/cached.
const PERFORMANCE_CCS = new Set([1, 2, 3, 4, 7, 11, 74]);

export function allowsContinuumPerformanceCC(cc, pedalCC) {
  return PERFORMANCE_CCS.has(Number(cc)) && Number(cc) !== pedalCC;
}
