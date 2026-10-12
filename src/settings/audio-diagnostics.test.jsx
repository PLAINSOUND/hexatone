import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import AudioDiagnostics from "./audio-diagnostics.jsx";
import { setTouchInputMode } from "../keyboard/touch-input-mode.js";
import { getLatencyMeasurementEnabled, setLatencyMeasurementEnabled, audioRuntimeReport } from "../audio/runtime-diagnostics.js";

afterEach(() => { cleanup(); setTouchInputMode("auto"); setLatencyMeasurementEnabled(false); });
it("recreates contexts and marks a fourth pass without clearing measurements", async () => {
  let finish;
  const recreate = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  render(<AudioDiagnostics keysRef={{ current: null }} onRecreateContexts={recreate} />);
  fireEvent.click(screen.getByRole("button", { name: "Show Audio Diagnostics settings" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Measure audio latency" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark Baseline" }));
  const button = screen.getByRole("button", { name: "Recreate audio contexts" });
  fireEvent.click(button);
  expect(recreate).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(true);
  finish();
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(audioRuntimeReport().testStages.map(stage => stage.label)).toEqual(["Baseline", "Contexts recreated"]);
});
it("keeps latency measurement opt-in", () => {
  render(<AudioDiagnostics keysRef={{ current: null }} />);
  fireEvent.click(screen.getByRole("button", { name: "Show Audio Diagnostics settings" }));
  const toggle = screen.getByRole("checkbox", { name: "Measure audio latency" });
  expect(toggle.checked).toBe(false);
  fireEvent.click(toggle);
  expect(getLatencyMeasurementEnabled()).toBe(true);
  fireEvent.click(toggle);
  expect(getLatencyMeasurementEnabled()).toBe(false);
});
it("switches input immediately and saves through the existing report action", () => {
  const configureTouchInput = vi.fn();
  const save = vi.fn();
  render(<AudioDiagnostics keysRef={{ current: { configureTouchInput } }} onSaveReport={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Show Audio Diagnostics settings" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "pointer" } });
  expect(configureTouchInput).toHaveBeenCalledWith("pointer");
  fireEvent.click(screen.getByRole("button", { name: "Save audio report" }));
  expect(save).toHaveBeenCalledOnce();
});

it("starts collapsed and keeps measurement state when closed", () => {
  render(<AudioDiagnostics keysRef={{ current: null }} />);
  const disclosure = screen.getByRole("button", { name: "Show Audio Diagnostics settings" });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(disclosure);
  fireEvent.click(screen.getByRole("checkbox", { name: "Measure audio latency" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide Audio Diagnostics settings" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(getLatencyMeasurementEnabled()).toBe(true);
});

it("marks all three comparison passes without clearing earlier stages", () => {
  render(<AudioDiagnostics keysRef={{ current: null }} />);
  fireEvent.click(screen.getByRole("button", { name: "Show Audio Diagnostics settings" }));
  expect(screen.getByRole("button", { name: "Mark Baseline" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Measure audio latency" }));
  for (const label of ["Baseline", "FluidSynth loaded", "SoundFont OFF"])
    fireEvent.click(screen.getByRole("button", { name: `Mark ${label}` }));
  expect(audioRuntimeReport().testStages.map(stage => stage.label)).toEqual(["Baseline", "FluidSynth loaded", "SoundFont OFF"]);
  expect(screen.getByRole("status").textContent).toContain("SoundFont OFF");
});
