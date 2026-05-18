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
      0,
      0.1,
      false,
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

  it("applies live layer volume changes to active note nodes and node 1 default state", async () => {
    const synth = await create_osc_synth(
      "ws://test-osc-live-volume",
      ["pluck", "string", "formant", "tone"],
      [0.5, 0.5, 0.5, 0.5],
      0,
      0.1,
      false,
      261.6255653,
      0,
      [0],
      1,
    );

    await Promise.resolve();

    const hex = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    hex.noteOn();
    synth.setLayerVolume(0, 0.73);

    const ws = MockWebSocket.instances[0];
    const sNew = ws.sent.filter((msg) => msg.address === "/s_new" && msg.port === 57101);
    expect(sNew).toHaveLength(1);
    const activeNodeId = sNew[0].args[1].value;

    const volSets = ws.sent.filter((msg) => {
      return (
        msg.address === "/n_set" &&
        msg.port === 57101 &&
        msg.args[1]?.value === "vol"
      );
    });

    expect(volSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: [
            { type: "i", value: activeNodeId },
            { type: "s", value: "vol" },
            { type: "f", value: 0.73 },
          ],
        }),
        expect.objectContaining({
          args: [
            { type: "i", value: 1 },
            { type: "s", value: "vol" },
            { type: "f", value: 0.73 },
          ],
        }),
      ]),
    );
  });

  it("routes per-note CC74 to mod rather than filter", async () => {
    const synth = await create_osc_synth(
      "ws://test-osc-cc74",
      ["pluck", "string", "formant", "tone"],
      [0.5, 0.5, 0.5, 0.5],
      0,
      0.1,
      false,
      261.6255653,
      0,
      [0],
      1,
    );

    await Promise.resolve();

    const hex = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    hex.noteOn();
    hex.cc74(64);

    const ws = MockWebSocket.instances[0];
    const modSets = ws.sent.filter((msg) => {
      return (
        msg.address === "/n_set" &&
        msg.args[1]?.value === "mod"
      );
    });
    const filterSets = ws.sent.filter((msg) => {
      return (
        msg.address === "/n_set" &&
        msg.args[1]?.value === "filter" &&
        msg.args[0]?.value !== 1
      );
    });

    expect(modSets.length).toBeGreaterThan(0);
    expect(filterSets).toHaveLength(0);
  });

  it("uses a pre-note-on retune for the /s_new onset frequency", async () => {
    const synth = await create_osc_synth(
      "ws://test-osc-onset-retune",
      ["pluck", "string", "formant", "tone"],
      [0.5, 0.5, 0.5, 0.5],
      0,
      0.1,
      false,
      261.6255653,
      0,
      [0],
      1,
    );

    await Promise.resolve();

    const hex = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    hex.retune(1200, true);
    hex.noteOn();

    const sent = MockWebSocket.instances[0].sent.filter((msg) => msg.address === "/s_new");
    expect(sent).toHaveLength(4);
    const onsetFreq = sent[0].args.find((arg, i, arr) => arr[i - 1]?.value === "freq")?.value;
    expect(onsetFreq).toBeCloseTo(523.2511306, 3);
  });

  it("forceFree sends /n_free for all active layer nodes", async () => {
    const synth = await create_osc_synth(
      "ws://test-osc-force-free",
      ["pluck", "string", "formant", "tone"],
      [0.5, 0.5, 0.5, 0.5],
      0,
      0.1,
      false,
      261.6255653,
      0,
      [0],
      1,
    );

    await Promise.resolve();

    const hex = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    hex.noteOn();
    hex.forceFree();

    const frees = MockWebSocket.instances[0].sent.filter((msg) => msg.address === "/n_free");
    expect(frees).toHaveLength(4);
    expect(frees.map((msg) => msg.port)).toEqual([57101, 57102, 57103, 57104]);
  });

  it("still releases nodes when the voice-pool coord lookup misses", async () => {
    const synth = await create_osc_synth(
      "ws://test-osc-noteoff-fallback",
      ["pluck", "string", "formant", "tone"],
      [0.5, 0.5, 0.5, 0.5],
      0,
      0.1,
      false,
      261.6255653,
      0,
      [0],
      1,
    );

    await Promise.resolve();

    const hex = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, 568, 72, 1, 1);
    hex.noteOn();

    const poolNoteOff = vi.spyOn(hex._pool, "noteOff").mockReturnValueOnce(null);
    hex.noteOff(18);

    const releases = MockWebSocket.instances[0].sent.filter((msg) => {
      return (
        msg.address === "/n_set" &&
        msg.args[1]?.value === "off_vel" &&
        msg.args[3]?.value === "gate"
      );
    });

    expect(poolNoteOff).toHaveBeenCalledTimes(1);
    expect(releases).toHaveLength(4);
    expect(releases.map((msg) => msg.port)).toEqual([57101, 57102, 57103, 57104]);
  });

  it("applies live quick release settings to active nodes and future note-ons", async () => {
    const synth = await create_osc_synth(
      "ws://test-osc-quick-release",
      ["pluck", "string", "formant", "tone"],
      [0.5, 0.5, 0.5, 0.5],
      0,
      0.1,
      false,
      261.6255653,
      0,
      [0],
      1,
    );

    await Promise.resolve();

    const firstHex = synth.makeHex({ x: 0, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    firstHex.noteOn();
    synth.setQuickRelease(0.75);
    synth.setQuickReleaseTime(0.08);

    const ws = MockWebSocket.instances[0];
    const quickReleaseSets = ws.sent.filter((msg) =>
      msg.address === "/n_set" && msg.args[1]?.value === "quick_release");
    const quickReleaseTimeSets = ws.sent.filter((msg) =>
      msg.address === "/n_set" && msg.args[1]?.value === "quick_release_time");

    expect(quickReleaseSets.length).toBeGreaterThan(0);
    expect(quickReleaseTimeSets.length).toBeGreaterThan(0);

    const secondHex = synth.makeHex({ x: 1, y: 0 }, 0, 0, 0, 1, 0, 0, undefined, 72, 1, 1);
    secondHex.noteOn();

    const latestSNew = ws.sent.filter((msg) => msg.address === "/s_new").at(-1);
    const quickReleaseArgIndex = latestSNew.args.findIndex((arg) => arg.value === "quick_release");
    const quickReleaseTimeArgIndex = latestSNew.args.findIndex((arg) => arg.value === "quick_release_time");

    expect(latestSNew.args[quickReleaseArgIndex + 1].value).toBeCloseTo(0.75, 5);
    expect(latestSNew.args[quickReleaseTimeArgIndex + 1].value).toBeCloseTo(0.08, 5);
  });
});
