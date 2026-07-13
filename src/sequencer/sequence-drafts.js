import { barBeatToAbsolutePosition } from "./transport.js";
import { formatSequenceOffset, normalizeSequenceNumber } from "./value-runtime.js";

export function removeDraftEntry(drafts, draftKey) {
  if (!(draftKey in drafts)) return drafts;
  const next = { ...drafts };
  delete next[draftKey];
  return next;
}

export function eventSequenceDraftKey(snapshotId, eventId, kind) {
  return `${snapshotId}:${eventId}:${kind}`;
}

export function buildEventSequenceDraft(snapshotNumber, relativeTime, meta = {}) {
  return {
    snapshotNumber: String(snapshotNumber),
    offset: formatSequenceOffset(relativeTime),
    ...meta,
  };
}

export function updateEventSequenceDrafts(drafts, { draftKey, field, value, meta, snapshotCount }) {
  const current = drafts[draftKey] ?? buildEventSequenceDraft(meta.snapshotNumber, meta.relativeTime);
  if (field === "snapshotNumber") {
    const currentSnapshotNumber = Number(current.snapshotNumber);
    const currentOffset = Number(current.offset);
    const currentAbsoluteTime = Number.isFinite(currentSnapshotNumber) && Number.isFinite(currentOffset)
      ? normalizeSequenceNumber(currentSnapshotNumber + currentOffset)
      : normalizeSequenceNumber(Number(meta.snapshotNumber) + Number(meta.relativeTime));
    const nextSnapshotNumber = Math.max(1, Math.min(snapshotCount, Math.round(Number(value) || 1)));
    return {
      ...drafts,
      [draftKey]: {
        ...current,
        ...meta,
        draftKey,
        scope: `event-sequence:${draftKey}`,
        snapshotNumber: String(nextSnapshotNumber),
        offset: formatSequenceOffset(currentAbsoluteTime - nextSnapshotNumber),
      },
    };
  }
  return {
    ...drafts,
    [draftKey]: {
      ...current,
      ...meta,
      draftKey,
      scope: `event-sequence:${draftKey}`,
      [field]: value,
    },
  };
}

export function eventBarRelativeDraftKey(snapshotId, eventId, kind) {
  return `${snapshotId}:${eventId}:${kind}`;
}

export function tempoBarRelativeDraftKey(tempoId) {
  return String(tempoId);
}

export function repeatBarRelativeDraftKey(repeatId) {
  return String(repeatId);
}

export function buildBarRelativeDraft(barBeat, changedField = null, override = {}) {
  const next = {
    barNumber: String(override.barNumber ?? barBeat?.barNumber ?? 1),
    beat: String(override.beat ?? barBeat?.beat ?? 1),
    numerator: String(override.numerator ?? barBeat?.numerator ?? 0),
    denominator: String(override.denominator ?? barBeat?.denominator ?? 1),
  };
  if (changedField === "bar") {
    next.beat = "1";
    next.numerator = "0";
  }
  return next;
}

function draftFieldName(field) {
  if (field === "bar") return "barNumber";
  if (field === "num") return "numerator";
  if (field === "den") return "denominator";
  return field;
}

export function updateBarRelativeDrafts(drafts, {
  draftKey,
  barBeat,
  field,
  value,
  meta,
  scopePrefix,
  beatsPerBarForBarNumber,
}) {
  const draftField = draftFieldName(field);
  const current = drafts[draftKey] ?? buildBarRelativeDraft(barBeat);
  const nextDraft = {
    ...buildBarRelativeDraft(current, field, { [draftField]: value }),
    ...meta,
    draftKey,
    scope: `${scopePrefix}:${draftKey}`,
  };
  const resolvedDraft = { ...nextDraft };
  const draftBarNumber = Math.round(Number(resolvedDraft.barNumber) || Number(barBeat?.barNumber) || 1);
  const beatsPerBar = typeof beatsPerBarForBarNumber === "function"
    ? Math.max(1, Math.round(Number(beatsPerBarForBarNumber(draftBarNumber)) || 1))
    : Math.max(1, Math.round(Number(barBeat?.beatsPerBar) || 1));
  if (draftField === "beat" && beatsPerBar > 0) {
    const parsedBeat = Math.round(Number(resolvedDraft.beat) || 1);
    resolvedDraft.beat = String(Math.max(1, Math.min(beatsPerBar, parsedBeat)));
  }
  return {
    ...drafts,
    [draftKey]: resolvedDraft,
  };
}

export function resolveEventSequenceDraftTarget(draft, snapshots) {
  if (!draft) return null;
  const snapshotNumber = Math.max(1, Math.min(snapshots.length, Math.round(Number(draft.snapshotNumber) || 1)));
  const targetSnapshot = snapshots[snapshotNumber - 1];
  const nextOffset = Number(draft.offset);
  if (!targetSnapshot || !Number.isFinite(nextOffset)) return null;
  return {
    snapshotNumber,
    targetSnapshot,
    nextOffset,
    nextAbsoluteTime: normalizeSequenceNumber(snapshotNumber + nextOffset),
  };
}

export function resolveBarRelativeDraftPosition(draft, bars, terminalBarlinePosition = null) {
  if (!draft) return null;
  return barBeatToAbsolutePosition({
    barNumber: Number(draft.barNumber),
    beat: Number(draft.beat),
    numerator: Number(draft.numerator),
    denominator: Number(draft.denominator),
  }, bars, terminalBarlinePosition);
}

export function resolveDraftScopeTarget(event, scopeAttribute) {
  return event.target instanceof Element
    ? event.target.closest(`[${scopeAttribute}]`)?.getAttribute(scopeAttribute)
    : null;
}

export function commitForeignDrafts(drafts, targetScope, applyDraft) {
  Object.values(drafts).forEach((draft) => {
    if (!draft || draft.scope === targetScope) return;
    applyDraft(draft);
  });
}
