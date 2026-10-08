import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import ManualSidebar from "./manual-sidebar.jsx";

describe("ManualSidebar", () => {
  it.each([
    ["HEXATONE tab", "manual-hexatone-tab"],
    ["SEQUENCER tab", "manual-sequencer-tab"],
    ["I/O tab", "manual-i-o-tab"],
    ["CALCULATOR tab", "manual-calculator-tab"],
  ])("opens at the requested %s section", (initialSectionTitle, expectedSectionId) => {
    const { container } = render(
      <ManualSidebar onClose={vi.fn()} initialSectionTitle={initialSectionTitle} />,
    );

    expect(screen.getByRole("link", { name: initialSectionTitle }).className).toContain(
      "manual-sidebar__toc-button--active",
    );
    expect(screen.getByRole("link", { name: initialSectionTitle }).getAttribute("href")).toBe(`#${expectedSectionId}`);
    expect(container.querySelector(".manual-sidebar__section")?.id).toBe("manual-about");
    expect(container.querySelector(`#${expectedSectionId}`)).not.toBeNull();
    expect(container.querySelector("#manual-performance-controls")).not.toBeNull();
  });

  it("reports section changes so its parent can remember the view", async () => {
    const onSectionChange = vi.fn();
    render(<ManualSidebar onSectionChange={onSectionChange} />);

    fireEvent.click(screen.getByRole("link", { name: "Quick Start" }));

    expect(onSectionChange).toHaveBeenCalledWith("Quick Start");
    expect(document.getElementById("manual-about")).not.toBeNull();
  });

  it("scrolls contextual help to its initial section in the complete document", async () => {
    const { container } = render(<nav id="sidebar">
      <ManualSidebar initialSectionTitle="HEXATONE Tab" />
    </nav>);
    const scroll = vi.fn();
    container.querySelector("#manual-hexatone-tab").scrollIntoView = scroll;
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "start" }));
    expect(container.querySelector("#manual-about")).not.toBeNull();
  });

  it("cross-links to earlier headings without removing the current section", () => {
    const changed = vi.fn();
    const { container } = render(<ManualSidebar initialSectionTitle="HEXATONE tab"
      onSectionChange={changed} />);
    const link = screen.getByRole("link", { name: "Performance Controls" });
    expect(link.getAttribute("href")).toBe("#manual-performance-controls");
    fireEvent.click(link);
    expect(changed).toHaveBeenCalledWith("Components");
    expect(container.querySelector("#manual-performance-controls")).not.toBeNull();
    expect(container.querySelector("#manual-hexatone-tab")).not.toBeNull();
  });

  it("reserves the measured sticky tab height for heading and fieldset anchors", () => {
    const sidebar = document.createElement("nav");
    sidebar.id = "sidebar";
    const tabs = document.createElement("div");
    tabs.className = "workspace-tabs";
    tabs.style.top = "10px";
    tabs.getBoundingClientRect = () => ({ height: 40 });
    const deadzone = document.createElement("div");
    deadzone.className = "workspace-tabs-deadzone";
    deadzone.getBoundingClientRect = () => ({ height: 6 });
    sidebar.append(tabs, deadzone);
    document.body.append(sidebar);
    const view = render(<ManualSidebar />, { container: sidebar.appendChild(document.createElement("div")) });
    expect(sidebar.querySelector(".manual-sidebar").style.getPropertyValue("--manual-anchor-inset")).toBe("56px");
    view.unmount();
    sidebar.remove();
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
    sectionsPanel.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "Top" }));
    expect(sectionsPanel.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });

    sidebar.scrollTop = 0;
    fireEvent.scroll(sidebar);
    expect(screen.queryByRole("button", { name: "Top" })).toBeNull();
  });
});
