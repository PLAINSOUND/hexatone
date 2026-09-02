/**
 * Tests for src/settings/scale/index.js (the Scale settings panel)
 *
 * The component always shows the ScaleTable. When "Edit Scala File"
 * is clicked, ScalaImport is shown alongside (not instead of) the table.
 * The ScalaImport cancel button is labelled "Hide".
 * The ScalaImport confirm button is labelled "Build Layout".
 */

import { render, screen, fireEvent } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { normalizeColors } from "../normalize-settings.js";
import useSettingsChange from "../../hooks/use-settings-change.js";
vi.mock("./fundamental-tune-cell.js", () => ({
  default: ({ onPreviewChange }) => (
    <div class="tune-cell--inline">
      <button
        type="button"
        title="preview reference frequency"
        onClick={() => onPreviewChange?.(50, false)}
      >
        preview
      </button>
      <button
        type="button"
        title="compare reference frequency"
        onClick={() => onPreviewChange?.(50, true)}
      >
        compare
      </button>
    </div>
  ),
}));
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

const fireDragEventWithClientY = (element, type, { dataTransfer, clientY }) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(element, event);
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

  it('renders the "Add Scale Degree" button and increments scale size on click', () => {
    const onChange = vi.fn();
    render(<Scale settings={minimalSettings} onChange={onChange} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /add scale degree/i }));

    expect(onChange).toHaveBeenCalledWith("equivSteps", 13);
  });

  it("renders blank-surface values as inactive hints while leaving surface creation active", () => {
    const onChange = vi.fn();
    render(
      <Scale
        settings={{ ...minimalSettings, scale: null, equivSteps: 1 }}
        hasMusicalSurface={false}
        onChange={onChange}
        onImport={() => {}}
      />,
    );

    expect(
      screen
        .getByText("Scale Settings")
        .closest("fieldset")
        .classList.contains("settings-fieldset--blank-surface"),
    ).toBe(true);
    expect(screen.getByLabelText("reference frequency").disabled).toBe(true);
    expect(screen.getByLabelText("Assigned Scale Degree").disabled).toBe(true);
    expect(screen.getByLabelText("degree 0 frequency").disabled).toBe(true);
    expect(screen.getByLabelText("equave").disabled).toBe(true);
    expect(screen.getByLabelText("Scale Size").disabled).toBe(false);
    expect(screen.getByLabelText("Scale Size").value).toBe("0");
    expect(document.querySelector(".scale-table__equave-label")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add scale degree/i }));
    expect(onChange).toHaveBeenCalledWith("equivSteps", 1);

    const scaleSize = screen.getByLabelText("Scale Size");
    fireEvent.input(scaleSize, { target: { value: "1" } });
    fireEvent.blur(scaleSize);
    expect(onChange).toHaveBeenCalledWith("equivSteps", 1);
  });

  it("shows the tuning save action below the scale actions when the primary save is out of view", () => {
    const save = vi.fn();
    render(
      <Scale
        settings={minimalSettings}
        onChange={() => {}}
        onImport={() => {}}
        primaryTuningSaveVisible={false}
        tuningSaveActionState={{
          visible: true,
          label: "Save current settings",
          action: save,
        }}
      />,
    );

    const scaleActions = screen
      .getByRole("button", { name: /edit scala file/i })
      .closest(".settings-form__action-group");
    const stickySave = screen.getByRole("button", { name: "Save current settings" });

    expect(
      scaleActions.compareDocumentPosition(stickySave) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(stickySave);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("hides the tuning save duplicate while the primary save is visible", () => {
    render(
      <Scale
        settings={minimalSettings}
        onChange={() => {}}
        onImport={() => {}}
        primaryTuningSaveVisible
        tuningSaveActionState={{
          visible: true,
          label: "Save current settings",
          action: vi.fn(),
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Save current settings" })).toBeNull();
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
    expect(screen.getByLabelText("Modulation Style")).not.toBeNull();
  });

  it("defaults Modulation Style to fixed Do when no setting is present", () => {
    const settingsWithoutStyle = { ...minimalSettings };
    delete settingsWithoutStyle.modulation_style;
    render(<Scale settings={settingsWithoutStyle} onChange={() => {}} onImport={() => {}} />);

    expect(screen.getByLabelText("Modulation Style").value).toBe("fixed_do");
  });

  it("keeps Modulation Style interactive when the table is collapsed", () => {
    sessionStorage.setItem("hexatone_scale_collapsed", "true");
    const onChange = vi.fn();
    render(<Scale settings={minimalSettings} onChange={onChange} onImport={() => {}} />);

    fireEvent.change(screen.getByLabelText("Modulation Style"), {
      target: { value: "fixed_do" },
    });

    expect(onChange).toHaveBeenCalledWith("modulation_style", "fixed_do");
  });

  it("keeps Key Colours togglable when the table is collapsed", () => {
    sessionStorage.setItem("hexatone_scale_collapsed", "true");

    const Wrapper = () => {
      const [settings, setSettings] = useState({
        ...minimalSettings,
        spectrum_colors: true,
        auto_colors: false,
        scale: ["23/16", "2/1"],
        equivSteps: 2,
        note_colors: ["#ffffff", "#ffffff"],
        note_names: ["1/1", "23"],
        key_labels: "note_names",
      });
      return (
        <Scale
          settings={{ ...settings, ...normalizeColors(settings) }}
          rawSettings={settings}
          onChange={(key, value) => setSettings((prev) => ({ ...prev, [key]: value }))}
          onImport={() => {}}
        />
      );
    };

    render(<Wrapper />);

    const selector = screen.getByLabelText("Key Colours");
    expect(selector.value).toBe("spectrum");

    fireEvent.change(selector, { target: { value: "auto" } });
    expect(screen.getByLabelText("Key Colours").value).toBe("auto");

    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "manual" } });
    expect(screen.getByLabelText("Key Colours").value).toBe("manual");
  });

  it("repaints back to stored colours when auto colours is turned off while collapsed", () => {
    sessionStorage.setItem("hexatone_scale_collapsed", "true");
    const updateColors = vi.fn();

    const Wrapper = () => {
      const [settings, setSettings] = useState({
        ...minimalSettings,
        spectrum_colors: false,
        auto_colors: true,
        scale: ["23/16", "2/1"],
        equivSteps: 2,
        note_colors: ["#112233", "#445566"],
        note_names: ["1/1", "23"],
        key_labels: "note_names",
      });
      const { onChange, onAtomicChange } = useSettingsChange(settings, setSettings, {
        midi: null,
        setMidiLearnActive: vi.fn(),
        setHakenPedalLearnActive: vi.fn(),
        keysRef: { current: { updateColors } },
        setLatch: vi.fn(),
        bumpImportCount: vi.fn(),
        onUserScaleEdit: vi.fn(),
      });
      const colorSettings = normalizeColors(settings);
      return (
        <>
          <Scale
            settings={{ ...settings, ...colorSettings }}
            rawSettings={settings}
            onChange={onChange}
            onAtomicChange={onAtomicChange}
            onImport={() => {}}
            keysRef={{ current: { updateColors } }}
          />
          <button type="button" onClick={() => updateColors(colorSettings)}>
            sync keyboard colors
          </button>
        </>
      );
    };

    render(<Wrapper />);

    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "manual" } });
    fireEvent.click(screen.getByRole("button", { name: /sync keyboard colors/i }));

    expect(screen.getByLabelText("Key Colours").value).toBe("manual");
    expect(updateColors.mock.calls.at(-1)[0]).toMatchObject({
      note_colors: ["112233", "445566"],
      spectrum_colors: false,
    });
  });

  it("shows the effective scale size from the current scale when equivSteps is stale", () => {
    const onChange = vi.fn();
    render(
      <Scale
        settings={{
          ...minimalSettings,
          equivSteps: 12,
          scale: ["2/1"],
        }}
        onChange={onChange}
        onImport={() => {}}
      />,
    );

    expect(screen.getByLabelText("Scale Size").value).toBe("1");
    expect(screen.queryByText("Divide Equave into 1 Equal Divisions")).toBeNull();
    expect(screen.queryByText("Divide Octave into 1 Equal Divisions")).toBeNull();

    const scaleSize = screen.getByLabelText("Scale Size");
    fireEvent.input(scaleSize, { target: { value: "0" } });
    fireEvent.blur(scaleSize);
    expect(onChange).toHaveBeenCalledWith("equivSteps", 0);
  });

  it("shows rounded reference frequency normally but full precision on focus", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);

    const frequencyInput = screen.getByLabelText("reference frequency");
    expect(frequencyInput.value).toBe("440.0");

    fireEvent.focus(frequencyInput);
    expect(frequencyInput.value).toBe("440.000000");
  });

  it("commits a descending equave ratio and keeps the typed form visible", () => {
    const onChange = vi.fn();
    render(<Scale settings={minimalSettings} onChange={onChange} onImport={() => {}} />);

    const equaveInput = screen.getByLabelText("equave");
    fireEvent.input(equaveInput, { target: { value: "1/2" } });
    fireEvent.blur(equaveInput);

    expect(equaveInput.value).toBe("1/2");
    expect(onChange).toHaveBeenCalledWith(
      "scale",
      expect.arrayContaining([expect.any(String), "1/2"]),
    );
  });

  it("shows the computed frequency of 1/1 from the assigned reference degree", () => {
    render(
      <Scale
        settings={{ ...minimalSettings, fundamental: 440, reference_degree: 9 }}
        onChange={() => {}}
        onImport={() => {}}
      />,
    );

    expect(screen.getByLabelText("degree 0 frequency").value).toBe("261.6");
  });

  it("updates reference frequency when the computed 1/1 frequency is edited", () => {
    const onChange = vi.fn();
    render(
      <Scale
        settings={{ ...minimalSettings, fundamental: 440, reference_degree: 9 }}
        onChange={onChange}
        onImport={() => {}}
      />,
    );

    const degreeZeroInput = screen.getByLabelText("degree 0 frequency");
    fireEvent.focus(degreeZeroInput);
    fireEvent.input(degreeZeroInput, { target: { value: "220" } });
    fireEvent.blur(degreeZeroInput);

    expect(onChange).toHaveBeenCalledWith("fundamental", expect.any(Number));
    expect(onChange.mock.calls.at(-1)[1]).toBeCloseTo(220 * Math.pow(2, 900 / 1200), 6);
  });

  it("retunes all linked frequencies when spelling frequency is edited in 36ed2", () => {
    const scale36ed2 = Array.from({ length: 36 }, (_, index) =>
      (((index + 1) * 1200) / 36).toFixed(1),
    );

    const Wrapper = () => {
      const [settings, setSettings] = useState({
        ...minimalSettings,
        scale: scale36ed2,
        equivSteps: 36,
        reference_degree: 27,
        note_names: Array(36).fill(""),
        note_colors: Array(36).fill("#ffffff"),
        heji_anchor_ratio: "",
        heji_anchor_label: "",
        heji_anchor_frequency: "",
      });
      return (
        <Scale
          settings={settings}
          heji_anchor_ratio_eff="1/1"
          heji_anchor_label_eff="A"
          onChange={(key, value) =>
            setSettings((current) => ({ ...current, [key]: value }))
          }
          onAtomicChange={(updates) =>
            setSettings((current) => ({ ...current, ...updates }))
          }
          onImport={() => {}}
        />
      );
    };

    render(<Wrapper />);

    const ratioInput = screen.getByLabelText("Ratio/Cents from 1/1 (scale degree 0)");
    fireEvent.input(ratioInput, { target: { value: "400." } });
    fireEvent.blur(ratioInput);

    const spellingInput = screen.getByLabelText("Notation (Spelling)");
    fireEvent.input(spellingInput, { target: { value: "E" } });
    fireEvent.blur(spellingInput);

    const spellingFrequencyInput = screen.getByLabelText("Spelling Frequency");
    fireEvent.focus(spellingFrequencyInput);
    fireEvent.input(spellingFrequencyInput, { target: { value: "330" } });
    fireEvent.blur(spellingFrequencyInput);

    expect(screen.getByLabelText("reference frequency").value).toBe("440.5");
    expect(screen.getByLabelText("degree 0 frequency").value).toBe("261.9");
    expect(screen.getByLabelText("pitch frequency 12").value).toBe("330.0");
  });

  it("live-updates the reference frequency and scale frequencies during a reference tune drag", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);

    let referenceInput = screen.getByLabelText("reference frequency");
    let degreeZeroComputedInput = screen.getByLabelText("degree 0 frequency");
    let degreeZeroFrequency = screen.getByLabelText("pitch frequency 0");

    expect(referenceInput.value).toBe("440.0");
    expect(degreeZeroComputedInput.value).toBe("440.0");
    expect(degreeZeroFrequency.value).toBe("440.0");

    fireEvent.click(screen.getByTitle("preview reference frequency"));

    referenceInput = screen.getByLabelText("reference frequency");
    degreeZeroComputedInput = screen.getByLabelText("degree 0 frequency");
    degreeZeroFrequency = screen.getByLabelText("pitch frequency 0");
    expect(referenceInput.style.color).toBe("rgb(153, 0, 0)");
    expect(referenceInput.value).not.toBe("440.0");
    expect(degreeZeroComputedInput.value).toBe(referenceInput.value);
    expect(degreeZeroFrequency.value).toBe(referenceInput.value);
  });

  it("shows the original reference frequency in dark red while comparing a tune preview", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByTitle("preview reference frequency"));
    fireEvent.click(screen.getByTitle("compare reference frequency"));

    const referenceInput = screen.getByLabelText("reference frequency");
    expect(referenceInput.value).toBe("440.0");
    expect(referenceInput.style.color).toBe("rgb(102, 0, 0)");
    expect(referenceInput.style.fontStyle).toBe("italic");
  });

  it("clears the reference tune preview when the scale reset token changes", () => {
    const { rerender } = render(
      <Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} importCount={0} />,
    );

    fireEvent.click(screen.getByTitle("preview reference frequency"));

    let referenceInput = screen.getByLabelText("reference frequency");
    expect(referenceInput.style.color).toBe("rgb(153, 0, 0)");

    rerender(
      <Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} importCount={1} />,
    );

    referenceInput = screen.getByLabelText("reference frequency");
    expect(referenceInput.value).toBe("440.0");
    expect(referenceInput.style.color).toBe("");
    expect(referenceInput.style.fontStyle).toBe("");
  });
});

