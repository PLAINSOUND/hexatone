import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, expect, it, vi } from "vitest";
import UserSounds from "./user-sounds.jsx";
import { loadUserSounds } from "../persistence/user-sounds.js";
vi.mock("../fluidsynth_synth/index.js", () => ({ peekFluidSynthEngine: () => null }));
beforeEach(() => localStorage.clear());

it("saves, names, copies, recalls and deletes sound snapshots", () => {
  const onApply = vi.fn();
  render(<UserSounds settings={{ dsf_attack: 37 }} oscBrightness={0.4} onApply={onApply} />);
  expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
  fireEvent.input(screen.getByLabelText("Sound name"), { target: { value: "Warm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    "Choose a sound:", "Default", "Test Tone", "──────────",
  ]);
  fireEvent.change(menu, { target: { value: "builtin:1" } });
  expect(onApply.mock.calls[0][0].settings).toMatchObject({
    output_dsf: true, output_sample: false, output_fluidsynth: false, output_osc: false,
    dsf_volume: 0.5, dsf_timbre: 0, dsf_volumeEnvelope: false, dsf_timbreEnvelope: false,
    dsf_velocityVolume: 0, dsf_velocityTimbre: 0, dsf_pressure: false, dsf_timbreResponse: false,
  });
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  fireEvent.change(menu, { target: { value: "builtin:0" } });
  expect(onApply.mock.calls[1][0].settings).toMatchObject({
    dsf_timbre: 0.25, dsf_attack: 12, dsf_volumeEnvelope: true,
  });
  expect(loadUserSounds()).toEqual([]);
});

it("requires a copy of built-in sounds before allowing Save", () => {
  render(<UserSounds settings={{}} onApply={vi.fn()} />);
  const menu = screen.getByLabelText("User sounds");
  for (const value of ["builtin:0", "builtin:1"]) {
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
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
