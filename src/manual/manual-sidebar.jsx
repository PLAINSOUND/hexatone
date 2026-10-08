/**
 * src/manual/manual-sidebar.jsx
 *
 * Manual surface shared by contextual help and the MANUAL workspace tab.
 *
 * The standalone browser manual still has its own Vite entrypoint. This version
 * renders the complete document. Section links and prose cross-links navigate
 * anchors without removing earlier sections from the reader's scroll path.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { MANUAL_INTRO } from "./content.js";
import { getManualSections } from "./markdown.js";

const { updated, sections } = getManualSections();

const DEFAULT_SECTION_ID =
  sections.find((section) => section.title === "About")?.id ?? sections[0]?.id;

function getInitialSectionId(initialSectionTitle) {
  return (
    sections.find((section) => section.title.toLowerCase() === initialSectionTitle.toLowerCase())?.id ?? DEFAULT_SECTION_ID
  );
}

const ManualSidebar = ({
  onClose,
  initialSectionTitle = "About",
  onSectionChange,
  scrollContainerRef,
}) => {
  const [selectedSectionId, setSelectedSectionId] = useState(() =>
    getInitialSectionId(initialSectionTitle),
  );
  const [showTopButton, setShowTopButton] = useState(false);
  const sectionsPanelRef = useRef(null);
  const manualRef = useRef(null);

  useLayoutEffect(() => {
    const sidebar = scrollContainerRef?.current ?? document.getElementById("sidebar");
    const tabs = sidebar?.querySelector(".workspace-tabs");
    if (!tabs) return undefined;
    const updateInset = () => {
      const top = Math.max(0, parseFloat(getComputedStyle(tabs).top) || 0);
      const deadzone = sidebar.querySelector(".workspace-tabs-deadzone")?.getBoundingClientRect().height ?? 0;
      const inset = tabs.getBoundingClientRect().height + top + deadzone;
      manualRef.current?.style.setProperty("--manual-anchor-inset", `${inset}px`);
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateInset) : null;
    observer?.observe(tabs);
    window.addEventListener("resize", updateInset);
    updateInset();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateInset);
    };
  }, [scrollContainerRef]);

  useEffect(() => {
    // Contextual help starts at its requested section; a returning manual view
    // keeps the scroll position restored by App. Wait until parent effects finish.
    const frame = window.requestAnimationFrame(() => {
      const sidebar = scrollContainerRef?.current ?? document.getElementById("sidebar");
      if (sidebar?.scrollTop > 0) return;
      const requestedId = getInitialSectionId(initialSectionTitle);
      const hashId = window.location.hash.slice(1);
      const useHash = requestedId === DEFAULT_SECTION_ID && hashId.startsWith("manual-");
      const target = [...(manualRef.current?.querySelectorAll("[id]") ?? [])]
        .find(element => element.id === (useHash ? hashId : requestedId));
      if (target && (useHash || requestedId !== DEFAULT_SECTION_ID)) {
        target.scrollIntoView?.({ block: "start" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
    // The initial target is used only when this view mounts, not on link clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollContainerRef]);

  useEffect(() => {
    const sidebar = scrollContainerRef?.current ?? document.getElementById("sidebar");
    if (!sidebar) return undefined;

    const updateTopButton = () => {
      const panel = sectionsPanelRef.current;
      if (!panel) return;
      const panelBottom = panel.offsetTop + panel.offsetHeight;
      setShowTopButton(sidebar.scrollTop > panelBottom);
    };

    updateTopButton();
    sidebar.addEventListener("scroll", updateTopButton, { passive: true });
    window.addEventListener("resize", updateTopButton);

    return () => {
      sidebar.removeEventListener("scroll", updateTopButton);
      window.removeEventListener("resize", updateTopButton);
    };
  }, [scrollContainerRef]);

  return (
    <div class="manual-sidebar" ref={manualRef} onClick={event => {
      const link = event.target.closest?.("a[href^='#manual-']");
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const id = link.getAttribute("href").slice(1);
      const target = [...manualRef.current.querySelectorAll("[id]")].find(element => element.id === id);
      const sectionId = target?.closest(".manual-sidebar__section")?.id;
      const section = sections.find(item => item.id === sectionId);
      if (section) {
        setSelectedSectionId(section.id);
        onSectionChange?.(section.title);
      }
    }}>
      <fieldset class="settings-panel settings-panel--manual">
        <legend>
          <b>App</b>
        </legend>
        {onClose ? (
          <button type="button" class="settings-panel__close" onClick={onClose} title="Close">
            ✕
          </button>
        ) : null}

        <p class="manual-sidebar__intro">{MANUAL_INTRO}</p>
        <div class="manual-sidebar__meta">
          {updated && (
            <p class="manual-sidebar__updated">
              <em>{updated}</em>
            </p>
          )}
        </div>
      </fieldset>

      <fieldset ref={sectionsPanelRef} class="manual-sidebar__panel">
        <legend>
          <b>Sections</b>
        </legend>
        <ol class="manual-sidebar__toc">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={section.id === selectedSectionId ? "location" : undefined}
                class={`manual-sidebar__toc-button${
                  section.id === selectedSectionId ? " manual-sidebar__toc-button--active" : ""
                }`}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </fieldset>

      {sections.map((section) => (
        <fieldset key={section.id} id={section.id} class="manual-sidebar__section">
          <legend>
            <b>{section.title}</b>
          </legend>
          <div class="manual-sidebar__content" dangerouslySetInnerHTML={{ __html: section.html }} />
        </fieldset>
      ))}

      {showTopButton ? (
        <div class="settings-form__action-row manual-sidebar__footer">
          <span class="settings-form__action-group">
            <button
              type="button"
              class="preset-action-btn"
              onClick={() => {
                sectionsPanelRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
              }}
            >
              Top
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default ManualSidebar;
