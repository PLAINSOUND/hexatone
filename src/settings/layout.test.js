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

  it("starts expanded on a fresh session", () => {
    sessionStorage.removeItem("hexatone_layout_collapsed");
    render(<Layout settings={minimalSettings} onChange={() => {}} />);
    expect(screen.getByText("Right-Facing Steps")).not.toBeNull();
  });

  it("selects a complete numeric value on first pointer focus", () => {
    render(<Layout settings={minimalSettings} onChange={() => {}} />);
    const input = screen.getByLabelText("Central Scale Degree");

    fireEvent.pointerDown(input);

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});
