/**
 * osc-bridge — WebSocket → UDP OSC bridge for hexatone → SuperCollider
 *
 * Zero npm dependencies — uses only Node.js built-ins (node:http, node:dgram,
 * node:crypto). Works with any Node.js v14+.
 *
 * Run with:  node osc-bridge/index.js
 *
 * Listens for JSON messages on WebSocket port 8089 (browser → bridge),
 * encodes them as OSC and forwards via UDP to SuperCollider on port 57100 by default.
 *
 * Message format from browser:
 *   { address: "/s_new", args: [...] }
 *   { address: "/n_set", args: [...] }
 *   { address: "/n_free", args: [...] }
 *   { port: 57103, address: "/n_set", args: [...] }
 *   { port: 57103, timetagUnixMs: 1720000000000, messages: [{ address, args }] }
 *
 * Each arg is either a plain number/string, or a typed object:
 *   { type: "i", value: 1 }    integer
 *   { type: "f", value: 1.5 }  float
 *   { type: "s", value: "x" }  string
 * Untyped numbers are sent as float.
 */

const { createServer } = require("node:http");
const { createSocket } = require("node:dgram");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { decodeOscMessage, createBridgeTrafficCounters } = require("./diagnostics.js");

const WS_PORT = 8089;
const SC_HOST = "127.0.0.1";
const SC_PORT = 57100; // sclang / dispatcher port in the Hexatone SC setup
const SC_LANG_PORT = Number(process.env.SC_LANG_PORT || 57120);
const PITCH_TRACE_ENABLED = process.env.HEXATONE_OSC_PITCH_TRACE === "1";
let PITCH_TRACE_SEQ = 0;
// Temporary OSC trace logging retained for future debugging.
// let TRACE_SEQ = 0;
let JITTER_LAST_BRIDGE_PERF = null;

// ── UDP socket to sclang ─────────────────────────────────────────────────────

const udp = createSocket("udp4");
const bridgeTraffic = createBridgeTrafficCounters();
const pendingStatusRequests = new Map();
const lastStatusRequestByClient = new WeakMap();
udp.bind(0, () => {
  console.log(`[osc-bridge] UDP ready → ${SC_HOST}:${SC_PORT}`);
});
udp.on("error", (err) => console.error("[osc-bridge] UDP error:", err.message));

function sendOsc(address, args, port = SC_PORT) {
  const buf = encodeOsc(address, args);
  bridgeTraffic.record(address, port, buf.length);
  const parameterName = address === "/n_set" ? oscArgValue(args?.[1]) : null;
  if (PITCH_TRACE_ENABLED && parameterName === "freq") {
    const nodeId = oscArgValue(args?.[0]);
    const frequency = Number(oscArgValue(args?.[2]));
    console.log(
      `[osc-bridge:pitch] seq=${++PITCH_TRACE_SEQ} time=${performance.now().toFixed(3)} port=${port} node=${nodeId} freq=${frequency.toPrecision(12)}`,
    );
  }
  // const seq = ++TRACE_SEQ;
  // const nodeId =
  //   address === "/s_new"
  //     ? (args?.[1]?.type === "i" ? args[1].value : null)
  //     : (args?.[0]?.type === "i" ? args[0].value : null);
  // const gateIndex = Array.isArray(args)
  //   ? args.findIndex((arg) => arg?.type === "s" && arg?.value === "gate")
  //   : -1;
  // const gateValue =
  //   gateIndex >= 0 && gateIndex + 1 < args.length ? args[gateIndex + 1]?.value : undefined;
  // if (
  //   address === "/s_new" ||
  //   address === "/n_free" ||
  //   (address === "/n_set" && gateValue === 0)
  // ) {
  //   console.log(
  //     `[osc-bridge] #${seq} ${address} port=${port} node=${nodeId ?? "?"} gate=${gateValue ?? "-"} args=${JSON.stringify(args)}`,
  //   );
  // }
  udp.send(buf, port, SC_HOST, (err) => {
    if (err) {
      bridgeTraffic.recordError();
      console.error("[osc-bridge] UDP send error:", err.message);
    }
  });
}

function sendOscBundle(messages, timetagUnixMs, port = SC_PORT) {
  const buf = encodeOscBundle(messages, timetagUnixMs);
  messages.forEach((message, index) =>
    bridgeTraffic.record(message.address, port, index === 0 ? buf.length : 0));
  udp.send(buf, port, SC_HOST, (err) => {
    if (err) {
      bridgeTraffic.recordError();
      console.error("[osc-bridge] UDP bundle send error:", err.message);
    }
  });
}

function sendWebSocketJson(client, value) {
  if (client.destroyed || !client.writable) return;
  const payload = Buffer.from(JSON.stringify(value));
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  client.write(Buffer.concat([header, payload]));
}

