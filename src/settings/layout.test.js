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
  it("displays and edits the active Exquis preset layout without changing ordinary steps", () => {
    sessionStorage.setItem("hexatone_layout_collapsed", "false");
    const onChange = vi.fn();
    const settings = { ...minimalSettings, rSteps: 5, drSteps: 3, exquis_rsteps: 5, exquis_drsteps: 6 };
    const view = render(<Layout settings={settings} controllerId="exquis" onChange={onChange} />);
    expect(screen.getByLabelText("Right-Facing Steps").value).toBe("5");
    const down = screen.getByLabelText("Right-Downward Steps");
    expect(down.value).toBe("6");
    fireEvent.input(down, { target: { value: "7" } });
    fireEvent.blur(down);
    expect(onChange).toHaveBeenCalledWith("exquis_drsteps", 7);
    expect(settings.drSteps).toBe(3);
    view.rerender(<Layout settings={settings} controllerId="lumatone" onChange={onChange} />);
    const ordinary = screen.getByLabelText("Right-Downward Steps");
    expect(ordinary.value).toBe("3");
    fireEvent.input(ordinary, { target: { value: "4" } });
    fireEvent.blur(ordinary);
    expect(onChange).toHaveBeenLastCalledWith("drSteps", 4);
  });

  it("displays and persists the manual override when it takes precedence", () => {
    sessionStorage.setItem("hexatone_layout_collapsed", "false");
    const onChange = vi.fn();
    render(<Layout controllerId="exquis" onChange={onChange} settings={{
      ...minimalSettings, exquis_rsteps: 9, exquis_drsteps: 4,
      exquis_layout_override: true, exquis_rSteps: 5, exquis_drSteps: 6,
    }} />);
    const right = screen.getByLabelText("Right-Facing Steps");
    expect(right.value).toBe("5");
    expect(screen.getByLabelText("Right-Downward Steps").value).toBe("6");
    fireEvent.input(right, { target: { value: "7" } });
    fireEvent.blur(right);
    expect(onChange).toHaveBeenCalledWith("exquis_rSteps", 7);
    expect(localStorage.getItem("exquis_rSteps")).toBe("7");
    localStorage.removeItem("exquis_rSteps");
  });

});
