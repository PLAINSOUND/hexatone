import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import KeyLabels from "./key-labels.js";

describe("KeyLabels HEJI anchor auto-fill", () => {
  it("populates empty HEJI anchor fields from the effective derived values", async () => {
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
          heji_show_cents: true,
        }}
      />,
    );

    await waitFor(() => {
      expect(onAtomicChange).toHaveBeenCalledWith({
        heji_anchor_ratio: "17/16",
        heji_anchor_label: "A",
      });
    });
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
          heji_show_cents: true,
        }}
      />,
    );

    expect(screen.getByText("Non-octave equave cannot generate consistent note names.")).toBeTruthy();
    expect(screen.getByLabelText("Ratio/Cents from scale degree 0 (1/1)").disabled).toBe(true);
    expect(screen.getByLabelText("Notation (Spelling)").disabled).toBe(true);
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
          heji_show_cents: true,
        }}
      />,
    );

    fireEvent.blur(screen.getByLabelText("Ratio/Cents from scale degree 0 (1/1)"));
    expect(onChange).toHaveBeenCalledWith("heji_anchor_ratio", "0.");
  });
});
