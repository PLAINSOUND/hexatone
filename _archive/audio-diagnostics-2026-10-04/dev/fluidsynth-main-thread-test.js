/** Live-delivery comparison: all events pass through the normal MIDI output. */
export function startFluidSynthMainThreadTest(output) {
  const started = performance.now();
  let step = -1;
  let note = null;
  let stopped = false;
  const bend = value => output.send([0xe0, value & 127, value >> 7]);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (note != null) output.send([0x80, note, 0]);
    bend(8192);
    for (let carrier = 48; carrier <= 72; carrier++) {
      output.send([0xf0, 0x7e, 0x7f, 0x08, 0x02, 0, 1, carrier, carrier, 0, 0, 0xf7]);
    }
  };
  const tick = () => {
    const elapsed = performance.now() - started;
    if (elapsed >= 30000) { stop(); return; }
    const nextStep = Math.floor(elapsed * 16 / 1000);
    if (nextStep !== step) {
      step = nextStep;
      if (note != null) output.send([0x80, note, 0]);
      note = 60;
      const target = 48 + Math.floor(Math.random() * 25);
      const pitch = target + Math.random() - 0.5;
      const semitone = Math.floor(pitch);
      const fraction = Math.min(16383, Math.round((pitch - semitone) * 16384));
      output.send([0xf0, 0x7f, 0x7f, 0x08, 0x02, 0, 1, note,
        semitone, fraction >> 7, fraction & 127, 0xf7]);
      bend(8192);
      output.send([0x90, note, 72]);
    } else bend(Math.round(8192 + 4096 * Math.sin(elapsed / 1000 * Math.PI * 12)));
  };
  const timer = setInterval(tick, 3);
  output.send([0xb0, 123, 0]);
  tick();
  return stop;
}
