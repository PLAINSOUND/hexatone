import { useState } from "preact/hooks";
import { getManualSections } from "./manual/markdown.js";

const { updated, sections } = getManualSections();

const DEFAULT_SECTION_ID = sections.find((section) => section.title === "About")?.id ?? sections[0]?.id;

const ManualSidebar = ({ onClose }) => {
  const [selectedSectionId, setSelectedSectionId] = useState(DEFAULT_SECTION_ID);
  const selectedIndex = Math.max(
    0,
    sections.findIndex((section) => section.id === selectedSectionId),
  );
  const visibleSections = sections.slice(selectedIndex);

  return (
    <div class="manual-sidebar">
      <fieldset class="settings-panel settings-panel--manual">
        <legend>
          <b>Manual</b>
        </legend>
        <button
          type="button"
          class="settings-panel__close"
          onClick={onClose}
          title="Close"
        >
          ✕
        </button>

        <p class="manual-sidebar__intro">
          PLAINSOUND HEXATONE and SEQUENCER is a webapp designed for exploring rational tuning (JI). A tool for learning, playing, and composing, it features 2D microtonal tuning layouts, a scale workspace with live retuning, modulation, and rationalisation, built-in sounds, support for MIDI controllers and external synths. Sounds may be captured as snapshots and edited into a step sequence.
        </p>
        {updated && (
          <p class="manual-sidebar__updated">
            <em>{updated}</em>
          </p>
        )}
      </fieldset>

      <fieldset class="manual-sidebar__panel">
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
                onClick={() => setSelectedSectionId(section.id)}
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

      <div class="manual-sidebar__footer">
        <button
          type="button"
          class="preset-action-btn"
          onClick={() => {
            const sidebar = document.getElementById("sidebar");
            if (sidebar) sidebar.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          Top
        </button>
      </div>
    </div>
  );
};

export default ManualSidebar;
