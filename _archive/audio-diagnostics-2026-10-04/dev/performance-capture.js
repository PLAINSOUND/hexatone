/** Small, allocation-light helpers for opt-in development audio captures. */
export function createPerformanceCapture(metadata, startedAt = new Date().toISOString()) {
  const events = Object.create(null);
  const samples = [];
  const clone = value => structuredClone(value);
  return {
    event(name, count = 1) {
      events[name] = (events[name] ?? 0) + count;
    },
    sample(value) {
      samples.push(clone(value));
      if (samples.length > 1800) samples.shift();
    },
    updateSample(index, patch) {
      if (samples[index]) Object.assign(samples[index], patch);
    },
    report(endedAt = new Date().toISOString()) {
      return {
        schema: "hexatone-audio-performance-capture/v1",
        startedAt,
        endedAt,
        metadata: clone(metadata),
        events: { ...events },
        samples: samples.map(clone),
      };
    },
  };
}

export function downloadPerformanceReport(report, filename = "hexatone-audio-performance.json") {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
