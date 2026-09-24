// Exercise the real wiring hook with controllable backend creation/preparation.
import { act, cleanup, render, waitFor } from "@testing-library/preact";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import useSynthWiring from "./use-synth-wiring.js";
import { WebMidi } from "webmidi";

const factories = vi.hoisted(() => ({ sample: vi.fn(), osc: vi.fn(), mpe: vi.fn(), mts: vi.fn() }));
vi.mock("../sample_synth", () => ({ create_sample_synth: factories.sample }));
vi.mock("../osc_synth", () => ({ create_osc_synth: factories.osc }));
vi.mock("../mpe_synth", () => ({ default: factories.mpe }));
vi.mock("../midi_synth", () => ({ create_midi_synth: factories.mts }));
vi.mock("webmidi", () => ({ WebMidi: { enabled: false } }));
vi.mock("../composite_synth", () => ({
  create_composite_synth: children => ({ children, setVolume: vi.fn() }),
}));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const engine = () => ({ shutdown: vi.fn(), allSoundOff: vi.fn() });
const scale = ["2/1"];
const base = { fundamental: 440, reference_degree: 0, scale, instrument: "A", output_sample: true, midi_velocity: 72 };
let current;
const keysRef = { current: { updateLiveOutputState: vi.fn(), disconnectMidiInput: vi.fn() } };
const synthRef = { current: null };
const setSettings = vi.fn();
function Harness({ settings = base }) {
  current = useSynthWiring(settings, setSettings, { ready: true, userHasInteracted: true, keysRef, synthRef });
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  factories.sample.mockReset();
  factories.osc.mockReset();
  factories.mpe.mockReset();
  factories.mts.mockReset();
  WebMidi.enabled = false;
  WebMidi.interface = null;
  WebMidi.disable = vi.fn(async () => { WebMidi.enabled = false; WebMidi.interface = null; });
});
afterEach(cleanup);

it("still closes MIDI permissions after queue clearing and engine shutdown fail", async () => {
  const first = { id: "port", clear: vi.fn(() => { throw new Error("disconnected port"); }) };
  const second = { id: "other", clear: vi.fn() };
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", first], ["other", second]]) };
  const old = { shutdown: vi.fn(() => { throw new Error("release failed"); }) };
  factories.mpe.mockResolvedValue(old);
  const settings = { ...base, output_sample: false, output_mpe: true,
    mpe_device: "port", mpe_lo_ch: 2, mpe_hi_ch: 8 };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(current.synth?.children).toEqual([old]));
  await act(async () => current.disableWebMidi());
  expect(second.clear).toHaveBeenCalledOnce();
  expect(old.shutdown).toHaveBeenCalledExactlyOnceWith({ disconnected: true });
  expect(keysRef.current.disconnectMidiInput).toHaveBeenCalledOnce();
  expect(WebMidi.disable).toHaveBeenCalledOnce();
  expect(current.midi).toBeNull();
  view.unmount();
  expect(old.shutdown).toHaveBeenCalledOnce();
});

it("installs a replacement even when the previous OSC engine cannot shut down cleanly", async () => {
  const old = { shutdown: vi.fn(() => { throw new Error("closed bridge"); }) };
  const next = engine();
  factories.osc.mockResolvedValueOnce(old).mockResolvedValueOnce(next);
  const settings = { ...base, output_sample: false, output_osc: true };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(current.synth?.children).toEqual([old]));
  view.rerender(<Harness settings={{ ...settings, osc_bridge_url: "ws://localhost:8099" }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([next]));
  expect(old.shutdown).toHaveBeenCalledOnce();
  expect(current.loading).toBe(0);
});