function statusReplyData(args) {
  if (args.length < 9) throw new Error("Incomplete scsynth /status.reply");
  return {
    ugens: args[1],
    synths: args[2],
    groups: args[3],
    synthDefs: args[4],
    averageCpuPct: args[5],
    peakCpuPct: args[6],
    nominalSampleRate: args[7],
    actualSampleRate: args[8],
  };
}

function requestServerStatus(client, request) {
  const port = Number(request.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    sendWebSocketJson(client, { diagnostic: "sample", requestId: request.requestId,
      sampleIndex: request.sampleIndex, error: "Invalid SuperCollider server port" });
    return;
  }
  const now = performance.now();
  const previous = lastStatusRequestByClient.get(client) ?? -Infinity;
  if (now - previous < 125) {
    sendWebSocketJson(client, { diagnostic: "sample", requestId: request.requestId,
      sampleIndex: request.sampleIndex, error: "Status sampling is limited to 8 Hz" });
    return;
  }
  lastStatusRequestByClient.set(client, now);
  const existing = pendingStatusRequests.get(port);
  if (existing) clearTimeout(existing.timeout);
  const pending = { client, requestId: request.requestId, sampleIndex: request.sampleIndex,
    bridge: bridgeTraffic.snapshot(), requestedAt: new Date().toISOString(), timeout: null };
  pending.timeout = setTimeout(() => {
    if (pendingStatusRequests.get(port) !== pending) return;
    pendingStatusRequests.delete(port);
    sendWebSocketJson(client, { diagnostic: "sample", requestId: pending.requestId,
      sampleIndex: pending.sampleIndex, sampledAt: pending.requestedAt,
      bridge: pending.bridge, server: null, error: `No /status.reply from 127.0.0.1:${port}` });
  }, 700);
  pendingStatusRequests.set(port, pending);
  // Send directly so this instrumentation does not inflate OSC traffic counts.
  udp.send(encodeOsc("/status", []), port, SC_HOST, error => {
    if (!error) return;
    clearTimeout(pending.timeout);
    if (pendingStatusRequests.get(port) === pending) pendingStatusRequests.delete(port);
    bridgeTraffic.recordError();
    sendWebSocketJson(client, { diagnostic: "sample", requestId: pending.requestId,
      sampleIndex: pending.sampleIndex, bridge: bridgeTraffic.snapshot(), server: null,
      error: `Could not query scsynth: ${error.message}` });
  });
}

udp.on("message", (packet, remote) => {
  let reply;
  try { reply = decodeOscMessage(packet); } catch { return; }
  if (reply.address !== "/status.reply") return;
  const pending = pendingStatusRequests.get(remote.port);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingStatusRequests.delete(remote.port);
  let server = null;
  let error = null;
  try { server = statusReplyData(reply.args); } catch (caught) { error = caught.message; }
  sendWebSocketJson(pending.client, { diagnostic: "sample", requestId: pending.requestId,
    sampleIndex: pending.sampleIndex, sampledAt: pending.requestedAt,
    server, bridge: pending.bridge, error });
});

function oscArgValue(arg) {
  if (arg && typeof arg === "object" && "value" in arg) return arg.value;
  return arg;
}

function enrichJitterArgs(args) {
  const bridgePerfNow = performance.now();
  const bridgeDelta = JITTER_LAST_BRIDGE_PERF == null ? 0 : bridgePerfNow - JITTER_LAST_BRIDGE_PERF;
  JITTER_LAST_BRIDGE_PERF = bridgePerfNow;
  const seq = oscArgValue(args[0]);
  const kind = oscArgValue(args[1]);
  const browserDelta = oscArgValue(args[3]);
  const voiceId = oscArgValue(args[4]);
  console.log(
    `[osc-bridge:jitter] seq=${seq} kind=${kind} voice=${voiceId} browserΔ=${Number(browserDelta).toFixed?.(3) ?? browserDelta} bridgeΔ=${bridgeDelta.toFixed(3)}`,
  );
  return [...args, { type: "f", value: bridgePerfNow }, { type: "f", value: bridgeDelta }];
}

// ── WebSocket server (manual HTTP upgrade, no ws package) ────────────────────

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("osc-bridge running\n");
});

