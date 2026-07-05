function normalizePosition(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 1000000) / 1000000;
}

function normalizePositiveNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function normalizePositiveInteger(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function normalizeStructuralBarPosition(value, fallback = 1) {
  return normalizePositiveInteger(value, fallback);
}

function tempoFractionToBeatLength(numerator, denominator) {
  return (4 * numerator) / denominator;
}

function normalizeTempoMarker(marker, index) {
  const explicitBeatLength = normalizePositiveNumber(marker?.beatLength, 1);
  const beatFraction = marker?.beatNumerator != null || marker?.beatDenominator != null
    ? {
      numerator: normalizePositiveInteger(marker?.beatNumerator, 1),
      denominator: normalizePositiveInteger(marker?.beatDenominator, 4),
    }
    : approximateFraction(explicitBeatLength / 4, 64, 0.000001, 4);
  const beatLength = tempoFractionToBeatLength(beatFraction.numerator, beatFraction.denominator);

  return {
    id: marker?.id ?? `tempo:${index + 1}`,
    position: normalizePosition(marker?.position, index === 0 ? 1 : 1),
    bpm: normalizePositiveNumber(marker?.bpm, 60),
    beatNumerator: beatFraction.numerator,
    beatDenominator: beatFraction.denominator,
    beatLength,
  };
}

export function normalizeTempoMarkers(markers = [], options = {}) {
  const { includeDefault = true } = options;
  const source = Array.isArray(markers) ? markers : [];
  const normalized = source
    .map((marker, index) => normalizeTempoMarker(marker, index))
    .sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)));

  if (includeDefault && (normalized.length === 0 || Math.abs(normalized[0].position - 1) > 1e-9)) {
    normalized.unshift({
      id: "tempo:default",
      position: 1,
      bpm: 60,
      beatNumerator: 1,
      beatDenominator: 4,
      beatLength: 1,
    });
  }

  const deduped = [];
  for (const marker of normalized) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.position - marker.position) < 1e-9) {
      deduped[deduped.length - 1] = marker;
      continue;
    }
    deduped.push(marker);
  }

  return deduped;
}

function normalizeMeterMarker(marker, index) {
  const numerator = Math.max(1, Math.round(normalizePositiveNumber(marker?.numerator, 4)));
  const denominator = Math.max(1, Math.round(normalizePositiveNumber(marker?.denominator, 4)));
  const beatLength = normalizePositiveNumber(marker?.beatLength, 1);
  const defaultBarLength = numerator * beatLength;

  return {
    id: marker?.id ?? `meter:${index + 1}`,
    position: normalizePosition(marker?.position, index === 0 ? 1 : 1),
    numerator,
    denominator,
    beatLength,
    barLength: normalizePositiveNumber(marker?.barLength, defaultBarLength),
  };
}

export function normalizeMeterMarkers(markers = []) {
  const source = Array.isArray(markers) ? markers : [];
  const normalized = source
    .map((marker, index) => normalizeMeterMarker(marker, index))
    .sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)));

  if (normalized.length === 0 || Math.abs(normalized[0].position - 1) > 1e-9) {
    normalized.unshift({
      id: "meter:default",
      position: 1,
      numerator: 4,
      denominator: 4,
      beatLength: 1,
      barLength: 4,
    });
  }

  const deduped = [];
  for (const marker of normalized) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.position - marker.position) < 1e-9) {
      deduped[deduped.length - 1] = marker;
      continue;
    }
    deduped.push(marker);
  }

  return deduped;
}

export function buildTempoSegments(markers = []) {
  const normalized = normalizeTempoMarkers(markers);
  const segments = [];
  let elapsedSeconds = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    const marker = normalized[i];
    const next = normalized[i + 1] ?? null;
    const secondsPerUnit = 60 / (marker.bpm * marker.beatLength);
    const endPosition = next?.position ?? Infinity;

    segments.push({
      ...marker,
      startPosition: marker.position,
      endPosition,
      startSeconds: elapsedSeconds,
      secondsPerUnit,
    });

    if (Number.isFinite(endPosition)) {
      elapsedSeconds += (endPosition - marker.position) * secondsPerUnit;
    }
  }

  return segments;
}

