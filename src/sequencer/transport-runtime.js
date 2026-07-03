function isWholeSequencePosition(time) {
  const value = Number(time);
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - Math.round(value)) < 1e-9;
}

export function barDisplayBucket(position) {
  const time = Number(position);
  if (!Number.isFinite(time) || time <= 1 + 1e-9) return -1;
  const rounded = Math.round(time);
  const isInteger = Math.abs(time - rounded) < 1e-9;
  return isInteger ? rounded - 2 : Math.floor(time - 1);
}

export function normalizeTempoBeatFraction(numerator, denominator) {
  const beatNumerator = Math.max(1, Math.round(Number(numerator) || 1));
  const beatDenominator = Math.max(1, Math.round(Number(denominator) || 4));
  return {
    beatNumerator,
    beatDenominator,
    beatLength: (4 * beatNumerator) / beatDenominator,
  };
}

export function buildBarNumberById(bars = []) {
  const entries = bars.map((bar, index) => [bar.id, index + 1]);
  return new Map(entries);
}

export function buildStructuralMarkersByDisplayBucket(bars = [], tempi = []) {
  const groups = new Map();

  const collect = (marker, type, order) => {
    if (!isWholeSequencePosition(marker?.position)) return;
    const bucket = barDisplayBucket(marker.position);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push({ ...marker, structuralType: type, structuralOrder: order });
  };

  bars.forEach((bar, index) => collect(bar, "bar", index));
  tempi.forEach((tempo, index) => collect(tempo, "tempo", index));

  for (const items of groups.values()) {
    items.sort((a, b) => (
      Number(a.position) - Number(b.position) ||
      (a.structuralType === "tempo" ? 0 : 1) - (b.structuralType === "tempo" ? 0 : 1) ||
      Number(a.structuralOrder) - Number(b.structuralOrder)
    ));
  }

  return groups;
}

export function isStoppedBarNumber(barNumber, bars = []) {
  const index = Math.max(0, Math.round(Number(barNumber) || 1) - 1);
  const bar = bars[index] ?? null;
  const beatsPerBar = Math.max(0, Math.round(Number(bar?.numerator) || 0));
  return beatsPerBar === 0;
}
