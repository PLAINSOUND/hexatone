/**
 * src/credits.js
 *
 * Static credits/about panel content shown from the sidebar.
 *
 * Kept separate from app.jsx because it is pure presentation content with no
 * runtime wiring, and it changes on a different cadence from the main app
 * orchestration code.
 */

import { createCreditsContent } from "./credits-content.js";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "unknown";

function renderCreditNode(node, key) {
  if (typeof node === "string") return node;
  if (node.type === "link") {
    return (
      <a key={key} href={node.href} title={node.title}>
        {node.text}
      </a>
    );
  }
  if (node.type === "emphasis") {
    return <em key={key}>{node.children.map(renderCreditNode)}</em>;
  }
  if (node.type === "strong") {
    return <b key={key}>{node.children.map(renderCreditNode)}</b>;
  }
  if (node.type === "break") return <br key={key} />;
  return null;
}

const Credits = () => (
  <div class="credits-panel">
    {createCreditsContent(APP_VERSION).map((paragraph, paragraphIndex) => (
      <p key={paragraph.id ?? paragraphIndex} id={paragraph.id}>
        {paragraph.children.map(renderCreditNode)}
      </p>
    ))}
  </div>
);
export default Credits;
