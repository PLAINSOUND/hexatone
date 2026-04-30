import Point from "./point";
import {
  beginModulation,
  cancelModulation,
  clearModulationHistory,
  commitModulationTarget,
  createModulationState,
  describeSurfaceStrategy,
  frameForNewNotes,
  noteBelongsToLegacyFrame,
  resetModulationRouteCounts,
  setModulationHistoryIndex,
  settleModulationIfPossible,
} from "./modulation-runtime.js";

function makeHex(id, x, y, degree = null) {
  return {
    id,
    coords: new Point(x, y),
    pressed_interval: degree,
  };
}

describe("keyboard/modulation-runtime", () => {
  const oldFrame = { id: "frame-old" };
  const newFrame = { id: "frame-new" };

  it("enters awaiting-target mode from the most recent sounding note", () => {
    const sourceHex = makeHex("source", 2, 3, 7);
    const state = createModulationState({ currentFrame: oldFrame });
    const next = beginModulation(state, {
      currentFrame: oldFrame,
      sourceHex,
    });

    expect(next.mode).toBe("awaiting_target");
    expect(next.oldFrame).toBe(oldFrame);
    expect(next.sourceHex).toBe(sourceHex);
    expect(next.sourceCoordsKey).toBe("2,3");
    expect(next.sourceDegree).toBe(7);
    expect(next.strategy).toBe("retune_surface_to_source");
    expect(next.geometryMode).toBe("moveable_surface");
  });

  it("can arm from an implicit degree-zero source when nothing is sounding", () => {
    const state = createModulationState({ currentFrame: oldFrame });
    const next = beginModulation(state, {
      currentFrame: oldFrame,
      sourceDegree: 0,
    });

    expect(next.mode).toBe("awaiting_target");
    expect(next.oldFrame).toBe(oldFrame);
    expect(next.sourceHex).toBeNull();
    expect(next.sourceCoordsKey).toBeNull();
    expect(next.sourceDegree).toBe(0);
    expect(next.lastDecision.sourceDegree).toBe(0);
  });

  it("chooses takeover when the source note is still sounding", () => {
    const sourceHex = makeHex("source", 2, 3, 7);
    const state = beginModulation(createModulationState({ currentFrame: oldFrame }), {
      currentFrame: oldFrame,
      sourceHex,
    });
    const next = commitModulationTarget(state, {
      targetDegree: 11,
      pendingFrame: newFrame,
      sourceStillSounding: true,
    });

    expect(next.mode).toBe("pending_settlement");
    expect(next.pendingFrame).toBe(newFrame);
    expect(next.targetDegree).toBe(11);
    expect(next.takeoverConsumed).toBe(false);
    expect(next.lastDecision.articulation).toBe("takeover");
    expect(next.lastDecision.strategy).toBe("retune_surface_to_source");
    expect(next.lastDecision.geometryMode).toBe("moveable_surface");
    expect(frameForNewNotes(next)).toBe(newFrame);
    expect(next.currentRoute).toEqual({
      count: 1,
      sourceDegree: 7,
      targetDegree: 11,
      strategy: "retune_surface_to_source",
    });
    expect(next.history).toEqual([
      {
        count: 1,
        sourceDegree: 7,
        targetDegree: 11,
        strategy: "retune_surface_to_source",
      },
    ]);
    expect(next.historyIndex).toBe(1);
  });

  it("chooses a fresh attack when the source note is no longer sounding", () => {
    const sourceHex = makeHex("source", 2, 3, 7);
    const state = beginModulation(createModulationState({ currentFrame: oldFrame }), {
      currentFrame: oldFrame,
      sourceHex,
    });
    const next = commitModulationTarget(state, {
      targetDegree: 11,
      pendingFrame: newFrame,
      sourceStillSounding: false,
    });

    expect(next.lastDecision.articulation).toBe("attack");
    expect(next.takeoverConsumed).toBe(false);
  });

  it("supports the stable-surface reinterpretation strategy explicitly", () => {
    const sourceHex = makeHex("source", 2, 3, 7);
    const state = beginModulation(createModulationState({ currentFrame: oldFrame }), {
      currentFrame: oldFrame,
      sourceHex,
      strategy: "reinterpret_surface_from_target",
    });
    const next = commitModulationTarget(state, {
      targetDegree: 11,
      pendingFrame: newFrame,
      strategy: "reinterpret_surface_from_target",
    });

    expect(next.strategy).toBe("reinterpret_surface_from_target");
    expect(next.geometryMode).toBe("stable_surface");
    expect(next.lastDecision.strategy).toBe("reinterpret_surface_from_target");
    expect(next.lastDecision.geometryMode).toBe("stable_surface");
  });

  it("defers settlement while legacy-frame notes remain", () => {
    const sourceHex = makeHex("source", 2, 3, 7);
    const state = commitModulationTarget(
      beginModulation(createModulationState({ currentFrame: oldFrame }), {
        currentFrame: oldFrame,
        sourceHex,
      }),
      {
        targetDegree: 11,
        pendingFrame: newFrame,
      },
    );
    const deferred = settleModulationIfPossible(state, { hasLegacyNotes: true });

    expect(deferred.mode).toBe("pending_settlement");
    expect(deferred.currentFrame).toBe(oldFrame);
    expect(deferred.pendingFrame).toBe(newFrame);
    expect(deferred.lastDecision.type).toBe("settlement_deferred");
  });

  it("completes settlement once no legacy-frame notes remain", () => {
    const sourceHex = makeHex("source", 2, 3, 7);
    const state = commitModulationTarget(
      beginModulation(createModulationState({ currentFrame: oldFrame }), {
        currentFrame: oldFrame,
        sourceHex,
      }),
      {
        targetDegree: 11,
        pendingFrame: newFrame,
      },
    );
    const settled = settleModulationIfPossible(state, { hasLegacyNotes: false });

    expect(settled.mode).toBe("idle");
    expect(settled.currentFrame).toBe(newFrame);
    expect(settled.pendingFrame).toBeNull();
    expect(settled.sourceHex).toBeNull();
    expect(settled.currentRoute).toEqual({
      count: 1,
      sourceDegree: 7,
      targetDegree: 11,
      strategy: "retune_surface_to_source",
    });
    expect(settled.history).toEqual([
      {
        count: 1,
        sourceDegree: 7,
        targetDegree: 11,
        strategy: "retune_surface_to_source",
      },
    ]);
    expect(settled.historyIndex).toBe(1);
    expect(settled.lastDecision.type).toBe("settlement_complete");
  });

  it("appends new steps after the current history position", () => {
    const state = createModulationState({
      currentFrame: oldFrame,
      history: [
        { sourceDegree: 0, targetDegree: 7, strategy: "retune_surface_to_source", count: 0 },
        { sourceDegree: 7, targetDegree: 2, strategy: "retune_surface_to_source", count: 0 },
      ],
      historyIndex: 1,
      currentRoute: { sourceDegree: 0, targetDegree: 7, strategy: "retune_surface_to_source", count: 1 },
    });
    const armed = beginModulation(state, {
      currentFrame: oldFrame,
      sourceDegree: 7,
    });
    const committed = commitModulationTarget(armed, {
      targetDegree: 11,
      pendingFrame: newFrame,
      sourceStillSounding: false,
    });

    expect(committed.history).toEqual([
      { sourceDegree: 0, targetDegree: 7, strategy: "retune_surface_to_source", count: 0 },
      { sourceDegree: 7, targetDegree: 2, strategy: "retune_surface_to_source", count: 0 },
      { sourceDegree: 7, targetDegree: 11, strategy: "retune_surface_to_source", count: 1 },
    ]);
    expect(committed.historyIndex).toBe(1);
    expect(committed.currentRoute).toEqual({
      count: 1,
      sourceDegree: 7,
      targetDegree: 11,
      strategy: "retune_surface_to_source",
    });
  });

  it("can move to a stored history index and clear the library at home", () => {
    const state = createModulationState({
      currentFrame: oldFrame,
      history: [
        { sourceDegree: 0, targetDegree: 7, strategy: "retune_surface_to_source", count: 0 },
        { sourceDegree: 7, targetDegree: 11, strategy: "retune_surface_to_source", count: 2 },
      ],
      historyIndex: 2,
      currentRoute: { sourceDegree: 7, targetDegree: 11, strategy: "retune_surface_to_source", count: 2 },
    });
    const rewound = setModulationHistoryIndex(state, 0, oldFrame);

    expect(rewound.historyIndex).toBe(0);
    expect(rewound.currentRoute).toBeNull();
    expect(rewound.currentFrame).toBe(oldFrame);

    const cleared = clearModulationHistory(rewound, oldFrame);
    expect(cleared.history).toEqual([]);
    expect(cleared.historyIndex).toBe(0);
    expect(cleared.currentRoute).toBeNull();
  });

  it("can zero all modulation route counts while preserving the library", () => {
    const state = createModulationState({
      currentFrame: newFrame,
      homeFrame: oldFrame,
      history: [
        { sourceDegree: 0, targetDegree: 7, strategy: "retune_surface_to_source", count: 1 },
        { sourceDegree: 7, targetDegree: 11, strategy: "retune_surface_to_source", count: -2 },
      ],
      historyIndex: -2,
      currentRoute: { sourceDegree: 7, targetDegree: 11, strategy: "retune_surface_to_source", count: -2 },
    });

    const reset = resetModulationRouteCounts(state, oldFrame);

    expect(reset.history).toEqual([
      { sourceDegree: 0, targetDegree: 7, strategy: "retune_surface_to_source", count: 0 },
      { sourceDegree: 7, targetDegree: 11, strategy: "retune_surface_to_source", count: 0 },
    ]);
    expect(reset.historyIndex).toBe(0);
    expect(reset.currentRoute).toBeNull();
    expect(reset.currentFrame).toBe(oldFrame);
  });

  it("detects whether a note belongs to the legacy frame during settlement", () => {
    const sourceHex = makeHex("source", 2, 3, 7);
    const state = commitModulationTarget(
      beginModulation(createModulationState({ currentFrame: oldFrame }), {
        currentFrame: oldFrame,
        sourceHex,
      }),
      {
        targetDegree: 11,
        pendingFrame: newFrame,
      },
    );

    expect(noteBelongsToLegacyFrame(state, { onsetFrameId: "frame-old" })).toBe(true);
    expect(noteBelongsToLegacyFrame(state, { onsetFrameId: "frame-new" })).toBe(false);
  });

  it("can cancel a partially started modulation cleanly", () => {
    const sourceHex = makeHex("source", 2, 3, 7);
    const state = beginModulation(createModulationState({ currentFrame: oldFrame }), {
      currentFrame: oldFrame,
      sourceHex,
    });
    const cancelled = cancelModulation(state, "user_cancelled");

    expect(cancelled.mode).toBe("idle");
    expect(cancelled.currentFrame).toBe(oldFrame);
    expect(cancelled.sourceHex).toBeNull();
    expect(cancelled.lastDecision).toEqual({
      type: "cancel_modulation",
      reason: "user_cancelled",
    });
  });

  it("describes the current surface policy for later Keys integration", () => {
    const stable = createModulationState({
      strategy: "reinterpret_surface_from_target",
    });
    const moveable = createModulationState({
      strategy: "retune_surface_to_source",
    });

    expect(describeSurfaceStrategy(stable)).toEqual({
      strategy: "reinterpret_surface_from_target",
      geometryMode: "stable_surface",
      moveableSurface: false,
      stableSurface: true,
    });
    expect(describeSurfaceStrategy(moveable)).toEqual({
      strategy: "retune_surface_to_source",
      geometryMode: "moveable_surface",
      moveableSurface: true,
      stableSurface: false,
    });
  });
});
