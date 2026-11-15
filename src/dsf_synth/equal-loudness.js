// ISO 226:2023, formula (1) and table 1. Pure-tone, free-field reference.
// https://cdn.standards.iteh.ai/samples/83117/6afa5bd94e0e4f32812c28c3b0a7b8ac/ISO-226-2023.pdf
// This is relative per-note compensation, not calibrated SPL or broadband EQ.
const PARAMETERS = [
  [20,.635,-31.5,78.1], [25,.602,-27.2,68.7], [31.5,.569,-23.1,59.5],
  [40,.537,-19.3,51.1], [50,.509,-16.1,44], [63,.482,-13.1,37.5],
  [80,.456,-10.4,31.5], [100,.433,-8.2,26.5], [125,.412,-6.3,22.1],
  [160,.391,-4.6,17.9], [200,.373,-3.2,14.4], [250,.357,-2.1,11.4],
  [315,.343,-1.2,8.6], [400,.330,-.5,6.2], [500,.320,0,4.4],
  [630,.311,.4,3], [800,.303,.5,2.2], [1000,.300,0,2.4],
  [1250,.295,-2.7,3.5], [1600,.292,-4.2,1.7], [2000,.290,-1.2,-1.3],
  [2500,.290,1.4,-4.2], [3150,.289,2.3,-6], [4000,.289,1,-5.4],
  [5000,.289,-2.3,-1.5], [6300,.293,-7.2,6], [8000,.303,-11.2,12.6],
  [10000,.323,-10.9,13.9], [12500,.354,-3.5,12.3],
];
const contour = PARAMETERS.map(([frequency, alpha, lu, threshold]) => {
  const power = (4e-10) ** (0.3 - alpha) * (10 ** (0.03 * 60) - 10 ** 0.072) +
    10 ** (alpha * (threshold + lu) / 10);
  return [frequency, 10 / alpha * Math.log10(power) - lu - 60];
});
export function equalLoudnessGain(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) return 1;
  const f = Math.max(20, Math.min(12500, frequency));
  let upper = 1;
  while (upper < contour.length - 1 && contour[upper][0] < f) upper++;
  const [lowHz, lowDb] = contour[upper - 1];
  const [highHz, highDb] = contour[upper];
  const mix = Math.log(f / lowHz) / Math.log(highHz / lowHz);
  // Limit bass boost rather than letting a very low test tone overload a chord.
  const db = Math.max(-12, Math.min(12, lowDb + mix * (highDb - lowDb)));
  return 10 ** (db / 20);
}

// Listening adjustment for DSF: retain the ISO reference above, but ease the
// upper-bass boost by 2 dB. Log-frequency shoulders preserve the deep bass
// through 50 Hz and return to the reference contour at 315 Hz.
export function dsfLoudnessGain(frequency) {
  const smooth = t => t * t * (3 - 2 * t);
  let amount = 0;
  if (frequency > 50 && frequency < 80)
    amount = smooth(Math.log(frequency / 50) / Math.log(80 / 50));
  else if (frequency >= 80 && frequency <= 200) amount = 1;
  else if (frequency > 200 && frequency < 315)
    amount = 1 - smooth(Math.log(frequency / 200) / Math.log(315 / 200));
  return equalLoudnessGain(frequency) * 10 ** (-2 * amount / 20);
}
