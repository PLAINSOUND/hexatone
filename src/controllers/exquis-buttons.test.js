import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "webmidi";
import { ExquisLEDs } from "./exquis-leds.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const frame = (...payload) => ({ data: [0xf0, 0, 0x21, 0x7e, ...payload, 0xf7] });
function setup(mpe = true, octave = 0) {
  vi.useFakeTimers();
  const out = { send: vi.fn() };
  const controls = { onOctave: vi.fn(), onAnchor: vi.fn(), onMidi: vi.fn(), getOctaveOffset: () => octave };
  const driver = new ExquisLEDs(out, null, null, 15, 1.3, mpe, 90, 1, [], controls);
  driver._onMessage(frame(0, 3, 0, 0));
  return { driver, out, controls, send: (...payload) => driver._onMessage(frame(...payload)) };
}

describe("Exquis App Mode buttons", () => {
  it("starts at the host's restored octave offset", () => {
    const { driver, out } = setup(true, 3);
    vi.advanceTimersByTime(200);
    expect(out.send.mock.calls.map(([data]) => [...data]))
      .toContainEqual(frame(0x29, 7, 0, 60, 38).data);
    expect(out.send.mock.calls.some(([data]) => data[4] === 0x29 && data[5] === 7 && data[6] === 40)).toBe(false);
    driver.exit();
  });
  it.each([
    [-1, 6, [60, 56, 0]], [-2, 6, [60, 34, 0]], [-3, 6, [60, 15, 0]],
    [-4, 6, [60, 0, 0]], [-20, 6, [60, 0, 0]],
    [1, 7, [32, 60, 0]], [2, 7, [0, 60, 0]], [3, 7, [0, 60, 38]],
    [4, 7, [0, 10, 60]], [5, 7, [40, 0, 60]], [20, 7, [40, 0, 60]],
  ])("shows spectral shading at OCT %s", (offset, active, rgb) => {
    const { driver, out } = setup();
    driver.setOctaveOffset(offset);
    const messages = out.send.mock.calls.map(([data]) => [...data]);
    expect(messages).toContainEqual(frame(0x29, active, ...rgb).data);
    expect(messages).toContainEqual(frame(0x29, active === 6 ? 7 : 6, 20, 20, 20).data);
    out.send.mockClear();
    driver.setOctaveOffset(0);
    for (const id of [6, 7]) expect(out.send.mock.calls.map(([data]) => [...data]))
      .toContainEqual(frame(0x29, id, 40, 40, 40).data);
    driver.exit();
  });

  it("flashes a press for 120ms, then restores the latest offset and cleans up on exit", () => {
    const { driver, out, send, controls } = setup();
    vi.advanceTimersByTime(200);
    out.send.mockClear();
    send(0x2a, 7, 1);
    send(0x2a, 7, 1);
    send(0x2a, 7, 0);
    expect(controls.onOctave).toHaveBeenCalledExactlyOnceWith(1);
    expect(out.send.mock.calls.map(([data]) => [...data]))
      .toContainEqual(frame(0x29, 7, 68, 127, 0).data);
    driver.setOctaveOffset(4); // onscreen change while the press flash is active
    out.send.mockClear();
    vi.advanceTimersByTime(120);
    expect(out.send.mock.calls.map(([data]) => [...data]))
      .toContainEqual(frame(0x29, 7, 0, 10, 60).data);
    send(0x2a, 6, 1);
    driver.exit();
    out.send.mockClear();
    vi.advanceTimersByTime(500);
    expect(out.send).not.toHaveBeenCalled();
  });

  it("restores the current octave colours after sleep without retaining a stale flash", () => {
    const { driver, out, send } = setup();
    vi.advanceTimersByTime(200);
    driver.setOctaveOffset(-1);
    send(0x2a, 6, 1); // OCT -2, briefly bright amber
    out.send.mockClear();
    driver.restoreControls();
    expect(out.send.mock.calls.map(([data]) => [...data]))
      .toContainEqual(frame(0x29, 6, 60, 34, 0).data);
    out.send.mockClear();
    vi.advanceTimersByTime(120);
    expect(out.send).not.toHaveBeenCalled();
    driver.exit();
  });

  it("assigns the anchor to the most recent played pad once per press, even after release and recovery", () => {
    const { driver, controls, out, send } = setup();
    send(0x2a, 4, 1);
    send(0x2a, 4, 0);
    expect(controls.onAnchor).not.toHaveBeenCalled();
    driver._onMessage({ data: [0x91, 20, 70] });
    driver._onMessage({ data: [0x81, 20, 0] });
    driver._onMessage({ data: [0x93, 31, 80] });
    driver._onMessage({ data: [0x93, 31, 0] });
    driver._onMessage({ data: [0x94, 90, 72] }); // not an App-mode pad ID
    driver.recoverIfHeartbeatStale({ force: true });
    out.send.mockClear();
    send(0x2a, 4, 1);
    send(0x2a, 4, 1);
    send(0x2a, 4, 0);
    expect(controls.onAnchor).toHaveBeenCalledExactlyOnceWith(31, 4);
    expect(controls.onMidi).not.toHaveBeenCalled(); // consume the former CC34
    const messages = out.send.mock.calls.map(([data]) => [...data]);
    expect(messages).toContainEqual(frame(0x29, 4, 0, 70, 20).data);
    expect(messages).toContainEqual(frame(0x29, 4, 20, 20, 20).data);
    driver.exit();
  });
  it.each([0, 127])("restores button ownership and bend LED %s after a stale timer and delayed layout setup", value => {
    const { driver, controls, out, send } = setup();
    controls.getControlValue = cc => cc === 32 ? value : undefined;
    vi.advanceTimersByTime(200);
    const last = driver._lastHeartbeatSentAt;
    vi.spyOn(performance, "now").mockReturnValue(last + 11000);
    out.send.mockClear();
    driver._sendHeartbeat(); // timer wins the race with the foreground event
    vi.advanceTimersByTime(200);
    const messages = out.send.mock.calls.map(([data]) => [...data]);
    const lastMap = messages.findLastIndex(data => data[4] === 0x15);
    const lastButtonMode = messages.findLastIndex(data => data[4] === 0x28);
    expect(lastMap).toBeGreaterThan(-1);
    expect(lastButtonMode).toBeGreaterThan(lastMap);
    const restored = messages.slice(lastButtonMode);
    expect(restored).toContainEqual(frame(0x28, 1).data);
    for (const id of [6, 7]) expect(restored).toContainEqual(frame(0x29, id, 40, 40, 40).data);
    expect(restored).toContainEqual(frame(0x29, 2, ...(value ? [40, 0, 0] : [0, 40, 0])).data);
    expect(restored).toContainEqual(frame(0x29, 3, 20, 20, 20).data);
    expect(restored).toContainEqual(frame(0x29, 4, 0, 0, 0).data);
    send(0x2a, 7, 1);
    send(0x2a, 7, 0);
    expect(controls.onOctave).toHaveBeenCalledExactlyOnceWith(1);
    driver.exit();
  });

  it("restores buttons with a fresh heartbeat while a held pad defers full recovery", () => {
    const { driver, controls, out, send } = setup();
    vi.advanceTimersByTime(200);
    driver._onMessage({ data: [0x91, 19, 90] });
    out.send.mockClear();
    driver.recoverIfHeartbeatStale({ force: true });
    expect(out.send.mock.calls.map(([data]) => [...data])).toContainEqual(frame(0x28, 1).data);
    expect(out.send.mock.calls.some(([data]) => [0x07, 0x15].includes(data[4]))).toBe(false);
    out.send.mockClear();
    driver.restoreControls(); // focus may arrive after the heartbeat resumed
    expect(out.send.mock.calls.map(([data]) => [...data])).toContainEqual(frame(0x29, 6, 40, 40, 40).data);
    send(0x2a, 6, 1);
    expect(controls.onOctave).toHaveBeenCalledExactlyOnceWith(-1);
    driver.exit();
  });

  it("takes over buttons, keeps rotation native, queries assignments and lights octave buttons", () => {
    const { driver, out } = setup();
    const messages = out.send.mock.calls.map(([data]) => [...data]);
    expect(messages).toContainEqual(frame(0x28, 1).data);
    expect(messages).toContainEqual(frame(0x32, 0).data);
    expect(messages).toContainEqual(frame(0x02).data);
    for (const id of [6, 7]) expect(messages).toContainEqual(frame(0x29, id, 40, 40, 40).data);
    driver.exit();
  });

  it("shifts once per octave press, ignoring releases, duplicates and other directions", () => {
    const { driver, controls, send } = setup();
    send(0x2a, 6, 1);
    send(0x2a, 6, 1);
    send(0x2a, 6, 0);
    send(0x2a, 7, 1);
    send(0x2a, 7, 0);
    send(0x2a, 8, 1);
    send(0x2a, 8, 0);
    send(0x2a, 7, 1);
    expect(controls.onOctave.mock.calls).toEqual([[-1], [1], [1]]);
    expect(controls.onMidi).not.toHaveBeenCalled();
    driver.exit();
  });

  it("preserves toggle bypass, momentary sustain and encoder CCs, including custom assignments", () => {
    const { driver, controls, send } = setup();
    controls.getControlValue = () => 127; // bypass was already on before entry
    send(0x2a, 2, 1);
    send(0x2a, 2, 0);
    send(0x2a, 3, 1);
    send(0x2a, 3, 0);
    send(0x38, 1, 22);
    send(0x34, 1, 1);
    send(0x34, 1, 0);
    send(0x2b, 3, 64);
    send(0x2a, 3, 1);
    send(0x2a, 3, 0);
    expect(controls.onMidi.mock.calls).toEqual([
      [[0xb0, 32, 0]], [[0xb0, 33, 127]], [[0xb0, 33, 0]],
      [[0xb0, 22, 127]], [[0xb0, 22, 0]], [[0xb0, 64, 127]], [[0xb0, 64, 0]],
    ]);
    driver.exit();
  });

  it("retains a held button across recovery and releases momentary controls on exit", () => {
    const { driver, controls, send } = setup();
    send(0x2a, 3, 1);
    driver.recoverIfHeartbeatStale({ force: true });
    send(0x2a, 3, 0);
    expect(controls.onMidi).toHaveBeenLastCalledWith([0xb0, 33, 0]);
    send(0x34, 0, 1);
    driver.exit();
    expect(controls.onMidi).toHaveBeenLastCalledWith([0xb0, 21, 0]);
    controls.onOctave.mockClear();
    send(0x2a, 7, 1);
    expect(controls.onOctave).not.toHaveBeenCalled();
  });

  it("tracks the native note channel in non-MPE mode and leaves other buttons unbound", () => {
    const { driver, controls, send } = setup(false);
    driver._onMessage({ data: [0x95, 20, 72] });
    send(0x2a, 3, 1);
    send(0x2a, 3, 0);
    send(0x2a, 5, 1);
    send(0x2a, 5, 0);
    send(0x2a, 5, 1);
    expect(controls.onMidi.mock.calls).toEqual([
      [[0xb5, 33, 127]], [[0xb5, 33, 0]],
    ]);
    driver.exit();
  });

  it("lights the bypass/sustain buttons and follows presses and host bypass changes", () => {
    const { driver, controls, out, send } = setup();
    const frames = () => out.send.mock.calls.map(([data]) => [...data]);
    expect(frames()).toContainEqual(frame(0x29, 2, 0, 40, 0).data);
    expect(frames()).toContainEqual(frame(0x29, 3, 20, 20, 20).data);
    expect(frames()).toContainEqual(frame(0x29, 4, 0, 0, 0).data);
    send(0x2a, 2, 1);
    expect(frames()).toContainEqual(frame(0x29, 2, 40, 0, 0).data);
    send(0x2a, 3, 1);
    expect(frames()).toContainEqual(frame(0x29, 3, 0, 70, 20).data);
    out.send.mockClear();
    send(0x2a, 3, 0);
    expect(frames()).toContainEqual(frame(0x29, 3, 20, 20, 20).data);
    controls.getControlValue = cc => cc === 32 ? 0 : undefined;
    out.send.mockClear();
    driver.refreshControlLeds();
    expect(frames()).toContainEqual(frame(0x29, 2, 0, 40, 0).data);
    driver.exit();
  });

  it("reaches WebMidi's normal CC listeners through the raw input event bridge", () => {
    const { driver, controls, send } = setup();
    const raw = new EventTarget();
    Object.defineProperty(raw, "onmidimessage", { set(handler) {
      raw.addEventListener("midimessage", handler);
    } });
    const input = new Input(raw);
    const receive = vi.fn();
    input.addListener("controlchange", receive);
    controls.onMidi = data => raw.dispatchEvent(new MessageEvent("midimessage", {
      data: new Uint8Array(data),
    }));
    send(0x2a, 3, 1);
    send(0x2a, 3, 0);
    expect(receive.mock.calls.map(([event]) => [...event.message.data]))
      .toEqual([[0xb0, 33, 127], [0xb0, 33, 0]]);
    input.removeListener();
    driver.exit();
  });

  it("does not flood LED SysEx during unrelated expression, and restores LEDs after recovery", () => {
    const { driver, out, send } = setup();
    send(0x2a, 3, 1);
    out.send.mockClear();
    for (let value = 0; value < 127; value++) driver._onMessage({ data: [0xb1, 74, value] });
    expect(out.send).not.toHaveBeenCalled();
    driver.recoverIfHeartbeatStale({ force: true });
    expect(out.send.mock.calls.map(([data]) => [...data]))
      .toContainEqual(frame(0x29, 3, 0, 70, 20).data);
    driver.exit();
  });
});
