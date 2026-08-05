import { buildAutoSelectInputProps } from "./input-selection.js";

describe("buildAutoSelectInputProps", () => {
  it("selects the complete value on keyboard focus", () => {
    const input = document.createElement("input");
    input.value = "12345";
    document.body.append(input);
    const props = buildAutoSelectInputProps();

    props.onFocus({ currentTarget: input });

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
    input.remove();
  });

  it("focuses and preserves the complete selection on the first pointer down", () => {
    const input = document.createElement("input");
    input.value = "12345";
    document.body.append(input);
    const props = buildAutoSelectInputProps();
    input.addEventListener("focus", (event) => {
      props.onFocus({ currentTarget: event.currentTarget });
    });
    const event = {
      currentTarget: input,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    props.onPointerDown(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
    input.remove();
  });

  it("allows caret placement after the field is already focused", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const props = buildAutoSelectInputProps();
    const event = {
      currentTarget: input,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    props.onPointerDown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    input.remove();
  });
});
