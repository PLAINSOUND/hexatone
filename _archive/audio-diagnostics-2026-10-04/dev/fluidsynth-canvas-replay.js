import { canvasTrace } from "./fluidsynth-canvas-trace.js";

const mts = hex => [0xf0, 0x7f, 0x7f, 8, 2, 0, 1,
  ...hex.match(/../g).map(byte => parseInt(byte, 16)), 0xf7];

export const canvasReplayEvents = canvasTrace.trim().split("\n").flatMap(line => {
  const [absolute, ...tokens] = line.trim().split(/\s+/);
  const time = Number(absolute) - 15812;
  const data = tokens.flatMap(token => {
    if (token[0] === "o") return [[0x80, Number(token.slice(1)), 0]];
    if (token[0] === "n") return [[0x90, Number(token.slice(1)), 72]];
    if (token[0] === "s") return [mts(token.slice(1))];
    const [previous, hex] = token.split(":");
    const tuning = mts(hex);
    const result = previous === "-" ? [] : [[0x80, Number(previous), 0]];
    result.push(tuning, [0x90, tuning[7], 72], tuning.slice());
    return result;
  });
  return data.map(bytes => ({ time, data: bytes }));
});

export const canvasReplayDurationMs = canvasReplayEvents.at(-1).time + 1000;

// Track tuning state per device/map/carrier, across intervening note events.
// A repeated real-time tuning does not change that state and is omitted only
// for this controlled replay comparison, not for normal live MIDI delivery.
export function suppressUnchangedMts(events) {
  const tunings = new Map();
  return events.filter(({ data }) => {
    if (data.length !== 12 || data[0] !== 0xf0 || data[1] !== 0x7f ||
      data[3] !== 8 || data[4] !== 2 || data[6] !== 1 || data[11] !== 0xf7) return true;
    const key = `${data[2]}:${data[5]}:${data[7]}`;
    const tuning = `${data[8]}:${data[9]}:${data[10]}`;
    if (tunings.get(key) === tuning) return false;
    tunings.set(key, tuning);
    return true;
  });
}

export const deduplicatedCanvasReplayEvents = suppressUnchangedMts(canvasReplayEvents);

export function rotateReplayCarriers(events) {
  const mappings = new Map();
  const tunings = new Map();
  const used = new Set();
  const released = new Float64Array(128).fill(-Infinity);
  let cursor = 0;
  const allocate = source => {
    let carrier = null;
    for (let offset = 0; offset < 128; offset++) {
      const candidate = (cursor + offset) % 128;
      if (!used.has(candidate) && (carrier == null || released[candidate] < released[carrier])) {
        carrier = candidate;
      }
    }
    if (carrier == null) throw new Error("Replay carrier pool exhausted");
    cursor = (carrier + 1) % 128;
    used.add(carrier);
    mappings.set(source, carrier);
    return carrier;
  };
  return events.flatMap(({ time, data }) => {
    if (data[0] === 0xf0) {
      const source = data[7];
      tunings.set(source, data);
      const carrier = mappings.get(source) ?? allocate(source);
      const remapped = data.slice();
      remapped[7] = carrier;
      return [{ time, data: remapped }];
    }
    const source = data[1];
    if (data[0] === 0x90) {
      const existing = mappings.get(source);
      const carrier = existing ?? allocate(source);
      const result = [];
      // Deduplication may have removed a tuning before this new attack.
      // The newly allocated carrier still needs the source's current tuning.
      if (existing == null) {
        const tuning = (tunings.get(source) ?? mts(`${source.toString(16).padStart(2, "0").repeat(2)}0000`)).slice();
        tuning[7] = carrier;
        result.push({ time, data: tuning });
      }
      result.push({ time, data: [data[0], carrier, data[2]] });
      return result;
    }
    if (data[0] === 0x80) {
      const carrier = mappings.get(source);
      if (carrier == null) return []; // Excerpt may start with an unmatched release.
      mappings.delete(source);
      used.delete(carrier);
      released[carrier] = time;
      return [{ time, data: [data[0], carrier, data[2]] }];
    }
    return [{ time, data: data.slice() }];
  });
}

export const rotatingCanvasReplayEvents = rotateReplayCarriers(deduplicatedCanvasReplayEvents);

export function replayWithoutMts(events) {
  const pitches = new Map();
  const notes = new Map();
  return events.flatMap(({ time, data }) => {
    if (data[0] === 0xf0) {
      const pitch = data[8] + ((data[9] << 7) | data[10]) / 16384;
      pitches.set(data[7], Math.max(0, Math.min(127, Math.round(pitch))));
      return [];
    }
    if (data[0] === 0x90) {
      const note = pitches.get(data[1]) ?? data[1];
      notes.set(data[1], note);
      return [{ time, data: [0x90, note, data[2]] }];
    }
    if (data[0] === 0x80) {
      const note = notes.get(data[1]) ?? pitches.get(data[1]) ?? data[1];
      notes.delete(data[1]);
      return [{ time, data: [0x80, note, data[2]] }];
    }
    return [{ time, data: data.slice() }];
  });
}

export const plainMidiCanvasReplayEvents = replayWithoutMts(canvasReplayEvents);

export function prepareStaticTuningReplay(events) {
  const tunings = new Map();
  for (const { data } of events) {
    if (data[0] === 0xf0 && !tunings.has(data[7])) tunings.set(data[7], data.slice());
  }
  return {
    setup: [...tunings.values()],
    events: events.filter(({ data }) => data[0] !== 0xf0),
  };
}

export const staticTuningCanvasReplay = prepareStaticTuningReplay(rotatingCanvasReplayEvents);

export function startCanvasReplay(output) {
  const events = staticTuningCanvasReplay.events;
  let index = 0;
  let stopped = false;
  output.send([0xb0, 123, 0]);
  output.send([0xe0, 0, 64]);
  staticTuningCanvasReplay.setup.forEach(data => output.send(data));
  // Let setup reach the worklet before the first attack; no MTS during playback.
  const started = performance.now() + 500;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    output.send([0xb0, 123, 0]);
    for (let note = 0; note < 128; note++) output.send(
      [0xf0, 0x7e, 0x7f, 8, 2, 0, 1, note, note, 0, 0, 0xf7]);
  };
  const timer = setInterval(() => {
    const elapsed = performance.now() - started;
    while (index < events.length && events[index].time <= elapsed) {
      output.send(events[index++].data);
    }
    if (elapsed >= canvasReplayDurationMs) stop();
  }, 1);
  return stop;
}