describe("Scale panel — clicking import", () => {
  it("shows the import panel (with textarea) when the button is clicked", () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /edit scala file/i }));
    // ScalaImport renders alongside the table, not instead of it
    expect(document.querySelector("textarea")).not.toBeNull();
  });

  it("warns and disables Scala exports when the scale contains negative values", () => {
    render(
      <Scale
        settings={{
          ...minimalSettings,
          scale: ["-100.", "2/1"],
          equivSteps: 2,
        }}
        onChange={() => {}}
        onImport={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /edit scala file/i }));

    expect(
      screen.getByText(/negative scale values are not supported in scala export/i),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save .scl" }).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "Save .ascl" })[0].disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Save .kbm" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Save .json" }).disabled).toBe(false);
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
    fireDragEventWithClientY(dropTarget, "drop", { dataTransfer, clientY: 115 });

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
    fireDragEventWithClientY(dropTarget, "dragenter", { dataTransfer, clientY: 115 });
    fireDragEventWithClientY(dropTarget, "dragover", { dataTransfer, clientY: 115 });
    fireDragEventWithClientY(dropTarget, "drop", { dataTransfer, clientY: 115 });

    expect(onAtomicChange).toHaveBeenCalledWith({
      scale: ["100.", "700.", "500.", "2/1"],
      note_names: ["root", "second", "fifth", "fourth"],
      note_colors: ["#000000", "#111111", "#555555", "#333333"],
      reference_degree: 2,
      center_degree: 1,
    });
  });

  it("does not move a degree when dropped in the upper half of the immediately following row", () => {
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
    fireDragEventWithClientY(dropTarget, "dragenter", { dataTransfer, clientY: 105 });
    fireDragEventWithClientY(dropTarget, "dragover", { dataTransfer, clientY: 105 });
    fireDragEventWithClientY(dropTarget, "drop", { dataTransfer, clientY: 105 });

    expect(onAtomicChange).not.toHaveBeenCalled();
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
