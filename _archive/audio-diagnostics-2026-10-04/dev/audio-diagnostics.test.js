import { describe, expect, it } from "vitest";
import { createPerformanceCapture } from "./performance-capture.js";

describe("bounded audio captures", () => {
  it("retains recent samples and returns independent report snapshots", () => {
    const capture = createPerformanceCapture({ purpose: "test" });
    for (let i = 0; i < 1805; i++) capture.sample({ index: i });
    const report = capture.report();
    expect(report.samples).toHaveLength(1800);
    expect(report.samples[0].index).toBe(5);
    report.samples[0].index = -1;
    expect(capture.report().samples[0].index).toBe(5);
  });
});
