// This module owns structural snapshot mutations within a sequence workspace.
// It appends, duplicates, deletes, moves, and normalizes snapshots while
// keeping bars, tempi, repeats, and related workspace state aligned.

import { buildSnapshotDescription } from "./labels.js";
import { cloneJsonValue } from "../persistence/clone-json-value.js";
import {
  normalizeManualArpeggiation,
  normalizeManualSnapshotTrigger,
} from "./manual-snapshot-arpeggiation.js";
import {
  shiftStructuralMarkersAfterSnapshotRangeDeletion,
  shiftStructuralMarkersAfterSnapshotDeletion,
  shiftStructuralMarkersAfterSnapshotInsertion,
} from "./structure-editing.js";
import { normalizeTempoMode } from "./transport.js";

function clone(value) {
  return cloneJsonValue(value);
}

function normalizeSnapshotPosition(value, snapshotCount = 0, fallback = 1) {
  if (snapshotCount <= 0) return null;
  const numeric = Math.round(Number(value) || fallback);
  if (!Number.isFinite(numeric)) return Math.max(1, Math.min(snapshotCount, fallback));
  return Math.max(1, Math.min(snapshotCount, numeric));
}

function normalizeInsertionPosition(value, snapshotCount = 0) {
  const numeric = Math.round(Number(value) || 1);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(snapshotCount + 1, numeric));
}

function normalizeMarkerPosition(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 1000000) / 1000000;
}

function sortMarkers(markers = []) {
  return [...markers].sort((left, right) => {
    const leftPosition = Number(left?.position) || 0;
    const rightPosition = Number(right?.position) || 0;
    if (Math.abs(leftPosition - rightPosition) > 1e-9) return leftPosition - rightPosition;
    return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  });
}

function shiftMarkerForCopyInsertion(
  marker,
  insertionPosition,
  snapshotCount = 1,
  shouldStayAtBoundary = () => false,
) {
  const position = normalizeMarkerPosition(marker?.position);
  if (position == null || position < insertionPosition - 1e-9) return marker;
  if (Math.abs(position - insertionPosition) < 1e-9 && shouldStayAtBoundary(marker)) {
    return marker;
  }
  return {
    ...marker,
    position: normalizeMarkerPosition(position + snapshotCount),
  };
}

function shiftStructuralMarkersForCopyInsertion({
  bars = [],
  tempi = [],
  repeats = [],
  insertionPosition,
  snapshotCount = 1,
} = {}) {
  const normalizedInsertionPosition = Math.max(1, Math.round(Number(insertionPosition) || 1));
  const normalizedSnapshotCount = Math.max(1, Math.round(Number(snapshotCount) || 1));
  return {
    bars: Array.isArray(bars)
      ? bars.map((bar) =>
          shiftMarkerForCopyInsertion(bar, normalizedInsertionPosition, normalizedSnapshotCount),
        )
      : [],
    tempi: Array.isArray(tempi)
      ? tempi.map((tempo) =>
          shiftMarkerForCopyInsertion(
            tempo,
            normalizedInsertionPosition,
            normalizedSnapshotCount,
            (marker) => normalizeTempoMode(marker?.mode) === "gradual",
          ),
        )
      : [],
    repeats: Array.isArray(repeats)
      ? repeats.map((repeat) =>
          shiftMarkerForCopyInsertion(
            repeat,
            normalizedInsertionPosition,
            normalizedSnapshotCount,
            (marker) => marker?.kind === "end",
          ),
        )
      : [],
  };
}

function nextNumericMarkerId(markers = []) {
  return (markers ?? []).reduce((max, marker) => Math.max(max, Number(marker?.id) || 0), 0) + 1;
}

function barStartAtOrBefore(position, bars = []) {
  const normalizedBars = sortMarkers(bars)
    .map((bar) => Math.round(Number(bar?.position) || 0))
    .filter((barPosition) => barPosition >= 1);
  let resolved = 1;
  normalizedBars.forEach((barPosition) => {
    if (barPosition <= position) resolved = barPosition;
  });
  return resolved;
}

