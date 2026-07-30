import { describe, expect, it, vi } from "vitest";
import { sendMpeZonePitchBendRange, sendRpn } from "./rpn.js";

describe("MIDI RPN helpers", () => {
  it("selects, writes, and nulls an RPN on a zero-based channel", () => {
    const output = { send: vi.fn() };

    sendRpn(output, 2, 0, 0, 48, 0);

    expect(output.send.mock.calls.map(([message]) => message)).toEqual([
      [0xb2, 101, 0],
      [0xb2, 100, 0],
      [0xb2, 6, 48],
      [0xb2, 38, 0],
      [0xb2, 101, 127],
      [0xb2, 100, 127],
    ]);
  });

  it("configures the MPE manager and only valid member channels", () => {
    const output = { send: vi.fn() };

    sendMpeZonePitchBendRange(output, {
      managerChannel0: 0,
      memberChannels0: [1, 2, 16],
      memberBendRange: 24,
      managerBendRange: 2,
    });

    const messages = output.send.mock.calls.map(([message]) => message);
    expect(messages).toHaveLength(24);
    expect(messages.slice(0, 6)).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 6],
      [0xb0, 6, 2],
      [0xb0, 38, 0],
      [0xb0, 101, 127],
      [0xb0, 100, 127],
    ]);
    expect(messages.some(([status]) => status === 0xb1)).toBe(true);
    expect(messages.some(([status]) => status === 0xb2)).toBe(true);
    expect(messages.some(([status]) => status === 0xc0)).toBe(false);
  });
});
