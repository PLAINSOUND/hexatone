import { buildSnapshotDescription } from "./labels.js";
import {
  shiftStructuralMarkersAfterSnapshotDeletion,
  shiftStructuralMarkersAfterSnapshotInsertion,
} from "./structure-editing.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
  const deletedSnapshotIndex = (snapshots ?? []).findIndex((snapshot) => snapshot.id === snapshotId);
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

  return {
    snapshots: nextSnapshots,
    bars: nextBars,
    tempi: nextTempi,
    repeats: nextRepeats,
    selectedSnapshotId: selectedSnapshotId === snapshotId ? (nextSnapshots[0]?.id ?? null) : selectedSnapshotId,
    selectedSnapshotMarker: selectedSnapshotMarker?.snapshotId === snapshotId ? null : selectedSnapshotMarker,
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
  };
}

export function moveSnapshotInWorkspace({
  snapshots = [],
  fromId,
  toId,
  side = "before",
} = {}) {
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
      !nextSnapshot.descriptionManual
      && Object.prototype.hasOwnProperty.call(updates, "notes")
      && !Object.prototype.hasOwnProperty.call(updates, "description")
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
