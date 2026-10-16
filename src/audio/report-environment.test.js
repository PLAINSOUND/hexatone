import { describe, expect, it, vi } from "vitest";
import { buildDiagnostics, playbackClockDiagnostics, serviceWorkerDiagnostics } from "./report-environment.js";

describe("audio report environment", () => {
  it("identifies the build mode and page without URL query data", () => {
    expect(buildDiagnostics()).toMatchObject({ mode: "test", origin: location.origin, pathname: location.pathname });
    expect(buildDiagnostics()).not.toHaveProperty("search");
  });
  it("projects the playback position to observation time", () => {
    const spy = vi.spyOn(performance, "now").mockReturnValue(2000);
    try {
      const clock = playbackClockDiagnostics({ state: "running", currentTime: 12,
        getOutputTimestamp: () => ({ contextTime: 10.9, performanceTime: 1900 }) });
      expect(clock.usable).toBe(true);
      expect(clock.renderAheadMs).toBeCloseTo(1000, 5);
      expect(playbackClockDiagnostics({ state: "running", currentTime: 12,
        getOutputTimestamp: () => ({ contextTime: 10.9, performanceTime: 500 }) }).usable).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it("does not turn unavailable, stopped or stale readings into zero latency", () => {
    expect(playbackClockDiagnostics({}).supported).toBe(false);
    for (const state of ["suspended", "running"]) {
      const result = playbackClockDiagnostics({ state, currentTime: 12,
        getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) });
      expect(result.usable).toBe(false);
      expect(result.renderAheadMs).toBeNull();
    }
    expect(playbackClockDiagnostics({ getOutputTimestamp() { throw new Error("unavailable"); } }).error).toBe("unavailable");
  });
  it("reports controlling and waiting workers without mutating them", async () => {
    const active = { scriptURL: "https://example.org/sw.js", state: "activated" };
    const waiting = { ...active, state: "installed" };
    const reg = { scope: "https://example.org/", active, waiting, update: vi.fn() };
    const result = await serviceWorkerDiagnostics({ controller: active, getRegistrations: async () => [reg] });
    expect(result.controller).toEqual(active);
    expect(result.registrations[0].waiting).toEqual(waiting);
    expect(reg.update).not.toHaveBeenCalled();
    expect(await serviceWorkerDiagnostics(null)).toMatchObject({ supported: false });
    expect(await serviceWorkerDiagnostics({ getRegistrations: async () => { throw new Error("denied"); } }))
      .toMatchObject({ error: "denied", registrations: null });
  });
  it("bounds service-worker inspection when the browser does not respond", async () => {
    vi.useFakeTimers();
    try {
      const result = serviceWorkerDiagnostics({ getRegistrations: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toMatchObject({ error: "Service-worker inspection timed out" });
    } finally { vi.useRealTimers(); }
  });
});