it("releases retired samples only once when disabling sample alongside another output", async () => {
  const old = { ...engine(), hasVoices: () => true };
  const next = engine(), osc = engine();
  factories.sample.mockResolvedValueOnce(old).mockResolvedValueOnce(next);
  factories.osc.mockResolvedValue(osc);
  const settings = { ...base, output_osc: true };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(current.synth?.children).toEqual([old, osc]));
  view.rerender(<Harness settings={{ ...settings, instrument: "B" }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([next, osc]));
  expect(old.shutdown).not.toHaveBeenCalled();
  view.rerender(<Harness settings={{ ...settings, instrument: "B", output_sample: false }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([osc]));
  expect(old.shutdown).toHaveBeenCalledOnce();
  expect(next.shutdown).toHaveBeenCalledOnce();
  view.unmount();
  expect(old.shutdown).toHaveBeenCalledOnce();
  expect(old.allSoundOff).not.toHaveBeenCalled();
  expect(next.shutdown).toHaveBeenCalledOnce();
});

it("finishes loading after a reconciliation error and retries using the cached engine", async () => {
  const selected = engine();
  factories.osc.mockResolvedValue(selected);
  keysRef.current.updateLiveOutputState.mockImplementationOnce(() => { throw new Error("handoff failed"); });
  const settings = { ...base, output_sample: false, output_osc: true };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(keysRef.current.updateLiveOutputState).toHaveBeenCalledOnce());
  await waitFor(() => expect(current.loading).toBe(0));
  expect(current.synth).toBeNull();
  expect(selected.shutdown).not.toHaveBeenCalled();
  view.rerender(<Harness settings={{ ...settings, instrument: "B" }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([selected]));
  expect(factories.osc).toHaveBeenCalledOnce();
});

it("detaches old output children when every replacement fails", async () => {
  const old = engine();
  factories.osc.mockResolvedValueOnce(old).mockRejectedValueOnce(new Error("offline"));
  const settings = { ...base, output_sample: false, output_osc: true };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(current.synth?.children).toEqual([old]));
  view.rerender(<Harness settings={{ ...settings, osc_bridge_url: "ws://localhost:8099" }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([]));
  expect(keysRef.current.updateLiveOutputState.mock.calls.at(-1)[1].children).toEqual([]);
  expect(current.loading).toBe(0);
  expect(old.shutdown).toHaveBeenCalledOnce();
});

it("shares pending OSC creation and applies live controls before installing it", async () => {
  const pending = deferred();
  factories.osc.mockReturnValue(pending.promise);
  const settings = { ...base, output_sample: false, output_osc: true };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(factories.osc).toHaveBeenCalledOnce());
  act(() => {
    current.onOscLayerVolumeChange(1, 0.17);
    current.onOscQuickReleaseChange(0.8);
    current.onOscQuickReleaseTimeChange(0.12);
    current.onOscQuickReleaseRasterOnlyChange(false);
  });
  view.rerender(<Harness settings={{ ...settings, instrument: "B" }} />);
  await act(async () => {});
  const selected = { ...engine(), setLayerVolume: vi.fn(), setQuickRelease: vi.fn(),
    setQuickReleaseTime: vi.fn(), setQuickReleaseRasterOnly: vi.fn() };
  keysRef.current.updateLiveOutputState.mockImplementationOnce(() => {
    expect(selected.setLayerVolume).toHaveBeenCalledWith(1, 0.17);
    expect(selected.setQuickRelease).toHaveBeenLastCalledWith(0.8);
  });
  await act(async () => pending.resolve(selected));
  await waitFor(() => expect(current.synth?.children).toEqual([selected]));
  expect(factories.osc).toHaveBeenCalledOnce();
  expect(selected.setQuickReleaseTime).toHaveBeenLastCalledWith(0.12);
  expect(selected.setQuickReleaseRasterOnly).toHaveBeenLastCalledWith(false);
  expect(selected.shutdown).not.toHaveBeenCalled();
});

it("applies OSC mode changes made while creation is pending without rebuilding", async () => {
  const pending = deferred();
  factories.osc.mockReturnValue(pending.promise);
  const settings = { ...base, output_sample: false, output_osc: true };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(factories.osc).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={{ ...settings, osc_sustain_buzz_formant: true,
    osc_retrigger_buzz_formant: true }} />);
  await act(async () => {});
  const selected = { ...engine(), setSustainBuzzFormant: vi.fn(), setRetriggerBuzzFormant: vi.fn() };
  await act(async () => pending.resolve(selected));
  await waitFor(() => expect(current.synth?.children).toEqual([selected]));
  expect(selected.setSustainBuzzFormant).toHaveBeenLastCalledWith(true);
  expect(selected.setRetriggerBuzzFormant).toHaveBeenLastCalledWith(true);
  expect(factories.osc).toHaveBeenCalledOnce();
});

