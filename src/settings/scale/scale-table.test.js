/**
 * Tests for src/settings/scale/scale-table/index.js
 *
 * The ScaleTable component renders a table of scale degrees, names and colors.
 * Tests use aria-labels (already present in the component) to find inputs,
 * avoiding brittleness from position or implementation details.
 */

import { render, screen, fireEvent } from "@testing-library/preact";
import ScaleTable from "./scale-table/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const scale_values = [
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
];
const scale_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const scale_colors = [
  "#ffffff",
  "#7b7b7b",
  "#ffffff",
  "#7b7b7b",
  "#ffffff",
  "#ffffff",
  "#7b7b7b",
  "#ffffff",
  "#7b7b7b",
  "#ffffff",
  "#7b7b7b",
  "#ffffff",
];

const settingsBase = {
  scale: scale_values,
  spectrum_colors: false,
  note_colors: scale_colors,
  note_names: scale_names,
  key_labels: "note_names",
};

// ── Key labels ────────────────────────────────────────────────────────────────

describe("ScaleTable — key labels: note_names", () => {
  it("name inputs are enabled when key_labels is note_names", () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText("pitch name 0").disabled).toBe(false);
  });

  it("name inputs are populated with note_names values", () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText("pitch name 0").value).toBe("C");
    expect(screen.getByLabelText("pitch name 3").value).toBe("D#");
  });

  it('calls onChange("note_names", ...) with updated array when a name is changed', () => {
    const onChange = vi.fn();
    render(<ScaleTable settings={settingsBase} onChange={onChange} />);
    const input = screen.getByLabelText("pitch name 3");
    fireEvent.change(input, { target: { value: "Eb", name: "name3" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("note_names");
    const updated = onChange.mock.calls[0][1];
    expect(updated[3]).toBe("Eb");
    expect(updated[0]).toBe("C");
    expect(updated[4]).toBe("E");
  });
});

describe("ScaleTable — key labels: no_labels", () => {
  const settings = { ...settingsBase, key_labels: "no_labels" };

  it("name inputs are always enabled regardless of key_labels", () => {
    render(<ScaleTable settings={settings} onChange={() => {}} />);
    expect(screen.getByLabelText("pitch name 0").disabled).toBe(false);
  });
});

describe("ScaleTable — key labels: enumerate", () => {
  const settings = { ...settingsBase, key_labels: "enumerate" };

  it("name inputs are always enabled regardless of key_labels", () => {
    render(<ScaleTable settings={settings} onChange={() => {}} />);
    expect(screen.getByLabelText("pitch name 0").disabled).toBe(false);
  });
});

// ── Scale values ──────────────────────────────────────────────────────────────

describe("ScaleTable — scale value inputs", () => {
  it("scale inputs are populated with the correct values", () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText("pitch value 0").value).toBe("100.");
    expect(screen.getByLabelText("pitch value 4").value).toBe("500.");
  });

  it('calls onChange("scale", ...) with updated array when a value is changed', () => {
    const onChange = vi.fn();
    render(<ScaleTable settings={settingsBase} onChange={onChange} />);
    const input = screen.getByLabelText("pitch value 4");
    fireEvent.change(input, { target: { value: "498.04", name: "scale4" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("scale");
    const updated = onChange.mock.calls[0][1];
    expect(updated[4]).toBe("498.04");
    expect(updated[0]).toBe("100.");
  });
});

// ── Colors ────────────────────────────────────────────────────────────────────

describe("ScaleTable — explicit colors", () => {
  it("color inputs are enabled when spectrum_colors is false", () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText("hex colour for color0").disabled).toBe(false);
  });

  it("color inputs have the correct values", () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText("hex colour for color0").value).toBe("#ffffff");
    expect(screen.getByLabelText("hex colour for color1").value).toBe("#7b7b7b");
  });

  it('calls onChange("note_colors", ...) with updated array when a color is changed', () => {
    const onChange = vi.fn();
    render(<ScaleTable settings={settingsBase} onChange={onChange} />);
    const input = screen.getByLabelText("hex colour for color2");
    fireEvent.change(input, { target: { value: "#ff0000", name: "color2" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("note_colors");
    const updated = onChange.mock.calls[0][1];
    expect(updated[2]).toBe("#ff0000");
    expect(updated[0]).toBe("#ffffff");
  });
});

describe("ScaleTable — spectrum colors", () => {
  const settings = {
    ...settingsBase,
    spectrum_colors: true,
    fundamental_color: "#abcdef",
  };

  it("color inputs are disabled when spectrum_colors is true", () => {
    render(<ScaleTable settings={settings} onChange={() => {}} />);
    expect(screen.getByLabelText("hex colour for color0").disabled).toBe(true);
  });

  it("all color inputs show the fundamental_color", () => {
    render(<ScaleTable settings={settings} onChange={() => {}} />);
    // degrees 0–11
    for (let i = 0; i < 12; i++) {
      expect(screen.getByLabelText(`hex colour for color${i}`).value).toBe("#abcdef");
    }
  });
});

// ── Table structure ───────────────────────────────────────────────────────────

describe("ScaleTable — table structure", () => {
  it("renders a row for each scale degree plus root and equave", () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    // scale_values has 12 entries; ScaleTable shows root + 11 intervals + equave repeat = 13 rows
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBe(scale_values.length + 1);
  });

  it('root row has a disabled "pitch value root" input, not an editable one', () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    // The 1/1 root cell is labelled "pitch value root" and is disabled
    const rootInput = screen.getByLabelText("pitch value root");
    expect(rootInput).not.toBeNull();
    expect(rootInput.disabled).toBe(true);
    // The first editable interval is "pitch value 0" (scale index 0)
    expect(screen.getByLabelText("pitch value 0").disabled).toBe(false);
  });

  it("equave row shows the same note name as degree 0", () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    // The equave should show the same name as degree 0 (root)
    const equaveNameInput = screen.getByLabelText("pitch name equave");
    expect(equaveNameInput.value).toBe("C");
    expect(equaveNameInput.disabled).toBe(true);
  });

  it("shows degrees in a read-only gutter instead of a dedicated Degree column", () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.queryByText("Degree")).toBeNull();
    expect(screen.getByLabelText("scale degree gutter 0").textContent).toBe("0");
    expect(screen.getByLabelText("scale degree gutter 4").textContent).toBe("4");
    expect(screen.getByLabelText("scale degree gutter equave").textContent).toBe("12");
  });

  it("shows computed frequencies based on reference degree and reference frequency", () => {
    render(
      <ScaleTable
        settings={{ ...settingsBase, fundamental: 440, reference_degree: 9 }}
        onChange={() => {}}
      />,
    );
    expect(document.querySelector('input[aria-label="pitch frequency 9"]').value).toBe("440.0");
    expect(document.querySelector('input[aria-label="pitch frequency 0"]').value).toBe("261.6");
    expect(document.querySelector('input[aria-label="equave frequency"]').value).toBe("523.3");
  });

  it("shows rounded frequency normally but full precision on focus", () => {
    render(
      <ScaleTable
        settings={{ ...settingsBase, fundamental: 440, reference_degree: 9 }}
        onChange={() => {}}
      />,
    );

    const frequencyInput = screen.getByLabelText("pitch frequency 0");
    expect(frequencyInput.value).toBe("261.6");

    fireEvent.focus(frequencyInput);
    expect(frequencyInput.value).toBe("261.625565");
  });

  it("does not commit when a frequency cell is only focused and blurred", () => {
    const onChange = vi.fn();
    const onAtomicChange = vi.fn();

    render(
      <ScaleTable
        settings={{ ...settingsBase, fundamental: 440, reference_degree: 9, scale: ["9/8", ...scale_values.slice(1)] }}
        onChange={onChange}
        onAtomicChange={onAtomicChange}
      />,
    );

    const frequencyInput = screen.getByLabelText("pitch frequency 0");
    fireEvent.focus(frequencyInput);
    fireEvent.blur(frequencyInput);

    expect(onChange).not.toHaveBeenCalled();
    expect(onAtomicChange).not.toHaveBeenCalled();
  });

  it("highlights only the degree 0 row when reference_degree is 0", () => {
    render(<ScaleTable settings={{ ...settingsBase, reference_degree: 0 }} onChange={() => {}} />);
    const rows = document.querySelectorAll("tbody tr");
    expect(rows[0].classList.contains("reference-degree-row")).toBe(true);
    expect(rows[rows.length - 1].classList.contains("reference-degree-row")).toBe(false);
  });

  it("highlights the center-degree row separately in pale green", () => {
    render(
      <ScaleTable
        settings={{ ...settingsBase, reference_degree: 0, center_degree: 3 }}
        onChange={() => {}}
      />,
    );
    const rows = document.querySelectorAll("tbody tr");
    expect(rows[3].classList.contains("center-degree-row")).toBe(true);
    expect(rows[0].classList.contains("center-degree-row")).toBe(false);
  });
});
