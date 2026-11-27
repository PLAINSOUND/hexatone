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
vi.mock("./sample", () => ({ default: ({ soundSession }) => <div>Sample controls
  <button onClick={() => soundSession.setParameter("synth_volume", 0.3)}>Edit sample volume</button>
</div> }));
vi.mock("./fluidsynth-settings.jsx", () => ({ default: () => <div>SoundFont controls</div> }));
vi.mock("./supercollider-settings.jsx", () => ({ default: () => <div>scsynth controls</div> }));
vi.mock("./midi", () => ({ default: () => <div>MIDI input</div> }));
vi.mock("./midi/midioutputs", () => ({ default: () => <div>MIDI output</div> }));
import { createSoundSession } from "../audio/sound-session.js";
import { createSoundRecall } from "../audio/sound-recall.js";
import IOSettings from "./io-settings.jsx";
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); });

it("updates the dirty marker for imperative faders without rerendering the whole panel", () => {
  const onVolumeChange = vi.fn();
  const session = createSoundSession(() => ({ settings: {}, applyMixer: onVolumeChange, commit: vi.fn() }));
  render(<IOSettings settings={{}} onChange={vi.fn()} soundSession={session} />);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Warm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  const picker = screen.getByRole("combobox", { name: "User sounds" });
  const observer = new MutationObserver(() => {});
  observer.observe(picker, { subtree: true, attributes: true, childList: true, characterData: true });
  const renders = mocks.renderDsf.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Edit sample volume" }));
  const pickerChanges = observer.takeRecords();
  observer.disconnect();
  expect(onVolumeChange).toHaveBeenCalledWith("synth_volume", 0.3);
  session.discardEdits();
  expect(screen.getByLabelText("Unsaved sound changes")).toBeTruthy();
  expect(mocks.renderDsf).toHaveBeenCalledTimes(renders);
  expect(pickerChanges).toEqual([]);
});

it("switches visible panels while keeping sound controls mounted", () => {
  const props = { settings: {}, onChange: vi.fn(), onAtomicChange: vi.fn() };
  const view = render(<IOSettings {...props} panel="sounds" />);
  expect(screen.getByText("Diagnostics")).toBeTruthy();
  const dsf = screen.getByText("DSF controls");
  const midiSetup = screen.getByText("MIDI Setup").closest("fieldset");
  expect(dsf.parentElement.hidden).toBe(false);
  expect(midiSetup.parentElement.hidden).toBe(true);
  view.rerender(<IOSettings {...props} panel="midi" />);
  expect(screen.queryByText("Diagnostics")).toBeNull();
  expect(dsf.isConnected).toBe(true);
  expect(dsf.parentElement.hidden).toBe(true);
  expect(midiSetup.parentElement.hidden).toBe(false);
  expect(mocks.unmount).not.toHaveBeenCalled();
});

it("delegates menu recalls to the shared runtime and stores the patch", () => {
  const sound = captureUserSound("Quiet", { dsf_attack: 46 });
  sound.sampleVolume = 0.2;
  sound.soundfont.volume = 33;
  saveUserSounds([sound]);
  const beginPatch = vi.fn();
  const soundRecall = createSoundRecall(() => ({ beginPatch, discardEdits: vi.fn() }));
  render(<IOSettings settings={{}} onChange={vi.fn()} soundRecall={soundRecall} />);
  fireEvent.change(screen.getByLabelText("User sounds"), { target: { value: "user:Quiet" } });
  expect(beginPatch).toHaveBeenCalledExactlyOnceWith(
    { ...sound.settings, fluidsynth_preset: "0:0" }, "preserve", null, sound.soundfont,
  );
  expect(localStorage.getItem("dsf_attack")).toBe("46");
  expect(localStorage.getItem("synth_volume")).toBe("0.2");
});


it("keeps SOUND and MIDI reload preferences independent without changing live settings", () => {
  const props = { settings: {}, onChange: vi.fn(), onAtomicChange: vi.fn() };
  const view = render(<IOSettings {...props} panel="sounds" />);
  const preferencesAtBottom = (legend, restore) => {
    const fieldset = screen.getByText(legend, { exact: true, selector: "legend b" }).closest("fieldset");
    const patch = screen.getByLabelText("Change patches immediately and rearticulate");
    expect(fieldset.lastElementChild.contains(patch)).toBe(true);
    expect(fieldset.lastElementChild.previousElementSibling.contains(restore)).toBe(true);
  };
  const sound = screen.getByLabelText("Restore SOUND settings on reload");
  preferencesAtBottom("User Sounds", sound);
  fireEvent.click(sound);
  expect(localStorage.getItem("hexatone_restore_sound_on_reload")).toBe("false");
  view.rerender(<IOSettings {...props} panel="midi" />);
  const midi = screen.getByLabelText("Restore MIDI settings on reload");
  preferencesAtBottom("MIDI Setup", midi);
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

it("shares the patch policy between MIDI and Sounds and defaults to preserving voices", () => {
  const beginPatch = vi.fn();
  const soundRecall = createSoundRecall(() => ({ beginPatch, discardEdits: vi.fn() }));
  const props = { settings: {}, onChange: vi.fn(), soundRecall };
  const view = render(<IOSettings {...props} panel="sounds" />);
  const label = "Change patches immediately and rearticulate";
  expect(screen.getByLabelText(label).checked).toBe(false);
  const menu = screen.getByLabelText("User sounds");
  const hammond = screen.getByRole("option", { name: "Hammond" }).value;
  fireEvent.change(menu, { target: { value: hammond } });
  expect(beginPatch.mock.lastCall[1]).toBe("preserve");

  view.rerender(<IOSettings {...props} panel="midi" />);
  fireEvent.click(screen.getByLabelText(label));
  view.rerender(<IOSettings {...props} panel="sounds" />);
  expect(screen.getByLabelText(label).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload selected sound" }));
  expect(beginPatch.mock.lastCall[1]).toBe("rearticulate");
  view.unmount();

  render(<IOSettings {...props} panel="midi" />);
  expect(screen.getByLabelText(label).checked).toBe(true);
});
