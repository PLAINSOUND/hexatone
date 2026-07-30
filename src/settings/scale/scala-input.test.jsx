import { fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
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

  it("can show the canonical committed interval after blur", () => {
    const onChange = vi.fn();
    const Harness = () => {
      const [value, setValue] = useState("64/63");
      return (
        <ScalaInput
          value={value}
          context="interval"
          showCanonicalOnCommit
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          aria-label="Equave"
        />
      );
    };

    render(<Harness />);

    const input = screen.getByLabelText("Equave");
    fireEvent.input(input, { target: { value: "2" } });

    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("2/1");
    expect(input.value).toBe("2/1");
  });

  it("accepts signed bend intervals when negatives are allowed", () => {
    const onChange = vi.fn();
    render(
      <ScalaInput
        value="28/27"
        context="interval"
        allowNegative
        onChange={onChange}
        aria-label="Pitch Bend Interval (Scala)"
      />,
    );

    const input = screen.getByLabelText("Pitch Bend Interval (Scala)");
    fireEvent.input(input, { target: { value: "-28/27" } });

    expect(input.style.border).not.toContain("c0392b");

    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("-28/27");
    expect(input.value).toBe("-28/27");
  });

  it("can commit a negative scale degree while keeping the warning preview", () => {
    const onChange = vi.fn();
    render(
      <ScalaInput
        value="33/32"
        context="degree"
        commitNegative
        onChange={onChange}
        aria-label="Scale Degree"
      />,
    );

    const input = screen.getByLabelText("Scale Degree");
    fireEvent.input(input, { target: { value: "32/33" } });

    expect(input.style.border).toContain("rgb(192, 57, 43)");

    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("32/33");
    expect(input.value).toBe("32/33");
    expect(screen.getByText("-53¢")).toBeTruthy();
  });

  it("does not fight deletion while editing before commit", () => {
    const onChange = vi.fn();
    render(
      <ScalaInput value="500." context="degree" onChange={onChange} aria-label="Scale Degree" />,
    );

    const input = screen.getByLabelText("Scale Degree");
    fireEvent.input(input, { target: { value: "50" } });

    expect(input.value).toBe("50");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("50/1");
  });
});
