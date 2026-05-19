import { describe, expect, it, vi } from "vitest";
import { sendHakenNrpn, sendHakenRpn } from "./hakenaudio.js";

describe("hakenaudio MIDI helpers", () => {
  it("sends raw NRPN bytes on the requested manager channel", () => {
    const output = { send: vi.fn() };

    sendHakenNrpn(output, 16, 101, 30);

    expect(output.send.mock.calls).toEqual([
      [[0xbf, 99, 0]],
      [[0xbf, 98, 101]],
      [[0xbf, 6, 30]],
      [[0xbf, 99, 127]],
      [[0xbf, 98, 127]],
    ]);
  });

  it("falls back to sendControlChange when raw send is unavailable", () => {
    const output = { sendControlChange: vi.fn() };

    sendHakenRpn(output, 3, 0, 0, 96, 0);

    expect(output.sendControlChange.mock.calls).toEqual([
      [101, 0, { channels: 3 }],
      [100, 0, { channels: 3 }],
      [6, 96, { channels: 3 }],
      [38, 0, { channels: 3 }],
      [101, 127, { channels: 3 }],
      [100, 127, { channels: 3 }],
    ]);
  });
});