function nextBarStartAfter(position, bars = []) {
  return (
    sortMarkers(bars)
      .map((bar) => Math.round(Number(bar?.position) || 0))
      .find((barPosition) => barPosition > position) ?? null
  );
}

function resetCopiedNotes(notes = []) {
  return (notes ?? []).map((note) => ({
    ...note,
    start: 0,
    end: 1,
    startFractionDenominator: 1,
    endFractionDenominator: 1,
  }));
}

export function resolveSnapshotCopyRange({
  snapshots = [],
  bars = [],
  startPosition = 1,
  endPosition = 1,
  includeBars = false,
} = {}) {
  const snapshotCount = Array.isArray(snapshots) ? snapshots.length : 0;
  if (snapshotCount <= 0) {
    return {
      snapshotCount: 0,
      valid: false,
      startPosition: null,
      endPosition: null,
      length: 0,
      includeBars: includeBars === true,
    };
  }

  const requestedStart = normalizeSnapshotPosition(startPosition, snapshotCount, 1);
  const requestedEnd = normalizeSnapshotPosition(endPosition, snapshotCount, requestedStart);
  const lowerRequested = Math.min(requestedStart, requestedEnd);
  const upperRequested = Math.max(requestedStart, requestedEnd);

  if (includeBars !== true) {
    return {
      snapshotCount,
      valid: true,
      requestedStartPosition: lowerRequested,
      requestedEndPosition: upperRequested,
      startPosition: lowerRequested,
      endPosition: upperRequested,
      length: upperRequested - lowerRequested + 1,
      includeBars: false,
    };
  }

  const expandedStart = barStartAtOrBefore(lowerRequested, bars);
  const nextBarStart = nextBarStartAfter(upperRequested, bars);
  const expandedEnd =
    nextBarStart == null
      ? snapshotCount
      : Math.max(expandedStart, Math.min(snapshotCount, nextBarStart - 1));

  return {
    snapshotCount,
    valid: true,
    requestedStartPosition: lowerRequested,
    requestedEndPosition: upperRequested,
    startPosition: expandedStart,
    endPosition: expandedEnd,
    length: expandedEnd - expandedStart + 1,
    includeBars: true,
  };
}

export function buildSnapshotCopyBlock({
  snapshots = [],
  bars = [],
  tempi = [],
  repeats = [],
  startPosition = 1,
  endPosition = 1,
  includeBars = false,
  includeTempi = false,
  includeRepeats = false,
  resetNoteOffsets = false,
} = {}) {
  const range = resolveSnapshotCopyRange({
    snapshots,
    bars,
    startPosition,
    endPosition,
    includeBars,
  });
  if (!range.valid) return null;

  const startIndex = range.startPosition - 1;
  const endIndex = range.endPosition - 1;
  const selectionEndBoundary = range.endPosition + 1;
  const copiedSnapshots = (snapshots ?? []).slice(startIndex, endIndex + 1).map((snapshot) => {
    const copiedSnapshot = clone(snapshot);
    if (resetNoteOffsets === true) {
      copiedSnapshot.notes = resetCopiedNotes(copiedSnapshot.notes);
    }
    return copiedSnapshot;
  });

  const mapMarkerIntoBlock = (marker) => {
    const position = normalizeMarkerPosition(marker?.position);
    if (position == null) return null;
    return {
      ...clone(marker),
      position: normalizeMarkerPosition(position - range.startPosition + 1),
    };
  };

  const isMarkerWithinRange = (marker) => {
    const position = normalizeMarkerPosition(marker?.position);
    return (
      position != null &&
      position >= range.startPosition - 1e-9 &&
      position < selectionEndBoundary - 1e-9
    );
  };

  return {
    range,
    length: range.length,
    includeBars: includeBars === true,
    includeTempi: includeTempi === true,
    includeRepeats: includeRepeats === true,
    resetNoteOffsets: resetNoteOffsets === true,
    snapshots: copiedSnapshots,
    bars:
      includeBars === true
        ? sortMarkers(
            (bars ?? []).filter(isMarkerWithinRange).map(mapMarkerIntoBlock).filter(Boolean),
          )
        : [],
    tempi:
      includeTempi === true
        ? sortMarkers(
            (tempi ?? []).filter(isMarkerWithinRange).map(mapMarkerIntoBlock).filter(Boolean),
          )
        : [],
    repeats:
      includeRepeats === true
        ? sortMarkers(
            (repeats ?? []).filter(isMarkerWithinRange).map(mapMarkerIntoBlock).filter(Boolean),
          )
        : [],
  };
}

