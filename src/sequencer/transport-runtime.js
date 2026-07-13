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

function structuralTypePriority(type) {
  if (type === "repeat-end") return 0;
  if (type === "repeat-start") return 1;
  if (type === "tempo") return 2;
  if (type === "bar") return 3;
  return 4;
}

export function buildStructuralMarkersByDisplayBucket(bars = [], tempi = [], repeats = []) {
  const groups = new Map();

  const collect = (marker, type, order) => {
    if (!isWholeSequencePosition(marker?.position)) return;
    const bucket = barDisplayBucket(marker.position);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push({ ...marker, structuralType: type, structuralOrder: order });
  };

  bars.forEach((bar, index) => collect(bar, "bar", index));
  tempi.forEach((tempo, index) => collect(tempo, "tempo", index));
  repeats.forEach((repeat, index) => collect(repeat, repeat?.kind === "end" ? "repeat-end" : "repeat-start", index));

  for (const items of groups.values()) {
    items.sort((a, b) => (
      Number(a.position) - Number(b.position) ||
      structuralTypePriority(a.structuralType) - structuralTypePriority(b.structuralType) ||
      Number(a.structuralOrder) - Number(b.structuralOrder)
    ));
  }

  return groups;
}
