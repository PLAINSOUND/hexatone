import { render, screen, fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi } from "vitest";
import ExquisArpeggiator from "./exquis-arpeggiator.jsx";

describe("Exquis Arpeggiator", () => {
  it("keeps the menu order with the tested IDs and saves/sends the selection", () => {
    const onChange = vi.fn();
    const setArpeggiatorPattern = vi.fn();
    render(
      <ExquisArpeggiator
        settings={{}}
        onChange={onChange}
        keysRef={{ current: { exquisLEDs: { setArpeggiatorPattern } } }}
      />,
    );
    const menu = screen.getByLabelText("Arpeggiator");
    expect([...menu.options].map((option) => option.text)).toEqual([
      "Order",
      "Up",
      "Down",
      "Convergent",
      "Divergent",
      "Note Repeat",
    ]);
    expect([...menu.options].map((option) => option.value)).toEqual(["1", "2", "3", "4", "5", "0"]);
    expect(menu.selectedOptions[0].text).toBe("Note Repeat");
    fireEvent.change(menu, { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith("exquis_arpeggiator_pattern", 4);
    expect(setArpeggiatorPattern).toHaveBeenCalledWith(4);
    expect(localStorage.getItem("exquis_arpeggiator_pattern")).toBe("4");
  });
});
