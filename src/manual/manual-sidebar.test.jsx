import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import ManualSidebar from "./manual-sidebar.jsx";

describe("ManualSidebar", () => {
  it.each([
    ["Hexatone Tab", "manual-hexatone-tab"],
    ["Sequencer Tab", "manual-sequencer-tab"],
  ])("opens at the requested %s section", (initialSectionTitle, expectedSectionId) => {
    const { container } = render(
      <ManualSidebar onClose={vi.fn()} initialSectionTitle={initialSectionTitle} />,
    );

    expect(screen.getByRole("button", { name: initialSectionTitle }).className).toContain(
      "manual-sidebar__toc-button--active",
    );
    expect(container.querySelector(".manual-sidebar__section")?.id).toBe(expectedSectionId);
  });

  it("reports section changes so its parent can remember the view", async () => {
    const onSectionChange = vi.fn();
    render(<ManualSidebar onSectionChange={onSectionChange} />);

    screen.getByRole("button", { name: "Quick Start" }).click();

    expect(onSectionChange).toHaveBeenCalledWith("Quick Start");
  });

  it("shows a Top button after the Sections fieldset has been scrolled past", () => {
    const { container } = render(
      <nav id="sidebar">
        <ManualSidebar />
      </nav>,
    );
    const sidebar = container.querySelector("#sidebar");
    const sectionsPanel = container.querySelector(".manual-sidebar__panel");
    Object.defineProperty(sectionsPanel, "offsetTop", { configurable: true, value: 100 });
    Object.defineProperty(sectionsPanel, "offsetHeight", { configurable: true, value: 100 });

    expect(screen.queryByRole("button", { name: "Top" })).toBeNull();

    sidebar.scrollTop = 201;
    fireEvent.scroll(sidebar);
    expect(screen.getByRole("button", { name: "Top" })).not.toBeNull();

    sidebar.scrollTop = 0;
    fireEvent.scroll(sidebar);
    expect(screen.queryByRole("button", { name: "Top" })).toBeNull();
  });
});
