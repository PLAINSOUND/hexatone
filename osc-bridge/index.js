/**
 * osc-bridge — WebSocket → UDP OSC bridge for hexatone → SuperCollider
 *
 * Uses Node.js built-ins and ws for bounded WebSocket framing. Requires Node 24+.
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
const { randomBytes } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { PROTOCOL, MAX_PAYLOAD, DEFAULT_ORIGINS, authorize, validateMessage } = require("./security.js");
const { performance } = require("node:perf_hooks");
const { decodeOscMessage, createBridgeTrafficCounters } = require("./diagnostics.js");

function createOscBridge({ port = 8089, token = process.env.HEXATONE_OSC_TOKEN || randomBytes(32).toString('hex'),
  allowedPorts = [57100, 57101, 57102, 57103, 57104, 57110, Number(process.env.SC_LANG_PORT || 57120)],
  allowedOrigins = DEFAULT_ORIGINS } = {}) {
if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('Bridge token must be 32–128 URL-safe characters');
const WS_PORT = port;
const ports = new Set(allowedPorts);
if ([...ports].some(p => !Number.isInteger(p) || p < 1024 || p > 65535)) throw new Error('Invalid allowed OSC ports');
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
udp.bind(0, SC_HOST, () => {
  console.log(`[osc-bridge] UDP ready → ${SC_HOST}:${SC_PORT}`);
});
udp.on("error", (err) => console.error("[osc-bridge] UDP error:", err.message));

function sendOsc(address, args, port = SC_PORT) {
  const buf = encodeOsc(address, args);
  if (buf.length > 60000) throw new Error("OSC packet exceeds 60000 bytes");
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
  if (buf.length > 60000) throw new Error("OSC bundle exceeds 60000 bytes");
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
  if (client.readyState !== WebSocket.OPEN) return;
  if (client.bufferedAmount > MAX_PAYLOAD) { client.terminate(); return; }
  client.send(JSON.stringify(value), error => { if (error) client.terminate(); });
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
  if (remote.address !== SC_HOST || reply.address !== "/status.reply") return;
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

// Authenticate the HTTP upgrade before ws accepts or buffers application data.
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain", "Connection": "close" });
  res.end("osc-bridge running; authenticated WebSocket required\n");
});
server.headersTimeout = 5000;
server.requestTimeout = 10000;
server.maxConnections = 16;
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD,
  maxFragments: 256, maxBufferedChunks: 1024, maxPendingAutoPongs: 16,
  perMessageDeflate: false, closeTimeout: 1000,
  handleProtocols: () => PROTOCOL });
server.on("upgrade", (req, socket, head) => {
  if (!authorize(req, token, allowedOrigins) || req.url !== "/") {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  if (wss.clients.size >= 8) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, client => wss.emit("connection", client));
});
wss.on("connection", client => {
  let windowStart = performance.now(), messages = 0, bytes = 0;
  client.on("message", (payload, binary) => {
    if (client.readyState !== WebSocket.OPEN) return;
    try {
      const now = performance.now();
      if (now - windowStart >= 1000) { windowStart = now; messages = bytes = 0; }
      bytes += payload.length;
      if (binary || ++messages > 10000 || bytes > 8 * 1024 * 1024) throw new Error("Input limit exceeded");
      const msg = validateMessage(JSON.parse(payload.toString("utf8")), ports);
      if (msg.diagnostic === "start") {
        bridgeTraffic.reset();
        sendWebSocketJson(client, { diagnostic: "started", at: new Date().toISOString() });
      } else if (msg.diagnostic === "sample") requestServerStatus(client, msg);
      else if (msg.diagnostic === "stop") sendWebSocketJson(client, {
        diagnostic: "stopped", at: new Date().toISOString(), bridge: bridgeTraffic.snapshot() });
      else if (Array.isArray(msg.messages)) sendOscBundle(msg.messages, msg.timetagUnixMs, msg.port ?? SC_PORT);
      else if (msg.address === "/hex/jitter") sendOsc(msg.address, enrichJitterArgs(msg.args), SC_LANG_PORT);
      else sendOsc(msg.address, msg.args, msg.port ?? SC_PORT);
    } catch {
      // Invalid input is confined to this connection. Never log credentials/payloads.
      client.close(1008, "Invalid or oversized bridge message");
    }
  });
  client.on("close", () => {
    for (const [port, pending] of pendingStatusRequests) if (pending.client === client) {
      clearTimeout(pending.timeout); pendingStatusRequests.delete(port);
    }
  });
  client.on("error", () => client.terminate());
});
server.on("error", err => console.error("[osc-bridge] Server error:", err.message));
return { server, token, listen: () => server.listen(WS_PORT, SC_HOST),
  close: () => new Promise(resolve => {
    for (const pending of pendingStatusRequests.values()) clearTimeout(pending.timeout);
    for (const client of wss.clients) client.terminate();
    wss.close();
    udp.close();
    server.close(resolve);
  }) };
}

if (require.main === module) {
  const bridge = createOscBridge();
  bridge.server.on("listening", () => {
    console.log(`[osc-bridge] WebSocket listening on ws://127.0.0.1:${bridge.server.address().port}`);
    console.log(`[osc-bridge] Pairing token: ${bridge.token}`);
    console.log("[osc-bridge] Paste this token in Hexatone’s OSC Bridge settings. Keep it private.");
  });
  bridge.listen();
}
module.exports = { createOscBridge, encodeOsc, encodeOscBundle };

// ── OSC encoder ──────────────────────────────────────────────────────────────
// Encodes a single OSC message to a Buffer. Supports s, i, f types.

function oscPadded(str) {
  // OSC strings are null-terminated and padded to 4-byte boundary
  const len = Math.ceil((Buffer.byteLength(str, "utf8") + 1) / 4) * 4;
  const buf = Buffer.alloc(len);
  buf.write(str, 0, "utf8");
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
