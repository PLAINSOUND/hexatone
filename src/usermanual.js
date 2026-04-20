import "normalize.css";
import "./settings/settings.css";
import "./usermanual.css";
import { parseMarkdown, escapeHtml, manualMarkdown } from "./manual/markdown.js";

function groupSections(target) {
  const updatedEl = document.getElementById("manual-updated");
  const nodes = Array.from(target.childNodes);

  const h1 = nodes.find((node) => node.nodeType === Node.ELEMENT_NODE && node.tagName === "H1");
  if (h1) h1.remove();

  const firstParagraph = target.querySelector("p");
  if (firstParagraph?.textContent?.startsWith("Updated:")) {
    if (updatedEl) updatedEl.textContent = firstParagraph.textContent;
    firstParagraph.remove();
  }

  const remaining = Array.from(target.childNodes).filter(
    (node) => !(node.nodeType === Node.TEXT_NODE && !node.textContent.trim()),
  );

  const wrapper = document.createElement("div");
  wrapper.className = "manual-groups";

  let currentGroup = null;
  for (const node of remaining) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "H2") {
      currentGroup = document.createElement("fieldset");
      currentGroup.className = "manual-group markdown-body";
      const legend = document.createElement("legend");
      const strong = document.createElement("b");
      const anchor = document.createElement("a");
      anchor.href = `#${node.id}`;
      anchor.textContent = node.textContent;
      strong.appendChild(anchor);
      legend.appendChild(strong);
      currentGroup.appendChild(legend);
      wrapper.appendChild(currentGroup);
      continue;
    }

    if (!currentGroup) continue;
    currentGroup.appendChild(node);
  }

  target.innerHTML = "";
  target.appendChild(wrapper);
}

async function renderManual() {
  const target = document.getElementById("manual-content");
  const status = document.querySelector(".manual-status");
  try {
    target.innerHTML = parseMarkdown(manualMarkdown);
    if (status) status.remove();
    groupSections(target);
  } catch (error) {
    if (status) status.remove();
    target.innerHTML = `<p class="manual-error">Could not render the user manual.</p><p>${escapeHtml(
      String(error),
    )}</p>`;
  }
}

renderManual();
