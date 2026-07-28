import { fireEvent, render, screen } from "@testing-library/preact";
import { useRef } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import SidebarTopAction from "./sidebar-top-action.jsx";

const ScrollPanelHarness = () => {
  const scrollTargetRef = useRef(null);
  return (
    <div ref={scrollTargetRef} data-testid="scroll-panel">
      <SidebarTopAction scrollTargetRef={scrollTargetRef} threshold={48} />
    </div>
  );
};

describe("SidebarTopAction", () => {
  it("appears after its threshold and scrolls the target to the top", () => {
    render(<ScrollPanelHarness />);
    const scrollPanel = screen.getByTestId("scroll-panel");
    scrollPanel.scrollTo = vi.fn();

    expect(screen.queryByRole("button", { name: "Top" })).toBeNull();

    scrollPanel.scrollTop = 49;
    fireEvent.scroll(scrollPanel);
    fireEvent.click(screen.getByRole("button", { name: "Top" }));

    expect(scrollPanel.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
