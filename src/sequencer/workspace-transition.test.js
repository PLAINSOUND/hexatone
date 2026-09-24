import { expect, it } from "vitest";
import { sequenceWorkspaceTransition } from "./workspace-transition.js";

it.each(["io", "calculator", "manual", "hexatone"])("preserves a held snapshot on entering %s", tab => {
  expect(sequenceWorkspaceTransition({ previousPerformanceTab: "sequencer",
    performanceTab: tab === "hexatone" ? "hexatone" : "sequencer",
    previousTab: "sequencer", tab, playhead: { stepIndex: 27, markerIndex: null, stopped: false },
    timedClockSeconds: -Infinity })).toBe("flush-manual-snapshot");
});

it.each(["io", "calculator", "manual", "hexatone"])("applies timed-playback policy on entering %s", tab => {
  expect(sequenceWorkspaceTransition({ previousPerformanceTab: "sequencer",
    performanceTab: tab === "hexatone" ? "hexatone" : "sequencer",
    previousTab: "sequencer", tab, playhead: { stepIndex: 27, markerIndex: 3, stopped: false },
    timedClockSeconds: 5 })).toBe(tab === "io" ? "preserve" : "stop-sequencer");
});

it("does nothing on unrelated renders or returning from I/O", () => {
  for (const previousTab of ["sequencer", "io"])
    expect(sequenceWorkspaceTransition({ previousPerformanceTab: "sequencer", performanceTab: "sequencer",
      previousTab, tab: "sequencer", playhead: { stepIndex: 27, stopped: true } })).toBe("preserve");
});

it.each(["io", "calculator", "manual", "hexatone"])("does not treat a manual cue as a shared snapshot in %s", tab => {
  expect(sequenceWorkspaceTransition({ previousPerformanceTab: "sequencer",
    performanceTab: tab === "hexatone" ? "hexatone" : "sequencer",
    previousTab: "sequencer", tab,
    playhead: { stepIndex: 27, markerIndex: 0, stopped: false },
    timedClockSeconds: -Infinity })).toBe(tab === "io" ? "preserve" : "stop-sequencer");
});

it("recognises timed ownership even without a marker and never flushes a stopped snapshot", () => {
  const transition = { previousPerformanceTab: "sequencer", performanceTab: "sequencer",
    previousTab: "io", tab: "calculator", playhead: { stepIndex: 27, markerIndex: null, stopped: false } };
  expect(sequenceWorkspaceTransition({ ...transition, timedClockSeconds: 0 })).toBe("stop-sequencer");
  expect(sequenceWorkspaceTransition({ ...transition, timedClockSeconds: -Infinity,
    playhead: { ...transition.playhead, stopped: true } })).toBe("stop-sequencer");
});

it("does not flush or stop a held snapshot on an unrelated render in I/O", () => {
  expect(sequenceWorkspaceTransition({ previousPerformanceTab: "sequencer", performanceTab: "sequencer",
    previousTab: "io", tab: "io", playhead: { stepIndex: 27, stopped: false, markerIndex: null },
    timedClockSeconds: -Infinity })).toBe("preserve");
});
