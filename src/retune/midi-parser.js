function readAscii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function readUint32(bytes, offset) {
  return (
    (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
  );
}

function readUint16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readVarLen(bytes, offset) {
  let value = 0;
  let index = offset;
  while (index < bytes.length) {
    const byte = bytes[index];
    value = (value << 7) | (byte & 0x7f);
    index += 1;
    if ((byte & 0x80) === 0) break;
  }
  return { value, offset: index };
}

function ticksToSecondsFactory(ppq, tempos) {
  const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
  if (!sorted.length || sorted[0].tick !== 0) {
    sorted.unshift({ tick: 0, mpqn: 500000 });
  }
  let seconds = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    sorted[i].seconds = seconds;
    const next = sorted[i + 1];
    if (!next) break;
    seconds += ((next.tick - sorted[i].tick) * sorted[i].mpqn) / (ppq * 1000000);
  }

  return (tick) => {
    let current = sorted[0];
    for (const tempo of sorted) {
      if (tempo.tick <= tick) current = tempo;
      else break;
    }
    return current.seconds + ((tick - current.tick) * current.mpqn) / (ppq * 1000000);
  };
}

export function parseMidi(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (readAscii(bytes, 0, 4) !== "MThd") {
    throw new Error("Invalid MIDI file: missing MThd header");
  }
  const headerLength = readUint32(bytes, 4);
  const format = readUint16(bytes, 8);
  const trackCount = readUint16(bytes, 10);
  const ppq = readUint16(bytes, 12);

  let offset = 8 + headerLength;
  const tempos = [];
  const timeSignatures = [];
  const notes = [];

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    const id = readAscii(bytes, offset, 4);
    if (id !== "MTrk") throw new Error(`Invalid MIDI file: expected MTrk at track ${trackIndex}`);
    const length = readUint32(bytes, offset + 4);
    const trackStart = offset + 8;
    const trackEnd = trackStart + length;
    let cursor = trackStart;
    let tick = 0;
    let runningStatus = null;
    const activeNotes = new Map();

    while (cursor < trackEnd) {
      const delta = readVarLen(bytes, cursor);
      tick += delta.value;
      cursor = delta.offset;

      let status = bytes[cursor];
      if (status < 0x80) {
        status = runningStatus;
      } else {
        cursor += 1;
        runningStatus = status;
      }

      if (status === 0xff) {
        const metaType = bytes[cursor];
        const len = readVarLen(bytes, cursor + 1);
        const dataStart = len.offset;
        const data = bytes.slice(dataStart, dataStart + len.value);
        if (metaType === 0x51 && data.length === 3) {
          tempos.push({ tick, mpqn: (data[0] << 16) | (data[1] << 8) | data[2] });
        } else if (metaType === 0x58 && data.length >= 2) {
          timeSignatures.push({ tick, numerator: data[0], denominator: 2 ** data[1] });
        }
        cursor = dataStart + len.value;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const len = readVarLen(bytes, cursor);
        cursor = len.offset + len.value;
        continue;
      }

      const eventType = status & 0xf0;
      const channel = (status & 0x0f) + 1;
      const data1 = bytes[cursor];
      const data2 = bytes[cursor + 1];
      cursor += eventType === 0xc0 || eventType === 0xd0 ? 1 : 2;

      if (eventType === 0x90 && data2 > 0) {
        const key = `${channel}:${data1}`;
        if (!activeNotes.has(key)) activeNotes.set(key, []);
        activeNotes.get(key).push({
          track: trackIndex,
          channel,
          note: data1,
          velocity: data2,
          onTick: tick,
        });
      } else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
        const key = `${channel}:${data1}`;
        const stack = activeNotes.get(key);
        if (stack?.length) {
          const start = stack.pop();
          notes.push({
            id: `t${trackIndex}_c${channel}_n${data1}_on${start.onTick}`,
            track: trackIndex,
            channel,
            midiNote: data1,
            velocity: start.velocity,
            onTick: start.onTick,
            offTick: tick,
          });
        }
      }
    }
    offset = trackEnd;
  }

  notes.sort((a, b) => a.onTick - b.onTick || a.midiNote - b.midiNote);
  const ticksToSeconds = ticksToSecondsFactory(ppq, tempos);
  const enrichedNotes = notes.map((note, index) => ({
    ...note,
    eventId: `n${String(index + 1).padStart(4, "0")}`,
    onSeconds: ticksToSeconds(note.onTick),
    offSeconds: ticksToSeconds(note.offTick),
  }));

  return {
    format,
    ppq,
    tempos,
    timeSignatures,
    notes: enrichedNotes,
  };
}
