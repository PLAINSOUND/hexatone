import { afterEach, expect, it, vi } from "vitest";
import { createExquisModeGate } from "./exquis-mode-gate.js";
afterEach(() => vi.useRealTimers());
it("postpones a queued transition when another pad is pressed before the timer runs", () => {
  vi.useFakeTimers();
  const gate = createExquisModeGate(), commit = vi.fn();
  gate.message({ data: [0x90, 60, 100] });
  gate.defer("midi_passthrough", true, false, commit);
  gate.message({ data: [0x80, 60, 0] });
  gate.message({ data: [0x90, 62, 100] });
  vi.runAllTimers();
  expect(commit).not.toHaveBeenCalled();
  gate.message({ data: [0x80, 62, 0] });
  vi.runAllTimers();
  expect(commit).toHaveBeenCalledOnce();
});
it("defers either mode direction until all pads release and the note-off dispatch completes", () => {
  vi.useFakeTimers();
  const status = vi.fn(), commit = vi.fn();
  const gate = createExquisModeGate(status);
  for (const direction of [true, false]) {
    gate.message({ data: [0x91, 60, 100] });
    gate.message({ data: [0x91, 60, 100] }); // duplicate is one physical hold
    gate.message({ data: [0x92, 61, 100] });
    expect(gate.defer("midi_passthrough", direction, !direction, commit)).toBe(true);
    expect(status).toHaveBeenLastCalledWith(true, { midi_passthrough: direction });
    gate.message({ data: [0x81, 60, 0] });
    vi.runAllTimers();
    expect(commit).not.toHaveBeenCalled();
    gate.message({ data: [0x92, 61, 0] });
    expect(commit).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(commit).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith(false, {});
    commit.mockClear();
  }
});
it("cancels a pending selection when reselected, on disconnect, or when superseded after release", () => {
  vi.useFakeTimers();
  const gate = createExquisModeGate(), commit = vi.fn();
  gate.message({ data: [0x90, 60, 100] });
  gate.defer("midiin_mapping_target", "scale", "hex_layout", commit);
  gate.defer("midiin_mapping_target", "hex_layout", "hex_layout", commit);
  gate.message({ data: [0x80, 60, 0] });
  vi.runAllTimers();
  expect(commit).not.toHaveBeenCalled();
  gate.message({ data: [0x90, 60, 100] });
  gate.defer("midi_passthrough", true, false, commit);
  gate.message({ data: [0x80, 60, 0] });
  expect(gate.defer("midi_passthrough", false, false, commit)).toBe(false);
  vi.runAllTimers();
  expect(commit).not.toHaveBeenCalled();
  gate.message({ data: [0x90, 60, 100] });
  gate.defer("midi_passthrough", true, false, commit);
  gate.reset();
  vi.runAllTimers();
  expect(commit).not.toHaveBeenCalled();
});
