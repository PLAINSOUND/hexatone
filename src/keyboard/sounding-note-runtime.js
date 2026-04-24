function coordKey(coords) {
  return `${coords.x},${coords.y}`;
}

function coordsMatch(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

export function createSoundingNoteState() {
  return {
    sustain: false,
    latch: false,
    sustainedNotes: [],
    sustainedCoords: new Set(),
    escHeld: false,
    isTuneDragging: false,
    pressedKeys: new Set(),
    shiftSustainedKeys: new Set(),
    activeMouse: null,
    activeTouch: new Map(),
    activeKeyboard: new Map(),
    activeMidi: new Map(),
    activeMidiByChannel: new Map(),
    isTouchDown: false,
    isMouseDown: false,
  };
}

export function* iterActiveHexes(state) {
  if (state.activeMouse) yield state.activeMouse;
  yield* state.activeTouch.values();
  yield* state.activeKeyboard.values();
  yield* state.activeMidi.values();
}

export function isCoordActive(state, coords) {
  for (const hex of iterActiveHexes(state)) {
    if (hex.coords.equals(coords)) return true;
  }
  return false;
}

export function hasSoundingNotes(state) {
  return (
    state.activeMouse !== null ||
    state.activeTouch.size > 0 ||
    state.activeKeyboard.size > 0 ||
    state.activeMidi.size > 0 ||
    state.sustainedNotes.length > 0
  );
}

export function collectSoundingHexes(state, options = {}) {
  const out = [...iterActiveHexes(state), ...state.sustainedNotes.map(([hex]) => hex)];
  if (options.includeRecentReleased && options.recentReleasedHexes) {
    out.push(...options.recentReleasedHexes.keys());
  }
  return out;
}

export function findSustainedHexIndex(state, coords) {
  return state.sustainedNotes.findIndex(([hex]) => coordsMatch(hex.coords, coords));
}

export function addSustainedHex(state, hex, releaseVelocity = 0) {
  const key = coordKey(hex.coords);
  const existingIndex = findSustainedHexIndex(state, hex.coords);
  if (existingIndex !== -1) {
    return {
      added: false,
      key,
      index: existingIndex,
      entry: state.sustainedNotes[existingIndex],
    };
  }
  const entry = [hex, releaseVelocity];
  state.sustainedNotes.push(entry);
  state.sustainedCoords.add(key);
  return {
    added: true,
    key,
    index: state.sustainedNotes.length - 1,
    entry,
  };
}

export function removeSustainedHex(state, coords) {
  const index = findSustainedHexIndex(state, coords);
  if (index === -1) return null;
  const [entry] = state.sustainedNotes.splice(index, 1);
  state.sustainedCoords.delete(coordKey(coords));
  return {
    index,
    entry,
    key: coordKey(coords),
  };
}

export function clearSustainedHexes(state) {
  const notes = state.sustainedNotes;
  state.sustainedNotes = [];
  state.sustainedCoords.clear();
  return notes;
}
