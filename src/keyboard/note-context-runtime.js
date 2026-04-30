export function noteBelongsToFrameId(noteLike, frameId) {
  if (!frameId) return false;
  return noteLike?._onsetFrameId === frameId;
}

export function normalizeSettlementNotes(activeHexes = [], sustainedNotes = []) {
  const notes = [];
  for (const hex of activeHexes) {
    notes.push({
      onsetFrameId: hex?._onsetFrameId ?? null,
      source: "active",
    });
  }
  for (const [hex] of sustainedNotes) {
    notes.push({
      onsetFrameId: hex?._onsetFrameId ?? null,
      source: "sustained",
    });
  }
  return notes;
}

function noteSnapshotBelongsToFrameId(noteLike, frameId) {
  if (!frameId) return false;
  if (noteLike?.onsetFrameId !== undefined) return noteLike.onsetFrameId === frameId;
  return noteBelongsToFrameId(noteLike, frameId);
}

export function hasLegacyFrameNotes(modulationState, notes = []) {
  if (modulationState?.mode !== "pending_settlement" || !modulationState?.oldFrame?.id) {
    return false;
  }
  const oldFrameId = modulationState.oldFrame.id;
  for (const note of notes) {
    if (noteSnapshotBelongsToFrameId(note, oldFrameId)) return true;
  }
  return false;
}

export function evaluateSettlement(modulationState, notes = []) {
  if (modulationState?.mode !== "pending_settlement") {
    return {
      pendingSettlement: false,
      hasLegacyNotes: false,
      canSettle: false,
    };
  }
  const hasLegacyNotes = hasLegacyFrameNotes(modulationState, notes);
  return {
    pendingSettlement: true,
    hasLegacyNotes,
    canSettle: !hasLegacyNotes,
  };
}

export function classifyReleaseForSettlement(modulationState, options = {}) {
  const suppressed = options.suppressed === true;
  const notes = options.notes ?? normalizeSettlementNotes(
    options.activeHexes ?? [],
    options.sustainedNotes ?? [],
  );
  const settlement = evaluateSettlement(modulationState, notes);

  return {
    suppressed,
    pendingSettlement: settlement.pendingSettlement,
    hasLegacyNotes: settlement.hasLegacyNotes,
    canSettle: settlement.canSettle,
    shouldRetrySettlement: settlement.pendingSettlement && !suppressed,
  };
}
