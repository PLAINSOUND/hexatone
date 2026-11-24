import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import DsfSettings from "./dsf-settings.jsx";

afterEach(() => { cleanup(); localStorage.removeItem("dsf_iso226"); });
it("replaces the ISO checkbox with a persisted percentage fader", () => {
  const onChange = vi.fn();
  const view = render(<DsfSettings settings={{ output_dsf: true, dsf_iso226: .5 }} onChange={onChange} />);
  expect(screen.queryByRole("checkbox", { name: /ISO/ })).toBeNull();
  const slider = screen.getByRole("slider", { name: "DSF ISO-226 compensation amount" });
  expect(slider.getAttribute("aria-valuenow")).toBe("0.5");
  expect(screen.getByText("50%")).toBeTruthy();
  fireEvent.keyDown(slider, { key: "Home" });
  expect(onChange).toHaveBeenLastCalledWith("dsf_iso226", 0);
  expect(localStorage.getItem("dsf_iso226")).toBe("0");
  view.rerender(<DsfSettings settings={{ output_dsf: true, dsf_iso226: 0 }} onChange={onChange} />);
  fireEvent.keyDown(slider, { key: "End" });
  expect(onChange).toHaveBeenLastCalledWith("dsf_iso226", 1);
});
