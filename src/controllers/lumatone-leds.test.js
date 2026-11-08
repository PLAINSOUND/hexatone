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
  const layout = () => [0, 1].map(key => ({ board: 1, key, note: key, channel: 0, hexColor: "#111111" }));
  const acknowledgeAll = leds => {
    vi.advanceTimersByTime(1600);
    while (leds._queue.length) {
      const { board, cmd } = leds._queue[0];
      leds._onMessage({ data: [0xf0, 0, 0x21, 0x50, board, cmd, 1, 0xf7] });
    }
  };

  it("retains full layout requests made during suspension and uses the newest colours on resume", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    leds.suspend();
    leds.sendLayout(layout(), [{ cmd: 0x0e, board: 0, value: 1 }]);
    leds.sendAll(layout().map(entry => ({ ...entry, hexColor: "#abcdef" })));
    expect(leds.layoutInitializationPending).toBe(true);
    leds.resume();
    expect(leds._queue.map(entry => entry.cmd)).toEqual([14, 0, 1, 0, 1]);
    expect(leds._queue.filter(entry => entry.cmd === 1).every(entry => entry.r === 0xab)).toBe(true);
    acknowledgeAll(leds);
    expect(leds.layoutInitializationPending).toBe(false);
    leds.suspend();
    leds.resume();
    expect(leds._queue.every(entry => entry.cmd === 1)).toBe(true);
    leds.destroy();
  });

  it("replays assignments after interrupting an acknowledged-but-incomplete layout", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    leds.sendLayout(layout());
    vi.advanceTimersByTime(600);
    leds._onMessage({ data: [0xf0, 0, 0x21, 0x50, 1, 0, 1, 0xf7] });
    leds.suspend();
    leds.resume();
    expect(leds._queue.filter(entry => entry.cmd === 0)).toHaveLength(2);
    acknowledgeAll(leds);
    expect(leds.layoutInitializationPending).toBe(false);
    leds.destroy();
  });

  it("does not declare timed-out layout setup complete and cancels retained requests explicitly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    try {
      leds.sendLayout(layout());
      vi.runAllTimers();
      expect(leds.layoutInitializationPending).toBe(true);
      leds.suspend();
      leds.resume();
      expect(leds._queue.some(entry => entry.cmd === 0)).toBe(true);
      leds.cancel();
      expect(leds.layoutInitializationPending).toBe(false);
      expect(leds._queue).toHaveLength(0);
    } finally { leds.destroy(); warn.mockRestore(); }
  });
  it("preserves pending layout assignments through full and partial colour updates", () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    leds.sendLayout([
      { board: 1, key: 0, note: 0, channel: 0, hexColor: "#111111" },
      { board: 1, key: 1, note: 1, channel: 0, hexColor: "#222222" },
    ], [{ cmd: 0x0e, board: 0, value: 1 }]);
    const assignments = leds._queue.filter(entry => entry.cmd === 0x00);
    leds.sendAll([{ board: 1, key: 0, hexColor: "#333333" }]);
    leds.updateDegree([{ board: 1, key: 1, hexColor: "#444444" }]);
    expect(leds._queue.filter(entry => entry.cmd === 0x00)).toEqual(assignments);
    expect(assignments).toHaveLength(2);
    expect(leds._queue.filter(entry => entry.cmd === 0x01)).toHaveLength(2);
    expect(leds._queue.find(entry => entry.cmd === 0x0e)).toBeDefined();
    leds.destroy();
  });
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

  it("queries firmware before automatic colours and validates the main-controller reply", async () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    const query = leds.queryFirmware();
    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);
    vi.advanceTimersByTime(600);
    expect(output.send).toHaveBeenCalledTimes(1);
    expect(output.send.mock.calls[0][0]).toEqual([0xf0, 0, 0x21, 0x50, 0, 0x31, 0, 0, 0, 0, 0xf7]);
    const receive = input.addEventListener.mock.calls[0][1];
    receive({ data: [0xf0, 0, 0x21, 0x50, 1, 0x31, 1, 1, 5, 0, 0xf7] });
    receive({ data: [0xf0, 0, 0x21, 0x50, 0, 0x31, 1, 1, 5, 0xf7] });
    expect(output.send).toHaveBeenCalledTimes(1);
    receive({ data: [0xf0, 0, 0x21, 0x50, 0, 0x31, 1, 1, 5, 0, 0xf7] });
    await expect(query).resolves.toMatchObject({ ok: true, firmwareVersion: "1.5.0" });
    expect(output.send).toHaveBeenCalledTimes(2);
    expect(output.send.mock.calls[1][0][5]).toBe(1);
    leds.destroy();
  });

  it("continues colours after firmware timeout and cancels a disconnected query", async () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    const query = leds.queryFirmware();
    leds.sendAll([{ board: 1, key: 2, hexColor: "#123456" }]);
    vi.advanceTimersByTime(2600);
    await expect(query).resolves.toMatchObject({ ok: false, reason: "timeout", command: 0x31 });
    expect(output.send.mock.calls[1][0][5]).toBe(1);
    const cancelled = leds.queryFirmware();
    leds.destroy();
    await expect(cancelled).resolves.toMatchObject({ ok: false, reason: "cancelled" });
  });

  it("defers a firmware query while suspended and waits for an in-flight layout ACK", async () => {
    const { output, input } = makePorts();
    const leds = new LumatoneLEDs(output, input);
    leds.sendLayout(layout());
    vi.advanceTimersByTime(600);
    const query = leds.queryFirmware();
    expect(output.send).toHaveBeenCalledTimes(1);
    leds._onMessage({ data: [0xf0, 0, 0x21, 0x50, 1, 0, 1, 0xf7] });
    expect(output.send.mock.calls[1][0][5]).toBe(0x31);
    leds._onMessage({ data: [0xf0, 0, 0x21, 0x50, 0, 0x31, 1, 1, 4, 0, 0xf7] });
    await expect(query).resolves.toMatchObject({ firmwareVersion: "1.4.0" });
    leds.destroy();

    const ports = makePorts();
    const suspended = new LumatoneLEDs(ports.output, ports.input);
    suspended.suspend();
    const deferred = suspended.queryFirmware();
    vi.advanceTimersByTime(3000);
    expect(ports.output.send).not.toHaveBeenCalled();
    suspended.resume();
    vi.advanceTimersByTime(1500);
    expect(ports.output.send.mock.calls[0][0][5]).toBe(0x31);
    suspended.destroy();
    await expect(deferred).resolves.toMatchObject({ reason: "cancelled" });
  });

  const completeColours = () => Array.from({ length: 280 }, (_, index) => ({
    board: Math.floor(index / 56) + 1, key: index % 56,
    hexColor: index === 0 ? "#ff0080" : index === 279 ? "#00ff00" : "#123456",
  }));
  const connectFirmware = async (version = [1, 5, 0], ports = makePorts()) => {
    const leds = new LumatoneLEDs(ports.output, ports.input);
    const result = leds.queryFirmware();
    vi.advanceTimersByTime(600);
    leds._onMessage({ data: [0xf0, 0, 0x21, 0x50, 0, 0x31, 1, ...version, 0xf7] });
    await result;
    ports.output.send.mockClear();
    ports.output.sendSysex?.mockClear();
    return { leds, ...ports };
  };
  const reply = (leds, board, cmd, status = 1) =>
    leds._onMessage({ data: [0xf0, 0, 0x21, 0x50, board, cmd, status, 0xf7] });

  it("sends a complete 847-byte RGB frame on verified firmware 1.5", async () => {
    const { leds, output } = await connectFirmware();
    leds.sendAll(completeColours().reverse());
    vi.advanceTimersByTime(600);
    expect(output.send).toHaveBeenCalledOnce();
    const packet = output.send.mock.calls[0][0];
    expect(packet).toHaveLength(847);
    expect(packet.slice(0, 9)).toEqual([0xf0, 0, 0x21, 0x50, 0, 0x55, 127, 0, 64]);
    expect(packet.slice(-4)).toEqual([0, 127, 0, 0xf7]);
    expect(packet.slice(6, -1).every(value => value >= 0 && value < 128)).toBe(true);
    reply(leds, 1, 0x55); // Wrong board cannot acknowledge an all-board frame.
    expect(leds._pending).toBe(true);
    reply(leds, 0, 0x55);
    expect(leds._queue).toHaveLength(0);
    leds.destroy();
  });

  it("sends one complete board through WebMidi and leaves incomplete boards on the legacy path", async () => {
    const { leds, output } = await connectFirmware([1, 5, 0], makeWebMidiPorts());
    leds.sendAll(completeColours().filter(entry => entry.board === 3));
    vi.advanceTimersByTime(600);
    const [manufacturer, payload] = output.sendSysex.mock.calls[0];
    expect(manufacturer).toEqual([0, 0x21, 0x50]);
    expect(payload).toHaveLength(170);
    expect(payload.slice(0, 2)).toEqual([3, 0x55]);
    reply(leds, 3, 0x55);
    leds.sendAll([{ board: 2, key: 4, hexColor: "#ffffff" }]);
    expect(output.sendSysex.mock.lastCall[1].slice(0, 3)).toEqual([2, 1, 4]);
    leds.destroy();
  });

  it("retains per-key colours on older firmware and uses bulk on later numeric versions", async () => {
    for (const [version, command] of [[[1, 4, 3], 1], [[1, 10, 0], 0x55], [[2, 0, 0], 0x55]]) {
      const { leds, output } = await connectFirmware(version);
      leds.sendAll(completeColours());
      vi.advanceTimersByTime(600);
      expect(output.send.mock.calls[0][0][5]).toBe(command);
      leds.destroy();
    }
  });

  it("coalesces changes behind an in-flight frame and preserves the latest partial colour update", async () => {
    const { leds, output } = await connectFirmware();
    leds.sendAll(completeColours());
    vi.advanceTimersByTime(600);
    leds.sendAll(completeColours().map(entry => ({ ...entry, hexColor: "#ffffff" })));
    leds.updateDegree([{ board: 1, key: 0, hexColor: "#000000" }]);
    expect(output.send).toHaveBeenCalledOnce();
    reply(leds, 0, 0x55);
    expect(output.send).toHaveBeenCalledTimes(2);
    expect(output.send.mock.lastCall[0].slice(6, 12)).toEqual([0, 0, 0, 127, 127, 127]);
    reply(leds, 0, 0x55);
    expect(leds._queue).toHaveLength(0);
    leds.destroy();
  });

  it("finishes aftertouch and assignments before the newest bulk colours", async () => {
    const { leds, output } = await connectFirmware();
    const entries = completeColours().map(entry => ({ ...entry, note: entry.key, channel: entry.board - 1 }));
    leds.sendLayout(entries, [{ cmd: 0x0e, board: 0, value: 1 }]);
    vi.advanceTimersByTime(600);
    expect(output.send.mock.lastCall[0][5]).toBe(0x0e);
    reply(leds, 0, 0x0e);
    leds.updateDegree([{ board: 1, key: 0, hexColor: "#ffffff" }]);
    for (let index = 0; index < 280; index += 1) {
      const pending = leds._queue[0];
      expect(pending.cmd).toBe(0);
      reply(leds, pending.board, 0);
    }
    expect(output.send.mock.lastCall[0][5]).toBe(0x55);
    expect(output.send.mock.lastCall[0].slice(6, 9)).toEqual([127, 127, 127]);
    expect(leds.layoutInitializationPending).toBe(true);
    reply(leds, 0, 0x55);
    expect(leds.layoutInitializationPending).toBe(false);
    leds.destroy();
  });

  it("retries BUSY without treating a frame as delivered or sending concurrent commands", async () => {
    const { leds, output } = await connectFirmware();
    leds.sendAll(completeColours());
    vi.advanceTimersByTime(600);
    reply(leds, 0, 0x55, 2);
    vi.advanceTimersByTime(39);
    expect(output.send).toHaveBeenCalledOnce();
    expect(leds._pending).toBe(true);
    vi.advanceTimersByTime(1);
    expect(output.send).toHaveBeenCalledTimes(2);
    expect(output.send.mock.lastCall[0][5]).toBe(0x55);
    reply(leds, 0, 0x55);
    expect(leds._queue).toHaveLength(0);
    leds.destroy();
  });

  it("falls back to per-key RGB after a rejected or timed-out bulk command", async () => {
    for (const failure of ["reject", "timeout", "busy"]) {
      const { leds, output } = await connectFirmware();
      leds.sendAll(completeColours());
      vi.advanceTimersByTime(600);
      if (failure === "reject") reply(leds, 0, 0x55, 4);
      else if (failure === "timeout") vi.advanceTimersByTime(2400);
      else for (let index = 0; index < 9; index += 1) {
        reply(leds, 0, 0x55, 2);
        vi.advanceTimersByTime(40);
      }
      expect(leds.supportsBulkColours).toBe(false);
      expect(output.send.mock.lastCall[0].slice(4, 7)).toEqual([1, 1, 0]);
      expect(output.send.mock.lastCall[0].slice(7, -1)).toEqual([15, 15, 0, 0, 8, 0]);
      leds.destroy();
    }
  });

  it("replays the latest bulk state after sleep and cancels a delayed BUSY retry on destroy", async () => {
    const { leds, output } = await connectFirmware();
    leds.sendAll(completeColours());
    vi.advanceTimersByTime(600);
    leds.suspend();
    leds.updateDegree([{ board: 1, key: 0, hexColor: "#000000" }]);
    leds.resume();
    vi.advanceTimersByTime(1500);
    expect(output.send.mock.lastCall[0][5]).toBe(0x55);
    expect(output.send.mock.lastCall[0].slice(6, 9)).toEqual([0, 0, 0]);
    reply(leds, 0, 0x55, 2);
    const count = output.send.mock.calls.length;
    leds.destroy();
    vi.advanceTimersByTime(1000);
    expect(output.send).toHaveBeenCalledTimes(count);
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
