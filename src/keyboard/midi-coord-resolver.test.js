import { describe, expect, it } from "vitest";
import Point from "./point.js";
import { MidiCoordResolver } from "./midi-coord-resolver.js";

function createResolver() {
  return new MidiCoordResolver(
    {
      rSteps: 1,
      drSteps: 12,
      hexSize: 40,
      centerHexOffset: new Point(0, 0),
      runtime_display_offset_x: 0,
      runtime_display_offset_y: 0,
      center_degree: 0,
      equivSteps: 12,
      midiin_anchor_note: 60,
      midiin_anchor_channel: 1,
    },
    (coords) => [0, 0, coords.x],
    (coords) => new Point(500 + coords.x * 100, 500 - coords.y * 100),
    () => new Point(500, 500),
    null,
  );
}

function setStepTables(resolver, steps, coords) {
  resolver.stepsTable = new Map([[steps, coords]]);
  resolver.fullyVisibleStepsTable = new Map([
    [steps, coords.filter((coord) => resolver._isFullyVisibleCoord(coord))],
  ]);
  resolver._rebuildPreferredFullyVisibleCoords();
}

describe("MidiCoordResolver", () => {
  it("reuses the same visible coord for a repeated live input address", () => {
    const resolver = createResolver();
    const center = new Point(0, 0);
    const right = new Point(2, 0);
    setStepTables(resolver, 0, [center, right]);
    resolver.lastMidiCoords = resolver._hexCoordsToScreen(center);
    resolver.rememberCoordsForInputAddress({ channel: 3, note: 64 }, right);

    expect(resolver.bestVisibleCoord(0, { channel: 3, note: 64 })).toEqual(right);
    expect(resolver.bestVisibleCoord(0, { channel: 4, note: 64 })).toEqual(center);
  });

  it("prefers a central on-screen band when several visible coords share the same steps", () => {
    const resolver = createResolver();
    const center = new Point(0, 0);
    const nearEdge = new Point(4, 0);
    setStepTables(resolver, 0, [center, nearEdge]);
    resolver.lastMidiCoords = resolver._hexCoordsToScreen(nearEdge);

    expect(resolver.bestVisibleCoord(0, { channel: 8, note: 72 })).toEqual(center);
  });

  it("prefers a fully visible hex over a clipped edge hex when both match the same steps", () => {
    const resolver = createResolver();
    const middle = new Point(0, 0);
    const clippedBottomRight = new Point(5, -5);
    setStepTables(resolver, 0, [middle, clippedBottomRight]);
    resolver.lastMidiCoords = resolver._hexCoordsToScreen(clippedBottomRight);

    expect(resolver.stepsToFullyVisibleCoords(0)).toEqual([middle]);
    expect(resolver._isFullyVisibleCoord(middle)).toBe(true);
    expect(resolver._isFullyVisibleCoord(clippedBottomRight)).toBe(false);
    expect(resolver.bestVisibleCoord(0)).toEqual(middle);
  });

  it("precomputes stable preferred fully visible coords that drift gradually with step height", () => {
    const resolver = createResolver();
    const lowLeft = new Point(-2, -2);
    const lowRight = new Point(1, -1);
    const centerLeft = new Point(-1, 0);
    const centerRight = new Point(1, 0);
    const highLeft = new Point(-1, 1);
    const highRight = new Point(2, 2);
    resolver.stepsTable = new Map([
      [-1, [lowLeft, lowRight]],
      [0, [centerLeft, centerRight]],
      [1, [highLeft, highRight]],
    ]);
    resolver.fullyVisibleStepsTable = new Map([
      [-1, [lowLeft, lowRight]],
      [0, [centerLeft, centerRight]],
      [1, [highLeft, highRight]],
    ]);

    resolver._rebuildPreferredFullyVisibleCoords();

    const low = resolver.preferredFullyVisibleCoordByStep.get(-1);
    const mid = resolver.preferredFullyVisibleCoordByStep.get(0);
    const high = resolver.preferredFullyVisibleCoordByStep.get(1);

    expect(resolver.stepsToFullyVisibleCoords(-1)).toContainEqual(low);
    expect(resolver.stepsToFullyVisibleCoords(0)).toContainEqual(mid);
    expect(resolver.stepsToFullyVisibleCoords(1)).toContainEqual(high);

    const lowScreen = resolver._hexCoordsToScreen(low);
    const midScreen = resolver._hexCoordsToScreen(mid);
    const highScreen = resolver._hexCoordsToScreen(high);

    expect(lowScreen.y).toBeGreaterThan(midScreen.y);
    expect(midScreen.y).toBeGreaterThan(highScreen.y);
  });
});
