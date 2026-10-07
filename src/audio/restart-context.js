export async function verifyAudioClock(context, timeoutMs = 1200) {
  if (!context || context.state === "closed")
    throw new Error("AudioContext is unavailable or closed");
  const initialTime = context.currentTime;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (context.state === "running" && context.currentTime > initialTime) return;
  }
  throw new Error(
    `Audio clock did not advance (context ${context.state}, time ${context.currentTime})`,
  );
}

export async function restartAudioContext(context, timeoutMs = 2500) {
  if (!context || context.state === "closed")
    throw new Error("AudioContext is unavailable or closed");
  let timer;
  let active = true;
  // Call suspend in the original gesture, including running-but-frozen contexts.
  const work = (async () => {
    await context.suspend();
    if (!active) throw new Error("AudioContext restart was abandoned");
    await context.resume();
    await verifyAudioClock(context);
  })();
  try {
    await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("AudioContext restart timed out")), timeoutMs);
      }),
    ]);
  } finally {
    active = false;
    clearTimeout(timer);
  }
}
