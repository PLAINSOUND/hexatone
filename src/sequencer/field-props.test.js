import { describe, expect, it, vi } from "vitest";

import { buildSelectAllOnFirstPointerDown, buildSelectOnFocus } from "./field-props.js";
import { commitTextInput } from "./value-runtime.js";

describe("sequencer field props", () => {
  it("preserves whole-value selection on the first pointer focus", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "0.375";
    document.body.append(input);
    input.addEventListener(
      "focus",
      buildSelectOnFocus({
        clearCommitted: true,
        setValue: () => "0.375000",
      }),
    );

    const preventDefault = vi.fn();
    buildSelectAllOnFirstPointerDown()({
      currentTarget: input,
      preventDefault,
      stopPropagation: vi.fn(),
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("0.375000");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(input.dataset.lastCommittedValue).toBe("0.375000");

    input.remove();
  });

  it("records the selected value so an unchanged blur is not treated as an edit", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "*nA4";

    buildSelectOnFocus({ clearCommitted: true })({
      currentTarget: input,
      stopPropagation: vi.fn(),
    });

    const commit = vi.fn();
    expect(input.dataset.lastCommittedValue).toBe("*nA4");
    expect(commitTextInput(input, commit)).toEqual({ committed: false, metadata: null });
    expect(commit).not.toHaveBeenCalled();
    input.remove();
  });

  it("does not interfere with caret placement once the field is focused", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.append(input);
    input.focus();
    const preventDefault = vi.fn();

    buildSelectAllOnFirstPointerDown()({
      currentTarget: input,
      preventDefault,
      stopPropagation: vi.fn(),
    });

    expect(preventDefault).not.toHaveBeenCalled();
    input.remove();
  });
});
