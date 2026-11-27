import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, expect, it, vi } from "vitest";
import UserSounds from "./user-sounds.jsx";
import { ACTIVE_SOUND_KEY, applyIOReloadPolicy, SOUND_RESTORE_KEY } from "../persistence/io-reload-policy.js";
import { BUILTIN_USER_SOUNDS, loadUserSounds } from "../persistence/user-sounds.js";
import { useState } from "preact/hooks";
const fluidMock = vi.hoisted(() => ({ engine: null }));
vi.mock("../fluidsynth_synth/index.js", () => ({ peekFluidSynthEngine: () => fluidMock.engine,
  subscribeFluidSynthEngine: () => () => {} }));
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); fluidMock.engine = null; });
const builtinValue = name => `builtin:${BUILTIN_USER_SOUNDS.findIndex(sound => sound.name === name)}`;

it("keeps maximum-length copies and imported sounds distinct and selectable", async () => {
  const { container } = render(<UserSounds settings={{}} onApply={vi.fn()} />);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "x".repeat(200) } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  const copied = loadUserSounds()[1];
  expect(copied.name).toBe(`${"x".repeat(198)} 2`);
  expect(screen.getByLabelText("User sounds").value).toBe(`user:${copied.name}`);
  fireEvent.change(container.querySelector('input[type="file"]'), {
    target: { files: [{ text: async () => JSON.stringify(loadUserSounds()[0]) }] },
  });
  await waitFor(() => expect(loadUserSounds()).toHaveLength(3));
  expect(loadUserSounds()[2].name).toBe(`${"x".repeat(198)} 3`);
  expect(new Set(loadUserSounds().map(sound => sound.name)).size).toBe(3);
});

it("keeps live Mod wheel movement clean while saved brightness edits remain dirty", () => {
  localStorage.setItem("osc_brightness", "0.2");
  const props = { settings: {}, onApply: vi.fn() };
  const view = render(<UserSounds {...props} oscBrightness={0.2} />);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Harpsichord" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  view.rerender(<UserSounds {...props} oscBrightness={1} />);
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(loadUserSounds()[1].settings.osc_brightness).toBe(0.2);
  localStorage.setItem("osc_brightness", "0.7");
  view.rerender(<UserSounds {...props} oscBrightness={0.7} />);
  expect(screen.getByLabelText("Unsaved sound changes")).toBeTruthy();
  localStorage.setItem("osc_brightness", "0.2");
  view.rerender(<UserSounds {...props} oscBrightness={1} />);
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
});

it.each(["Hammond", "Test Tone"])("recalls and reloads %s cleanly with a different SoundFont kept warm", soundName => {
  fluidMock.engine = { soundfontSource: { name: "PlainsoundSrutibox.sf2" },
    selectedPreset: { bank: 0, program: 3 }, volume: 100, reverb: 20,
    smoothing: { pressureMs: 0, expressionMs: 0, minimumMs: 0 } };
  const soundIndex = BUILTIN_USER_SOUNDS.findIndex(sound => sound.name === soundName);
  function WorkingSound() {
    const [settings, setSettings] = useState({});
    return <>
      <UserSounds settings={settings} onApply={sound => setSettings(sound.settings)} />
      <button onClick={() => setSettings(current => ({ ...current, dsf_attack: 73 }))}>Edit attack</button>
    </>;
  }
  render(<WorkingSound />);
  fireEvent.change(screen.getByLabelText("User sounds"), { target: { value: `builtin:${soundIndex}` } });
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  expect(screen.getByRole("option", { name: soundName })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit attack" }));
  expect(screen.getByLabelText("Unsaved sound changes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reload selected sound" }));
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  expect(screen.getByRole("option", { name: soundName })).toBeTruthy();
  expect(fluidMock.engine.selectedPreset).toEqual({ bank: 0, program: 3 });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(loadUserSounds()[0].soundfont).toEqual(BUILTIN_USER_SOUNDS[soundIndex].soundfont);
});