server.on("upgrade", (req, socket, head) => {
  // Validate WebSocket upgrade request
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n",
  );

  console.log(`[osc-bridge] Client connected: ${req.socket.remoteAddress}`);

  // WebSocket frame parser state
  let buf = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let payloadLen = buf[1] & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buf.length < 4) break;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buf.length < 10) break;
        // 64-bit length — only lower 32 bits needed for our use case
        payloadLen = buf.readUInt32BE(6);
        offset = 10;
      }

      const maskOffset = offset;
      if (masked) offset += 4;
      if (buf.length < offset + payloadLen) break;

      let payload = buf.slice(offset, offset + payloadLen);
      if (masked) {
        const mask = buf.slice(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      }

      buf = buf.slice(offset + payloadLen);

      if (opcode === 0x8) {
        socket.destroy();
        return;
      } // close frame
      if (opcode === 0x9) {
        // ping → pong
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a;
        pong[1] = 0;
        socket.write(pong);
        continue;
      }
      if (opcode !== 0x1 && opcode !== 0x0) continue; // only text frames

      if (!fin) continue; // skip fragmented frames (not used by osc_synth)

      let msg;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch (e) {
        console.warn("[osc-bridge] Bad JSON:", payload.toString());
        continue;
      }

      if (msg?.diagnostic === "start") {
        bridgeTraffic.reset();
        sendWebSocketJson(socket, { diagnostic: "started", at: new Date().toISOString() });
        continue;
      }
      if (msg?.diagnostic === "sample") {
        requestServerStatus(socket, msg);
        continue;
      }
      if (msg?.diagnostic === "stop") {
        sendWebSocketJson(socket, { diagnostic: "stopped", at: new Date().toISOString(),
          bridge: bridgeTraffic.snapshot() });
        continue;
      }

      if (Array.isArray(msg.messages) && Number.isFinite(msg.timetagUnixMs)) {
        const validMessages = msg.messages.filter(
          (entry) => entry?.address && Array.isArray(entry?.args),
        );
        if (!validMessages.length || validMessages.length !== msg.messages.length) {
          console.warn("[osc-bridge] Invalid bundle:", msg);
          continue;
        }
        sendOscBundle(
          validMessages,
          msg.timetagUnixMs,
          Number.isFinite(msg.port) ? msg.port : SC_PORT,
        );
      } else if (!msg.address || !Array.isArray(msg.args)) {
        console.warn("[osc-bridge] Invalid message:", msg);
        continue;
      } else if (msg.address === "/hex/jitter") {
        sendOsc(msg.address, enrichJitterArgs(msg.args), SC_LANG_PORT);
      } else {
        sendOsc(msg.address, msg.args, Number.isFinite(msg.port) ? msg.port : SC_PORT);
      }
    }
  });

  socket.on("close", () => console.log("[osc-bridge] Client disconnected"));
  socket.on("error", (err) => console.warn("[osc-bridge] Socket error:", err.message));
});

server.listen(WS_PORT, () => {
  console.log(`[osc-bridge] WebSocket listening on ws://localhost:${WS_PORT}`);
  console.log("[osc-bridge] Waiting for hexatone to connect...");
});

server.on("error", (err) => {
  console.error("[osc-bridge] Server error:", err.message);
  if (err.code === "EADDRINUSE")
    console.error(`[osc-bridge] Port ${WS_PORT} already in use — kill the other process first.`);
});

// ── OSC encoder ──────────────────────────────────────────────────────────────
// Encodes a single OSC message to a Buffer. Supports s, i, f types.

function oscPadded(str) {
  // OSC strings are null-terminated and padded to 4-byte boundary
  const len = Math.ceil((str.length + 1) / 4) * 4;
  const buf = Buffer.alloc(len);
  buf.write(str, 0, "ascii");
  return buf;
}

function encodeOsc(address, args) {
  // Normalise args
  const normalised = args.map((a) => {
    if (a !== null && typeof a === "object" && "type" in a) return a;
    if (typeof a === "string") return { type: "s", value: a };
    return { type: "f", value: Number(a) };
  });

  const typetag = "," + normalised.map((a) => a.type).join("");

  const parts = [oscPadded(address), oscPadded(typetag)];
  for (const a of normalised) {
    if (a.type === "s") {
      parts.push(oscPadded(a.value));
    } else if (a.type === "i") {
      const b = Buffer.alloc(4);
      b.writeInt32BE(Math.round(a.value));
      parts.push(b);
    } else {
      // f
      const b = Buffer.alloc(4);
      b.writeFloatBE(a.value);
      parts.push(b);
    }
  }

  return Buffer.concat(parts);
}

function encodeOscBundle(messages, timetagUnixMs) {
  const unixMs = Number(timetagUnixMs);
  const unixSeconds = unixMs / 1000;
  const wholeUnixSeconds = Math.floor(unixSeconds);
  const fractionalSeconds = unixSeconds - wholeUnixSeconds;
  const timetag = Buffer.alloc(8);
  timetag.writeUInt32BE((wholeUnixSeconds + 2208988800) >>> 0, 0);
  timetag.writeUInt32BE(Math.floor(fractionalSeconds * 0x100000000) >>> 0, 4);

  const elements = messages.map(({ address, args }) => {
    const message = encodeOsc(address, args);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(message.length, 0);
    return Buffer.concat([size, message]);
  });
  return Buffer.concat([oscPadded("#bundle"), timetag, ...elements]);
}
