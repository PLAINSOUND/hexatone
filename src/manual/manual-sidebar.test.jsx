import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import ManualSidebar from "./manual-sidebar.jsx";

describe("ManualSidebar", () => {
  it.each([
    ["HEXATONE tab", "manual-hexatone-tab"],
    ["SEQUENCER tab", "manual-sequencer-tab"],
    ["SOUNDS and MIDI tabs", "manual-sounds-and-midi-tabs"],
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
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "instant" }));
    expect(container.querySelector("#manual-about")).not.toBeNull();
  });

  it("jumps to the tab section on every contextual opening despite an old scroll position", async () => {
    const sidebar = document.createElement("nav");
    sidebar.id = "sidebar";
    sidebar.scrollTop = 1200;
    document.body.append(sidebar);
    const props = { initialSectionTitle: "HEXATONE Tab", onClose: vi.fn() };
    let view = render(<ManualSidebar {...props} />, { container: sidebar.appendChild(document.createElement("div")) });
    const firstScroll = vi.fn();
    sidebar.querySelector("#manual-hexatone-tab").scrollIntoView = firstScroll;
    await waitFor(() => expect(firstScroll).toHaveBeenCalledOnce());
    view.unmount();
    sidebar.scrollTop = 3600;
    view = render(<ManualSidebar {...props} />, { container: sidebar.appendChild(document.createElement("div")) });
    const secondScroll = vi.fn();
    sidebar.querySelector("#manual-hexatone-tab").scrollIntoView = secondScroll;
    await waitFor(() => expect(secondScroll).toHaveBeenCalledOnce());
    view.unmount();
    sidebar.remove();
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

  it("adds only enough bottom space for the last help section to reach the tabs", () => {
    const { container } = render(<nav id="sidebar">
      <div class="workspace-tabs" style={{ top: "10px" }} />
      <ManualSidebar />
    </nav>);
    const sidebar = container.querySelector("#sidebar");
    Object.defineProperty(sidebar, "clientHeight", { configurable: true, value: 1500 });
    container.querySelector(".workspace-tabs").getBoundingClientRect = () => ({ height: 40 });
    [...container.querySelectorAll(".manual-sidebar__section")].at(-1).getBoundingClientRect = () => ({ height: 900 });
    fireEvent(window, new Event("resize"));
    const manual = container.querySelector(".manual-sidebar");
    expect(manual.style.getPropertyValue("--manual-end-space")).toBe("550px");
    Object.defineProperty(sidebar, "clientHeight", { configurable: true, value: 800 });
    fireEvent(window, new Event("resize"));
    expect(manual.style.getPropertyValue("--manual-end-space")).toBe("0px");
  });

  it("centres the close button on the fieldset corner and leaves scrolling to its sticky track", () => {
    const onClose = vi.fn();
    const { container } = render(<nav id="sidebar">
      <div class="workspace-tabs" style={{ top: "10px" }} />
      <ManualSidebar onClose={onClose} />
    </nav>);
    const sidebar = container.querySelector("#sidebar");
    const tabs = container.querySelector(".workspace-tabs");
    tabs.getBoundingClientRect = () => ({ height: 40 });
    const manual = container.querySelector(".manual-sidebar");
    manual.getBoundingClientRect = () => ({ top: 100, right: 400 });
    const anchor = container.querySelector(".manual-sidebar__close-anchor");
    anchor.getBoundingClientRect = () => ({ top: 98, left: 390, width: 24, height: 24 });
    const button = screen.getByRole("button", { name: "Close contextual manual" });
    button.getBoundingClientRect = () => ({ height: 24 });
    expect(button.parentElement.className).toBe("manual-sidebar__close-track");
    fireEvent(window, new Event("resize"));
    expect(manual.style.getPropertyValue("--manual-close-corner-y")).toBe("10px");
    expect(manual.style.getPropertyValue("--manual-close-corner-x")).toBe("2px");
    expect(manual.style.getPropertyValue("--manual-close-half-height")).toBe("12px");
    const geometry = manual.style.cssText;
    for (const top of [50, 500, 1000, 0]) {
      sidebar.scrollTop = top;
      fireEvent.scroll(sidebar);
      expect(manual.style.cssText).toBe(geometry);
      expect(button.style.transform).toBe("");
    }
    fireEvent.click(button);
    expect(onClose).toHaveBeenCalledOnce();
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
