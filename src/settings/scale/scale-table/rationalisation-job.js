import { rationaliseScaleBatch } from "./batch-rationalise.js";

export function startRationalisationJob(input, onProgress = () => {}) {
  let worker;
  let settled = false;
  let rejectJob;
  const promise = new Promise((resolve, reject) => {
    rejectJob = reject;
    const finish = (error, scale) => {
      if (settled) return;
      settled = true;
      worker?.terminate();
      if (error) reject(error);
      else resolve(scale);
    };
    if (typeof Worker === "undefined") {
      // Compatibility fallback for environments without workers.
      Promise.resolve().then(() => {
        if (settled) return;
        try {
          finish(null, rationaliseScaleBatch(input, onProgress));
        } catch (error) {
          finish(error);
        }
      });
      return;
    }
    try {
      worker = new Worker(new URL("./batch-rationalise.worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.error) finish(new Error(data.error));
        else if (data.scale) finish(null, data.scale);
        else if (data.progress != null) onProgress(data.progress);
      };
      worker.onerror = (event) =>
        finish(new Error(event.message || "Rationalisation worker failed"));
      worker.postMessage(input);
    } catch (error) {
      finish(error);
    }
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker?.terminate();
      rejectJob(new DOMException("Rationalisation cancelled", "AbortError"));
    },
  };
}
