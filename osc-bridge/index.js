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

const WS_PORT = 8089;
const SC_HOST = "127.0.0.1";
const SC_PORT = 57100; // sclang / dispatcher port in the Hexatone SC setup

// ── UDP socket to sclang ─────────────────────────────────────────────────────

const udp = createSocket("udp4");
udp.bind(0, () => {
  console.log(`[osc-bridge] UDP ready → ${SC_HOST}:${SC_PORT}`);
});
udp.on("error", (err) => console.error("[osc-bridge] UDP error:", err.message));

function sendOsc(address, args, port = SC_PORT) {
  const buf = encodeOsc(address, args);
  udp.send(buf, port, SC_HOST, (err) => {
    if (err) console.error("[osc-bridge] UDP send error:", err.message);
  });
}

// ── WebSocket server (manual HTTP upgrade, no ws package) ────────────────────

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("osc-bridge running\n");
});

server.on("upgrade", (req, socket, head) => {
  // Validate WebSocket upgrade request
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return; }

  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n"
  );

  console.log(`[osc-bridge] Client connected: ${req.socket.remoteAddress}`);

  // WebSocket frame parser state
  let buf = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin  = (buf[0] & 0x80) !== 0;
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

      if (opcode === 0x8) { socket.destroy(); return; } // close frame
      if (opcode === 0x9) { // ping → pong
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a; pong[1] = 0;
        socket.write(pong);
        continue;
      }
      if (opcode !== 0x1 && opcode !== 0x0) continue; // only text frames

      if (!fin) continue; // skip fragmented frames (not used by osc_synth)

      let msg;
      try { msg = JSON.parse(payload.toString("utf8")); }
      catch (e) { console.warn("[osc-bridge] Bad JSON:", payload.toString()); continue; }

      if (!msg.address || !Array.isArray(msg.args)) {
        console.warn("[osc-bridge] Invalid message:", msg);
        continue;
      }

      sendOsc(msg.address, msg.args, Number.isFinite(msg.port) ? msg.port : SC_PORT);
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
    } else { // f
      const b = Buffer.alloc(4);
      b.writeFloatBE(a.value);
      parts.push(b);
    }
  }

  return Buffer.concat(parts);
}
