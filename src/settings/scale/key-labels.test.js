import { fireEvent, render, screen } from "@testing-library/preact";
import KeyLabels from "./key-labels.js";

describe("KeyLabels HEJI anchor handling", () => {
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
    expect(screen.getByLabelText("Ratio/Cents from scale degree 0 (1/1)").disabled).toBe(true);
    expect(screen.getByLabelText("Notation (Spelling)").disabled).toBe(true);
    expect(screen.getByLabelText("Tempered Accidentals Only").disabled).toBe(true);
    expect(screen.getByLabelText("Always Include Cents on Keys").disabled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAtomicChange).not.toHaveBeenCalled();
  });

  it('canonicalises a bare "0" HEJI anchor ratio to "0." on blur', () => {
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

    fireEvent.blur(screen.getByLabelText("Ratio/Cents from scale degree 0 (1/1)"));
    expect(onChange).toHaveBeenCalledWith("heji_anchor_ratio", "0.");
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
      "HEJI (auto-generated)",
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
});
