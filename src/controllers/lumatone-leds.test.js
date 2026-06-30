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
  
})