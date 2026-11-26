import { fireEvent, render, screen, act } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import OutputPortPicker from "./output-port-picker.js";
afterEach(() => vi.useRealTimers());

it.each([false, true])("focuses an opened port picker once rather than on every MIDI update (inline=%s)", inline => {
  vi.useFakeTimers();
  const props = { label: "LED Output", inline, outputs: new Map([["exquis", { id: "exquis", name: "Exquis" }]]), onChange: vi.fn() };
  const view = render(<OutputPortPicker {...props} />);
  fireEvent.click(screen.getByText("Not found — click to choose"));
  const menu = screen.getByRole("combobox");
  act(() => vi.runOnlyPendingTimers());
  expect(document.activeElement).toBe(menu);
  const focus = vi.spyOn(menu, "focus");
  view.rerender(<OutputPortPicker {...props} outputs={new Map(props.outputs)} />);
  act(() => vi.runOnlyPendingTimers());
  expect(screen.getByRole("combobox")).toBe(menu);
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});

it("releases focus when the user moves to another MIDI menu", () => {
  vi.useFakeTimers();
  const view = render(<div>
    <OutputPortPicker label="LED Output" outputs={new Map()} onChange={vi.fn()} />
    <select aria-label="Controller Geometry"><option>Exquis</option><option>Lumatone</option></select>
  </div>);
  fireEvent.click(screen.getByText("Not found — click to choose"));
  act(() => vi.runOnlyPendingTimers());
  const geometry = screen.getByLabelText("Controller Geometry");
  act(() => geometry.focus());
  act(() => vi.runOnlyPendingTimers());
  expect(document.activeElement).toBe(geometry);
  expect(screen.getByText("Not found — click to choose")).toBeTruthy();
  view.unmount();
  act(() => vi.runOnlyPendingTimers());
});