export function insertSnapshotCopyBlock({
  snapshots = [],
  bars = [],
  tempi = [],
  repeats = [],
  block = null,
  insertionPosition = 1,
  nextSnapshotId = 1,
  nextBarId = 0,
  preserveSnapshotIds = false,
  preserveMarkerIds = false,
} = {}) {
  const snapshotCount = Array.isArray(snapshots) ? snapshots.length : 0;
  if (!block || !Array.isArray(block.snapshots) || block.snapshots.length === 0) {
    return {
      snapshots,
      bars,
      tempi,
      repeats,
      ids: {
        snapshotId: nextSnapshotId - 1,
        barId: nextBarId,
      },
      selectedSnapshotId: null,
      selectedSnapshotMarker: null,
      error: "empty-block",
    };
  }

  const normalizedInsertionPosition = normalizeInsertionPosition(insertionPosition, snapshotCount);
  const insertionAtBarBoundary =
    normalizedInsertionPosition === 1 ||
    normalizedInsertionPosition === snapshotCount + 1 ||
    (bars ?? []).some(
      (bar) => Math.abs((Number(bar?.position) || 0) - normalizedInsertionPosition) < 1e-9,
    );

  if (block.includeBars === true && !insertionAtBarBoundary) {
    return {
      snapshots,
      bars,
      tempi,
      repeats,
      ids: {
        snapshotId: nextSnapshotId - 1,
        barId: nextBarId,
      },
      selectedSnapshotId: null,
      selectedSnapshotMarker: null,
      error: "bar-boundary-required",
    };
  }

  let resolvedNextSnapshotId = Math.max(1, Number(nextSnapshotId) || 1);
  const insertedSnapshots = block.snapshots.map((snapshot) => {
    const insertedSnapshot = clone(snapshot);
    if (!preserveSnapshotIds) insertedSnapshot.id = resolvedNextSnapshotId++;
    return insertedSnapshot;
  });
  const insertIndex = normalizedInsertionPosition - 1;
  const nextSnapshots = [...(snapshots ?? [])];
  nextSnapshots.splice(insertIndex, 0, ...insertedSnapshots);

  const shifted = shiftStructuralMarkersForCopyInsertion({
    bars,
    tempi,
    repeats,
    insertionPosition: normalizedInsertionPosition,
    snapshotCount: block.length,
  });

  let resolvedNextBarId = Math.max(0, Number(nextBarId) || 0);
  const insertedBars = (block.includeBars === true ? block.bars : []).map((bar) => {
    const insertedBar = {
      ...clone(bar),
      position: normalizeMarkerPosition(
        (Number(bar?.position) || 1) + normalizedInsertionPosition - 1,
      ),
    };
    if (!preserveMarkerIds) insertedBar.id = ++resolvedNextBarId;
    return insertedBar;
  });

  let nextTempoId = nextNumericMarkerId(shifted.tempi);
  const insertedTempi = (block.includeTempi === true ? block.tempi : []).map((tempo) => {
    const insertedTempo = {
      ...clone(tempo),
      position: normalizeMarkerPosition(
        (Number(tempo?.position) || 1) + normalizedInsertionPosition - 1,
      ),
    };
    if (!preserveMarkerIds) insertedTempo.id = nextTempoId++;
    return insertedTempo;
  });

  let nextRepeatId = nextNumericMarkerId(shifted.repeats);
  const insertedRepeats = (block.includeRepeats === true ? block.repeats : []).map((repeat) => {
    const insertedRepeat = {
      ...clone(repeat),
      position: normalizeMarkerPosition(
        (Number(repeat?.position) || 1) + normalizedInsertionPosition - 1,
      ),
    };
    if (!preserveMarkerIds) insertedRepeat.id = nextRepeatId++;
    return insertedRepeat;
  });

  return {
    snapshots: nextSnapshots,
    bars: sortMarkers([...(shifted.bars ?? []), ...insertedBars]),
    tempi: sortMarkers([...(shifted.tempi ?? []), ...insertedTempi]),
    repeats: sortMarkers([...(shifted.repeats ?? []), ...insertedRepeats]),
    ids: {
      snapshotId: preserveSnapshotIds ? nextSnapshotId - 1 : resolvedNextSnapshotId - 1,
      barId: resolvedNextBarId,
    },
    selectedSnapshotId: insertedSnapshots[0]?.id ?? null,
    selectedSnapshotMarker: null,
    focus: {
      kind: "snapshot",
      snapshotIndex: insertIndex,
      snapshotId: insertedSnapshots[0]?.id ?? null,
      snapshotCount: nextSnapshots.length,
    },
    error: null,
  };
}

