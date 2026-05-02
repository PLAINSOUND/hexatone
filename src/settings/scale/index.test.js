/**
 * Tests for src/settings/scale/index.js (the Scale settings panel)
 *
 * The component always shows the ScaleTable. When "Edit Scala File"
 * is clicked, ScalaImport is shown alongside (not instead of) the table.
 * The ScalaImport cancel button is labelled "Hide".
 * The ScalaImport confirm button is labelled "Build Layout".
 */

import { render, screen, fireEvent } from "@testing-library/preact";
import Scale from "./index";

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
  center_degree: 0,
};

describe("Scale panel — default state", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("renders the scale table by default", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(document.querySelector("table")).not.toBeNull();
  });

  it('renders the "View and Edit Scala File" button', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(screen.getByRole("button", { name: /edit scala file/i })).not.toBeNull();
  });

  it("does not show the scala import textarea initially", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("highlights the Assigned Scale Degree row", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    const label = screen.getByText("Assigned Scale Degree").closest("label");
    expect(label?.classList.contains("reference-degree-row")).toBe(true);
  });

  it("keeps settings through Key Labels visible when the table is collapsed", () => {
    sessionStorage.setItem("hexatone_scale_collapsed", "true");
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByText("Equave")).not.toBeNull();
    expect(screen.getByText("Key Labels")).not.toBeNull();
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

describe("Scale panel — sort degrees", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("sorts interior degrees and remaps names, colors, reference degree, and center degree", () => {
    const onAtomicChange = vi.fn();
    render(
      <Scale
        settings={{
          ...minimalSettings,
          scale: ["700.", "100.", "500.", "2/1"],
          equivSteps: 4,
          note_names: ["root", "fifth", "second", "fourth"],
          note_colors: ["#000000", "#555555", "#111111", "#333333"],
          reference_degree: 2,
          center_degree: 3,
        }}
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        onImport={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sort degrees ascending/i }));

    expect(onAtomicChange).toHaveBeenCalledWith({
      scale: ["100.", "500.", "700.", "2/1"],
      note_names: ["root", "second", "fourth", "fifth"],
      note_colors: ["#000000", "#111111", "#333333", "#555555"],
      reference_degree: 1,
      center_degree: 2,
    });
  });

  it("reorders an interior degree by dragging its gutter onto another row", () => {
    const onAtomicChange = vi.fn();
    render(
      <Scale
        settings={{
          ...minimalSettings,
          scale: ["700.", "100.", "500.", "2/1"],
          equivSteps: 4,
          note_names: ["root", "fifth", "second", "fourth"],
          note_colors: ["#000000", "#555555", "#111111", "#333333"],
          reference_degree: 2,
          center_degree: 3,
        }}
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        onImport={() => {}}
      />,
    );

    const dragSource = screen.getByLabelText("scale degree gutter 3");
    const dropTarget = screen.getByLabelText("scale degree gutter 1").closest("tr");
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
    };

    fireEvent.dragStart(dragSource, { dataTransfer });
    fireEvent.dragEnter(dropTarget, { dataTransfer });
    fireEvent.dragOver(dropTarget, { dataTransfer });
    fireEvent.drop(dropTarget, { dataTransfer, clientY: 115 });

    expect(onAtomicChange).toHaveBeenCalledWith({
      scale: ["500.", "700.", "100.", "2/1"],
      note_names: ["root", "fourth", "fifth", "second"],
      note_colors: ["#000000", "#333333", "#555555", "#111111"],
      reference_degree: 3,
      center_degree: 1,
    });
  });

  it("uses the lower half of a row as an insert-after target", () => {
    const onAtomicChange = vi.fn();
    render(
      <Scale
        settings={{
          ...minimalSettings,
          scale: ["700.", "100.", "500.", "2/1"],
          equivSteps: 4,
          note_names: ["root", "fifth", "second", "fourth"],
          note_colors: ["#000000", "#555555", "#111111", "#333333"],
          reference_degree: 1,
          center_degree: 2,
        }}
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        onImport={() => {}}
      />,
    );

    const dragSource = screen.getByLabelText("scale degree gutter 1");
    const dropTarget = screen.getByLabelText("scale degree gutter 2").closest("tr");
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
    };

    vi.spyOn(dropTarget, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 20,
      left: 0,
      right: 0,
      bottom: 120,
      width: 0,
      x: 0,
      y: 100,
      toJSON: () => {},
    });

    fireEvent.dragStart(dragSource, { dataTransfer });
    fireEvent.dragEnter(dropTarget, { dataTransfer, clientY: 115 });
    fireEvent.dragOver(dropTarget, { dataTransfer, clientY: 115 });
    fireEvent.drop(dropTarget, { dataTransfer });

    expect(onAtomicChange).toHaveBeenCalledWith({
      scale: ["100.", "700.", "500.", "2/1"],
      note_names: ["root", "second", "fifth", "fourth"],
      note_colors: ["#000000", "#111111", "#555555", "#333333"],
      reference_degree: 2,
      center_degree: 1,
    });
  });

  it("selects a degree gutter and deletes that degree through the gutter action", () => {
    const onAtomicChange = vi.fn();
    render(
      <Scale
        settings={{
          ...minimalSettings,
          scale: ["700.", "100.", "500.", "2/1"],
          equivSteps: 4,
          note_names: ["root", "fifth", "second", "fourth"],
          note_colors: ["#000000", "#555555", "#111111", "#333333"],
          reference_degree: 2,
          center_degree: 3,
        }}
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        onImport={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("scale degree gutter 2"));
    fireEvent.click(screen.getByRole("button", { name: /delete scale degree 2/i }));

    expect(onAtomicChange).toHaveBeenCalledWith({
      equivSteps: 3,
      scale: ["700.", "500.", "2/1"],
      note_names: ["root", "fifth", "fourth"],
      note_colors: ["#000000", "#555555", "#333333"],
      reference_degree: 1,
      center_degree: 2,
    });
  });
});
