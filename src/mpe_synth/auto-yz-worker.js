import { createAutoMpeYzRampEngine } from "./auto-yz.js";

const SAMPLE_MS = 1;
const engine = createAutoMpeYzRampEngine((values) => self.postMessage(values));
let timer = null;

const stop = () => {
  if (timer == null) return;
  clearInterval(timer);
  timer = null;
};

const start = () => {
  if (timer != null) return;
  timer = setInterval(() => {
    if (!engine.tick(performance.now())) stop();
  }, SAMPLE_MS);
};

self.onmessage = ({ data }) => {
  if (data?.type === "clear") {
    engine.clear();
    stop();
    return;
  }
  if (data?.type !== "schedule") return;
  const receivedAt = performance.now();
  const startedAt = Number.isFinite(data.startedAtEpoch)
    ? receivedAt - Math.max(0, performance.timeOrigin + receivedAt - data.startedAtEpoch)
    : receivedAt;
  const active = engine.schedule(
    data.channel,
    data.y,
    data.z,
    data.duration,
    startedAt,
    data.generation,
    receivedAt,
    data.silent !== true,
    data.silent === true,
  );
  if (active && data.silent !== true) start();
};