export function moveSnapshotRangeInWorkspace({
  snapshots = [],
  bars = [],
  tempi = [],
  repeats = [],
  startPosition = 1,
  endPosition = 1,
  insertionPosition = 1,
  includeBars = false,
  includeTempi = false,
  includeRepeats = false,
  selectedSnapshotId = null,
  selectedSnapshotMarker = null,
  nextSnapshotId = 1,
  nextBarId = 0,
} = {}) {
  const block = buildSnapshotCopyBlock({
    snapshots,
    bars,
    tempi,
    repeats,
    startPosition,
    endPosition,
    includeBars,
    includeTempi,
    includeRepeats,
  });
  if (!block) {
    return {
      snapshots,
      bars,
      tempi,
      repeats,
      selectedSnapshotId,
      selectedSnapshotMarker,
      changed: false,
      error: "empty-range",
    };
  }

  const sourceStart = block.range.startPosition;
  const sourceEndBoundary = block.range.endPosition + 1;
  const destination = normalizeInsertionPosition(insertionPosition, snapshots.length);
  const destinationAtBarBoundary =
    destination === 1 ||
    destination === snapshots.length + 1 ||
    (bars ?? []).some(
      (bar) => Math.abs((Number(bar?.position) || 0) - destination) < 1e-9,
    );
  if (block.includeBars && !destinationAtBarBoundary) {
    return {
      snapshots,
      bars,
      tempi,
      repeats,
      selectedSnapshotId,
      selectedSnapshotMarker,
      range: block.range,
      changed: false,
      error: "bar-boundary-required",
    };
  }

  if (destination >= sourceStart && destination <= sourceEndBoundary) {
    return {
      snapshots,
      bars,
      tempi,
      repeats,
      selectedSnapshotId: block.snapshots[0]?.id ?? selectedSnapshotId,
      selectedSnapshotMarker: null,
      range: block.range,
      insertionPosition: sourceStart,
      changed: false,
      error: null,
    };
  }

  const deleted = deleteSnapshotRangeFromWorkspace({
    snapshots,
    bars,
    tempi,
    repeats,
    startPosition: block.range.startPosition,
    endPosition: block.range.endPosition,
    includeBars,
    includeTempi,
    includeRepeats,
    selectedSnapshotId,
    selectedSnapshotMarker,
  });
  if (deleted.error) return deleted;

  const adjustedInsertionPosition =
    destination > sourceEndBoundary ? destination - block.length : destination;
  const inserted = insertSnapshotCopyBlock({
    snapshots: deleted.snapshots,
    bars: deleted.bars,
    tempi: deleted.tempi,
    repeats: deleted.repeats,
    block,
    insertionPosition: adjustedInsertionPosition,
    nextSnapshotId,
    nextBarId,
    preserveSnapshotIds: true,
    preserveMarkerIds: true,
  });
  return {
    ...inserted,
    range: block.range,
    insertionPosition: adjustedInsertionPosition,
    changed: inserted.error == null,
  };
}

