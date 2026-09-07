import { afterEach, describe, expect, it, vi } from "vitest";
import { startRationalisationJob } from "./rationalisation-job.js";
import { rationaliseScaleBatch } from "./batch-rationalise.js";
const input = { settings: { scale: ["5/4", "3/2", "2/1"], fundamental: 440, reference_degree: 0 }, searchPrefs: { existingRatios: "keep" }, frequencies: [440, 550, 660, 880], committedCents: [0, 386.3137, 701.955, 1200] };
afterEach(() => vi.unstubAllGlobals());
describe("rationalisation jobs", () => {
  it("keeps committed ratios and the equave in the shared algorithm", () => {
    expect(rationaliseScaleBatch(input)).toEqual(input.settings.scale);
  });
  it("runs a worker, reports progress and terminates on completion", async () => {
    let worker;
    vi.stubGlobal("Worker", class {
      constructor() { worker = this; }
      postMessage = vi.fn();
      terminate = vi.fn();
    });
    const progress = vi.fn();
    const job = startRationalisationJob(input, progress);
    expect(worker.postMessage).toHaveBeenCalledWith(input);
    worker.onmessage({ data: { progress: 50 } });
    expect(progress).toHaveBeenCalledWith(50);
    worker.onmessage({ data: { scale: input.settings.scale } });
    await expect(job.promise).resolves.toEqual(input.settings.scale);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("terminates cancelled workers and ignores their late results", async () => {
    let worker;
    vi.stubGlobal("Worker", class {
      constructor() { worker = this; }
      postMessage = vi.fn();
      terminate = vi.fn();
    });
    const progress = vi.fn();
    const job = startRationalisationJob(input, progress);
    const rejected = expect(job.promise).rejects.toMatchObject({ name: "AbortError" });
    job.cancel();
    worker.onmessage({ data: { scale: ["wrong"] } });
    worker.onmessage({ data: { progress: 90 } });
    await rejected;
    expect(progress).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("rejects worker errors and releases the worker", async () => {
    let worker;
    vi.stubGlobal("Worker", class {
      constructor() { worker = this; }
      postMessage = vi.fn();
      terminate = vi.fn();
    });
    const job = startRationalisationJob(input);
    worker.onerror({ message: "search failed" });
    await expect(job.promise).rejects.toThrow("search failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
