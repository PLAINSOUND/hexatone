/**
 * src/manual/manual-sidebar.jsx
 *
 * Manual surface shared by contextual help and the MANUAL workspace tab.
 *
 * The standalone browser manual still has its own Vite entrypoint. This version
 * renders the common section picker and, intentionally, the selected section
 * plus every following section so the reader can continue scrolling naturally.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { MANUAL_INTRO } from "./content.js";
import { getManualSections } from "./markdown.js";

const { updated, sections } = getManualSections();

const DEFAULT_SECTION_ID =
  sections.find((section) => section.title === "About")?.id ?? sections[0]?.id;

function getInitialSectionId(initialSectionTitle) {
  return (
    sections.find((section) => section.title === initialSectionTitle)?.id ?? DEFAULT_SECTION_ID
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
  const selectedIndex = Math.max(
    0,
    sections.findIndex((section) => section.id === selectedSectionId),
  );
  // Starting at the selection keeps earlier material out of the scroll path
  // while allowing uninterrupted reading through all subsequent sections.
  const visibleSections = sections.slice(selectedIndex);

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
    <div class="manual-sidebar">
      <fieldset class="settings-panel settings-panel--manual">
        <legend>
          <b>App</b>
        </legend>
        {onClose ? (
          <button
            type="button"
            class="settings-panel__close"
            onClick={onClose}
            title="Close"
          >
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
              <button
                type="button"
                class={`manual-sidebar__toc-button${
                  section.id === selectedSectionId ? " manual-sidebar__toc-button--active" : ""
                }`}
                onClick={() => {
                  setSelectedSectionId(section.id);
                  onSectionChange?.(section.title);
                }}
              >
                {section.title}
              </button>
            </li>
          ))}
        </ol>
      </fieldset>

      {visibleSections.map((section) => (
        <fieldset key={section.id} id={section.id} class="manual-sidebar__section">
          <legend>
            <b>{section.title}</b>
          </legend>
          <div
            class="manual-sidebar__content"
            dangerouslySetInnerHTML={{ __html: section.html }}
          />
        </fieldset>
      ))}

      {showTopButton ? (
        <div class="settings-form__action-row manual-sidebar__footer">
          <span class="settings-form__action-group">
            <button
              type="button"
              class="preset-action-btn"
              onClick={() => {
                const sidebar =
                  scrollContainerRef?.current ?? document.getElementById("sidebar");
                if (sidebar) sidebar.scrollTo({ top: 0, behavior: "smooth" });
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