export function resetSnapshotRangeNoteOffsetsInWorkspace({
  snapshots = [],
  bars = [],
  startPosition = 1,
  endPosition = 1,
  includeBars = false,
} = {}) {
  const range = resolveSnapshotCopyRange({
    snapshots,
    bars,
    startPosition,
    endPosition,
    includeBars,
  });
  if (!range.valid) {
    return {
      snapshots,
      range,
      changed: false,
      error: "empty-range",
    };
  }

  const startIndex = range.startPosition - 1;
  const endIndex = range.endPosition - 1;
  const nextSnapshots = (snapshots ?? []).map((snapshot, index) => {
    if (index < startIndex || index > endIndex) return snapshot;
    return {
      ...snapshot,
      notes: resetCopiedNotes(snapshot.notes),
    };
  });

  return {
    snapshots: nextSnapshots,
    range,
    changed: true,
    error: null,
  };
}

export function setSnapshotRangeArticulationInWorkspace({
  snapshots = [],
  bars = [],
  startPosition = 1,
  endPosition = 1,
  includeBars = false,
  articulation = "chord",
} = {}) {
  const range = resolveSnapshotCopyRange({
    snapshots,
    bars,
    startPosition,
    endPosition,
    includeBars,
  });
  if (!range.valid) {
    return {
      snapshots,
      range,
      changed: false,
      error: "empty-range",
    };
  }

  const normalizedArticulation = articulation === "arpeggiate" ? "arpeggiate" : "chord";
  const startIndex = range.startPosition - 1;
  const endIndex = range.endPosition - 1;
  const nextSnapshots = (snapshots ?? []).map((snapshot, index) => {
    if (index < startIndex || index > endIndex) return snapshot;
    return {
      ...snapshot,
      manualTrigger: {
        ...normalizeManualSnapshotTrigger(snapshot.manualTrigger),
        articulation: normalizedArticulation,
      },
    };
  });

  return {
    snapshots: nextSnapshots,
    range,
    changed: true,
    error: null,
  };
}

export function restoreSnapshotsInWorkspace({ snapshots = [], replacements = [] } = {}) {
  const replacementById = new Map(
    (replacements ?? [])
      .filter((snapshot) => snapshot?.id != null)
      .map((snapshot) => [snapshot.id, snapshot]),
  );
  if (replacementById.size === 0) {
    return {
      snapshots,
      changed: false,
      error: "empty-replacements",
    };
  }

  let changed = false;
  const nextSnapshots = (snapshots ?? []).map((snapshot) => {
    const replacement = replacementById.get(snapshot?.id);
    if (!replacement) return snapshot;
    changed = true;
    return clone(replacement);
  });

  return {
    snapshots: changed ? nextSnapshots : snapshots,
    changed,
    error: changed ? null : "snapshots-not-found",
  };
}

export function deleteSnapshotRangeFromWorkspace({
  snapshots = [],
  bars = [],
  tempi = [],
  repeats = [],
  startPosition = 1,
  endPosition = 1,
  includeBars = false,
  includeTempi = false,
  includeRepeats = false,
  selectedSnapshotId = null,
  selectedSnapshotMarker = null,
} = {}) {
  const range = resolveSnapshotCopyRange({
    snapshots,
    bars,
    startPosition,
    endPosition,
    includeBars,
  });
  if (!range.valid) {
    return {
      snapshots,
      bars,
      tempi,
      repeats,
      selectedSnapshotId,
      selectedSnapshotMarker,
      range,
      changed: false,
      error: "empty-range",
    };
  }

  const startIndex = range.startPosition - 1;
  const endIndex = range.endPosition - 1;
  const nextSnapshots = (snapshots ?? []).filter(
    (_, index) => index < startIndex || index > endIndex,
  );
  const shifted = shiftStructuralMarkersAfterSnapshotRangeDeletion({
    bars,
    tempi,
    repeats,
    startPosition: range.startPosition,
    endPosition: range.endPosition,
    deleteBarsInRange: includeBars === true,
    deleteTempiInRange: includeTempi === true,
    deleteRepeatsInRange: includeRepeats === true,
  });

  const snapshotAtDeletionPoint = nextSnapshots[startIndex] ?? null;
  const focus =
    snapshotAtDeletionPoint == null
      ? {
          kind: "end",
          snapshotIndex: nextSnapshots.length,
          snapshotId: null,
          snapshotCount: nextSnapshots.length,
        }
      : {
          kind: "snapshot",
          snapshotIndex: startIndex,
          snapshotId: snapshotAtDeletionPoint.id,
          snapshotCount: nextSnapshots.length,
        };

  return {
    snapshots: nextSnapshots,
    bars: shifted.bars,
    tempi: shifted.tempi,
    repeats: shifted.repeats,
    selectedSnapshotId: focus.snapshotId,
    selectedSnapshotMarker: null,
    focus,
    range,
    changed: true,
    error: null,
  };
}