it("rebuilds OSC for a changed bridge URL and rejects the obsolete pending result", async () => {
  const a = deferred(), b = deferred();
  factories.osc.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const settings = { ...base, output_sample: false, output_osc: true, osc_bridge_url: "ws://localhost:8089" };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(factories.osc).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={{ ...settings, osc_bridge_url: "ws://localhost:8090" }} />);
  await waitFor(() => expect(factories.osc).toHaveBeenCalledTimes(2));
  const old = engine(), selected = engine();
  await act(async () => { b.resolve(selected); a.resolve(old); });
  await waitFor(() => expect(current.synth?.children).toEqual([selected]));
  expect(factories.osc.mock.calls[1][0]).toBe("ws://localhost:8090");
  expect(old.shutdown).toHaveBeenCalledOnce();
  expect(selected.shutdown).not.toHaveBeenCalled();
});

it("rebuilds MTS when its pitch-bend range changes", async () => {
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", { id: "port" }]]) };
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const old = engine(), next = engine();
  factories.mts.mockResolvedValueOnce(old).mockResolvedValueOnce(next);
  const on = { ...off, output_mts: true, midi_device: "port", midi_channel: 0,
    midi_mapping: "MTS1", midi_wheel_semitones: 2 };
  view.rerender(<Harness settings={on} />);
  await waitFor(() => expect(current.synth?.children).toEqual([old]));
  view.rerender(<Harness settings={{ ...on, midi_wheel_semitones: 12 }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([next]));
  expect(factories.mts.mock.calls[1][0].outputMode.pitchBendRange).toBe(12);
  expect(old.shutdown).toHaveBeenCalledOnce();
});

it("applies current MPE expression options when pending creation completes", async () => {
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", { id: "port" }]]) };
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const pending = deferred();
  factories.mpe.mockReturnValue(pending.promise);
  const on = { ...off, output_mpe: true, mpe_device: "port", mpe_lo_ch: 2, mpe_hi_ch: 8 };
  view.rerender(<Harness settings={on} />);
  await waitFor(() => expect(factories.mpe).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={{ ...on, mpe_plus_output: true, mpe_auto_generate_yz: true }} />);
  await act(async () => {});
  const selected = { ...engine(), setMpePlusPitchBendEnabled: vi.fn(), setAutoGenerateMpeYzEnabled: vi.fn() };
  await act(async () => pending.resolve(selected));
  await waitFor(() => expect(current.synth?.children).toEqual([selected]));
  expect(selected.setMpePlusPitchBendEnabled).toHaveBeenLastCalledWith(true);
  expect(selected.setAutoGenerateMpeYzEnabled).toHaveBeenLastCalledWith(true);
  expect(factories.mpe).toHaveBeenCalledOnce();
});

it.each(["mpe", "mts"])("shares pending %s construction across unrelated graph rebuilds", async family => {
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", { id: "port" }]]) };
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const pending = deferred();
  factories[family].mockReturnValue(pending.promise);
  const on = { ...off, [`output_${family}`]: true, mpe_device: "port", mpe_lo_ch: 2,
    mpe_hi_ch: 8, midi_device: "port", midi_channel: 0, midi_mapping: "MTS1" };
  view.rerender(<Harness settings={on} />);
  await waitFor(() => expect(factories[family]).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={{ ...on, instrument: "B" }} />);
  await act(async () => {});
  const selected = engine();
  await act(async () => pending.resolve(selected));
  await waitFor(() => expect(current.synth?.children).toEqual([selected]));
  expect(factories[family]).toHaveBeenCalledOnce();
  expect(selected.shutdown).not.toHaveBeenCalled();
  expect(current.loading).toBe(0);
});

it.each(["mpe", "mts"])("does not share pending %s construction across replaced port objects", async family => {
  const original = { id: "port" }, replacement = { id: "port" };
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", original]]) };
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const a = deferred(), b = deferred();
  factories[family].mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const on = { ...off, [`output_${family}`]: true, mpe_device: "port", mpe_lo_ch: 2,
    mpe_hi_ch: 8, midi_device: "port", midi_channel: 0, midi_mapping: "MTS1" };
  view.rerender(<Harness settings={on} />);
  await waitFor(() => expect(factories[family]).toHaveBeenCalledOnce());
  WebMidi.interface.outputs.set("port", replacement);
  view.rerender(<Harness settings={{ ...on, instrument: "B" }} />);
  await waitFor(() => expect(factories[family]).toHaveBeenCalledTimes(2));
  const old = engine(), selected = engine();
  await act(async () => { b.resolve(selected); a.resolve(old); });
  await waitFor(() => expect(current.synth?.children).toEqual([selected]));
  expect(old.shutdown).toHaveBeenCalledOnce();
  expect(selected.shutdown).not.toHaveBeenCalled();
});

it("releases owned MIDI voices and controller state before closing permission", async () => {
  const order = [];
  const port = { id: "port", clear: vi.fn(() => order.push("clear")) };
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", port]]) };
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const mpe = engine();
  mpe.shutdown.mockImplementation(() => order.push("release"));
  factories.mpe.mockResolvedValue(mpe);
  view.rerender(<Harness settings={{ ...off, output_mpe: true, mpe_device: "port", mpe_lo_ch: 2, mpe_hi_ch: 8 }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([mpe]));
  keysRef.current.disconnectMidiInput.mockImplementationOnce(() => order.push("input"));
  WebMidi.disable.mockImplementationOnce(async () => {
    order.push("close");
    WebMidi.enabled = false;
    WebMidi.interface = null;
  });
  await act(async () => current.disableWebMidi());
  expect(order).toEqual(["clear", "release", "input", "close"]);
  expect(mpe.shutdown).toHaveBeenCalledExactlyOnceWith({ disconnected: true });
  expect(mpe.allSoundOff).not.toHaveBeenCalled();
});

it("waits for permission close before attempting reactivation", async () => {
  const closing = deferred();
  const access = { inputs: new Map(), outputs: new Map() };
  WebMidi.enabled = true;
  WebMidi.interface = access;
  WebMidi.disable.mockImplementation(() => closing.promise.then(() => {
    WebMidi.enabled = false;
    WebMidi.interface = null;
  }));
  WebMidi.enable = vi.fn(async () => {
    WebMidi.enabled = true;
    WebMidi.interface = access;
    return WebMidi;
  });
  WebMidi.addListener = vi.fn(() => ({ remove: vi.fn() }));
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "requestMIDIAccess");
  Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: vi.fn() });
  try {
    render(<Harness settings={{ ...base, output_sample: false }} />);
    await waitFor(() => expect(current.midi).toBe(access));
    let stopping, starting;
    act(() => {
      stopping = current.disableWebMidi();
      starting = current.enableWebMidi();
    });
    expect(WebMidi.enable).not.toHaveBeenCalled();
    await act(async () => { closing.resolve(); await stopping; await starting; });
    expect(WebMidi.enable).toHaveBeenCalledOnce();
    await waitFor(() => expect(current.midi).toBe(access));
  } finally {
    if (descriptor) Object.defineProperty(navigator, "requestMIDIAccess", descriptor);
    else delete navigator.requestMIDIAccess;
  }
});

