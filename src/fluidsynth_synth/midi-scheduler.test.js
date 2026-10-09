import { afterEach, expect, it, vi } from "vitest";
import { createFluidMidiScheduler } from "./midi-scheduler.js";
import { withOutputTransaction } from "../midi/output-transaction.js";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const engine = { context: { currentTime: 10, sampleRate: 48000 },
    node: { port: { postMessage: vi.fn() } } };
  const output = createFluidMidiScheduler(() => engine);
  return { engine, output, advance: (ms) => { now += ms; },
    batches: () => engine.node.port.postMessage.mock.calls.map(([m]) => m).filter(m => m.type === "midi-batch") };
}

it("assigns one frame to an ordered chord despite main-thread and audio-block clock changes", async () => {
  const f = fixture();
  withOutputTransaction(() => {
    for (const op of ["off", "reset", "tune", "pressure", "on"]) {
      f.output.sendCommand({ channel: 0, op }, 1020, 1);
      f.advance(0.4);
      f.engine.context.currentTime += 128 / 48000;
    }
  });
  await Promise.resolve();
  const events = f.batches()[0].events;
  expect(events.map(e => e.frame)).toEqual(Array(5).fill(480960));
  expect(events.map(e => e.command.op)).toEqual(["off", "reset", "tune", "pressure", "on"]);
});

it("keeps a future timestamp stable across batches and resets it on worklet replacement", async () => {
  const f = fixture();
  f.output.sendCommand({ op: "on" }, 1020, 1);
  await Promise.resolve();
  f.advance(1);
  f.output.sendCommand({ op: "pressure" }, 1020, 1);
  await Promise.resolve();
  expect(f.batches().map(b => b.events[0].frame)).toEqual([480960, 480960]);
  f.output.sendCommand({ op: "obsolete" }, 1020, 1);
  f.engine.node = { port: { postMessage: vi.fn() } };
  f.engine.context.currentTime = 20;
  f.output.sendCommand({ op: "new" }, 1020, 1);
  await Promise.resolve();
  expect(f.batches()[0].events).toHaveLength(1);
  expect(f.batches()[0].events[0]).toMatchObject({ command: { op: "new" }, frame: 960912 });
});

it("cancels a sequence generation without dropping live notes or its replacement generation", async () => {
  const f = fixture();
  const send = (scope, generation) => f.output.sendCommand({ op: "on" }, 1020, 1, { scope, generation });
  send("sequence", 0);
  f.output.sendCommand({ op: "off" }, 1020, 1, { scope: "sequence", generation: 0 });
  send("live", 0);
  f.output.cancelEvents(1, "sequence", 0);
  send("sequence", 1);
  await Promise.resolve();
  expect(f.batches()[0].events.map(e => [e.scope, e.generation])).toEqual([["sequence", 0], ["live", 0], ["sequence", 1]]);
  expect(f.batches()[0].events[0].command.op).toBe("off");
  expect(f.engine.node.port.postMessage).toHaveBeenCalledWith({ type: "cancel-owner-events",
    owner: 1, scope: "sequence", generation: 0, voice: undefined });
});

it("drops pending batches and clock mappings on recovery", async () => {
  const f = fixture();
  f.output.sendCommand({ op: "obsolete" }, 1020, 1);
  f.output.resetClock();
  f.engine.context.currentTime = 0;
  f.output.sendCommand({ op: "new" }, 1020, 1);
  await Promise.resolve();
  expect(f.batches()[0].events).toHaveLength(1);
  expect(f.batches()[0].events[0].frame).toBe(960);
});
