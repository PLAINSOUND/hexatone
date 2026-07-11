import { fireEvent, render, screen } from "@testing-library/preact";
import KeyLabels from "./key-labels.js";
import { buildPitchFrame } from "../../notation/pitch-frame.js";
import { createScaleWorkspace } from "../../tuning/workspace.js";

describe("KeyLabels HEJI anchor handling", () => {
  const pitchFrameFor = ({ scale = ["3/2", "2/1"], reference_degree = 1, fundamental = 440, heji_anchor_label = "A", heji_anchor_ratio = "1/1" } = {}) => {
    const settings = {
      scale,
      reference_degree,
      fundamental,
      heji_anchor_label,
      heji_anchor_ratio,
    };
    return buildPitchFrame(settings, createScaleWorkspace(settings));
  };

  it("does not write derived HEJI anchor values back into settings on mode switch", async () => {
    const onAtomicChange = vi.fn();

    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        heji_names={[]}
        heji_anchor_ratio_eff="17/16"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAtomicChange).not.toHaveBeenCalled();
  });

  it("does not overwrite explicitly entered HEJI anchor values", async () => {
    const onAtomicChange = vi.fn();

    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        heji_names={[]}
        heji_anchor_ratio_eff="17/16"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "1/1",
          heji_anchor_label: "nC",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAtomicChange).not.toHaveBeenCalled();
  });

  it("shows a hard warning and disables HEJI controls for non-octave equaves", async () => {
    const onAtomicChange = vi.fn();

    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        heji_supported={false}
        heji_warning="Non-octave equave cannot generate consistent note names."
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    expect(screen.getByText("Non-octave equave cannot generate consistent note names.")).toBeTruthy();
    expect(screen.getByLabelText("Ratio/Cents from 1/1 (scale degree 0)").disabled).toBe(true);
    expect(screen.getByLabelText("Notation (Spelling)").disabled).toBe(true);
    expect(screen.getByLabelText("Tempered Accidentals Only").disabled).toBe(true);
    expect(screen.getByLabelText("Always Include Cents on Keys").disabled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAtomicChange).not.toHaveBeenCalled();
  });

  it("shows Copy HEJI to Note Names only when Key Labels is set to HEJI", () => {
    const { rerender } = render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={["A"]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "1/1",
          heji_anchor_label: "A",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Copy HEJI to Note Names" })).toBeTruthy();

    rerender(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={["A"]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "note_names",
          heji_anchor_ratio: "1/1",
          heji_anchor_label: "A",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Copy HEJI to Note Names" })).toBeNull();
  });

  it('canonicalises a bare "0" HEJI anchor ratio to "1/1" on blur', () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "0",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.blur(screen.getByLabelText("Ratio/Cents from 1/1 (scale degree 0)"));
    expect(onChange).toHaveBeenCalledWith("heji_anchor_ratio", "1/1");
  });

  it('commits the HEJI anchor ratio on Enter like blur', () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "0",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    const input = screen.getByLabelText("Ratio/Cents from 1/1 (scale degree 0)");
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("heji_anchor_ratio", "1/1");
  });

  it("retunes the reference frequency when the HEJI anchor ratio changes, preserving spelling frequency", () => {
    const onAtomicChange = vi.fn();

    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        heji_names={[]}
        heji_anchor_ratio_eff="27/16"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          scale: ["3/2", "2/1"],
          reference_degree: 0,
          fundamental: 440 / (27 / 16),
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_anchor_frequency: "",
          heji_tempered_only: false,
          heji_show_cents: true,
          pitch_frame: pitchFrameFor({
            reference_degree: 0,
            fundamental: 440 / (27 / 16),
            heji_anchor_label: "A",
            heji_anchor_ratio: "27/16",
          }),
        }}
      />,
    );

    fireEvent.input(screen.getByLabelText("Ratio/Cents from 1/1 (scale degree 0)"), {
      target: { value: "1/1" },
    });
    fireEvent.blur(screen.getByLabelText("Ratio/Cents from 1/1 (scale degree 0)"));

    expect(onAtomicChange).toHaveBeenCalledWith({
      heji_anchor_label: "A",
      heji_anchor_ratio: "1/1",
      fundamental: 440,
    });
  });

  it("does not recompute or commit the HEJI anchor ratio while typing", () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.input(screen.getByLabelText("Ratio/Cents from 1/1 (scale degree 0)"), {
      target: { value: "27/1" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("canonicalises shorthand HEJI spellings on blur", () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "",
          heji_anchor_label: "A#",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.blur(screen.getByLabelText("Notation (Spelling)"));
    expect(onChange).toHaveBeenCalledWith("heji_anchor_label", "\uE262A");
  });

  it("does not commit the HEJI anchor spelling while typing", () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.input(screen.getByLabelText("Notation (Spelling)"), {
      target: { value: "A#" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("canonicalises bare note letters to natural-prefixed HEJI spellings on blur", () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "",
          heji_anchor_label: "B",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.blur(screen.getByLabelText("Notation (Spelling)"));
    expect(onChange).toHaveBeenCalledWith("heji_anchor_label", "\uE261B");
  });

  it("commits the HEJI anchor spelling on Enter like blur", () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "",
          heji_anchor_label: "A#",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    const input = screen.getByLabelText("Notation (Spelling)");
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("heji_anchor_label", "\uE262A");
  });

  it("strips a pasted cents suffix before committing the HEJI anchor spelling", () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.input(screen.getByLabelText("Notation (Spelling)"), {
      target: { value: "B-10" },
    });
    fireEvent.blur(screen.getByLabelText("Notation (Spelling)"));
    expect(onChange).toHaveBeenCalledWith("heji_anchor_label", "B");
  });

  it("shows an auto-derived spelling frequency value", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          scale: ["3/2", "2/1"],
          reference_degree: 1,
          fundamental: 440,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_anchor_frequency: "",
          heji_tempered_only: false,
          heji_show_cents: true,
          pitch_frame: pitchFrameFor(),
        }}
      />,
    );

    expect(screen.getByLabelText("Spelling Frequency").value).toBe("293.3");
  });

  it("shows full six-decimal spelling frequency while focused", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          scale: ["3/2", "2/1"],
          reference_degree: 1,
          fundamental: 440,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_anchor_frequency: "",
          heji_tempered_only: false,
          heji_show_cents: true,
          pitch_frame: pitchFrameFor(),
        }}
      />,
    );

    const input = screen.getByLabelText("Spelling Frequency");
    expect(input.value).toBe("293.3");
    fireEvent.focus(input);
    expect(input.value).toBe("293.333333");
  });

  it("commits spelling frequency by retuning the reference frequency", () => {
    const onAtomicChange = vi.fn();

    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        heji_names={[]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          scale: ["3/2", "2/1"],
          reference_degree: 1,
          fundamental: 440,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_anchor_frequency: "400",
          heji_tempered_only: false,
          heji_show_cents: true,
          pitch_frame: pitchFrameFor(),
        }}
      />,
    );

    const input = screen.getByLabelText("Spelling Frequency");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "400" } });
    fireEvent.blur(input);
    expect(onAtomicChange).toHaveBeenCalledWith({
      heji_anchor_label: "A",
      heji_anchor_ratio: "1/1",
      heji_anchor_frequency: "400",
      fundamental: 600,
    });
  });

  it("preserves the currently effective HEJI anchor when retuning spelling frequency from an implicit anchor", () => {
    const onAtomicChange = vi.fn();

    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
        heji_names={[]}
        heji_anchor_ratio_eff="27/16"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          scale: ["3/2", "2/1"],
          reference_degree: 1,
          fundamental: 440,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_anchor_frequency: "442",
          heji_tempered_only: false,
          heji_show_cents: true,
          pitch_frame: pitchFrameFor({ heji_anchor_label: "A", heji_anchor_ratio: "27/16" }),
        }}
      />,
    );

    const input = screen.getByLabelText("Spelling Frequency");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "442" } });
    fireEvent.blur(input);
    expect(onAtomicChange).toHaveBeenCalledWith({
      heji_anchor_label: "A",
      heji_anchor_ratio: "27/16",
      heji_anchor_frequency: "442",
      fundamental: expect.any(Number),
    });
  });

  it("shows a separate Show Equave Numbers toggle instead of an Equave Numbers label mode", () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "no_labels",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    expect(screen.queryByRole("option", { name: "Equave Numbers" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Show Equave Numbers"));
    expect(onChange).toHaveBeenCalledWith("show_equaves", true);
  });

  it("shows 440.0 as the spelling frequency value on blank-start defaults", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          scale: [],
          reference_degree: 0,
          fundamental: 440,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_anchor_frequency: "",
          heji_tempered_only: false,
          heji_show_cents: true,
          pitch_frame: null,
        }}
      />,
    );

    expect(screen.getByLabelText("Spelling Frequency").value).toBe("440.0");
  });

  it("shows 440.0 as the spelling frequency when the reference degree is already spelled A", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff="890.322581"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          scale: Array.from({ length: 31 }, (_, index) =>
            index === 30 ? "2/1" : `${(((index + 1) * 1200) / 31).toFixed(6)}`
          ),
          note_names: [
            "c", "c", "c", "d", "d", "d", "d", "d",
            "e", "e", "e", "e", "e", "f", "f", "f",
            "g", "g", "g", "g", "g", "a", "a", "a",
            "a", "a", "b", "b", "b", "b", "b",
          ],
          fundamental: 440,
          reference_degree: 23,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    expect(screen.getByLabelText("Spelling Frequency").value).toBe("440.0");
  });

  it('places "Scale Data" directly below "Scale Degrees" in the label-mode menu', () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "no_labels",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    const optionLabels = Array.from(screen.getByLabelText("Key Labels").querySelectorAll("option"))
      .map((option) => option.textContent);

    expect(optionLabels).toEqual([
      "Blank Keys",
      "Scale Degrees",
      "Scale Data",
      "Scale Cents",
      "Name",
      "HEJI",
    ]);
  });

  it('toggles "Tempered Accidentals Only" through onChange', () => {
    const onChange = vi.fn();

    render(
      <KeyLabels
        onChange={onChange}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Tempered Accidentals Only"));
    expect(onChange).toHaveBeenCalledWith("heji_tempered_only", true);
  });

  it("shows a HEJI palette builder and appends glyphs into the palette output", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("HEJI palette output").value).toBe("A");
  });

  it("shows a separate 12edo accidental row in the palette", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));

    expect(screen.getByLabelText("12edo accidentals")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("HEJI palette output").value).toBe("A");
  });

  it("switching to a 12edo accidental clears HEJI inflections and commits the auto cents to editable text", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
          scale: ["3/2", "2/1"],
          reference_degree: 0,
          fundamental: 440,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByTitle("7-limit upper"));
    const autoDeviation = screen.getByLabelText("HEJI palette cents deviation").value;
    expect(autoDeviation).not.toBe("+0");

    fireEvent.click(screen.getByRole("button", { name: "" }));

    expect(screen.getByLabelText("HEJI palette output").value).toBe("A");
    expect(screen.getByLabelText("HEJI palette cents deviation").value).toBe(autoDeviation);
    expect(screen.getByLabelText("HEJI palette cents deviation").readOnly).toBe(false);
  });

  it("switching back to HEJI clears the tempered sign to its 3-limit cousin and recalculates cents automatically", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
          scale: ["3/2", "2/1"],
          reference_degree: 0,
          fundamental: 440,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.input(screen.getByLabelText("HEJI palette cents deviation"), {
      target: { value: "+17" },
    });
    expect(screen.getByLabelText("HEJI palette cents deviation").readOnly).toBe(false);

    fireEvent.click(screen.getByTitle("7-limit upper"));

    const nextOutput = screen.getByLabelText("HEJI palette output").value;
    expect(nextOutput.endsWith("A")).toBe(true);
    expect(nextOutput.startsWith("")).toBe(false);
    expect(screen.getByLabelText("HEJI palette cents deviation").readOnly).toBe(true);
    expect(screen.getByLabelText("HEJI palette cents deviation").value).not.toBe("+17");
  });

  it("auto-calculates and displays cents for exact HEJI palette input", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    const deviation = screen.getByLabelText("HEJI palette cents deviation");
    expect(deviation.value).toBe("+0");
    expect(deviation).toHaveProperty("readOnly", true);
  });

  it("updates the auto cents field when higher-prime HEJI input changes", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    const deviation = screen.getByLabelText("HEJI palette cents deviation");
    expect(deviation.value).toBe("+0");

    fireEvent.click(screen.getByTitle("7-limit upper"));
    expect(deviation.value).not.toBe("+0");
  });

  it("formats exact HEJI palette cents with the selected number of decimal places", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff="1/1"
        heji_anchor_label_eff="A"
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
          scale: ["3/2", "2/1"],
          reference_degree: 0,
          fundamental: 440,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.change(screen.getByLabelText("HEJI palette cents decimal places"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByTitle("7-limit upper"));

    expect(screen.getByLabelText("HEJI palette cents deviation").value).toMatch(/^[+−]\d+\.\d{2}$/);
  });

  it("appends a typed cents deviation and copies the combined palette string", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.input(screen.getByLabelText("HEJI palette cents deviation"), {
      target: { value: "+17" },
    });
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    await fireEvent.click(screen.getByText("Copy"));

    expect(writeText).toHaveBeenCalledWith("A+17");
  });

  it("auto-prefixes + when typing a bare number into the editable tempered cents field", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "" }));
    const deviation = screen.getByLabelText("HEJI palette cents deviation");
    fireEvent.input(deviation, { target: { value: "17" } });

    expect(deviation.value).toBe("+17");
  });

  it("consolidates repeated sharps into a double-sharp when the checkbox is on", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("HEJI palette output").value).toBe("A");
  });

  it("adds extra natural-arrow glyphs for 5-limit steps beyond three", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("HEJI palette output").value).toBe("A");
  });

  it("treats higher-prime buttons as signed exponents instead of raw appended glyphs", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByTitle("7-limit upper"));
    fireEvent.click(screen.getByTitle("7-limit lower"));
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("HEJI palette output").value).toBe("A");
  });

  it("parses away the cautionary natural for higher-prime inflections when unchecked", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByLabelText("Cautionary Natural"));
    fireEvent.click(screen.getByTitle("7-limit upper"));
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("HEJI palette output").value).toBe("A");
  });

  it("compresses two septimal signs into the double-septimal glyph when enabled", () => {
    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByTitle("7-limit upper"));
    fireEvent.click(screen.getByTitle("7-limit upper"));
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("HEJI palette output").value).toBe("A");
  });

  it("copies the palette output to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    render(
      <KeyLabels
        onChange={() => {}}
        onAtomicChange={() => {}}
        heji_names={[]}
        heji_anchor_ratio_eff=""
        heji_anchor_label_eff=""
        settings={{
          key_labels: "heji",
          show_equaves: false,
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          heji_tempered_only: false,
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Palette"));
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    await fireEvent.click(screen.getByText("Copy"));

    expect(writeText).toHaveBeenCalledWith("A+14");
  });
});
