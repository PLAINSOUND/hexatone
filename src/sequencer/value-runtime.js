export function formatSequenceTime(snapshotIndex, relativeTime) {
  const baseIndex = Number(snapshotIndex);
  const offset = Number(relativeTime);
  if (!Number.isFinite(baseIndex) || !Number.isFinite(offset)) return "--";
  return (baseIndex + offset).toFixed(6);
}

export function formatSequenceOffset(relativeTime) {
  const offset = Number(relativeTime);
  if (!Number.isFinite(offset)) return "--";
  return offset.toFixed(6);
}

export function formatDisplaySequenceOffset(relativeTime) {
  const offset = Number(relativeTime);
  if (!Number.isFinite(offset)) return "--";
  return offset.toFixed(3);
}

export function formatFrequency(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(1);
}

export function formatEditableFrequency(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(6);
}

export function formatMidicents(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(3);
}

export function formatEditableMidicents(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(6);
}

export function displayValue(value) {
  return value == null ? "--" : String(value);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isOutOfSnapshotRange(snapshot, relativeTime) {
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  const time = Number(relativeTime);
  if (!Number.isFinite(time)) return false;
  return time < 0 || time > length;
}

export function frequencyToMidicents(value) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  return 69 + Math.log2(frequency / 440) * 12;
}

export function normalizeSequenceNumber(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

export function noteIdentity(note, fallbackLength = 1) {
  const midicents = Number.isFinite(Number(note?.midicents)) ? Number(note.midicents) : "na";
  const start = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
  const rawEnd = Number.isFinite(Number(note?.end)) ? Number(note.end) : fallbackLength;
  const end = Math.max(start, rawEnd);
  return note?.id ?? `${midicents}:${start}:${end}`;
}

export function sortSnapshotNotes(notes = [], fallbackLength = 1) {
  return [...notes].sort((a, b) => {
    const aStart = Number.isFinite(Number(a?.start)) ? Number(a.start) : 0;
    const bStart = Number.isFinite(Number(b?.start)) ? Number(b.start) : 0;
    if (aStart !== bStart) return aStart - bStart;
    const aEnd = Math.max(aStart, Number.isFinite(Number(a?.end)) ? Number(a.end) : fallbackLength);
    const bEnd = Math.max(bStart, Number.isFinite(Number(b?.end)) ? Number(b.end) : fallbackLength);
    if (aEnd !== bEnd) return aEnd - bEnd;
    const aPitch = Number.isFinite(Number(a?.midicents)) ? Number(a.midicents) : -Infinity;
    const bPitch = Number.isFinite(Number(b?.midicents)) ? Number(b.midicents) : -Infinity;
    return bPitch - aPitch;
  });
}

export function readNumericInput(container, selector, fallback = null) {
  const input = container?.querySelector?.(selector);
  if (!(input instanceof HTMLInputElement)) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

export function soundingOnTextStyle(active) {
  if (!active) return undefined;
  return {
    fontWeight: 600,
    color: "#15530f",
  };
}

export function structuralEventRenderKey(item) {
  if (!item) return "";
  if (item.type === "bar" || item.structuralType === "bar") return `bar:${item.barId ?? item.id}`;
  if (item.type === "tempo" || item.structuralType === "tempo") return `tempo:${item.tempoId ?? item.id}`;
  return "";
}

export function structuralEventInstanceKey(item) {
  const base = structuralEventRenderKey(item);
  if (!base) return "";
  if (item.type === "bar" || item.structuralType === "bar") {
    return `${base}:${Number(item.position ?? item.absoluteTime ?? 0).toFixed(6)}:${item.numerator ?? 4}:${item.denominator ?? 4}`;
  }
  if (item.type === "tempo" || item.structuralType === "tempo") {
    return `${base}:${Number(item.position ?? item.absoluteTime ?? 0).toFixed(6)}:${item.bpm ?? 60}:${item.beatNumerator ?? 1}:${item.beatDenominator ?? 4}`;
  }
  return base;
}

export function commitTextInput(target, commit) {
  if (!(target instanceof HTMLInputElement)) return;
  const value = target.value;
  if (target.dataset.lastCommittedValue === value) return;
  commit(value);
  target.dataset.lastCommittedValue = value;
}
