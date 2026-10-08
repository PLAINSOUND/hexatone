import { fireEvent, render, screen } from "@testing-library/preact";
import Layout from "./layout";

const minimalSettings = {
  center_degree: 3,
  equivSteps: 12,
  rSteps: 1,
  drSteps: 5,
  hexSize: 60,
  rotation: 0,
};

describe("Layout panel", () => {
  it("highlights the Central Scale Degree row", () => {
    render(<Layout settings={minimalSettings} onChange={() => {}} />);
    const label = screen.getByText("Central Scale Degree").closest("label");
    expect(label?.classList.contains("center-degree-row")).toBe(true);
  });

  it("starts collapsed on a fresh session while keeping degree and size editable", () => {
    sessionStorage.removeItem("hexatone_layout_collapsed");
    render(<Layout settings={minimalSettings} onChange={() => {}} />);
    expect(screen.queryByText("Right-Facing Steps")).toBeNull();
    expect(screen.getByLabelText("Central Scale Degree").disabled).toBe(false);
    expect(screen.getByLabelText("Hex Size").disabled).toBe(false);
    fireEvent.click(screen.getByTitle("Toggle to show Hexatone Layout settings"));
    expect(screen.getByText("Right-Facing Steps")).not.toBeNull();
    expect(screen.getAllByLabelText("Hex Size")).toHaveLength(1);
  });

  it("selects a complete numeric value on first pointer focus", () => {
    render(<Layout settings={minimalSettings} onChange={() => {}} />);
    const input = screen.getByLabelText("Central Scale Degree");

    fireEvent.pointerDown(input);

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("renders layout defaults as inactive hints without a musical surface", () => {
    sessionStorage.setItem("hexatone_layout_collapsed", "false");
    render(
      <Layout settings={minimalSettings} hasMusicalSurface={false} onChange={() => {}} />,
    );

    expect(
      screen
        .getByText("Hexatone Layout")
        .closest("fieldset")
        .classList.contains("settings-fieldset--blank-surface"),
    ).toBe(true);
    expect(screen.getByLabelText("Central Scale Degree").disabled).toBe(true);
    expect(screen.getByLabelText("Right-Facing Steps").disabled).toBe(true);
    expect(screen.getByLabelText("Right-Downward Steps").disabled).toBe(true);
    expect(screen.getByLabelText("Hex Size").disabled).toBe(true);
    expect(screen.getByLabelText("Rotation Clockwise").disabled).toBe(true);
  });
});
