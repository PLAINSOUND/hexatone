/**
 * Module-worker entry point for whole-scale rationalisation.
 * Receives one job payload, forwards progress, and posts the resulting scale or
 * error; rationalisation-job.js owns worker termination and cancellation.
 */

import { rationaliseScaleBatch } from "./batch-rationalise.js";
self.onmessage = ({ data }) => {
  try {
    const scale = rationaliseScaleBatch(data, (progress) => self.postMessage({ progress }));
    self.postMessage({ scale });
  } catch (error) {
    self.postMessage({ error: error?.message ?? String(error) });
  }
};
