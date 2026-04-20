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
      <fieldset class="settings-panel" style={{ marginBottom: "0.5em", background: "#faf7f6" }}>
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

        <p style={{ marginTop: "0.45em", marginBottom: "0.55em" }}>
          Hexatone is an app designed for musicians interested in exploring rational tuning (JI). It is a tool for learning, playing, and composing, conceived as a companion to Scale Workshop, featuring microtonal isomorphic tuning layouts, live retuning, a scale workspace with rationalisation features, MIDI controller workflows, and external synth support.
        </p>
        {updated && (
          <p class="manual-sidebar__updated">
            <em>{updated}</em>
          </p>
        )}
      </fieldset>

      <fieldset style={{ marginBottom: "0.5em" }}>
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
