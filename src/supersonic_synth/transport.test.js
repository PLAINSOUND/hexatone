// Local transport must preserve layer isolation, timing and terminal cleanup.
import { describe, it, expect, vi } from "vitest";
import { createLocalOscTransport, stopRetiredSuperSonicOutputs } from "./transport.js";
import { create_osc_synth } from "../osc_synth/index.js";

const typed = (...values) => values.map(value => ({ value }));
function setup() {
  let incoming;
  const sonic = { send: vi.fn(), sendOSC: vi.fn(), purge: vi.fn(async () => {}), clock: { now: () => 1000 },
    audioContext: { resume: vi.fn(async () => {}) }, on: (_, fn) => { incoming = fn; } };
  const encode = vi.fn(() => new Uint8Array([1]));
  const dispose = vi.fn();
  const transport = createLocalOscTransport(sonic, encode, dispose);
  return { sonic, encode, dispose, transport, ended: id => incoming(["/n_end", id]) };
}
describe("local OSC transport", () => {
  it("lets ordinary shutdown tails finish, rejecting new attacks until disposal", async () => {
    const { sonic, transport, dispose, ended } = setup();
    transport.send("/s_new", typed("tone", 100, 1, 1), 57104);
    sonic.send.mockClear();
    transport.release({ graceful: true });
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    expect(sonic.send).toHaveBeenCalledWith("/n_set", 9103, "gate", 0);
    expect(sonic.send.mock.calls.some(call => call[0] === "/g_freeAll")).toBe(false);
    sonic.send.mockClear();
    transport.send("/s_new", typed("tone", 101, 1, 1), 57104);
    expect(sonic.send).not.toHaveBeenCalled();
    ended(100);
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("keeps retiring tails reachable by PANIC", async () => {
    const { transport, dispose } = setup();
    transport.send("/s_new", typed("tone", 100, 1, 1), 57104);
    transport.release({ graceful: true });
    await Promise.resolve();
    stopRetiredSuperSonicOutputs();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("holds panic cleanup and fresh notes behind the scheduler purge", async () => {
    const { sonic, transport } = setup();
    let resolve;
    sonic.purge.mockImplementation(() => new Promise(done => { resolve = done; }));
    sonic.send.mockClear();
    transport.cancelScheduled();
    transport.send("/g_freeAll", typed(1), 57101);
    transport.send("/s_new", typed("pluck", 101, 1, 1), 57101);
    expect(sonic.send).not.toHaveBeenCalled();
    resolve();
    await Promise.resolve();
    expect(sonic.send.mock.calls).toEqual([
      ["/g_freeAll", 9100], ["/s_new", "hexlab_pluck", 101, 1, 9100],
    ]);
  });
  it("namespaces definitions and maps layer broadcasts without touching root", () => {
    const { sonic, transport } = setup();
    transport.send("/s_new", typed("formant", 100, 1, 1, "freq", 440), 57103);
    expect(sonic.send).toHaveBeenLastCalledWith("/s_new", "hexlab_formant", 100, 1, 9102, "freq", 440);
    transport.send("/n_set", typed(1, "mod", 1.5), 57103);
    expect(sonic.send).toHaveBeenLastCalledWith("/n_set", 9102, "mod", 1.5);
  });
  it("schedules on the audio clock and suppresses updates after natural completion", () => {
    const { sonic, transport, encode, ended } = setup();
    transport.send("/s_new", typed("pluck", 100, 1, 1), 57101, performance.now() + 100);
    expect(encode.mock.calls[0][0]).toBeCloseTo(1000.1, 2);
    expect(sonic.sendOSC).toHaveBeenCalledOnce();
    ended(100);
    sonic.send.mockClear();
    transport.send("/n_set", typed(100, "gate", 0), 57101);
    expect(sonic.send).not.toHaveBeenCalled();
    transport.release();
    expect(sonic.send.mock.calls[0]).toEqual(["/clearSched"]);
    sonic.send.mockClear();
    transport.send("/s_new", typed("pluck", 101, 1, 1), 57101);
    expect(sonic.send).not.toHaveBeenCalled();
  });
  it("reuses OSC controls without a WebSocket and panics before transport disposal", async () => {
    const { sonic, transport, dispose } = setup();
    const synth = await create_osc_synth(undefined, undefined, undefined, 0, 0.1, false,
      440, 0, [0], 1, { transport });
    expect(synth.local).toBe(true);
    synth.applyZoneModwheel(127);
    expect(sonic.send).toHaveBeenCalledWith("/n_set", 9100, "mod", 2);
    await synth.ensureAwake();
    expect(sonic.audioContext.resume).toHaveBeenCalledOnce();
    synth.shutdown({ panic: true });
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
    synth.shutdown();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
