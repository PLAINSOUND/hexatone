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

function makeLegacyPorts() {
  return {
    output: { send: vi.fn() },
    input: {
      onmidimessage: null,
    },
  };
}

function makeWebMidiPorts() {
  const listener = { remove: vi.fn() };
  return {
    output: { send: vi.fn(), sendSysex: vi.fn() },
    input: { addListener: vi.fn(() => listener) },
    listener,
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

  it("restarts the initial settle delay when startup colors change before the first send", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);

    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);
    vi.advanceTimersByTime(400);
    leds.sendAll([{ board: 1, key: 2, hexColor: "#abcdef" }]);

    vi.advanceTimersByTime(399);
    expect(output.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(output.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(output.send).toHaveBeenCalledTimes(1);
  });

  it("uses a longer ACK timeout before the first successful reconnect ACK", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);
    vi.advanceTimersByTime(600);
    expect(output.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1199);
    expect(warnSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(output.send).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1199);
    expect(warnSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it("accepts a delayed first ACK after one silent startup retry", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);
    vi.advanceTimersByTime(600);
    expect(output.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1200);
    expect(output.send).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();

    input.addEventListener.mock.calls[0][1]({
      data: new Uint8Array([0xf0, 0x00, 0x21, 0x50, 1, 0x01, 0x01, 0xf7]),
    });

    vi.advanceTimersByTime(1200);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
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

  it("falls back to onmidimessage when addEventListener is unavailable", () => {
    const { output, input } = makeLegacyPorts();
    const leds = new LumatoneLEDs(output, input);

    expect(typeof input.onmidimessage).toBe("function");
    leds.destroy();
    expect(input.onmidimessage).toBeNull();
  });

  it("uses the WebMidi input event emitter for SysEx replies when available", async () => {
    const { output, input, listener } = makeWebMidiPorts();
    const leds = new LumatoneLEDs(output, input);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(input.addListener).toHaveBeenCalledWith("midimessage", expect.any(Function));
    const resultPromise = leds.probeConnection();
    expect(output.send).not.toHaveBeenCalled();
    expect(output.sendSysex).toHaveBeenNthCalledWith(
      1,
      [0x00, 0x21, 0x50],
      [0x00, 0x23, 0x7f, 0x00, 0x00, 0x00],
    );
    const serialReply = new Uint8Array([
      0xf0, 0x00, 0x21, 0x50, 0, 0x23, 1, 0x0e, 0, 0x0f, 0x0f, 0x0f, 1, 0x0d, 9, 1, 1, 0, 0x0d,
      0xf7,
    ]);
    input.addListener.mock.calls[0][1]({ data: serialReply });
    expect(output.sendSysex).toHaveBeenNthCalledWith(
      2,
      [0x00, 0x21, 0x50],
      [0x00, 0x31, 0x00, 0x00, 0x00, 0x00],
    );
    const reply = new Uint8Array([0xf0, 0x00, 0x21, 0x50, 0, 0x31, 1, 1, 3, 0, 0xf7]);
    input.addListener.mock.calls[0][1]({ data: reply });

    await expect(resultPromise).resolves.toMatchObject({ ok: true, bytes: Array.from(reply) });
    leds.destroy();
    expect(listener.remove).toHaveBeenCalledTimes(1);
    infoSpy.mockRestore();
  });

  it("sends colour commands through WebMidi with framing bytes removed", () => {
    const { output, input } = makeWebMidiPorts();
    const leds = new LumatoneLEDs(output, input);

    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);
    vi.advanceTimersByTime(600);

    expect(output.send).not.toHaveBeenCalled();
    expect(output.sendSysex).toHaveBeenCalledWith(
      [0x00, 0x21, 0x50],
      [0x01, 0x01, 0x02, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06],
    );
  });

  it("reproduces the Editor identity handshake and captures the confirmed 1.3 reply", async () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const resultPromise = leds.probeConnection();

    expect(Array.from(output.send.mock.calls[0][0])).toEqual([
      0xf0, 0x00, 0x21, 0x50, 0x00, 0x23, 0x7f, 0x00, 0x00, 0x00, 0xf7,
    ]);
    vi.advanceTimersByTime(1);
    const serialReply = new Uint8Array([
      0xf0, 0x00, 0x21, 0x50, 0, 0x23, 1, 0x0e, 0, 0x0f, 0x0f, 0x0f, 1, 0x0d, 9, 1, 1, 0, 0x0d,
      0xf7,
    ]);
    input.addEventListener.mock.calls[0][1]({ data: serialReply });
    expect(Array.from(output.send.mock.calls[1][0])).toEqual([
      0xf0, 0x00, 0x21, 0x50, 0x00, 0x31, 0x00, 0x00, 0x00, 0x00, 0xf7,
    ]);
    vi.advanceTimersByTime(1);
    const reply = new Uint8Array([0xf0, 0x00, 0x21, 0x50, 0, 0x31, 1, 1, 3, 0, 0xf7]);
    input.addEventListener.mock.calls[0][1]({ data: reply });

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      status: 1,
      elapsedMs: 2,
      bytes: Array.from(reply),
      serialBytes: Array.from(serialReply),
    });
    expect(output.send).toHaveBeenCalledTimes(2);
    infoSpy.mockRestore();
  });

  it("times out a probe without retrying", async () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resultPromise = leds.probeConnection();

    vi.advanceTimersByTime(2000);
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      reason: "timeout",
      command: 0x23,
    });
    expect(output.send).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
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

  it("collapses duplicate Send Colours batches while the first batch is still pending", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    const entries = [
      { board: 1, key: 2, hexColor: "#111111" },
      { board: 1, key: 3, hexColor: "#222222" },
    ];

    leds.sendAll(entries);
    vi.advanceTimersByTime(600);
    expect(output.send).toHaveBeenCalledTimes(1);

    leds.sendAll(entries);
    leds.sendAll(entries);

    input.addEventListener.mock.calls[0][1]({
      data: new Uint8Array([0xf0, 0x00, 0x21, 0x50, 1, 0x01, 0x01, 0xf7]),
    });
    expect(output.send).toHaveBeenCalledTimes(2);

    input.addEventListener.mock.calls[0][1]({
      data: new Uint8Array([0xf0, 0x00, 0x21, 0x50, 1, 0x01, 0x01, 0xf7]),
    });
    expect(output.send).toHaveBeenCalledTimes(3);

    input.addEventListener.mock.calls[0][1]({
      data: new Uint8Array([0xf0, 0x00, 0x21, 0x50, 1, 0x01, 0x01, 0xf7]),
    });
    expect(output.send).toHaveBeenCalledTimes(3);
  });

  it("discards an in-flight batch during sleep and resumes one fresh colour batch", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);

    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);
    vi.advanceTimersByTime(600);
    expect(output.send).toHaveBeenCalledTimes(1);

    leds.suspend();
    vi.advanceTimersByTime(5000);
    expect(output.send).toHaveBeenCalledTimes(1);

    leds.resume();
    vi.advanceTimersByTime(1499);
    expect(output.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(output.send).toHaveBeenCalledTimes(2);
  });

  it("treats a substantially overdue ACK timer as wake recovery without warning", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    leds.sendAll([
      { board: 1, key: 2, hexColor: "#123456" },
      { board: 1, key: 3, hexColor: "#abcdef" },
    ]);
    vi.advanceTimersByTime(600);
    input.addEventListener.mock.calls[0][1]({
      data: new Uint8Array([0xf0, 0x00, 0x21, 0x50, 1, 0x01, 0x01, 0xf7]),
    });
    expect(output.send).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 5000);
    vi.advanceTimersByTime(300);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(output.send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1500);
    expect(output.send).toHaveBeenCalledTimes(3);
    warnSpy.mockRestore();
  });
});
