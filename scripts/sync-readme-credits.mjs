import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCreditsContent } from "../src/credits-content.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = path.join(projectRoot, "README.md");
const packagePath = path.join(projectRoot, "package.json");
const beginMarker = "<!-- BEGIN GENERATED CREDITS: edit src/credits-content.js -->";
const endMarker = "<!-- END GENERATED CREDITS -->";

function renderNode(node) {
  if (typeof node === "string") return node;
  if (node.type === "link") return `[${node.text}](${node.href})`;
  if (node.type === "emphasis") return `*${node.children.map(renderNode).join("")}*`;
  if (node.type === "strong") return `**${node.children.map(renderNode).join("")}**`;
  if (node.type === "break") return "<br>\n";
  throw new Error(`Unknown credit node type: ${node.type}`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const generated = [
  beginMarker,
  ...createCreditsContent(packageJson.version).map((paragraph) =>
    paragraph.children.map(renderNode).join(""),
  ),
  endMarker,
].join("\n\n");

const current = fs.readFileSync(readmePath, "utf8");
let next;
if (current.includes(beginMarker) && current.includes(endMarker)) {
  const start = current.indexOf(beginMarker);
  const end = current.indexOf(endMarker, start) + endMarker.length;
  next = `${current.slice(0, start)}${generated}${current.slice(end)}`;
} else {
  const sectionStart = current.indexOf("\n", current.indexOf("[Developer Quickstart]")) + 1;
  const sectionEnd = current.indexOf("## Current State");
  if (sectionStart <= 0 || sectionEnd < 0) {
    throw new Error("Could not locate the README credits section");
  }
  next = `${current.slice(0, sectionStart)}\n${generated}\n\n${current.slice(sectionEnd)}`;
}

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error("README credits are outdated. Run: yarn credits:sync");
    process.exitCode = 1;
  }
} else if (next !== current) {
  fs.writeFileSync(readmePath, next);
  console.log("Updated README credits from src/credits-content.js");
}
