import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create_osc_synth } from "./index.js";

class MockWebSocket {
  static instances = [];
  static OPEN = 1;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.sent = [];
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(message) {
    this.sent.push(JSON.parse(message));
  }
}

describe("osc_synth pooled slot allocation", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allocates fresh per-layer node IDs even when the logical slot is pooled from pitch", async () => {
    const synth = await create_osc_synth(
      "ws://test-osc-pool",
      ["pluck", "string", "formant", "tone"],
      [0.5, 0.5, 0.5, 0.5],
      261.6255653,
      0,
      [0],
      1,
    );

    await Promise.resolve();

    const hex = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    hex.noteOn();

    const sent = MockWebSocket.instances[0].sent.filter((msg) => msg.address === "/s_new");
    expect(sent).toHaveLength(4);
    expect(sent.map((msg) => msg.port)).toEqual([57101, 57102, 57103, 57104]);
    const nodeIds = sent.map((msg) => msg.args[1].value);
    expect(nodeIds[0]).toBeGreaterThanOrEqual(100000);
    expect(nodeIds[0]).toBeLessThan(300000);
    expect(nodeIds[1]).toBeGreaterThanOrEqual(300000);
    expect(nodeIds[1]).toBeLessThan(500000);
    expect(nodeIds[2]).toBeGreaterThanOrEqual(500000);
    expect(nodeIds[2]).toBeLessThan(700000);
    expect(nodeIds[3]).toBeGreaterThanOrEqual(700000);
    expect(nodeIds[3]).toBeLessThan(900000);
  });
});