it("marks edited sounds, clears the marker on revert, and saves the working state", () => {
  const onApply = vi.fn();
  const view = render(<UserSounds settings={{ dsf_attack: 37 }} onApply={onApply} />);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Warm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  view.rerender(<UserSounds settings={{ dsf_attack: 80 }} onApply={onApply} />);
  expect(screen.getByLabelText("Unsaved sound changes")).toBeTruthy();
  view.rerender(<UserSounds settings={{ dsf_attack: 37 }} onApply={onApply} />);
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  view.rerender(<UserSounds settings={{ dsf_attack: 80 }} onApply={onApply} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  expect(loadUserSounds()[0].settings.dsf_attack).toBe(80);
});

it("reloads the saved sound and its text drafts without saving current changes", () => {
  const onApply = vi.fn();
  const view = render(<UserSounds settings={{ dsf_attack: 37 }} onApply={onApply} />);
  const reload = screen.getByRole("button", { name: "Reload selected sound" });
  expect(reload.disabled).toBe(false);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Warm" } });
  fireEvent.input(screen.getByLabelText("Sound description"), { target: { value: "A quiet organ\nWith a sine tone" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  const saved = loadUserSounds()[0];
  expect(saved.description).toBe("A quiet organ\nWith a sine tone");
  view.rerender(<UserSounds settings={{ dsf_attack: 200 }} onApply={onApply} />);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Unsaved" } });
  fireEvent.input(screen.getByLabelText("Sound description"), { target: { value: "Changed" } });
  fireEvent.click(reload);
  expect(onApply).toHaveBeenLastCalledWith(saved);
  view.rerender(<UserSounds settings={saved.settings} onApply={onApply} />);
  expect(screen.getByLabelText("Sound name").value).toBe("Warm");
  expect(screen.getByLabelText("Sound description").value).toBe(saved.description);
  expect(loadUserSounds()).toEqual([saved]);
  fireEvent.change(screen.getByLabelText("User sounds"), { target: { value: builtinValue("Test Tone") } });
  fireEvent.click(reload);
  expect(onApply).toHaveBeenCalledTimes(3);
  expect(onApply.mock.calls[2][0].name).toBe("Test Tone");
  expect(screen.getByLabelText("Sound description").value).toBe("");
});

it("saves, names, copies, recalls and deletes sound snapshots", () => {
  const onApply = vi.fn();
  render(<UserSounds settings={{ dsf_attack: 37 }} oscBrightness={0.4} onApply={onApply} />);
  expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
  for (const name of ["Save", "Save as copy", "Export .json"])
    expect(screen.getByRole("button", { name }).closest("fieldset").querySelector("legend").textContent).toBe("User Sounds");
  expect(screen.getByLabelText("Sound description").closest("fieldset").querySelector("legend").textContent).toBe("Name and Description");
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Warm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(loadUserSounds()[0].settings.dsf_attack).toBe(37);
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(loadUserSounds().map(sound => sound.name)).toEqual(["Warm", "Warm 2"]);
  fireEvent.change(screen.getByLabelText("User sounds"), { target: { value: "user:Warm" } });
  expect(onApply).toHaveBeenCalledWith(loadUserSounds()[0]);
  expect(screen.getByLabelText("Sound name").value).toBe("Warm");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(loadUserSounds().map(sound => sound.name)).toEqual(["Warm 2"]);
});

it("exports the current named sound and imports without replacing equal names or applying it", async () => {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sound");
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const onApply = vi.fn();
  const { container } = render(<UserSounds settings={{ dsf_attack: 91 }} onApply={onApply} />);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Bright" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  fireEvent.click(screen.getByRole("button", { name: "Export .json" }));
  expect(create.mock.calls[0][0].type).toBe("application/json");
  expect(click.mock.instances[0].download).toBe("bright.json");
  fireEvent.change(container.querySelector('input[type="file"]'), {
    target: { files: [{ text: async () => JSON.stringify(loadUserSounds()[0]) }] },
  });
  await waitFor(() => expect(loadUserSounds()).toHaveLength(2));
  expect(loadUserSounds()[1].name).toBe("Bright 2");
  expect(onApply).not.toHaveBeenCalled();
  create.mockRestore(); click.mockRestore();
});


it("always offers factory defaults and a fixed sine test tone above the user sounds", () => {
  const onApply = vi.fn();
  render(<UserSounds settings={{ dsf_timbre: 0.9 }} onApply={onApply} />);
  const menu = screen.getByLabelText("User sounds");
  expect([...menu.options].map(option => option.textContent)).toEqual([
    "Default", "Reed Organ", "Hammond", "Baroque Organ", "Harpsichord", "Test Tone", "──────────",
  ]);
  fireEvent.change(menu, { target: { value: builtinValue("Test Tone") } });
  expect(onApply.mock.calls[0][0].settings).toMatchObject({
    output_dsf: true, output_sample: false, output_fluidsynth: false, output_osc: false,
    dsf_volume: 0.5, dsf_timbre: 0, dsf_volumeEnvelope: false, dsf_timbreEnvelope: false,
    dsf_velocityVolume: 0, dsf_velocityTimbre: 0, dsf_pressure: 0, dsf_timbreResponse: 0,
  });
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  fireEvent.change(menu, { target: { value: builtinValue("Default") } });
  expect(onApply.mock.calls[1][0].settings).toMatchObject({
    dsf_timbre: 0.25, dsf_attack: 12, dsf_volumeEnvelope: true, output_sample: false,
  });
  expect(onApply.mock.calls[1][0].soundfont).toMatchObject({
    name: "PlainsoundOrgan.sf2", preset: "0:1",
    fallback: { name: "PlainsoundOrganGedackt.sf2", preset: "0:1" },
  });
  expect(loadUserSounds()).toEqual([]);
});

it("requires a copy of built-in sounds before allowing Save", () => {
  render(<UserSounds settings={{}} onApply={vi.fn()} />);
  const menu = screen.getByLabelText("User sounds");
  for (const value of ["Default", "Reed Organ"].map(builtinValue)) {
    fireEvent.change(menu, { target: { value } });
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Save as copy" }).disabled).toBe(false);
  }
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "My test tone" } });
  expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(loadUserSounds().map(sound => sound.name)).toEqual(["My test tone"]);
  expect(menu.value).toBe("user:My test tone");
  expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false);
});