function findTempoSegmentForPosition(position, segments) {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (position >= segments[i].startPosition) return segments[i];
  }
  return segments[0] ?? null;
}

function findTempoSegmentForSeconds(seconds, segments) {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (seconds >= segments[i].startSeconds) return segments[i];
  }
  return segments[0] ?? null;
}

export function sequencePositionToSeconds(position, markers = []) {
  const sequencePosition = Number(position);
  if (!Number.isFinite(sequencePosition)) return null;

  const segments = buildTempoSegments(markers);
  const segment = findTempoSegmentForPosition(sequencePosition, segments);
  if (!segment) return null;

  return segment.startSeconds + (sequencePosition - segment.startPosition) * segment.secondsPerUnit;
}

export function sequenceSpanToSeconds(startPosition, endPosition, markers = []) {
  const startSeconds = sequencePositionToSeconds(startPosition, markers);
  const endSeconds = sequencePositionToSeconds(endPosition, markers);
  if (startSeconds == null || endSeconds == null) return null;
  return endSeconds - startSeconds;
}

export function secondsToSequencePosition(seconds, markers = []) {
  const elapsedSeconds = Number(seconds);
  if (!Number.isFinite(elapsedSeconds)) return null;

  const segments = buildTempoSegments(markers);
  const segment = findTempoSegmentForSeconds(elapsedSeconds, segments);
  if (!segment) return null;

  return segment.startPosition + (elapsedSeconds - segment.startSeconds) / segment.secondsPerUnit;
}

export function normalizeSequenceTransport(record = {}) {
  return {
    unit: "sequence",
    anchorSeconds: Number.isFinite(Number(record?.anchorSeconds)) ? Number(record.anchorSeconds) : 0,
  };
}

function normalizeBeatsPerBar(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 4;
  return n;
}

function normalizeBeatUnit(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 4;
  return n;
}

export function normalizeBarMarker(bar, index = 0) {
  return {
    id: bar?.id ?? `bar:${index + 1}`,
    position: normalizeStructuralBarPosition(bar?.position, index + 1),
    numerator: normalizeBeatsPerBar(bar?.numerator),
    denominator: normalizeBeatUnit(bar?.denominator),
  };
}

export function normalizeBarMarkers(bars = [], options = {}) {
  const { includeDefault = true } = options;
  const source = Array.isArray(bars) ? bars : [];
  const normalized = source
    .map((bar, index) => normalizeBarMarker(bar, index))
    .sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  if (includeDefault && (normalized.length === 0 || Math.abs(normalized[0].position - 1) > 1e-9)) {
    normalized.unshift({
      id: "bar:default",
      position: 1,
      numerator: 4,
      denominator: 4,
    });
  }

  const deduped = [];
  for (const bar of normalized) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.position - bar.position) < 1e-9) {
      deduped[deduped.length - 1] = bar;
      continue;
    }
    deduped.push(bar);
  }

  return deduped;
}

export function timingBarAtNumber(barNumber, bars = []) {
  const normalizedBars = normalizeBarMarkers(bars);
  const resolvedBarNumber = Math.max(1, Math.round(Number(barNumber) || 1));
  const fallback = normalizedBars[0] ?? {
    id: "bar:default",
    position: 1,
    numerator: 4,
    denominator: 4,
  };

  const explicitIndex = resolvedBarNumber - 1;
  if (explicitIndex < normalizedBars.length) {
    const explicitBar = normalizedBars[explicitIndex];
    return {
      ...explicitBar,
      position: Number(explicitBar.position),
      inherited: false,
    };
  }

  const inherited = normalizedBars.at(-1) ?? fallback;
  const inheritedOffset = resolvedBarNumber - normalizedBars.length;
  return {
    ...inherited,
    position: Number(inherited.position) + inheritedOffset,
    inherited: true,
  };
}

