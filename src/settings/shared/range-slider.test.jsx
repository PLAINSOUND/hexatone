import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import CustomRangeSlider from "./range-slider.jsx";

afterEach(cleanup);
function pointer(slider, type, clientX) {
  const event = new MouseEvent(type.replace("pointer", "Pointer").replace(/(down|move|up)$/, part => part[0].toUpperCase() + part.slice(1)), { bubbles: true, clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(slider, event);
}
it("sticks to an off-center default until pulled outside its release zone", () => {
  const input = vi.fn();
  render(<CustomRangeSlider ariaLabel="test" min={0} max={1} step={1 / 127}
    value={0.2} defaultValue={0.2} onInputValue={input} />);
  const slider = screen.getByRole("slider");
  slider.getBoundingClientRect = () => ({ left: 0, width: 1000 });
  expect(slider.getAttribute("aria-valuenow")).toBe("0.2");
  pointer(slider, "pointerdown", 205);
  expect(input).toHaveBeenLastCalledWith(0.2);
  pointer(slider, "pointermove", 220);
  expect(input).toHaveBeenLastCalledWith(0.2);
  pointer(slider, "pointermove", 240);
  expect(input.mock.calls.at(-1)[0]).toBeGreaterThan(0.2);
  pointer(slider, "pointermove", 200);
  expect(input).toHaveBeenLastCalledWith(0.2);
  pointer(slider, "pointerup", 200);
  expect(input).toHaveBeenLastCalledWith(0.2);
});

it("retains full travel and precise keyboard steps", () => {
  const input = vi.fn();
  render(<CustomRangeSlider ariaLabel="test" min={0} max={127} step={1}
    value={64} defaultValue={64} onInputValue={input} />);
  const slider = screen.getByRole("slider");
  slider.getBoundingClientRect = () => ({ left: 0, width: 127 });
  pointer(slider, "pointerdown", 0);
  expect(input).toHaveBeenLastCalledWith(0);
  pointer(slider, "pointerup", 127);
  expect(input).toHaveBeenLastCalledWith(127);
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(input).toHaveBeenLastCalledWith(65);
});
