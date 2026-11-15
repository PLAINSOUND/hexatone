import { describe, expect, it, vi } from "vitest";
import { createOutputDiagnostics } from "./output-diagnostics.js";

describe("SuperSonic device output diagnostics", () => {
  it("handles the initial postMessage copy request and exports levels without PCM or BigInt", () => {
    const getDeviceScope = vi.fn().mockReturnValueOnce(null).mockReturnValue({
      frames: 2, channels: 2, writePosition: 9007199254740993n,
      interleaved: new Float32Array([0.5, -0.5, 0.5, -0.5]),
    });
    const sample = createOutputDiagnostics({ getDeviceScope });
    expect(sample().status).toBe("awaiting-copy");
    const report = sample();
    expect(getDeviceScope).toHaveBeenLastCalledWith(0, 512);
    expect(report).toMatchObject({ status: "ready", peak: 0.5, rms: 0.5,
      writePosition: "9007199254740993", nonFiniteSamples: 0, clockAdvanced: null });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(report).not.toHaveProperty("interleaved");
    expect(report.meaning).toContain("native-only");
  });

  it("distinguishes an advancing scope from a frozen or non-finite one", () => {
    const scope = { frames: 2, channels: 1, writePosition: 100n,
      interleaved: new Float32Array([NaN, Infinity]) };
    const sample = createOutputDiagnostics({ getDeviceScope: () => scope });
    expect(sample()).toMatchObject({ nonFiniteSamples: 2, rms: null });
    scope.writePosition = 228n;
    expect(sample()).toMatchObject({ framesAdvanced: "128", clockAdvanced: true });
    expect(sample()).toMatchObject({ framesAdvanced: "0", clockAdvanced: false });
  });

  it("keeps absent or failed scope reads from breaking the audio report", () => {
    expect(createOutputDiagnostics({})().status).toBe("unsupported");
    expect(createOutputDiagnostics({ getDeviceScope: () => { throw new Error("closed"); } })())
      .toMatchObject({ status: "error", error: "closed" });
  });
});