export function deriveTerminalBarlinePosition(snapshots = [], bars = []) {
  const explicitBars = normalizeBarMarkers(bars);
  const explicitTerminal = (explicitBars.at(-1)?.position ?? 1) + 1;
  let lastSnapshotEdge = 1;
  for (const [snapshotIndex, snapshot] of (snapshots ?? []).entries()) {
    const baseTime = snapshotIndex + 1;
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    const noteEnds = (snapshot?.notes ?? [])
      .map((note) => Number(note?.end))
      .filter((value) => Number.isFinite(value));
    const localEnd = Math.max(length, ...noteEnds);
    const absoluteEnd = baseTime + localEnd;
    const rounded = Math.round(absoluteEnd);
    const nextBarline = Math.abs(absoluteEnd - rounded) < 1e-9 ? rounded : Math.ceil(absoluteEnd);
    lastSnapshotEdge = Math.max(lastSnapshotEdge, nextBarline);
  }
  return Math.max(explicitTerminal, lastSnapshotEdge);
}

function safeBarLength(bar, nextBar) {
  const start = Number(bar?.position);
  const end = Number(nextBar?.position);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start + 1e-9) {
    return end - start;
  }
  return 1;
}

const AUTO_DENOMINATOR_PREFERENCE = [2, 4, 8, 3, 6, 9, 5, 7];

function preferredDenominatorOrder(maxDenominator) {
  const limit = Math.max(1, Math.round(Number(maxDenominator) || 1));
  const ordered = AUTO_DENOMINATOR_PREFERENCE.filter((denominator) => denominator <= limit);
  for (let denominator = 1; denominator <= limit; denominator += 1) {
    if (ordered.includes(denominator)) continue;
    ordered.push(denominator);
  }
  return ordered;
}

function approximateFraction(value, maxDenominator = 9, tolerance = 0.000001, preferredDenominator = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return { numerator: 0, denominator: 1 };

  const preferred = Math.round(Number(preferredDenominator));
  if (Number.isFinite(preferred) && preferred > 0) {
    const numerator = Math.round(n * preferred);
    const error = Math.abs(n - numerator / preferred);
    if (error <= tolerance) {
      return {
        numerator,
        denominator: preferred,
      };
    }
  }

  for (const denominator of preferredDenominatorOrder(maxDenominator)) {
    const numerator = Math.round(n * denominator);
    const error = Math.abs(n - numerator / denominator);
    if (error <= tolerance) {
      return {
        numerator,
        denominator,
      };
    }
  }

  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Infinity;

  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(n * denominator);
    const error = Math.abs(n - numerator / denominator);
    if (error < bestError - 1e-12) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
    }
  }

  const divisor = gcd(Math.abs(bestNumerator), bestDenominator) || 1;
  return {
    numerator: bestNumerator / divisor,
    denominator: bestDenominator / divisor,
  };
}

