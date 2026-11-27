import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, expect, it, vi } from "vitest";
import { useEffect } from "preact/hooks";
import { captureUserSound, saveUserSounds } from "../persistence/user-sounds.js";

const mocks = vi.hoisted(() => ({ engine: { setVolume: vi.fn(), setReverb: vi.fn(), setSmoothing: vi.fn() }, unmount: vi.fn(), renderDsf: vi.fn() }));
vi.mock("../fluidsynth_synth/index.js", () => ({ peekFluidSynthEngine: () => mocks.engine,
  subscribeFluidSynthEngine: () => () => {} }));
vi.mock("./audio-diagnostics.jsx", () => ({ default: () => <div>Diagnostics</div> }));
vi.mock("./dsf-settings.jsx", () => ({ default: function MockDsfSettings() {
  mocks.renderDsf();
  useEffect(() => () => mocks.unmount(), []);
  return <div>DSF controls</div>;
} }));
vi.mock("./sample", () => ({ default: ({ onVolumeChange }) => <div>Sample controls
  <button onClick={() => { localStorage.setItem("synth_volume", "0.3"); onVolumeChange?.(0.3); }}>Edit sample volume</button>
</div> }));
vi.mock("./fluidsynth-settings.jsx", () => ({ default: () => <div>SoundFont controls</div> }));
vi.mock("./supercollider-settings.jsx", () => ({ default: () => <div>scsynth controls</div> }));
vi.mock("./midi/webmidi-settings.jsx", () => ({ default: () => <div>MIDI setup</div> }));
vi.mock("./midi", () => ({ default: () => <div>MIDI input</div> }));
vi.mock("./midi/midioutputs", () => ({ default: () => <div>MIDI output</div> }));
import IOSettings from "./io-settings.jsx";
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

it("updates the dirty marker for imperative faders without rerendering the whole panel", () => {
  const onVolumeChange = vi.fn();
  render(<IOSettings settings={{}} onChange={vi.fn()} onAtomicChange={vi.fn()} onVolumeChange={onVolumeChange} />);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Warm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  const renders = mocks.renderDsf.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Edit sample volume" }));
  expect(onVolumeChange).toHaveBeenCalledWith(0.3);
  expect(screen.getByLabelText("Unsaved sound changes")).toBeTruthy();
  expect(mocks.renderDsf).toHaveBeenCalledTimes(renders);
});

it("switches visible panels while keeping sound controls mounted", () => {
  const props = { settings: {}, onChange: vi.fn(), onAtomicChange: vi.fn() };
  const view = render(<IOSettings {...props} panel="sounds" />);
  expect(screen.getByText("Diagnostics")).toBeTruthy();
  const dsf = screen.getByText("DSF controls");
  expect(dsf.parentElement.hidden).toBe(false);
  expect(screen.getByText("MIDI setup").parentElement.hidden).toBe(true);
  view.rerender(<IOSettings {...props} panel="midi" />);
  expect(screen.queryByText("Diagnostics")).toBeNull();
  expect(dsf.isConnected).toBe(true);
  expect(dsf.parentElement.hidden).toBe(true);
  expect(screen.getByText("MIDI setup").parentElement.hidden).toBe(false);
  expect(mocks.unmount).not.toHaveBeenCalled();
});

it("recalls sound settings atomically and updates imperative controls and storage", () => {
  const sound = captureUserSound("Quiet", { dsf_attack: 46 });
  sound.sampleVolume = 0.2;
  sound.soundfont.volume = 33;
  saveUserSounds([sound]);
  const props = { settings: {}, onChange: vi.fn(), onAtomicChange: vi.fn(),
    onVolumeChange: vi.fn(), onOscLayerVolumeChange: vi.fn(), onOscBrightnessChange: vi.fn(),
    onOscQuickReleaseChange: vi.fn(), onOscQuickReleaseTimeChange: vi.fn(),
    onOscQuickReleaseRasterOnlyChange: vi.fn() };
  render(<IOSettings {...props} />);
  fireEvent.change(screen.getByLabelText("User sounds"), { target: { value: "user:Quiet" } });
  expect(props.onAtomicChange).toHaveBeenCalledTimes(1);
  expect(props.onAtomicChange).toHaveBeenCalledWith({ ...sound.settings, fluidsynth_preset: "0:0" });
  expect(props.onVolumeChange).toHaveBeenCalledWith(0.2);
  expect(props.onOscLayerVolumeChange).toHaveBeenCalledTimes(4);
  expect(mocks.engine.setVolume).toHaveBeenCalledWith(33);
  expect(mocks.engine.setSmoothing).toHaveBeenCalledWith(sound.soundfont.smoothing);
  expect(localStorage.getItem("dsf_attack")).toBe("46");
  expect(localStorage.getItem("synth_volume")).toBe("0.2");
});


it("keeps SOUND and MIDI reload preferences independent without changing live settings", () => {
  const props = { settings: {}, onChange: vi.fn(), onAtomicChange: vi.fn() };
  const view = render(<IOSettings {...props} panel="sounds" />);
  fireEvent.click(screen.getByLabelText("Restore SOUND settings on reload"));
  expect(localStorage.getItem("hexatone_restore_sound_on_reload")).toBe("false");
  view.rerender(<IOSettings {...props} panel="midi" />);
  const midi = screen.getByLabelText("Restore MIDI settings on reload");
  expect(midi.checked).toBe(true);
  fireEvent.click(midi);
  expect(localStorage.getItem("hexatone_restore_midi_on_reload")).toBe("false");
  view.rerender(<IOSettings {...props} panel="sounds" />);
  fireEvent.click(screen.getByLabelText("Restore SOUND settings on reload"));
  view.rerender(<IOSettings {...props} panel="midi" />);
  expect(screen.getByLabelText("Restore MIDI settings on reload").checked).toBe(false);
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onAtomicChange).not.toHaveBeenCalled();
});
