import Point from "./point";
import {
  addSustainedHex,
  clearSustainedHexes,
  collectSoundingHexes,
  createSoundingNoteState,
  hasSoundingNotes,
  isCoordActive,
  removeSustainedHex,
} from "./sounding-note-runtime.js";

function makeHex(x, y, id) {
  return {
    id,
    coords: new Point(x, y),
  };
}

describe("keyboard/sounding-note-runtime", () => {
  it("tracks active notes across input sources", () => {
    const state = createSoundingNoteState();
    const mouseHex = makeHex(0, 0, "mouse");
    const midiHex = makeHex(1, 0, "midi");
    state.activeMouse = mouseHex;
    state.activeMidi.set("n1", midiHex);

    expect(hasSoundingNotes(state)).toBe(true);
    expect(isCoordActive(state, mouseHex.coords)).toBe(true);
    expect(isCoordActive(state, midiHex.coords)).toBe(true);
    expect(collectSoundingHexes(state)).toEqual([mouseHex, midiHex]);
  });

  it("deduplicates sustained notes by coordinates", () => {
    const state = createSoundingNoteState();
    const first = makeHex(2, 3, "first");
    const second = makeHex(2, 3, "second");

    expect(addSustainedHex(state, first, 64).added).toBe(true);
    expect(addSustainedHex(state, second, 32).added).toBe(false);
    expect(state.sustainedNotes).toHaveLength(1);
    expect(state.sustainedCoords.has("2,3")).toBe(true);
  });

  it("removes and clears sustained notes cleanly", () => {
    const state = createSoundingNoteState();
    const first = makeHex(2, 3, "first");
    const second = makeHex(4, 5, "second");

    addSustainedHex(state, first, 64);
    addSustainedHex(state, second, 32);

    const removed = removeSustainedHex(state, first.coords);
    expect(removed?.entry).toEqual([first, 64]);
    expect(state.sustainedNotes).toEqual([[second, 32]]);
    expect(state.sustainedCoords.has("2,3")).toBe(false);

    const cleared = clearSustainedHexes(state);
    expect(cleared).toEqual([[second, 32]]);
    expect(state.sustainedNotes).toEqual([]);
    expect(state.sustainedCoords.size).toBe(0);
  });

  it("includes recently released notes only when requested", () => {
    const state = createSoundingNoteState();
    const active = makeHex(0, 0, "active");
    const recent = makeHex(9, 9, "recent");
    state.activeKeyboard.set("KeyA", active);
    const recentReleasedHexes = new Map([[recent, 1234]]);

    expect(
      collectSoundingHexes(state, {
        includeRecentReleased: false,
        recentReleasedHexes,
      }),
    ).toEqual([active]);
    expect(
      collectSoundingHexes(state, {
        includeRecentReleased: true,
        recentReleasedHexes,
      }),
    ).toEqual([active, recent]);
  });
});
