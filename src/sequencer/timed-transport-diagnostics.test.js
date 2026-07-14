import { describe, expect, it } from "vitest";

import {
  createTimedTransportDiagnostics,
  pushTimedTransportDiagnostic,
  resetTimedTransportDiagnostics,
  summarizeTimedTransportDiagnostics,
} from "./timed-transport-diagnostics.js";

describe("timed transport diagnostics", () => {
  it("keeps a bounded ring buffer of entries", () => {
    let diagnostics = createTimedTransportDiagnostics(2);
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "schedule", cueIndex: 1 });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", cueIndex: 2 });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", cueIndex: 3 });

    expect(diagnostics.entries.map((entry) => entry.cueIndex)).toEqual([2, 3]);
    expect(diagnostics.nextId).toBe(4);
  });

  it("summarizes lateness samples", () => {
    let diagnostics = createTimedTransportDiagnostics();
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", latenessMs: 12 });
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "fire", latenessMs: 31 });

    expect(summarizeTimedTransportDiagnostics(diagnostics)).toEqual({
      entryCount: 2,
      overrunCount: 1,
      maxLatenessMs: 31,
      recent: diagnostics.entries,
    });
  });

  it("resets while preserving or replacing the configured limit", () => {
    let diagnostics = createTimedTransportDiagnostics(10);
    diagnostics = pushTimedTransportDiagnostic(diagnostics, { type: "schedule" });

    expect(resetTimedTransportDiagnostics(diagnostics)).toEqual({
      limit: 10,
      entries: [],
      nextId: 1,
    });
    expect(resetTimedTransportDiagnostics(diagnostics, 5)).toEqual({
      limit: 5,
      entries: [],
      nextId: 1,
    });
  });
});