export function appendSnapshotToWorkspace({
  snapshots = [],
  notes = [],
  snapshotLabelMode = "proportion",
  sequenceAutoCreateBars = true,
  sequenceBars = [],
  nextSnapshotId = 1,
  nextBarId = 0,
} = {}) {
  const snapshotNotes = Array.isArray(notes) ? notes : [];
  const snapshot = {
    id: nextSnapshotId,
    length: 1,
    description: buildSnapshotDescription(snapshotNotes, snapshotLabelMode),
    descriptionManual: false,
    manualTrigger: normalizeManualSnapshotTrigger(),
    notes: snapshotNotes,
  };
  const nextSnapshots = [...(snapshots ?? []), snapshot];
  let bars = sequenceBars ?? [];
  let barId = nextBarId;

  if (sequenceAutoCreateBars) {
    const nextPosition = nextSnapshots.length;
    if (!bars.some((bar) => Math.abs(Number(bar.position) - nextPosition) < 1e-9)) {
      barId += 1;
      bars = [...bars, { id: barId, position: nextPosition, numerator: 4, denominator: 4 }];
    }
  }

  return {
    snapshots: nextSnapshots,
    bars,
    ids: {
      snapshotId: nextSnapshotId,
      barId,
    },
    selectedSnapshotId: nextSnapshotId,
    selectedSnapshotMarker: null,
  };
}

export function deleteSnapshotFromWorkspace({
  snapshots = [],
  bars = [],
  tempi = [],
  repeats = [],
  snapshotId,
  selectedSnapshotId = null,
  selectedSnapshotMarker = null,
} = {}) {
  const deletedSnapshotIndex = (snapshots ?? []).findIndex(
    (snapshot) => snapshot.id === snapshotId,
  );
  const nextSnapshots = (snapshots ?? []).filter((snapshot) => snapshot.id !== snapshotId);
  let nextBars = bars ?? [];
  let nextTempi = tempi ?? [];
  let nextRepeats = repeats ?? [];

  if (deletedSnapshotIndex >= 0) {
    const deletionPosition = deletedSnapshotIndex + 1;
    const shifted = shiftStructuralMarkersAfterSnapshotDeletion({
      bars,
      tempi,
      repeats,
      deletionPosition,
    });
    nextBars = shifted.bars;
    nextTempi = shifted.tempi;
    nextRepeats = shifted.repeats;
  }

  const snapshotAtDeletionPoint =
    deletedSnapshotIndex < 0 ? null : (nextSnapshots[deletedSnapshotIndex] ?? null);
  const focus =
    deletedSnapshotIndex < 0
      ? null
      : snapshotAtDeletionPoint == null
        ? {
            kind: "end",
            snapshotIndex: nextSnapshots.length,
            snapshotId: null,
            snapshotCount: nextSnapshots.length,
          }
        : {
            kind: "snapshot",
            snapshotIndex: deletedSnapshotIndex,
            snapshotId: snapshotAtDeletionPoint.id,
            snapshotCount: nextSnapshots.length,
          };

  return {
    snapshots: nextSnapshots,
    bars: nextBars,
    tempi: nextTempi,
    repeats: nextRepeats,
    selectedSnapshotId: focus == null ? selectedSnapshotId : focus.snapshotId,
    selectedSnapshotMarker: focus == null ? selectedSnapshotMarker : null,
    focus,
  };
}

