import { describe, expect, it } from "vitest";
import {
  planManualSnapshotFormation,
  planManualSnapshotRelease,
} from "./manual-snapshot-gesture-planner.js";

describe("manual snapshot gesture planner", () => {
  it("orders attacks by relative position and scales them to the total spread", () => {
    const notes = [
      { id: "late", start: 3 },
      { id: "first", start: 1 },
      { id: "middle", start: 2 },
    ];
    const plan = planManualSnapshotFormation(notes, {
      initialSpreadMs: 800,
      timingVariation: 0,
    });

    expect(plan.durationMs).toBe(800);
    expect(plan.events.map(({ noteId }) => noteId)).toEqual(["first", "middle", "late"]);
    expect(plan.events.map(({ offsetMs }) => offsetMs)).toEqual([0, 400, 800]);
  });

  it("distributes tied notes evenly in stable event-list order", () => {
    const plan = planManualSnapshotFormation(
      [
        { id: "a", start: 0 },
        { id: "b", start: 0 },
        { id: "c", start: 0 },
      ],
      { initialSpreadMs: 600 },
    );

    expect(plan.events.map(({ noteId }) => noteId)).toEqual(["a", "b", "c"]);
    expect(plan.events.map(({ offsetMs }) => offsetMs)).toEqual([0, 300, 600]);
  });

  it("orders notes sharing a start position by rising pitch", () => {
    const plan = planManualSnapshotFormation(
      [
        { id: "high", start: 0, midicents: 69 },
        { id: "low", start: 0, midicents: 62 },
        { id: "middle", start: 0, midicents: 65 },
        { id: "later", start: 1, midicents: 48 },
      ],
      { initialSpreadMs: 600 },
    );

    expect(plan.events.map(({ noteId }) => noteId)).toEqual(["low", "middle", "high", "later"]);
    expect(plan.events.map(({ offsetMs }) => offsetMs)).toEqual([0, 0, 0, 600]);
  });

  it("varies gaps without changing order or the final offset", () => {
    const values = [0, 1];
    const plan = planManualSnapshotFormation(
      [
        { id: "a", start: 0 },
        { id: "b", start: 1 },
        { id: "c", start: 2 },
      ],
      { initialSpreadMs: 1000, timingVariation: 1 },
      () => values.shift(),
    );

    expect(plan.events.map(({ noteId }) => noteId)).toEqual(["a", "b", "c"]);
    expect(plan.events[0].offsetMs).toBe(0);
    expect(plan.events[1].offsetMs).toBeGreaterThan(0);
    expect(plan.events[2].offsetMs).toBe(1000);
  });

  it("separates tied source attacks as timing variation approaches 100%", () => {
    const notes = [
      { id: "first", start: 0 },
      { id: "second", start: 0 },
      { id: "third", start: 0 },
      { id: "fourth", start: 0 },
      { id: "last", start: 0.375 },
    ];
    const preserved = planManualSnapshotFormation(
      notes,
      { initialSpreadMs: 1000, timingVariation: 0 },
      () => 0.5,
    );
    const redistributed = planManualSnapshotFormation(
      notes,
      { initialSpreadMs: 1000, timingVariation: 1 },
      () => 0.5,
    );

    expect(preserved.events.map(({ offsetMs }) => offsetMs)).toEqual([0, 0, 0, 0, 1000]);
    expect(redistributed.events.map(({ offsetMs }) => offsetMs)).toEqual([0, 250, 500, 750, 1000]);
    expect(redistributed.events.map(({ noteId }) => noteId)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
      "last",
    ]);
  });

  it("blends composed gaps with generated gaps at intermediate variation", () => {
    const plan = planManualSnapshotFormation(
      [
        { id: "first", start: 0 },
        { id: "second", start: 0 },
        { id: "last", start: 1 },
      ],
      { initialSpreadMs: 1000, timingVariation: 0.5 },
      () => 0.5,
    );

    expect(plan.events.map(({ offsetMs }) => offsetMs)).toEqual([0, 250, 1000]);
  });

  it("generates coherent beginning- and end-weighted timing arcs", () => {
    const notes = [
      { id: "a", start: 0 },
      { id: "b", start: 0 },
      { id: "c", start: 0 },
      { id: "d", start: 0 },
      { id: "e", start: 1 },
    ];
    const beginningValues = [0, 0];
    const endValues = [1, 1];
    const beginningWeighted = planManualSnapshotFormation(
      notes,
      { initialSpreadMs: 2000, timingVariation: 1 },
      () => beginningValues.shift(),
    );
    const endWeighted = planManualSnapshotFormation(
      notes,
      { initialSpreadMs: 2000, timingVariation: 1 },
      () => endValues.shift(),
    );

    [0, 200, 600, 1200, 2000].forEach((offset, index) => {
      expect(beginningWeighted.events[index].offsetMs).toBeCloseTo(offset);
    });
    [0, 800, 1400, 1800, 2000].forEach((offset, index) => {
      expect(endWeighted.events[index].offsetMs).toBeCloseTo(offset);
    });
  });

  it("varies the total spread reciprocally around its center value", () => {
    const notes = [
      { id: "a", start: 0 },
      { id: "b", start: 1 },
    ];
    const lower = planManualSnapshotFormation(
      notes,
      { initialSpreadMs: 2000, spreadVariation: 1 / 3 },
      () => 0,
    );
    const upper = planManualSnapshotFormation(
      notes,
      { initialSpreadMs: 2000, spreadVariation: 1 / 3 },
      () => 1,
    );

    expect(lower.durationMs).toBeCloseTo(1500);
    expect(lower.events.at(-1).offsetMs).toBeCloseTo(1500);
    expect(upper.durationMs).toBeCloseTo((2000 * 4) / 3);
    expect(upper.events.at(-1).offsetMs).toBeCloseTo((2000 * 4) / 3);
  });

  it("plans independently varied releases from the next trigger", () => {
    const randomValues = [1, 0];
    const formation = planManualSnapshotFormation(
      [
        { id: "first", start: 0 },
        { id: "second", start: 1 },
      ],
      {
        initialSpreadMs: 100,
        timingVariation: 0,
      },
    );
    const plan = planManualSnapshotRelease(
      formation.events,
      {
        decayMode: "timed",
        decayMs: 1000,
        decayVariation: 1,
      },
      () => randomValues.shift(),
    );

    expect(plan.events.map((event) => event.noteId)).toEqual(["second", "first"]);
    expect(plan.events[0].offsetMs).toBeCloseTo(500);
    expect(plan.events[1].offsetMs).toBeCloseTo(2000);
  });

  it("supports immediate and sustained release endpoints", () => {
    const attacks = planManualSnapshotFormation(
      [
        { id: "first", start: 0 },
        { id: "second", start: 1 },
      ],
      { initialSpreadMs: 100 },
    ).events;

    expect(planManualSnapshotRelease(attacks, { decayMode: "immediate" }).events).toEqual(
      attacks.map((event) => ({ ...event, type: "release", offsetMs: 0 })),
    );
    expect(planManualSnapshotRelease(attacks, { decayMode: "sustain" })).toEqual({
      durationMs: 0,
      events: [],
    });
  });

  it("handles empty and one-note snapshots without delayed work", () => {
    expect(planManualSnapshotFormation([], { initialSpreadMs: 700 })).toEqual({
      durationMs: 0,
      events: [],
    });
    expect(planManualSnapshotFormation([{ id: "solo" }], { initialSpreadMs: 700 })).toMatchObject({
      durationMs: 0,
      events: [{ offsetMs: 0, noteId: "solo" }],
    });
  });
});
