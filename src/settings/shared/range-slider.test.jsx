import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import CustomRangeSlider from "./range-slider.jsx";
import { dsfEnvelopeStep } from "../../dsf_synth/controls.js";

afterEach(cleanup);
it("snaps envelope times to progressively coarser steps and crosses keyboard boundaries", () => {
  const input = vi.fn();
  const { rerender } = render(<CustomRangeSlider min={0} max={4000} step={dsfEnvelopeStep}
    value={100} onInputValue={input} />);
  const slider = screen.getByRole("slider");
  slider.getBoundingClientRect = () => ({ left: 0, width: 4000 });
  pointer(slider, "pointerdown", 99);
  expect(input).toHaveBeenLastCalledWith(99);
  for (const [raw, expected] of [[103, 105], [497, 495], [537, 540], [1233, 1240], [4000, 4000]]) {
    pointer(slider, "pointermove", raw);
    expect(input).toHaveBeenLastCalledWith(expected);
  }
  pointer(slider, "pointerup", 100);
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(input).toHaveBeenLastCalledWith(105);
  fireEvent.keyDown(slider, { key: "ArrowLeft" });
  expect(input).toHaveBeenLastCalledWith(99);
  rerender(<CustomRangeSlider min={0} max={4000} step={dsfEnvelopeStep}
    value={500} onInputValue={input} />);
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(input).toHaveBeenLastCalledWith(510);
  fireEvent.keyDown(slider, { key: "ArrowLeft" });
  expect(input).toHaveBeenLastCalledWith(495);
});
it.each([2000, 4000])("uses matching linear short-time travel with a %i ms maximum", max => {
  const input = vi.fn();
  render(<CustomRangeSlider ariaLabel="envelope" min={0} max={max} step={1}
    knee={{ value: 100, position: 0.4 }} value={100} onInputValue={input} />);
  const slider = screen.getByRole("slider");
  slider.getBoundingClientRect = () => ({ left: 0, width: 1000 });
  expect(slider.querySelector(".settings-range-slider__thumb").style.left).toBe("40%");
  pointer(slider, "pointerdown", 0);
  expect(input).toHaveBeenLastCalledWith(0);
  pointer(slider, "pointermove", 4);
  expect(input).toHaveBeenLastCalledWith(1);
  pointer(slider, "pointermove", 200);
  expect(input).toHaveBeenLastCalledWith(50);
  pointer(slider, "pointermove", 400);
  expect(input).toHaveBeenLastCalledWith(100);
  pointer(slider, "pointermove", 700);
  expect(input).toHaveBeenLastCalledWith((100 + max) / 2);
  pointer(slider, "pointerup", 1000);
  expect(input).toHaveBeenLastCalledWith(max);
});
it("gives short envelope times more mouse travel while retaining endpoints and unit keyboard steps", () => {
  const input = vi.fn();
  render(<CustomRangeSlider ariaLabel="attack" min={0} max={2000} step={1}
    exponent={3} value={250} onInputValue={input} />);
  const slider = screen.getByRole("slider");
  slider.getBoundingClientRect = () => ({ left: 0, width: 1000 });
  expect(slider.querySelector(".settings-range-slider__thumb").style.left).toBe("50%");
  pointer(slider, "pointerdown", 100);
  expect(input).toHaveBeenLastCalledWith(2);
  pointer(slider, "pointermove", 500);
  expect(input).toHaveBeenLastCalledWith(250);
  pointer(slider, "pointermove", 0);
  expect(input).toHaveBeenLastCalledWith(0);
  pointer(slider, "pointerup", 1000);
  expect(input).toHaveBeenLastCalledWith(2000);
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(input).toHaveBeenLastCalledWith(251);
});

it("maps partial counts smoothly without losing integer resolution", () => {
  const input = vi.fn();
  render(<CustomRangeSlider ariaLabel="partials" min={1} max={1024} step={1}
    exponent={2} value={1} onInputValue={input} />);
  const slider = screen.getByRole("slider");
  slider.getBoundingClientRect = () => ({ left: 0, width: 1000 });
  pointer(slider, "pointerdown", 250);
  expect(input).toHaveBeenLastCalledWith(65);
  pointer(slider, "pointerup", 1000);
  expect(input).toHaveBeenLastCalledWith(1024);
});
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
