import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LumatoneLEDs } from "./lumatone-leds.js";

function makePorts() {
  return {
    output: { send: vi.fn() },
    input: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  };
}

describe("LumatoneLEDs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays the first SysEx send so the Lumatone can settle after reconnect", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);

    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);

    expect(output.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(599);
    expect(output.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(output.send).toHaveBeenCalledTimes(1);
  });

  it("does not send queued startup data after destroy", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);

    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);
    leds.destroy();
    vi.advanceTimersByTime(600);

    expect(output.send).not.toHaveBeenCalled();
    expect(input.removeEventListener).toHaveBeenCalledWith("midimessage", expect.any(Function));
  });

  it("preserves the in-flight command when Send Colours is clicked again", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);

    leds.sendAll([
      { board: 1, key: 2, hexColor: "#111111" },
      { board: 1, key: 3, hexColor: "#222222" },
    ]);
    vi.advanceTimersByTime(600);
    expect(output.send).toHaveBeenCalledTimes(1);

    leds.sendAll([{ board: 1, key: 4, hexColor: "#333333" }]);

    input.addEventListener.mock.calls[0][1]({
      data: new Uint8Array([0xf0, 0x00, 0x21, 0x50, 1, 0x01, 0x01, 0xf7]),
    });

    expect(output.send).toHaveBeenCalledTimes(2);
    expect(output.send.mock.calls[1][0][6]).toBe(4);
  });

})
