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

describe("ScaleTable — key labels: heji", () => {
  const settings = { ...settingsBase, key_labels: "heji" };

  it('changes the name column heading from "Name" to "HEJI"', () => {
    render(<ScaleTable settings={settings} onChange={() => {}} heji_names={scale_names} />);
    expect(screen.getByText("HEJI")).toBeTruthy();
    expect(screen.queryByText("Name")).toBeNull();
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

  it("normalizes a committed integer entry to explicit ratio form", () => {
    const onChange = vi.fn();
    render(<ScaleTable settings={settingsBase} onChange={onChange} />);
    const input = screen.getByLabelText("pitch value 4");

    fireEvent.input(input, { target: { value: "3" } });
    fireEvent.blur(input);

    const commitCall = onChange.mock.calls.findLast(
      ([key, updated]) => key === "scale" && Array.isArray(updated) && updated[4] === "3/1",
    );
    expect(commitCall).toBeTruthy();
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

  it('calls onChange("note_colors", ...) with updated array when a color is saved', () => {
    const onChange = vi.fn();
    render(<ScaleTable settings={settingsBase} onChange={onChange} />);
    const input = screen.getByLabelText("hex colour for color2");
    fireEvent.change(input, { target: { value: "#ff0000", name: "color2" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("save colour for color2"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("note_colors");
    const updated = onChange.mock.calls[0][1];
    expect(updated[2]).toBe("#ff0000");
    expect(updated[0]).toBe("#ffffff");
  });

  it("shows compare and save controls for manual edits without an auto suggestion", () => {
    const onChange = vi.fn();
    const keysRef = {
      current: {
        updateColors: vi.fn(),
      },
    };
    render(<ScaleTable settings={settingsBase} onChange={onChange} keysRef={keysRef} />);

    const input = screen.getByLabelText("hex colour for color2");
    fireEvent.input(input, { target: { value: "#ff0000" } });

    expect(screen.getByLabelText("compare original colour for color2")).not.toBeNull();
    expect(screen.getByLabelText("save colour for color2")).not.toBeNull();
    expect(screen.queryByLabelText("revert colour for color2")).toBeNull();

    expect(keysRef.current.updateColors).toHaveBeenCalled();
    let lastCall = keysRef.current.updateColors.mock.calls.at(-1)[0];
    expect(lastCall.note_colors[2]).toBe("ff0000");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("compare original colour for color2"));
    lastCall = keysRef.current.updateColors.mock.calls.at(-1)[0];
    expect(lastCall.note_colors[2]).toBe("ffffff");

    fireEvent.click(screen.getByLabelText("compare original colour for color2"));
    lastCall = keysRef.current.updateColors.mock.calls.at(-1)[0];
    expect(lastCall.note_colors[2]).toBe("ff0000");

    fireEvent.click(screen.getByLabelText("compare original colour for color2"));
    fireEvent.click(screen.getByLabelText("save colour for color2"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("note_colors");
    const updated = onChange.mock.calls[0][1];
    expect(updated[2]).toBe("#ffffff");
  });

  it("offers a suggested colour and commits it only when saved", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          scale: ["23/16", ...scale_values.slice(1)],
          note_colors: ["#ffffff", "#ffffff", ...scale_colors.slice(2)],
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("apply suggested colour for color1"));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("save colour for color1"));

    expect(onChange).toHaveBeenCalledWith(
      "note_colors",
      expect.arrayContaining(["#ffffff", "#95c69b"]),
    );
  });

  it("suppresses auto-colour hints when auto-colour mode is enabled", () => {
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          auto_colors: true,
          scale: ["23/16", ...scale_values.slice(1)],
          note_colors: ["#ffffff", "#95c69b", ...scale_colors.slice(2)],
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.queryByLabelText("apply suggested colour for color1")).toBeNull();
    expect(screen.getByLabelText("hex colour for color1").disabled).toBe(true);
  });

  it("uses live modulated spelling and monzo for auto colours when a row is unambiguous", () => {
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          auto_colors: true,
          key_labels: "heji",
          scale: ["9/8", "2/1"],
          note_colors: ["#ffffff", "#ffffff"],
        }}
        heji_names={["C", "D"]}
        liveScaleTableSnapshot={{
          version: 1,
          rowsByDegree: {
            1: {
              degree: 1,
              frequencyHz: 293.664768,
              displayLabel: "D♭",
              ratioText: "256/243",
              monzo: [8, -5, 0],
              noteCount: 1,
              mixed: false,
            },
          },
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("hex colour for color1").value).toBe("#d0d0d7");
  });

  it("disables Bosanquet black-key auto colours for odd-partial style tunings", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          name: "14-(3,5) < 256°",
          short_description: "OddPartials(3,5)",
          scale: ["135/128", ...scale_values.slice(1)],
          note_colors: ["#ffffff", "#fffae5", ...scale_colors.slice(2)],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText("apply suggested colour for color1")).toBeNull();
  });

  it("disables Bosanquet black-key auto colours for OddPart short descriptions too", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          name: "18-(3,7,11) < 256°",
          short_description: "OddPart(3,7,11)",
          scale: ["7/4", ...scale_values.slice(1)],
          note_colors: ["#ffffff", "#ffe5e5", ...scale_colors.slice(2)],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText("apply suggested colour for color1")).toBeNull();
  });

  it("does not disable fifths overlay just because a description mentions harmonic partials", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          name: "22-Sruti (Sambamurthy/Daniélou)",
          short_description: "22-JI-5L_Srutis",
          description: "Derived from harmonic partial row intervals up to a prime limit of 5.",
          scale: ["256/243", "2/1"],
          note_names: [" Sa ", " ReL- "],
          note_colors: ["#ffffff", "#ffffff"],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText("apply suggested colour for color1")).toBeNull();
  });

  it("prefers note-name D-centering over misleading HEJI labels for note-name tunings", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          key_labels: "note_names",
          scale: ["256/243", "9/8", "2/1"],
          note_names: [" Sa ", " ReL- ", " Re "],
          note_colors: ["#ffffff", "#d0d0d7", "#ffffff"],
        }}
        heji_names_table={["D", "", ""]}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("apply suggested colour for color0")).not.toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color1")).toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color2")).toBeNull();
  });

  it("keeps 22-Sruti flat-side 3-limit notes matched to the preset palette", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          key_labels: "note_names",
          scale: [
            "256/243",
            "16/15",
            "10/9",
            "9/8",
            "32/27",
            "6/5",
            "5/4",
            "81/64",
            "4/3",
            "27/20",
            "45/32",
            "64/45",
            "3/2",
            "128/81",
            "8/5",
            "5/3",
            "27/16",
            "16/9",
            "9/5",
            "15/8",
            "243/128",
            "2/1",
          ],
          note_names: [
            " Sa ",
            " ReL- ",
            " ReL+ ",
            " Re- ",
            " Re ",
            " GaL ",
            " Ga♭ ",
            " Ga ",
            " Ga+ ",
            " Ma ",
            " Ma+ ",
            " MaL- ",
            " MaL+ ",
            " Pa ",
            " DhaL ",
            " Dha♭ ",
            "Dha",
            " Dha+ ",
            " NiL ",
            " Ni♭ ",
            " Ni ",
            " Ni+ ",
          ],
          note_colors: [
            "#ffffff",
            "#d0d0d7",
            "#b7b196",
            "#fffae5",
            "#ffffff",
            "#d0d0d7",
            "#b7b196",
            "#fffae5",
            "#ffffff",
            "#ffffff",
            "#e9e1b4",
            "#cdcac1",
            "#b7b196",
            "#ffffff",
            "#d0d0d7",
            "#b7b196",
            "#fffae5",
            "#ffffff",
            "#d0d0d7",
            "#b7b196",
            "#fffae5",
            "#ffffff",
          ],
        }}
        heji_names_table={["D", "D", "D", "D", "D"]}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText("apply suggested colour for color1")).toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color5")).toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color14")).toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color18")).toBeNull();
  });

  it("recognizes Hamilton *nD spelling as the natural D center for relative monzo coloring", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          key_labels: "note_names",
          name: "12-Subharmonic (Elsie Hamilton) E-A-D 13-limit",
          short_description: "12-SH-13Hamilton",
          scale: [
            "12/11",
            "8/7",
            "6/5",
            "5/4",
            "4/3",
            "45/32",
            "3/2",
            "8/5",
            "12/7",
            "24/13",
            "15/8",
            "2/1",
          ],
          note_names: ["B", "C", "C", "D", "*nD", "E", "*nE", "F", "G", "G", "A", "*nA"],
          note_colors: [
            "#b7b196",
            "#f4d0f5",
            "#fdbdbe",
            "#e5d383",
            "#ffffff",
            "#b7b196",
            "#ffffff",
            "#b7b196",
            "#e5d383",
            "#fdbdbe",
            "#c8b4db",
            "#ffffff",
          ],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("apply suggested colour for color0")).not.toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color4")).toBeNull();
    expect(screen.getByLabelText("apply suggested colour for color5")).not.toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color6")).toBeNull();
  });

  it("shows an auto-colour hint for root degree 0 when the generated colour differs", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          key_labels: "note_names",
          name: "12-Subharmonic (Elsie Hamilton) E-A-D 13-limit",
          short_description: "12-SH-13Hamilton",
          scale: [
            "12/11",
            "8/7",
            "6/5",
            "5/4",
            "4/3",
            "45/32",
            "3/2",
            "8/5",
            "12/7",
            "24/13",
            "15/8",
            "2/1",
          ],
          note_names: ["B", "C", "C", "D", "*nD", "E", "*nE", "F", "G", "G", "A", "*nA"],
          note_colors: [
            "#d0d0d7",
            "#ffffff",
            "#ffffff",
            "#d0d0d7",
            "#ffffff",
            "#d0d0d7",
            "#ffffff",
            "#ffffff",
            "#d0d0d7",
            "#ffffff",
            "#d0d0d7",
            "#ffffff",
          ],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("apply suggested colour for color0")).not.toBeNull();
  });

  it("keeps quintal chromatic shading always on, but enables higher-prime shading only when both signs exist", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          key_labels: "note_names",
          name: "18-Oliveros Septimal-Quintal",
          short_description: "18-JI-7L",
          scale: [
            "135/128",
            "16/15",
            "9/8",
            "7/6",
            "6/5",
            "5/4",
            "4/3",
            "45/32",
            "64/45",
            "3/2",
            "14/9",
            "8/5",
            "5/3",
            "27/16",
            "7/4",
            "16/9",
            "15/8",
            "15/8",
            "2/1",
          ],
          note_names: ["C", "C", "D", "D", "C", "E", "E", "F", "G", "C", "G", "C", "A", "A", "C", "B", "C", "B", "C"],
          note_colors: [
            "#ffffff",
            "#cdcac1",
            "#b7b196",
            "#ffffff",
            "#ffe5e5",
            "#b7b196",
            "#fffae5",
            "#ffffff",
            "#cdcac1",
            "#b7b196",
            "#ffffff",
            "#ffe5e5",
            "#b7b196",
            "#fffae5",
            "#ffffff",
            "#ffe5e5",
            "#d0d0d7",
            "#fffae5",
            "#fffae5",
          ],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("apply suggested colour for color1")).not.toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color3")).toBeNull();
  });


  it("centers fifths on the plain pure-3 D nearest 9/8", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          key_labels: "note_names",
          scale: ["10/9", "9/8", "2/1"],
          note_names: [" Sa ", " Re- ", " Re "],
          note_colors: ["#ffffff", "#fffae5", "#ffffff"],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText("apply suggested colour for color1")).toBeNull();
    expect(screen.queryByLabelText("apply suggested colour for color2")).toBeNull();
  });

  it("prefers a pure-3 D center over a higher-prime natural-marked D in Partch-like scales", () => {
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          key_labels: "note_names",
          name: "Harry Partch: 43 tone Just Intonation scale",
          short_description: "43-JI-11LPartchA",
          scale: ["7/6", "32/27", "4/3", "27/20", "2/1"],
          note_names: ["B", "C", "D", "*nD", "A"],
          note_colors: ["#ffe5e5", "#ffffff", "#ffffff", "#ffffff", "#ffffff"],
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("apply suggested colour for color1").title).toContain("7-limit overtonal diatonic");
  });

  it("lets compare plus save restore the original after an auto-colour preview", () => {
    const onChange = vi.fn();
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          scale: ["23/16", ...scale_values.slice(1)],
          note_colors: ["#ffffff", "#ffffff", ...scale_colors.slice(2)],
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("apply suggested colour for color1"));
    fireEvent.click(screen.getByLabelText("compare original colour for color1"));
    fireEvent.click(screen.getByLabelText("save colour for color1"));

    expect(onChange).toHaveBeenCalledWith(
      "note_colors",
      expect.arrayContaining(["#ffffff", "#ffffff"]),
    );
  });

  it("pushes auto-colour previews to the live keys renderer before save", () => {
    const onChange = vi.fn();
    const keysRef = {
      current: {
        updateColors: vi.fn(),
      },
    };
    render(
      <ScaleTable
        settings={{
          ...settingsBase,
          scale: ["23/16", ...scale_values.slice(1)],
          note_colors: ["#ffffff", "#ffffff", ...scale_colors.slice(2)],
        }}
        onChange={onChange}
        keysRef={keysRef}
      />,
    );

    fireEvent.click(screen.getByLabelText("apply suggested colour for color1"));

    expect(keysRef.current.updateColors).toHaveBeenCalled();
    const lastCall = keysRef.current.updateColors.mock.calls.at(-1)[0];
    expect(lastCall.note_colors[1]).toBe("95c69b");
    expect(onChange).not.toHaveBeenCalled();
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

  it("lets auto colours override spectrum colours when both are enabled", () => {
    render(
      <ScaleTable
        settings={{
          ...settings,
          auto_colors: true,
          scale: ["23/16", ...scale_values.slice(1)],
          note_colors: ["#ffffff", "#ffffff", ...scale_colors.slice(2)],
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("hex colour for color1").value).toBe("#95c69b");
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

  it("shows modulated frequencies when a live global modulation transposition is active", () => {
    render(
      <ScaleTable
        settings={{ ...settingsBase, fundamental: 440, reference_degree: 9 }}
        modulation_transposition_cents={1200}
        modulation_display_active={true}
        onChange={() => {}}
      />,
    );

    expect(document.querySelector('input[aria-label="pitch frequency 9"]').value).toBe("880.0");
    expect(document.querySelector('input[aria-label="pitch frequency 0"]').value).toBe("523.3");
  });

  it("highlights HEJI names and frequency inputs during non-unison live modulation", () => {
    render(
      <ScaleTable
        settings={{ ...settingsBase, key_labels: "heji", fundamental: 440, reference_degree: 9 }}
        heji_names={scale_names}
        modulation_transposition_cents={100}
        modulation_display_active={true}
        onChange={() => {}}
      />,
    );

    const hejiCells = document.querySelectorAll(".heji-name-cell");
    expect(hejiCells[0].classList.contains("heji-name-cell--modulated")).toBe(true);
    expect(screen.getByLabelText("pitch frequency 0").style.color).toBe("rgb(154, 47, 47)");
  });

  it("returns HEJI names and frequency inputs to default styling at global 1/1", () => {
    render(
      <ScaleTable
        settings={{ ...settingsBase, key_labels: "heji", fundamental: 440, reference_degree: 9 }}
        heji_names={scale_names}
        modulation_transposition_cents={0}
        modulation_display_active={false}
        onChange={() => {}}
      />,
    );

    const hejiCells = document.querySelectorAll(".heji-name-cell");
    expect(hejiCells[0].classList.contains("heji-name-cell--modulated")).toBe(false);
    expect(screen.getByLabelText("pitch frequency 0").style.color).toBe("");
  });

  it("overrides a handoff row with live HEJI and frequency data when the live note is unambiguous", () => {
    render(
      <ScaleTable
        settings={{ ...settingsBase, key_labels: "heji", fundamental: 440, reference_degree: 9 }}
        heji_names={["F−8", ...scale_names.slice(1)]}
        modulation_transposition_cents={1200}
        modulation_display_active={true}
        liveScaleTableSnapshot={{
          version: 1,
          rowsByDegree: {
            0: {
              degree: 0,
              frequencyHz: 261.625565,
              displayLabel: "C−6",
              ratioText: "1/1",
              monzo: [0, 0, 0],
              noteCount: 1,
              mixed: false,
            },
          },
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("pitch frequency 0").value).toBe("261.6");
    expect(document.querySelector(".heji-name-cell").textContent).toBe("C−6");
    expect(document.querySelector(".heji-name-cell").title).toContain("Live ratio 1/1");
  });

  it("keeps the global row display when multiple live notes disagree on a handoff row", () => {
    render(
      <ScaleTable
        settings={{ ...settingsBase, key_labels: "heji", fundamental: 440, reference_degree: 9 }}
        heji_names={["F−8", ...scale_names.slice(1)]}
        modulation_transposition_cents={1200}
        modulation_display_active={true}
        liveScaleTableSnapshot={{
          version: 2,
          rowsByDegree: {
            0: {
              degree: 0,
              frequencyHz: 261.625565,
              displayLabel: "C−6",
              ratioText: "1/1",
              monzo: [0, 0, 0],
              noteCount: 2,
              mixed: true,
            },
          },
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("pitch frequency 0").value).toBe("523.3");
    expect(document.querySelector(".heji-name-cell").textContent).toBe("F−8");
    expect(document.querySelector(".heji-name-cell").title).toContain("Mixed live notes (2)");
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

  it("de-modulates a live reference-degree frequency edit before committing fundamental", () => {
    const onChange = vi.fn();

    render(
      <ScaleTable
        settings={{ ...settingsBase, fundamental: 440, reference_degree: 9 }}
        modulation_transposition_cents={1200}
        modulation_display_active={true}
        onChange={onChange}
      />,
    );

    const frequencyInput = screen.getByLabelText("pitch frequency 9");
    fireEvent.focus(frequencyInput);
    fireEvent.input(frequencyInput, { target: { value: "1760" } });
    fireEvent.blur(frequencyInput);

    expect(onChange).toHaveBeenCalledWith("fundamental", 880);
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
