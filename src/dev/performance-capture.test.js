import { describe, expect, it } from "vitest";
import { createPerformanceCapture } from "./performance-capture.js";

describe("development performance captures", () => {
  it("collects event totals and time-series samples without mutating prior samples", () => {
    const capture = createPerformanceCapture({ engine: "supersonic" }, "start");
    const first = { elapsedMs: 1000, nodeCount: 5 };
    capture.event("noteOn");
    capture.event("noteOn");
    capture.sample(first);
    capture.updateSample(0, { server: { avgCpuPct: 2 } });
    first.nodeCount = 99;

    expect(capture.report("end")).toEqual({
      schema: "hexatone-audio-performance-capture/v1",
      startedAt: "start",
      endedAt: "end",
      metadata: { engine: "supersonic" },
      events: { noteOn: 2 },
      samples: [{ elapsedMs: 1000, nodeCount: 5, server: { avgCpuPct: 2 } }],
    });
  });
});
