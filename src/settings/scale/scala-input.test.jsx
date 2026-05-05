import { fireEvent, render, screen } from "@testing-library/preact";
import ScalaInput from "./scala-input.js";

describe("ScalaInput", () => {
  it("commits a bare integer interval as an explicit ratio", () => {
    const onChange = vi.fn();
    render(
      <ScalaInput
        value="64/63"
        context="interval"
        onChange={onChange}
        aria-label="Pitch Bend Interval (Scala)"
      />,
    );

    const input = screen.getByLabelText("Pitch Bend Interval (Scala)");
    fireEvent.input(input, { target: { value: "4" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("4/1");
    expect(input.value).toBe("4/1");
  });
});
