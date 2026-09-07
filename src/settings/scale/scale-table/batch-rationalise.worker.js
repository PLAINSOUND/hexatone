import { rationaliseScaleBatch } from "./batch-rationalise.js";
self.onmessage = ({ data }) => {
  try {
    const scale = rationaliseScaleBatch(data, (progress) => self.postMessage({ progress }));
    self.postMessage({ scale });
  } catch (error) {
    self.postMessage({ error: error?.message ?? String(error) });
  }
};