function gcd(a, b) {
  let x = Math.abs(Number(a) || 0);
  let y = Math.abs(Number(b) || 0);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

export function barContextForPosition(position, bars = [], terminalPosition = null) {
  const absolutePosition = Number(position);
  if (!Number.isFinite(absolutePosition)) return null;
  const normalizedBars = normalizeBarMarkers(bars);
  const normalizedTerminalPosition = Number.isFinite(Number(terminalPosition))
    ? Number(terminalPosition)
    : null;

  for (let index = 0; index < normalizedBars.length; index += 1) {
    const bar = {
      ...normalizedBars[index],
      position: Number(normalizedBars[index].position),
      inherited: false,
    };
    const nextExplicit = normalizedBars[index + 1]
      ? {
        ...normalizedBars[index + 1],
        position: Number(normalizedBars[index + 1].position),
        inherited: false,
      }
      : null;
    const nextPosition = Number(nextExplicit?.position);
    if (!Number.isFinite(nextPosition) || absolutePosition < nextPosition - 1e-9) {
      const terminalNextBar = (
        !Number.isFinite(nextPosition)
        && Number.isFinite(normalizedTerminalPosition)
        && normalizedTerminalPosition > Number(bar.position) + 1e-9
      )
        ? {
          id: "barline:eof",
          position: normalizedTerminalPosition,
          implicitTerminal: true,
          numerator: bar.numerator,
          denominator: bar.denominator,
        }
        : null;
      const resolvedNextBar = terminalNextBar ?? (nextExplicit ?? timingBarAtNumber(index + 2, bars));
      return {
        bar,
        barIndex: index,
        barNumber: index + 1,
        nextBar: resolvedNextBar,
        barLength: safeBarLength(bar, resolvedNextBar),
      };
    }
  }

  const lastExplicit = normalizedBars.at(-1) ?? {
    id: "bar:default",
    position: 1,
    numerator: 4,
    denominator: 4,
  };
  if (
    Number.isFinite(normalizedTerminalPosition)
    && normalizedTerminalPosition > Number(lastExplicit.position) + 1e-9
    && absolutePosition <= normalizedTerminalPosition + 1e-9
  ) {
    const barNumber = normalizedBars.length || 1;
    const bar = {
      ...lastExplicit,
      position: Number(lastExplicit.position),
      inherited: false,
    };
    const nextBar = {
      id: "barline:eof",
      position: normalizedTerminalPosition,
      implicitTerminal: true,
      numerator: bar.numerator,
      denominator: bar.denominator,
    };
    return {
      bar,
      barIndex: barNumber - 1,
      barNumber,
      nextBar,
      barLength: safeBarLength(bar, nextBar),
    };
  }
  const tailOffset = Math.max(0, Math.floor(absolutePosition - Number(lastExplicit.position) + 1e-9));
  const barNumber = normalizedBars.length + tailOffset;
  const bar = timingBarAtNumber(barNumber, bars);
  const nextBar = timingBarAtNumber(barNumber + 1, bars);
  const barLength = safeBarLength(bar, nextBar);

  return {
    bar,
    barIndex: barNumber - 1,
    barNumber,
    nextBar,
    barLength,
  };
}

export function absolutePositionToBarBeat(
  position,
  bars = [],
  preferredDenominator = null,
  maxDenominator = 9,
  terminalPosition = null,
  preferBarEnd = false,
) {
  const numericPosition = Number(position);
  if (preferBarEnd && Number.isFinite(numericPosition)) {
    const currentContext = barContextForPosition(numericPosition, bars, terminalPosition);
    const previousContext = barContextForPosition(numericPosition - 0.000001, bars, terminalPosition);
    if (
      currentContext
      && previousContext
      && currentContext.barNumber !== previousContext.barNumber
      && Math.abs(numericPosition - Number(currentContext.bar?.position)) < 1e-9
    ) {
      const previousBar = previousContext.bar;
      const previousBeatsPerBar = normalizeBeatsPerBar(previousBar?.numerator);
      if (previousBeatsPerBar > 0) {
        return {
          barNumber: previousContext.barNumber,
          beat: previousBeatsPerBar,
          numerator: 1,
          denominator: 1,
          barStart: previousBar.position,
          barLength: previousContext.barLength,
          beatsPerBar: previousBeatsPerBar,
          beatUnit: normalizeBeatUnit(previousBar?.denominator),
        };
      }
    }
  }
  const context = barContextForPosition(position, bars, terminalPosition);
  if (!context) return null;

  const { bar, barNumber, barLength } = context;
  const numerator = normalizeBeatsPerBar(bar?.numerator);
  if (numerator === 0) {
    return {
      barNumber,
      beat: 0,
      numerator: 0,
      denominator: 1,
      barStart: bar.position,
      barLength,
      beatsPerBar: 0,
      beatUnit: normalizeBeatUnit(bar?.denominator),
      stopped: true,
    };
  }
  const normalizedTerminalPosition = Number.isFinite(Number(terminalPosition))
    ? Number(terminalPosition)
    : null;
  if (
    Number.isFinite(normalizedTerminalPosition)
    && context.nextBar?.implicitTerminal === true
    && Math.abs(Number(position) - normalizedTerminalPosition) < 1e-9
  ) {
    return {
      barNumber,
      beat: numerator,
      numerator: 1,
      denominator: 1,
      barStart: bar.position,
      barLength,
      beatsPerBar: numerator,
      beatUnit: normalizeBeatUnit(bar?.denominator),
    };
  }
  const beatLength = barLength / numerator;
  const offset = Math.max(0, Number(position) - Number(bar.position));
  const rawBeatOffset = beatLength > 0 ? offset / beatLength : 0;
  const nearestWholeBeatOffset = Math.round(rawBeatOffset);
  const snappedBeatOffset = Math.abs(rawBeatOffset - nearestWholeBeatOffset) <= 0.00001
    ? nearestWholeBeatOffset
    : rawBeatOffset;
  const beatWhole = Math.max(0, Math.floor(snappedBeatOffset + 1e-9));
  const beat = Math.min(numerator, beatWhole + 1);
  const resolvedMax = Math.max(
    maxDenominator,
    Number.isFinite(Number(preferredDenominator)) ? Math.round(Number(preferredDenominator)) : 0,
  );
  const fraction = approximateFraction(
    Math.max(0, snappedBeatOffset - beatWhole),
    resolvedMax,
    0.000001,
    preferredDenominator,
  );

  return {
    barNumber,
    beat,
    numerator: fraction.numerator,
    denominator: fraction.denominator,
    barStart: bar.position,
    barLength,
    beatsPerBar: numerator,
    beatUnit: normalizeBeatUnit(bar?.denominator),
  };
}

export function barBeatToAbsolutePosition(barBeat, bars = [], terminalPosition = null) {
  const rawBarNumber = Math.round(Number(barBeat?.barNumber));
  if (!Number.isFinite(rawBarNumber) || rawBarNumber <= 0) return null;
  const normalizedTerminalPosition = Number.isFinite(Number(terminalPosition))
    ? Number(terminalPosition)
    : null;
  const explicitBars = normalizeBarMarkers(bars);

  const resolveBarAndNextBar = (barNumber) => {
    const currentBar = timingBarAtNumber(barNumber, bars);
    const nextExplicitBar = explicitBars[barNumber];
    if (
      currentBar?.inherited !== true &&
      !nextExplicitBar &&
      Number.isFinite(normalizedTerminalPosition) &&
      normalizedTerminalPosition > Number(currentBar?.position) + 1e-9
    ) {
      return {
        bar: currentBar,
        nextBar: {
          id: "barline:eof",
          position: normalizedTerminalPosition,
          implicitTerminal: true,
          numerator: currentBar.numerator,
          denominator: currentBar.denominator,
        },
      };
    }
    return {
      bar: currentBar,
      nextBar: timingBarAtNumber(barNumber + 1, bars),
    };
  };

  let currentBarNumber = Math.max(1, rawBarNumber);
  let { bar, nextBar } = resolveBarAndNextBar(currentBarNumber);
  let beatsPerBar = normalizeBeatsPerBar(bar?.numerator);
  if (beatsPerBar === 0) {
    return normalizePosition(Number(bar.position), Number(bar.position));
  }

  const denominator = Math.max(1, Math.round(Number(barBeat?.denominator) || 1));
  const rawBeat = Math.max(1, Math.round(Number(barBeat?.beat) || 1));
  const rawNumerator = Math.max(0, Math.round(Number(barBeat?.numerator) || 0));
  let totalBeatOffset = (rawBeat - 1) + rawNumerator / denominator;

  if (
    Number.isFinite(normalizedTerminalPosition)
    && currentBarNumber >= explicitBars.length
    && normalizedTerminalPosition > Number(bar.position) + 1e-9
    && totalBeatOffset >= beatsPerBar - 1e-9
  ) {
    return normalizePosition(normalizedTerminalPosition, Number(bar.position));
  }

  while (beatsPerBar > 0 && totalBeatOffset >= beatsPerBar - 1e-9) {
    totalBeatOffset -= beatsPerBar;
    currentBarNumber += 1;
    ({ bar, nextBar } = resolveBarAndNextBar(currentBarNumber));
    beatsPerBar = normalizeBeatsPerBar(bar?.numerator);
    if (beatsPerBar === 0) {
      return normalizePosition(Number(bar.position), Number(bar.position));
    }
  }

  const barLength = safeBarLength(bar, nextBar);
  const beatLength = barLength / beatsPerBar;

  return normalizePosition(
    Number(bar.position) + totalBeatOffset * beatLength,
    Number(bar.position),
  );
}

export function normalizeRepeatMarker(marker, index = 0) {
  const kind = marker?.kind === "end" ? "end" : "start";
  const repeatCount = kind === "end"
    ? Math.max(2, Math.round(Number(marker?.repeatCount) || 2))
    : null;
  return {
    id: marker?.id ?? `repeat:${index + 1}`,
    position: normalizePosition(marker?.position, 1),
    kind,
    repeatCount,
  };
}

export function deriveImplicitRepeatStartPosition(markers = [], endPosition) {
  const normalizedEndPosition = normalizePosition(endPosition, 1);
  if (normalizedEndPosition <= 1) return null;

  const source = Array.isArray(markers) ? markers : [];
  const normalized = source
    .map((marker, index) => normalizeRepeatMarker(marker, index))
    .sort((a, b) => (
      a.position - b.position
      || (a.kind === "end" ? 0 : 1) - (b.kind === "end" ? 0 : 1)
      || String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
    ));

  if (normalized.some((marker) => Math.abs(marker.position - normalizedEndPosition) < 1e-9)) {
    return null;
  }

  let previousMarker = null;

  for (const marker of normalized) {
    if (marker.position >= normalizedEndPosition - 1e-9) break;
    previousMarker = marker;
  }

  if (previousMarker == null) return 1;
  if (previousMarker.kind === "start") return null;
  return normalizePosition(previousMarker.position, 1);
}

export function deriveImplicitRepeatStartPositionsForDanglingEnds(markers = []) {
  const normalized = normalizeRepeatMarkers(markers);
  const processed = [];
  const openStarts = [];
  const additions = [];

  normalized.forEach((marker) => {
    if (marker.kind === "start") {
      processed.push(marker);
      openStarts.push(marker);
      return;
    }

    if (openStarts.length > 0) {
      openStarts.pop();
      processed.push(marker);
      return;
    }

    const implicitStartPosition = deriveImplicitRepeatStartPosition(processed, marker.position);
    if (implicitStartPosition != null) {
      const implicitStart = normalizeRepeatMarker({
        id: `implicit-start:${additions.length + 1}`,
        position: implicitStartPosition,
        kind: "start",
        repeatCount: null,
      }, additions.length);
      additions.push(implicitStartPosition);
      processed.push(implicitStart);
    }

    processed.push(marker);
  });

  return additions;
}

export function normalizeRepeatMarkers(markers = []) {
  const source = Array.isArray(markers) ? markers : [];
  const normalized = source
    .map((marker, index) => normalizeRepeatMarker(marker, index))
    .sort((a, b) => (
      a.position - b.position
      || (a.kind === "end" ? 0 : 1) - (b.kind === "end" ? 0 : 1)
      || String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
    ));

  const deduped = [];
  for (const marker of normalized) {
    const previous = deduped.at(-1);
    if (
      previous
      && previous.kind === marker.kind
      && Math.abs(Number(previous.position) - Number(marker.position)) < 1e-9
    ) {
      deduped[deduped.length - 1] = marker;
      continue;
    }
    deduped.push(marker);
  }

  return deduped.filter((marker) => marker.kind === "start" || marker.position > 1);
}
