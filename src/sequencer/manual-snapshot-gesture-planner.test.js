import { describe, expect, it } from "vitest";
import { planManualSnapshotFormation } from "./manual-snapshot-gesture-planner.js";

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
      [{ id: "a", start: 0 }, { id: "b", start: 0 }, { id: "c", start: 0 }],
      { initialSpreadMs: 600 },
    );

    expect(plan.events.map(({ noteId }) => noteId)).toEqual(["a", "b", "c"]);
    expect(plan.events.map(({ offsetMs }) => offsetMs)).toEqual([0, 300, 600]);
  });

  it("varies gaps without changing order or the final offset", () => {
    const values = [0, 1];
    const plan = planManualSnapshotFormation(
      [{ id: "a", start: 0 }, { id: "b", start: 1 }, { id: "c", start: 2 }],
      { initialSpreadMs: 1000, timingVariation: 1 },
      () => values.shift(),
    );

    expect(plan.events.map(({ noteId }) => noteId)).toEqual(["a", "b", "c"]);
    expect(plan.events[0].offsetMs).toBe(0);
    expect(plan.events[1].offsetMs).toBeGreaterThan(0);
    expect(plan.events[2].offsetMs).toBe(1000);
  });

  it("varies the total spread reciprocally around its center value", () => {
    const notes = [{ id: "a", start: 0 }, { id: "b", start: 1 }];
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
    expect(upper.durationMs).toBeCloseTo(2000 * 4 / 3);
    expect(upper.events.at(-1).offsetMs).toBeCloseTo(2000 * 4 / 3);
  });

  it("plans independently varied per-note decays that can change release order", () => {
    const randomValues = [1, 0];
    const plan = planManualSnapshotFormation(
      [{ id: "first", start: 0 }, { id: "second", start: 1 }],
      {
        initialSpreadMs: 100,
        timingVariation: 0,
        decayMs: 1000,
        decayVariation: 1,
      },
      () => randomValues.shift(),
    );
    const releases = plan.events.filter((event) => event.type === "release");

    expect(releases.map((event) => event.noteId)).toEqual(["second", "first"]);
    expect(releases[0].offsetMs).toBeCloseTo(600);
    expect(releases[1].offsetMs).toBeCloseTo(2000);
  });

  it("handles empty and one-note snapshots without delayed work", () => {
    expect(planManualSnapshotFormation([], { initialSpreadMs: 700 })).toEqual({
      durationMs: 0,
      events: [],
    });
    expect(planManualSnapshotFormation([{ id: "solo" }], { initialSpreadMs: 700 }))
      .toMatchObject({
        durationMs: 0,
        events: [{ offsetMs: 0, noteId: "solo" }],
      });
  });
});
