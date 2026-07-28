/**
 * src/manual/usermanual.js
 *
 * Entry script for the standalone user manual page.
 *
 * This bootstraps the full-page manual with the same content structure and
 * shared styles as the in-app MANUAL workspace.
 */
import "normalize.css";
import "./usermanual.css";
import "./manual-shared.css";
import { MANUAL_INTRO } from "./content.js";
import { escapeHtml, getManualSections } from "./markdown.js";

async function renderManual() {
  const target = document.getElementById("manual-content");
  const toc = document.getElementById("manual-toc");
  const intro = document.getElementById("manual-intro");
  const updated = document.getElementById("manual-updated");
  const status = document.querySelector(".manual-status");

  try {
    const manual = getManualSections();
    intro.textContent = MANUAL_INTRO;
    updated.innerHTML = manual.updated ? `<em>${escapeHtml(manual.updated)}</em>` : "";
    toc.innerHTML = manual.sections
      .map(
        (section) =>
          `<li><a class="manual-sidebar__toc-link" href="#${section.id}">${escapeHtml(section.title)}</a></li>`,
      )
      .join("");
    target.innerHTML = manual.sections
      .map(
        (section) =>
          `<fieldset id="${section.id}" class="manual-sidebar__section"><legend><b>${escapeHtml(section.title)}</b></legend><div class="manual-sidebar__content">${section.html}</div></fieldset>`,
      )
      .join("");
    if (status) status.remove();
  } catch (error) {
    if (status) status.remove();
    target.innerHTML = `<p class="manual-error">Could not render the user manual.</p><p>${escapeHtml(
      String(error),
    )}</p>`;
  }
}

renderManual();
