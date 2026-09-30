const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { decodeOscMessage, createBridgeTrafficCounters } = require("./diagnostics.js");

function padded(value) {
  const bytes = Buffer.from(`${value}\0`, "utf8");
  return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
}

describe("OSC bridge diagnostics", () => {
  it("decodes the standard scsynth /status.reply fields", () => {
    const packet = Buffer.concat([
      padded("/status.reply"), padded(",iiiiiffdd"),
      ...[0, 320, 14, 2, 8].map(value => { const b = Buffer.alloc(4); b.writeInt32BE(value); return b; }),
      ...[1.25, 4.5].map(value => { const b = Buffer.alloc(4); b.writeFloatBE(value); return b; }),
      ...[48000, 47999.5].map(value => { const b = Buffer.alloc(8); b.writeDoubleBE(value); return b; }),
    ]);
    assert.deepEqual(decodeOscMessage(packet), {
      address: "/status.reply", args: [0, 320, 14, 2, 8, 1.25, 4.5, 48000, 47999.5],
    });
  });

  it("records bridge traffic by address and port and resets between captures", () => {
    const counters = createBridgeTrafficCounters();
    counters.record("/s_new", 57102, 80);
    counters.record("/n_set", 57102, 32, 3);
    assert.deepEqual(counters.snapshot(), {
      messages: 4, bytes: 112, sendErrors: 0,
      byAddress: { "/s_new": 1, "/n_set": 3 }, byPort: { 57102: 4 },
      lastMessagePerfMs: counters.snapshot().lastMessagePerfMs,
    });
    counters.recordError();
    counters.reset();
    assert.equal(counters.snapshot().messages, 0);
    assert.equal(counters.snapshot().sendErrors, 0);
  });
});
