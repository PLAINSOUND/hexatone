import { describe, it, expect, vi, afterEach } from "vitest";
import { getControllerById } from "./registry.js";
import { exquisOrientation, exquisLayoutFlags, rotateExquisCoords } from "./exquis-orientation.js";
import { ExquisLEDs } from "./exquis-leds.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Exquis orientation", () => {
  it("waits for pads held before driver construction before writing MPE and mapping", () => {
    vi.useFakeTimers();
    const out = { send: vi.fn() };
    const driver = new ExquisLEDs(out, null, null, 15, 1.3, true, 90, 1, ["0.60"]);
    driver._onMessage({ data: [0xf0, 0, 0x21, 0x7e, 0, 3, 0, 0, 0xf7] });
    vi.advanceTimersByTime(200);
    expect(out.send.mock.calls.some(([frame]) => frame[4] === 0x07 || frame[4] === 0x15)).toBe(false);
    driver._onMessage({ data: [0x80, 60, 0] });
    vi.advanceTimersByTime(200);
    expect(out.send.mock.calls.some(([frame]) => frame[4] === 0x07)).toBe(true);
    expect(out.send.mock.calls.some(([frame]) => frame[4] === 0x15)).toBe(true);
    driver.exit();
  });
  it("restores mode, note map and saved colours even when the returning timer runs first", () => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    const out = { send: vi.fn() };
    const driver = new ExquisLEDs(out, null);
    driver._onMessage({ data: [0xf0, 0, 0x21, 0x7e, 0, 3, 0, 0, 0xf7] });
    vi.advanceTimersByTime(200);
    driver.sendColors(Array(61).fill("#ff0000"));
    out.send.mockClear();
    now.mockReturnValue(11100);
    driver._sendHeartbeat();
    expect([...out.send.mock.calls[0][0]]).toEqual([0xf0, 0, 0x21, 0x7e, 0xf7]);
    expect(out.send.mock.calls.map(([frame]) => [...frame]))
      .toContainEqual([0xf0, 0, 0x21, 0x7e, 7, 1, 0xf7]);
    expect(driver.recoverIfHeartbeatStale()).toBe(false); // already restoring
    vi.advanceTimersByTime(200);
    const frames = out.send.mock.calls.map(([frame]) => [...frame]);
    expect(frames.filter(frame => frame[4] === 0x15)).toHaveLength(61);
    expect(frames.some(frame => frame[4] === 0x14 && frame[6] > 0)).toBe(true);
    driver.exit();
  });

  it("keeps recovery latched while held and handles duplicate note-ons with one release", () => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    const out = { send: vi.fn() };
    const driver = new ExquisLEDs(out, null);
    driver._onMessage({ data: [0xf0, 0, 0x21, 0x7e, 0, 3, 0, 0, 0xf7] });
    vi.advanceTimersByTime(200);
    driver._onMessage({ data: [0x91, 19, 90] });
    driver._onMessage({ data: [0x91, 19, 100] });
    out.send.mockClear();
    now.mockReturnValue(11100);
    driver._sendHeartbeat();
    expect(driver.recoverIfHeartbeatStale()).toBe(true);
    expect(out.send.mock.calls.every(([frame]) => frame.length === 5)).toBe(true);
    driver._onMessage({ data: [0x81, 19, 0] });
    vi.advanceTimersByTime(0);
    expect(out.send.mock.calls.map(([frame]) => [...frame]))
      .toContainEqual([0xf0, 0, 0x21, 0x7e, 7, 1, 0xf7]);
    driver.exit();
    out.send.mockClear();
    vi.advanceTimersByTime(1000);
    expect(out.send).not.toHaveBeenCalled();
  });
  it("uses MPE changes received before the handshake and avoids redundant mode commands", () => {
    vi.useFakeTimers();
    const out = { send: vi.fn() };
    const driver = new ExquisLEDs(out, null);
    driver.setMPEMode(true);
    driver._onMessage({ data: [0xf0, 0, 0x21, 0x7e, 0, 3, 0, 0, 0xf7] });
    expect(out.send.mock.calls.map(([message]) => [...message]))
      .toContainEqual([0xf0, 0, 0x21, 0x7e, 7, 1, 0xf7]);
    vi.advanceTimersByTime(200);
    out.send.mockClear();
    driver.setMPEMode(true);
    expect(out.send).not.toHaveBeenCalled();
    driver.exit();
  });
  it("defaults to the existing 90-degree setup", () => {
    expect(exquisOrientation(undefined)).toBe(90);
    expect(exquisOrientation(42)).toBe(90);
    expect(exquisLayoutFlags()).toEqual([
      [0x53, 1],
      [0x54, 1],
      [0x55, 1],
      [0x56, 0],
      [0x57, 1],
    ]);
    expect(rotateExquisCoords({ x: 3, y: -2 })).toEqual({ x: 3, y: -2 });
  });

  it.each([0, 90, 180, 270])(
    "keeps all pads unique and the anchor fixed at %s degrees",
    (angle) => {
      const controller = getControllerById("exquis");
      const original = controller.buildMap(19);
      const rotated = controller.buildMap(19, 1, 1, 1, angle);
      expect(rotated.size).toBe(61);
      expect(new Set([...rotated.values()].map((p) => `${p.x},${p.y}`)).size).toBe(61);
      expect(rotated.get("1.19")).toEqual({ x: 0, y: 0 });
      for (const [key, p] of rotated) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
        const q = original.get(key);
        expect(p.x * p.x + p.x * p.y + p.y * p.y).toBe(q.x * q.x + q.x * q.y + q.y * q.y);
        const opposite = controller.buildMap(19, 1, 1, 1, (angle + 180) % 360).get(key);
        expect(opposite).toEqual({ x: -p.x || 0, y: -p.y || 0 });
      }
    },
  );

  it("defers flags and host commit until release and retains orientation on recovery", () => {
    vi.useFakeTimers();
    const out = { send: vi.fn() };
    const driver = new ExquisLEDs(out, null);
    driver._onMessage({ data: [0xf0, 0, 0x21, 0x7e, 0, 3, 0, 0, 0xf7] });
    vi.advanceTimersByTime(200);
    out.send.mockClear();
    driver._onMessage({ data: [0x91, 19, 90] });
    const commit = vi.fn();
    driver.setOrientation(0, commit);
    expect(out.send).not.toHaveBeenCalled();
    driver._onMessage({ data: [0x81, 19, 0] });
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(commit).toHaveBeenCalledWith(0);
    expect(out.send.mock.calls.map(([frame]) => [...frame])).toEqual(
      exquisLayoutFlags(0).map(([cmd, value]) => [0xf0, 0, 0x21, 0x7e, cmd, value, 0xf7]),
    );
    driver._enterAppMode();
    out.send.mockClear();
    vi.advanceTimersByTime(200);
    expect(out.send.mock.calls.slice(0, 5).map(([frame]) => [...frame])).toEqual(
      exquisLayoutFlags(0).map(([cmd, value]) => [0xf0, 0, 0x21, 0x7e, cmd, value, 0xf7]),
    );
    driver.exit();
  });
});
