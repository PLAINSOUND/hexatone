import { describe, expect, it, vi } from "vitest";

import {
  buildSelectAllOnFirstPointerDown,
  buildSelectOnFocus,
} from "./field-props.js";

describe("sequencer field props", () => {
  it("preserves whole-value selection on the first pointer focus", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "0.375";
    document.body.append(input);
    input.addEventListener("focus", buildSelectOnFocus({
      setValue: () => "0.375000",
    }));

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
