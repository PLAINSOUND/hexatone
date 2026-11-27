/**
 * Tests for src/settings/scale/index.js (the Scale settings panel)
 *
 * The expanded component shows the ScaleTable. When "Edit Scala File"
 * is clicked, ScalaImport is shown alongside (not instead of) the table.
 * The ScalaImport cancel button is labelled "Hide".
 * The ScalaImport confirm button is labelled "Build Layout".
 */

import { render, screen, fireEvent } from "@testing-library/preact";
import Scale from "./index";
import { bindCanvasInputFocus } from "../../keyboard/keys-browser-input.js";

beforeEach(() => sessionStorage.setItem("hexatone_scale_collapsed", "false"));

const minimalSettings = {
  fundamental: 440,
  reference_degree: 0,
  equivSteps: 12,
  scale: [
    "100.",
    "200.",
    "300.",
    "400.",
    "500.",
    "600.",
    "700.",
    "800.",
    "900.",
    "1000.",
    "1100.",
    "1200.",
  ],
  key_labels: "no_labels",
  spectrum_colors: true,
  fundamental_color: "#ffffff",
  note_colors: Array(12).fill("#ffffff"),
  note_names: Array(12).fill(""),
};

describe("Scale panel — default state", () => {
  it("retains the activated canvas keyboard through TuneCell drags and suspends it for pitch typing", () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const keys = { state: { canvas, canvasInputFocused: false },
      releaseAllKeyboardNotes: vi.fn(), sustainOff: vi.fn(), setTuneDragging: vi.fn(),
      updateScaleDegree: vi.fn(), previewDegree0: vi.fn() };
    const unbind = bindCanvasInputFocus(keys);
    try {
      const { container } = render(<Scale settings={minimalSettings} onChange={() => {}}
        onImport={() => {}} keysRef={{ current: keys }} />);
      canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      const handle = container.querySelectorAll(".tune-cell .tune-handle")[1];
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 105 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 105 });
      expect(keys.state.canvasInputFocused).toBe(true);
      expect(keys.releaseAllKeyboardNotes).not.toHaveBeenCalled();
      expect(keys.setTuneDragging).toHaveBeenCalledWith(true);
      expect(keys.setTuneDragging).toHaveBeenCalledWith(false);
      expect(keys.updateScaleDegree).toHaveBeenCalled();
      screen.getByLabelText("pitch value 0").focus();
      expect(keys.state.canvasInputFocused).toBe(false);
      expect(keys.releaseAllKeyboardNotes).toHaveBeenCalled();
      expect(keys.sustainOff).toHaveBeenCalledWith(true, { releaseShiftLatches: true });
    } finally { unbind(); canvas.remove(); }
  });

  it("renders the scale table with a remembered expanded state", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(document.querySelector("table")).not.toBeNull();
  });

  it('renders the "Edit Scala File" button', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(screen.getByRole("button", { name: /edit scala file/i })).not.toBeNull();
  });

  it("does not show the scala import textarea initially", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

describe("Scale panel — clicking import", () => {
  it("shows the import panel (with textarea) when the button is clicked", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /edit scala file/i }));
    // ScalaImport renders alongside the table, not instead of it
    expect(document.querySelector("textarea")).not.toBeNull();
  });
});

describe("Scale panel — cancelling import", () => {
  it('hides the import panel when "Hide" is clicked', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /edit scala file/i }));
    fireEvent.click(screen.getByRole("button", { name: /^✕$/ }));
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("does not call onImport when cancelled", () => {
    const onImport = vi.fn();
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={onImport} />);
    fireEvent.click(screen.getByRole("button", { name: /edit scala file/i }));
    fireEvent.click(screen.getByRole("button", { name: /^✕$/ }));
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("Scale panel — completing import", () => {
  it("calls onImport and hides the import panel", () => {
    const onImport = vi.fn();
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={onImport} />);
    fireEvent.click(screen.getByRole("button", { name: /edit scala file/i }));
    fireEvent.click(screen.getByRole("button", { name: /build layout/i }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