it.each(["mpe", "osc"])("releases the previous %s engine before constructing a changed route", async family => {
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", { id: "port" }]]) };
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const on = { ...off, [`output_${family}`]: true, mpe_device: "port", mpe_lo_ch: 2, mpe_hi_ch: 8 };
  const old = engine(), next = engine();
  factories[family].mockResolvedValueOnce(old).mockImplementationOnce(async () => {
    expect(old.shutdown).toHaveBeenCalledOnce();
    return next;
  });
  view.rerender(<Harness settings={on} />);
  await waitFor(() => expect(current.synth?.children).toEqual([old]));
  view.rerender(<Harness settings={{ ...on, fundamental: 442 }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([next]));
  expect(old.shutdown).toHaveBeenCalledOnce();
  expect(old.allSoundOff).not.toHaveBeenCalled();
});

it.each(["mpe", "mts"])("rebuilds %s for a replacement port with the same ID", async family => {
  const originalPort = { id: "port" }, replacementPort = { id: "port" };
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", originalPort]]) };
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const on = { ...off, [`output_${family}`]: true, mpe_device: "port",
    mpe_lo_ch: 2, mpe_hi_ch: 8, midi_device: "port", midi_channel: 0, midi_mapping: "MTS1" };
  const old = engine(), next = engine();
  factories[family].mockResolvedValueOnce(old).mockResolvedValueOnce(next);
  view.rerender(<Harness settings={on} />);
  await waitFor(() => expect(current.synth?.children).toEqual([old]));
  // Force a graph reconsideration without changing this output's musical key.
  view.rerender(<Harness settings={{ ...on, instrument: "B" }} />);
  await act(async () => {});
  expect(factories[family]).toHaveBeenCalledOnce();
  WebMidi.interface.outputs.set("port", replacementPort);
  view.rerender(<Harness settings={{ ...on, instrument: "C" }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([next]));
  expect(factories[family]).toHaveBeenCalledTimes(2);
  const args = factories[family].mock.calls[1];
  expect(family === "mpe" ? args[0] : args[0].outputMode.output).toBe(replacementPort);
  expect(old.shutdown).toHaveBeenCalledOnce();
  expect(old.allSoundOff).not.toHaveBeenCalled();
  expect(next.shutdown).not.toHaveBeenCalled();
});

it.each(["mpe", "mts"])("rejects late %s creation for an already replaced port", async family => {
  const port = { id: "port" };
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", port]]) };
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const pending = deferred();
  factories[family].mockReturnValue(pending.promise);
  view.rerender(<Harness settings={{ ...off, [`output_${family}`]: true,
    mpe_device: "port", mpe_lo_ch: 2, mpe_hi_ch: 8,
    midi_device: "port", midi_channel: 0, midi_mapping: "MTS1" }} />);
  await waitFor(() => expect(factories[family]).toHaveBeenCalledOnce());
  // The port map can change before the statechange-triggered effect executes.
  WebMidi.interface.outputs.set("port", { id: "port" });
  const stale = engine();
  await act(async () => pending.resolve(stale));
  await waitFor(() => expect(stale.shutdown).toHaveBeenCalledOnce());
  expect(current.synth?.children ?? []).not.toContain(stale);
});

it("shares pending sample construction across unrelated output changes", async () => {
  const pending = deferred();
  const sample = engine(), osc = engine();
  factories.sample.mockReturnValue(pending.promise);
  factories.osc.mockResolvedValue(osc);
  const view = render(<Harness />);
  await waitFor(() => expect(factories.sample).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={{ ...base, output_osc: true }} />);
  await waitFor(() => expect(factories.osc).toHaveBeenCalledOnce());
  await act(async () => pending.resolve(sample));
  await waitFor(() => expect(current.synth?.children).toEqual([sample, osc]));
  expect(factories.sample).toHaveBeenCalledOnce();
  expect(sample.shutdown).not.toHaveBeenCalled();
  expect(current.loading).toBe(0);
});

it("shares sample preparation and adopts it for the latest routing selection", async () => {
  const preparation = deferred();
  const sample = { ...engine(), prepare: vi.fn(() => preparation.promise) };
  const osc = engine();
  factories.sample.mockResolvedValue(sample);
  factories.osc.mockResolvedValue(osc);
  const view = render(<Harness />);
  await waitFor(() => expect(sample.prepare).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={{ ...base, output_osc: true }} />);
  await waitFor(() => expect(factories.osc).toHaveBeenCalledOnce());
  await act(async () => preparation.resolve());
  await waitFor(() => expect(current.synth?.children).toEqual([sample, osc]));
  expect(factories.sample).toHaveBeenCalledOnce();
  expect(sample.prepare).toHaveBeenCalledOnce();
  expect(sample.shutdown).not.toHaveBeenCalled();
});

it("reclaims pending A after A/B/A selection without installing B", async () => {
  const a = deferred(), b = deferred();
  factories.sample.mockImplementation(name => name === "A" ? a.promise : b.promise);
  const view = render(<Harness />);
  await waitFor(() => expect(factories.sample).toHaveBeenCalledTimes(1));
  view.rerender(<Harness settings={{ ...base, instrument: "B" }} />);
  await waitFor(() => expect(factories.sample).toHaveBeenCalledTimes(2));
  view.rerender(<Harness />);
  await act(async () => {});
  const selected = engine(), stale = engine();
  await act(async () => { a.resolve(selected); b.resolve(stale); });
  await waitFor(() => expect(current.synth?.children).toEqual([selected]));
  expect(factories.sample).toHaveBeenCalledTimes(2);
  expect(selected.shutdown).not.toHaveBeenCalled();
  expect(stale.shutdown).toHaveBeenCalledOnce();
});

it("disposes a superseded sample that finishes after the selected replacement", async () => {
  const a = deferred(), b = deferred();
  factories.sample.mockImplementation(name => name === "A" ? a.promise : b.promise);
  const view = render(<Harness />);
  await waitFor(() => expect(factories.sample).toHaveBeenCalledTimes(1));
  view.rerender(<Harness settings={{ ...base, instrument: "B" }} />);
  await waitFor(() => expect(factories.sample).toHaveBeenCalledTimes(2));
  const selected = engine(), stale = engine();
  await act(async () => b.resolve(selected));
  await waitFor(() => expect(current.synth.children).toEqual([selected]));
  await act(async () => a.resolve(stale));
  await waitFor(() => expect(current.loading).toBe(0));
  expect(stale.shutdown).toHaveBeenCalledOnce();
  expect(selected.shutdown).not.toHaveBeenCalled();
  expect(current.synth.children).toEqual([selected]);
  expect(current.loading).toBe(0);
});

it("releases a candidate when its preparation fails", async () => {
  const preparation = deferred();
  const candidate = { ...engine(), prepare: vi.fn(() => preparation.promise) };
  factories.sample.mockResolvedValue(candidate);
  render(<Harness />);
  await waitFor(() => expect(candidate.prepare).toHaveBeenCalledOnce());
  await act(async () => preparation.reject(new Error("decode failed")));
  await waitFor(() => expect(current.loading).toBe(0));
  expect(candidate.shutdown).toHaveBeenCalledOnce();
  expect(current.loading).toBe(0);
});

it("disposes late OSC creation after routing is disabled", async () => {
  const pending = deferred();
  factories.osc.mockReturnValue(pending.promise);
  const settings = { ...base, output_sample: false, output_osc: true };
  const view = render(<Harness settings={settings} />);
  await waitFor(() => expect(factories.osc).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={{ ...settings, output_osc: false }} />);
  const candidate = engine();
  await act(async () => pending.resolve(candidate));
  expect(candidate.shutdown).toHaveBeenCalledOnce();
  expect(candidate.allSoundOff).not.toHaveBeenCalled();
  expect(current.synth.children).toEqual([]);
});

it("disposes creation that finishes after unmount without installing it", async () => {
  const pending = deferred();
  factories.sample.mockReturnValue(pending.promise);
  const view = render(<Harness />);
  await waitFor(() => expect(factories.sample).toHaveBeenCalledOnce());
  view.unmount();
  keysRef.current.updateLiveOutputState.mockClear();
  const candidate = engine();
  await act(async () => pending.resolve(candidate));
  await waitFor(() => expect(candidate.shutdown).toHaveBeenCalledOnce());
  expect(keysRef.current.updateLiveOutputState).not.toHaveBeenCalled();
});

it("waits for cancelled preparation to settle, then releases its engine", async () => {
  const preparation = deferred();
  const candidate = { ...engine(), prepare: vi.fn(() => preparation.promise) };
  factories.sample.mockResolvedValue(candidate);
  const view = render(<Harness />);
  await waitFor(() => expect(candidate.prepare).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={{ ...base, output_sample: false }} />);
  await waitFor(() => expect(current.synth.children).toEqual([]));
  expect(candidate.shutdown).not.toHaveBeenCalled();
  expect(current.loading).toBe(0);
  await act(async () => preparation.resolve());
  expect(candidate.shutdown).toHaveBeenCalledOnce();
  expect(current.loading).toBe(0);
});

it("does not dispose a cached OSC engine reused by a superseding build", async () => {
  const osc = engine();
  factories.osc.mockResolvedValue(osc);
  const a = deferred(), b = deferred();
  factories.sample.mockImplementation(name => name === "A" ? a.promise : b.promise);
  const view = render(<Harness settings={{ ...base, output_sample: false, output_osc: true }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([osc]));
  view.rerender(<Harness settings={{ ...base, output_osc: true }} />);
  await waitFor(() => expect(factories.sample).toHaveBeenCalledTimes(1));
  view.rerender(<Harness settings={{ ...base, output_osc: true, instrument: "B" }} />);
  await waitFor(() => expect(factories.sample).toHaveBeenCalledTimes(2));
  const stale = engine(), selected = engine();
  await act(async () => { a.resolve(stale); b.resolve(selected); });
  await waitFor(() => expect(current.synth.children).toEqual([selected, osc]));
  expect(stale.shutdown).toHaveBeenCalledOnce();
  expect(osc.shutdown).not.toHaveBeenCalled();
  expect(factories.osc).toHaveBeenCalledOnce();
  expect(current.synth.children).toEqual([selected, osc]);
});

it("clears installed outputs on unmount exactly once without a panic", async () => {
  const sample = engine(), osc = engine();
  factories.sample.mockResolvedValue(sample);
  factories.osc.mockResolvedValue(osc);
  const view = render(<Harness settings={{ ...base, output_osc: true }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([sample, osc]));
  view.unmount();
  for (const candidate of [sample, osc]) {
    expect(candidate.shutdown).toHaveBeenCalledOnce();
    expect(candidate.allSoundOff).not.toHaveBeenCalled();
  }
});

it("keeps the old sample playable during preparation and preserves its tails on handoff", async () => {
  const old = { ...engine(), hasVoices: () => true };
  const preparation = deferred();
  const next = { ...engine(), prepare: vi.fn(() => preparation.promise) };
  factories.sample.mockImplementation(async name => name === "A" ? old : next);
  const view = render(<Harness />);
  await waitFor(() => expect(current.synth?.children).toEqual([old]));
  view.rerender(<Harness settings={{ ...base, instrument: "B" }} />);
  await waitFor(() => expect(next.prepare).toHaveBeenCalledOnce());
  expect(current.synth.children).toEqual([old]);
  expect(current.loading).toBe(0);
  await act(async () => preparation.resolve());
  await waitFor(() => expect(current.synth.children).toEqual([next]));
  expect(old.shutdown).not.toHaveBeenCalled();
  expect(old.allSoundOff).not.toHaveBeenCalled();
});

it("installs a successful OSC output even if sample construction rejects", async () => {
  const osc = engine();
  factories.osc.mockResolvedValue(osc);
  factories.sample.mockRejectedValue(new Error("unavailable samples"));
  render(<Harness settings={{ ...base, output_osc: true }} />);
  await waitFor(() => expect(current.synth?.children).toEqual([osc]));
  expect(current.loading).toBe(0);
  expect(osc.shutdown).not.toHaveBeenCalled();
});

it.each(["mpe", "mts"])("disposes late %s creation when its route is disabled", async family => {
  const pending = deferred();
  factories[family].mockReturnValue(pending.promise);
  WebMidi.enabled = true;
  WebMidi.interface = { inputs: new Map(), outputs: new Map([["port", { id: "port" }]]) };
  // First settle port recovery without starting an output build.
  const off = { ...base, output_sample: false };
  const view = render(<Harness settings={off} />);
  await waitFor(() => expect(current.midi).toBe(WebMidi.interface));
  const on = { ...off, [`output_${family}`]: true, mpe_device: "port",
    mpe_lo_ch: 2, mpe_hi_ch: 8, midi_device: "port", midi_channel: 0, midi_mapping: "MTS1" };
  view.rerender(<Harness settings={on} />);
  await waitFor(() => expect(factories[family]).toHaveBeenCalledOnce());
  view.rerender(<Harness settings={off} />);
  const candidate = engine();
  await act(async () => pending.resolve(candidate));
  await waitFor(() => expect(candidate.shutdown).toHaveBeenCalledOnce());
  expect(candidate.allSoundOff).not.toHaveBeenCalled();
  expect(current.synth.children).toEqual([]);
});