it("renames the selected sound with Save and preserves it with Save as copy", () => {
  const props = { settings: { dsf_attack: 37 }, onApply: vi.fn() };
  const view = render(<UserSounds {...props} />);
  const name = screen.getByLabelText("Sound name");
  fireEvent.input(name, { target: { value: "Warm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  view.rerender(<UserSounds {...props} settings={{ dsf_attack: 85 }} />);
  fireEvent.input(name, { target: { value: "Renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(loadUserSounds().map(sound => sound.name)).toEqual(["Renamed"]);
  expect(loadUserSounds()[0].settings.dsf_attack).toBe(85);
  expect(screen.getByLabelText("User sounds").value).toBe("user:Renamed");
  fireEvent.input(name, { target: { value: "Separate copy" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(loadUserSounds().map(sound => sound.name)).toEqual(["Renamed", "Separate copy"]);
  fireEvent.input(name, { target: { value: "Renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert").textContent).toContain("already exists");
  expect(loadUserSounds().map(sound => sound.name)).toEqual(["Renamed", "Separate copy"]);
});

it("shows Default until another sound is selected and restores edited state without recalling the saved patch", () => {
  const onApply = vi.fn();
  const defaults = BUILTIN_USER_SOUNDS[0];
  const initial = render(<UserSounds settings={{ ...defaults.settings, fluidsynth_preset: "0:0" }} onApply={onApply} />);
  expect(screen.getByLabelText("User sounds").value).toBe(builtinValue("Default"));
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  fireEvent.change(screen.getByLabelText("User sounds"), { target: { value: builtinValue("Hammond") } });
  fireEvent.input(screen.getByLabelText("Sound description"), { target: { value: "Working draft" } });
  initial.unmount();

  const hammond = BUILTIN_USER_SOUNDS.find(sound => sound.name === "Hammond");
  const restored = render(<UserSounds settings={{ ...hammond.settings, dsf_attack: 99 }} onApply={onApply} />);
  expect(screen.getByLabelText("User sounds").value).toBe(builtinValue("Hammond"));
  expect(screen.getByLabelText("Unsaved sound changes")).toBeTruthy();
  expect(screen.getByLabelText("Sound description").value).toBe("Working draft");
  expect(onApply).toHaveBeenCalledOnce();
  restored.unmount();

  localStorage.setItem(SOUND_RESTORE_KEY, "false");
  applyIOReloadPolicy({ navigationType: "reload" });
  expect(sessionStorage.getItem(ACTIVE_SOUND_KEY)).toBeNull();
  render(<UserSounds settings={defaults.settings} onApply={onApply} />);
  expect(screen.getByLabelText("User sounds").value).toBe(builtinValue("Default"));
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
});

it("restores a saved user sound and its local bank before the engine starts", () => {
  const onApply = vi.fn();
  const settings = { output_fluidsynth: true, fluidsynth_preset: "0:2" };
  localStorage.setItem("fluidsynth_last_soundfont_source", JSON.stringify({ name: "Local.sf2", url: "" }));
  const view = render(<UserSounds settings={settings} onApply={onApply} />);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Local organ" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  view.unmount();

  render(<UserSounds settings={settings} onApply={onApply} />);
  expect(screen.getByLabelText("User sounds").value).toBe("user:Local organ");
  expect(screen.queryByLabelText("Unsaved sound changes")).toBeNull();
  expect(loadUserSounds()[0].soundfont).toMatchObject({ name: "Local.sf2", preset: "0:2" });
  expect(onApply).not.toHaveBeenCalled();
});

it.each(["mouse", "keyboard"])("keeps the native picker stable during %s selection", input => {
  const onApply = vi.fn();
  const defaults = BUILTIN_USER_SOUNDS.find(sound => sound.name === "Default");
  const readTimbre = vi.fn(() => defaults.settings.dsf_timbre);
  const settings = { ...defaults.settings, get dsf_timbre() { return readTimbre(); } };
  const view = render(<UserSounds settings={settings} onApply={onApply} />);
  const picker = screen.getByRole("combobox", { name: "User sounds" });
  expect(picker.closest("label")).toBeNull();
  const observer = new MutationObserver(() => {});
  observer.observe(picker, { subtree: true, attributes: true, childList: true, characterData: true });
  readTimbre.mockClear();
  if (input === "mouse") {
    fireEvent.pointerDown(picker);
    fireEvent.mouseDown(picker);
  }
  act(() => picker.focus());
  if (input === "keyboard") fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
  expect(readTimbre).not.toHaveBeenCalled();

  // Browsing the native list is not the same as committing a patch change.
  picker.value = builtinValue("Hammond");
  view.rerender(<UserSounds settings={{ ...settings, dsf_timbre: 0.9 }} onApply={onApply} />);
  expect(screen.getByLabelText("Unsaved sound changes")).toBeTruthy();
  if (input === "mouse") fireEvent.mouseUp(picker);
  expect(screen.getByRole("combobox", { name: "User sounds" })).toBe(picker);
  expect(document.activeElement).toBe(picker);
  expect(picker.value).toBe(builtinValue("Hammond"));
  expect(onApply).not.toHaveBeenCalled();
  // A native popup may briefly take focus. This must not rename its options.
  act(() => picker.blur());
  expect(observer.takeRecords()).toEqual([]);
  observer.disconnect();

  fireEvent.change(picker, { target: { value: builtinValue("Harpsichord") } });
  expect(onApply).toHaveBeenCalledExactlyOnceWith(BUILTIN_USER_SOUNDS.find(sound => sound.name === "Harpsichord"));
  expect(picker.value).toBe(builtinValue("Harpsichord"));
});

it("restores the active sound in the native picker when recall fails", () => {
  const onApply = vi.fn(() => { throw new Error("Sound unavailable"); });
  render(<UserSounds settings={{}} onApply={onApply} />);
  const picker = screen.getByRole("combobox", { name: "User sounds" });
  fireEvent.change(picker, { target: { value: builtinValue("Harpsichord") } });
  expect(picker.value).toBe(builtinValue("Default"));
  expect(screen.getByRole("alert").textContent).toBe("Sound unavailable");
});

it("shows the dirty star between edits and excludes it from saved names", () => {
  const props = { settings: { dsf_attack: 37 }, onApply: vi.fn() };
  const view = render(<UserSounds {...props} />);
  const name = screen.getByLabelText("Sound name");
  fireEvent.input(name, { target: { value: "Warm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  view.rerender(<UserSounds {...props} settings={{ dsf_attack: 80 }} />);
  expect(name.value).toBe("Warm *");
  fireEvent.focus(name);
  expect(name.value).toBe("Warm");
  fireEvent.blur(name);
  expect(name.value).toBe("Warm *");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(name.value).toBe("Warm");
  view.rerender(<UserSounds {...props} settings={{ dsf_attack: 81 }} />);
  fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
  expect(loadUserSounds().map(sound => sound.name)).toEqual(["Warm", "Warm 2"]);
});
