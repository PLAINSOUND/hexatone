import { afterEach, describe, expect, it, vi } from "vitest";
import { createChordSnapScheduler, chordPrefetchIndices, CHORD_CACHE_LIMIT, CHORD_QUEUE_LIMIT } from "./chord-snap-scheduler.js";
import { chordSearchWithinBudget } from "./chord-snap.js";
import { resolveLiveSequencePitch, withSequenceSnapGroup } from "./runtime-pitch-map.js";

const runtime = { scale: [0, 10, 696, 710], equivInterval: 1200, fundamental: 440, referenceDegree: 0 };
const workers = [];
const solvers = [];
function scheduler() {
  const solver = createChordSnapScheduler({ createWorker: () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(),
      respond(steps = [1, 3]) {
        this.onmessage({ data: { id: this.postMessage.mock.calls.at(-1)[0].id, steps } });
      } };
    workers.push(worker);
    return worker;
  } });
  solvers.push(solver);
  return solver;
}
afterEach(() => {
  solvers.splice(0).forEach(solver => solver.dispose());
  workers.length = 0;
  vi.useRealTimers();
});

describe("bounded chord preparation", () => {
  it("prioritises current and forward snapshots without scanning the score", () => {
    expect(chordPrefetchIndices(100000, 30)).toEqual([30, 31, 32, 33, 34, 35, 36, 37, 38, 29, 28]);
    expect(chordPrefetchIndices(2, 0)).toEqual([0, 1]);
    expect(chordPrefetchIndices(0, 0)).toEqual([]);
  });

  it("rejects oversized scale, pair-scoring and chord work before enqueueing", () => {
    expect(chordSearchWithinBudget(32, 512, 66)).toBe(false);
    expect(chordSearchWithinBudget(2, 513, 1)).toBe(false);
    expect(chordSearchWithinBudget(33, 4, 1)).toBe(false);
    expect(chordSearchWithinBudget(4, 64, 66)).toBe(true);
    const solver = scheduler();
    solver.prepare(Array(33).fill(0), runtime, 66);
    expect(workers).toHaveLength(0);
  });

  it("uses nearest Snap until ready, deduplicates jobs and caches whole decisions", () => {
    const solver = scheduler();
    expect(solver.choose([0, 700], runtime, 20, [false, false])).toEqual([0, 2]);
    solver.choose([0, 700], runtime, 20, [false, false]);
    expect(workers[0].postMessage).toHaveBeenCalledOnce();
    workers[0].respond();
    expect(solver.choose([0, 700], runtime, 20, [false, false])).toEqual([1, 3]);
    expect(solver.stats().cached).toBe(1);
  });

  it("bounds queue and cache; urgent work moves ahead of background jobs", () => {
    const solver = scheduler();
    for (let i = 0; i < 100; i++) solver.prepare([i, i + 700], runtime, 20);
    expect(solver.stats().queued).toBe(CHORD_QUEUE_LIMIT);
    solver.choose([200, 900], runtime, 20);
    expect(solver.stats().queued).toBe(CHORD_QUEUE_LIMIT);
    workers[0].respond();
    expect(workers[0].postMessage.mock.calls.at(-1)[0].pitches).toEqual([200, 900]);
    while (solver.stats().active) workers[0].respond();
    for (let i = 300; i < 500; i++) {
      solver.prepare([i, i + 700], runtime, 20);
      workers[0].respond();
    }
    expect(solver.stats().cached).toBe(CHORD_CACHE_LIMIT);
  });

  it("discards obsolete work and ignores late replies/errors from a terminated worker", () => {
    const solver = scheduler();
    solver.setContext("a");
    solver.prepare([0, 700], runtime, 20);
    const old = workers[0];
    solver.setContext("b");
    solver.prepare([1, 701], runtime, 33);
    old.respond();
    old.onerror();
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(solver.stats()).toMatchObject({ cached: 0, active: true, disabled: false });
    workers[1].respond();
    expect(solver.stats().cached).toBe(1);
  });

  it("times out stalled workers and falls back without retry storms", () => {
    vi.useFakeTimers();
    const solver = scheduler();
    solver.prepare([0, 700], runtime, 20);
    vi.advanceTimersByTime(251);
    expect(solver.stats()).toMatchObject({ active: false, queued: 0, disabled: true });
    expect(solver.choose([0, 700], runtime, 20)).toEqual([0, 2]);
    expect(workers).toHaveLength(1);
    solver.setContext("new tuning");
    solver.prepare([0, 700], runtime, 20);
    expect(workers).toHaveLength(2);
  });

  it("survives worker construction failure, malformed replies and disposal", () => {
    const unavailable = createChordSnapScheduler({ createWorker: () => { throw Error("blocked"); } });
    expect(unavailable.choose([0, 700], runtime, 20)).toEqual([0, 2]);
    expect(unavailable.stats().disabled).toBe(true);
    unavailable.dispose();
    const solver = scheduler();
    solver.prepare([0, 700], runtime, 20);
    workers[0].respond([NaN]);
    expect(solver.stats().disabled).toBe(true);
    solver.dispose();
    solver.prepare([0, 700], runtime, 20);
    expect(solver.stats()).toMatchObject({ cached: 0, queued: 0, disposed: true });
  });

  it("locks fallback for an entire arpeggio; a late result helps only a new decision", () => {
    const solver = scheduler();
    const choose = vi.spyOn(solver, "choose");
    const notes = [{ midicents: 69 }, { midicents: 76 }];
    const group = withSequenceSnapGroup(notes);
    const options = { chordAware: true, chordDrift: 20, chordSolver: solver, decisionToken: {} };
    expect(resolveLiveSequencePitch(group[0], runtime, 0, options).midicents).toBeCloseTo(69);
    workers[0].respond();
    expect(resolveLiveSequencePitch(group[1], runtime, 0, options).midicents).toBeCloseTo(75.96);
    expect(choose).toHaveBeenCalledOnce();
    const fresh = withSequenceSnapGroup(notes);
    expect(resolveLiveSequencePitch(fresh[0], runtime, 0, options).midicents).toBeCloseTo(69.1);
    expect(resolveLiveSequencePitch(fresh[1], runtime, 0, options).midicents).toBeCloseTo(76.1);
    // Explicit Snap/tuning/fader transactions may adopt the ready decision.
    expect(resolveLiveSequencePitch(group[1], runtime, 0, { ...options, decisionToken: {} }).midicents).toBeCloseTo(76.1);
  });
});
