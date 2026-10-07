import { render, screen } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import SampleSynth from "./index.js";

afterEach(() => localStorage.removeItem("synth_volume"));

it("uses the shared output fader styling and half-volume default", () => {
  localStorage.removeItem("synth_volume");
  const { container } = render(
    <SampleSynth settings={{ output_sample: true, instrument: "OFF" }}
      instruments={[]} onChange={vi.fn()} />,
  );
  expect(container.querySelector("fieldset").classList.contains("output-routing-fieldset")).toBe(true);
  expect(screen.getByRole("slider", { name: "Volume" }).getAttribute("aria-valuenow")).toBe("0.5");
  expect(container.querySelector(".settings-form__range-value--short")).toBeNull();
});
