import { expect, it } from "vitest";
import { createDsfYzEnvelope } from "./generated-yz.js";
it("matches Eagan velocity targets and independently latches each pressure gate", () => {
  const envelope = createDsfYzEnvelope(100, 0);
  expect(envelope.sample(0)).toEqual({ timbre: 0, pressure: 0 });
  expect(envelope.sample(2)).toEqual({ timbre: 69 / 127, pressure: 90 / 127 });
  envelope.pressure(60 / 127, 2);
  expect(envelope.sample(50)).toEqual({ timbre: 69 / 127, pressure: 90 / 127 });
  envelope.pressure(80 / 127, 50);
  expect(envelope.sample(90)).toEqual({ timbre: 80 / 127, pressure: 90 / 127 });
  envelope.pressure(0, 90);
  expect(envelope.sample(130)).toEqual({ timbre: 0, pressure: 90 / 127 });
  envelope.pressure(1, 130);
  expect(envelope.sample(170)).toEqual({ timbre: 1, pressure: 116 / 127 });
  envelope.pressure(0, 170);
  expect(envelope.sample(210)).toEqual({ timbre: 0, pressure: 28 / 127 });
});
it("uses release velocity timing and keeps independent envelopes per voice", () => {
  const slow = createDsfYzEnvelope(127, 0), fast = createDsfYzEnvelope(127, 0);
  slow.release(0, 10);
  fast.release(127, 10);
  expect(fast.sample(10)).toEqual({ timbre: 0, pressure: 0 });
  expect(slow.sample(14).timbre).toBeGreaterThan(0);
  expect(slow.sample(20)).toEqual({ timbre: 0, pressure: 0 });
});
