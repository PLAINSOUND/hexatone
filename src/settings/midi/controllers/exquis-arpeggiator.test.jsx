import { render, screen, fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi } from "vitest";
import ExquisArpeggiator from "./exquis-arpeggiator.jsx";

describe("Exquis Arpeggiator", () => {
  it("keeps Note Repeat selected after saving and rerendering zero", () => {
    const onChange = vi.fn();
    const setArpeggiatorPattern = vi.fn();
    const props = { onChange, keysRef: { current: { exquisLEDs: { setArpeggiatorPattern } } } };
    const { rerender } = render(<ExquisArpeggiator {...props} settings={{}} />);
    const menu = screen.getByLabelText("Arpeggiator");
    fireEvent.change(menu, { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith("exquis_arpeggiator_pattern", 0);
    expect(setArpeggiatorPattern).toHaveBeenCalledWith(0);
    expect(localStorage.getItem("exquis_arpeggiator_pattern")).toBe("0");
    rerender(<ExquisArpeggiator {...props} settings={{ exquis_arpeggiator_pattern: 0 }} />);
    expect(menu.value).toBe("0");
    expect(menu.selectedOptions[0].text).toBe("Note Repeat");
  });
  it("shows Note Repeat for a saved experimental OFF selection", () => {
    render(<ExquisArpeggiator settings={{ exquis_arpeggiator_pattern: -1 }} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Arpeggiator").selectedOptions[0].text).toBe("Note Repeat");
    expect(screen.queryByRole("option", { name: "OFF" })).toBeNull();
  });
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
    expect(menu.selectedOptions[0].text).toBe("Order");
    fireEvent.change(menu, { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith("exquis_arpeggiator_pattern", 4);
    expect(setArpeggiatorPattern).toHaveBeenCalledWith(4);
    expect(localStorage.getItem("exquis_arpeggiator_pattern")).toBe("4");
  });
});
