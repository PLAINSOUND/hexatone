/** OSC reply decoding and low-overhead traffic counters used by dev diagnostics. */
const { performance } = require("node:perf_hooks");

function readOscString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw new Error("Malformed OSC string");
  return { value: buffer.toString("utf8", offset, end), offset: (end + 4) & ~3 };
}

function decodeOscMessage(buffer) {
  let cursor = 0;
  const address = readOscString(buffer, cursor);
  cursor = address.offset;
  const typetag = readOscString(buffer, cursor);
  cursor = typetag.offset;
  if (!typetag.value.startsWith(",")) throw new Error("Malformed OSC typetag");
  const args = [];
  for (const type of typetag.value.slice(1)) {
    if (type === "i") { args.push(buffer.readInt32BE(cursor)); cursor += 4; }
    else if (type === "f") { args.push(buffer.readFloatBE(cursor)); cursor += 4; }
    else if (type === "d") { args.push(buffer.readDoubleBE(cursor)); cursor += 8; }
    else if (type === "s") {
      const string = readOscString(buffer, cursor);
      args.push(string.value);
      cursor = string.offset;
    } else if (type === "T") args.push(true);
    else if (type === "F") args.push(false);
    else if (type === "N") args.push(null);
    else throw new Error(`Unsupported OSC reply type: ${type}`);
  }
  return { address: address.value, args };
}

function createBridgeTrafficCounters() {
  let messages = 0;
  let bytes = 0;
  let sendErrors = 0;
  let lastMessagePerfMs = null;
  const byAddress = Object.create(null);
  const byPort = Object.create(null);
  return {
    record(address, port, messageBytes, count = 1) {
      messages += count;
      bytes += messageBytes;
      byAddress[address] = (byAddress[address] ?? 0) + count;
      byPort[port] = (byPort[port] ?? 0) + count;
      lastMessagePerfMs = performance.now();
    },
    recordBytesOnly(messageBytes) { bytes += messageBytes; },
    recordError() { sendErrors += 1; },
    reset() {
      messages = 0;
      bytes = 0;
      sendErrors = 0;
      lastMessagePerfMs = null;
      for (const key of Object.keys(byAddress)) delete byAddress[key];
      for (const key of Object.keys(byPort)) delete byPort[key];
    },
    snapshot() {
      return { messages, bytes, sendErrors, byAddress: { ...byAddress }, byPort: { ...byPort },
        lastMessagePerfMs };
    },
  };
}

module.exports = { decodeOscMessage, createBridgeTrafficCounters };
