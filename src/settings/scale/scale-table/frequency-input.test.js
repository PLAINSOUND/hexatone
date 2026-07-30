import { fireEvent, render, screen } from "@testing-library/preact";
import FrequencyInput from "./frequency-input.js";

describe("FrequencyInput", () => {
  it("shows the full six-decimal value while focused", () => {
    render(
      <FrequencyInput
        ariaLabel="pitch frequency"
        value={440.123456}
        onCommit={() => {}}
      />,
    );

    const input = screen.getByLabelText("pitch frequency");
    expect(input.value).toBe("440.1");

    fireEvent.focus(input);
    expect(input.value).toBe("440.123456");
  });

  it("selects the complete expanded value on the first pointer focus", () => {
    render(
      <FrequencyInput
        ariaLabel="pitch frequency"
        value={440.123456}
        onCommit={() => {}}
      />,
    );

    const input = screen.getByLabelText("pitch frequency");
    fireEvent.pointerDown(input);

    expect(input.value).toBe("440.123456");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("returns to one-decimal display on blur without changes", () => {
    render(
      <FrequencyInput
        ariaLabel="pitch frequency"
        value={440.123456}
        onCommit={() => {}}
      />,
    );

    const input = screen.getByLabelText("pitch frequency");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input.value).toBe("440.1");
  });
});
