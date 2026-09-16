import { render, screen, fireEvent } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import SampleSynth from "./index.js";

describe("Built-in Sounds audio activation", () => {
  it("uses the supplied activation handler and hides once activated", () => {
    const activateAudioContext = vi.fn();
    const props = { settings: { output_sample: false }, onChange: vi.fn(), activateAudioContext };
    const { rerender } = render(<SampleSynth {...props} showActivateAudioContext />);
    const button = screen.getByRole("button", { name: "Activate Audio Context" });
    expect(button.closest("fieldset").querySelector("legend").textContent).toBe("Built-in Sounds");
    fireEvent.click(button);
    expect(activateAudioContext).toHaveBeenCalledOnce();
    rerender(<SampleSynth {...props} showActivateAudioContext={false} />);
    expect(screen.queryByRole("button", { name: "Activate Audio Context" })).toBeNull();
  });
});