export function buildClearedSequenceWorkspaceState() {
  return {
    snapshots: [],
    selectedSnapshotId: null,
    selectedSnapshotMarker: null,
    bars: [],
    tempi: [],
    repeats: [],
    ids: {
      snapshotId: 0,
      barId: 0,
    },
    activeSequenceSource: "",
    activeSequenceBuiltInName: "",
    activeSequenceName: "",
    activeSequenceSavedName: "",
    activeSequenceDescription: "",
    manualArpeggiation: normalizeManualArpeggiation(),
  };
}

export function moveSnapshotInWorkspace({ snapshots = [], fromId, toId, side = "before" } = {}) {
  const fromIdx = (snapshots ?? []).findIndex((snapshot) => snapshot.id === fromId);
  const toIdx = (snapshots ?? []).findIndex((snapshot) => snapshot.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return snapshots ?? [];
  const next = [...(snapshots ?? [])];
  const [moved] = next.splice(fromIdx, 1);
  const adjustedToIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
  const insertIdx = side === "after" ? adjustedToIdx + 1 : adjustedToIdx;
  next.splice(insertIdx, 0, moved);
  return next;
}

export function duplicateSnapshotInWorkspace({
  snapshots = [],
  bars = [],
  tempi = [],
  repeats = [],
  fromId,
  toId,
  side = "before",
  nextSnapshotId = 1,
} = {}) {
  const fromIdx = (snapshots ?? []).findIndex((snapshot) => snapshot.id === fromId);
  const toIdx = (snapshots ?? []).findIndex((snapshot) => snapshot.id === toId);
  if (fromIdx === -1 || toIdx === -1) {
    return {
      snapshots,
      bars,
      tempi,
      repeats,
      ids: { snapshotId: nextSnapshotId - 1 },
    };
  }
  const source = snapshots[fromIdx];
  if (!source) {
    return {
      snapshots,
      bars,
      tempi,
      repeats,
      ids: { snapshotId: nextSnapshotId - 1 },
    };
  }
  const duplicate = {
    ...clone(source),
    id: nextSnapshotId,
  };
  const nextSnapshots = [...snapshots];
  const insertIdx = side === "after" ? toIdx + 1 : toIdx;
  nextSnapshots.splice(insertIdx, 0, duplicate);
  const insertionPosition = insertIdx + 1;
  const shifted = shiftStructuralMarkersAfterSnapshotInsertion({
    bars,
    tempi,
    repeats,
    insertionPosition,
    snapshotCount: 1,
  });

  return {
    snapshots: nextSnapshots,
    bars: shifted.bars,
    tempi: shifted.tempi,
    repeats: shifted.repeats,
    ids: { snapshotId: nextSnapshotId },
  };
}

export function updateSnapshotInWorkspace({
  snapshots = [],
  snapshotId,
  updates = {},
  snapshotLabelMode = "proportion",
} = {}) {
  return (snapshots ?? []).map((snapshot) => {
    if (snapshot.id !== snapshotId) return snapshot;
    const nextSnapshot = {
      ...snapshot,
      ...updates,
      ...(Object.prototype.hasOwnProperty.call(updates, "description")
        ? { descriptionManual: true }
        : {}),
    };
    if (
      !nextSnapshot.descriptionManual &&
      Object.prototype.hasOwnProperty.call(updates, "notes") &&
      !Object.prototype.hasOwnProperty.call(updates, "description")
    ) {
      nextSnapshot.description = buildSnapshotDescription(nextSnapshot.notes, snapshotLabelMode);
    }
    return nextSnapshot;
  });
}

export function resetSnapshotDescriptionInWorkspace({
  snapshots = [],
  snapshotId,
  snapshotLabelMode = "proportion",
} = {}) {
  return (snapshots ?? []).map((snapshot) => {
    if (snapshot.id !== snapshotId) return snapshot;
    return {
      ...snapshot,
      description: buildSnapshotDescription(snapshot.notes, snapshotLabelMode),
      descriptionManual: false,
    };
  });
}
