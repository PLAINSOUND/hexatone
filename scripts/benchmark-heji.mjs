import fs from "node:fs";
import { createReferenceFrame, spellScaleFromReferenceFrame } from "../src/notation/reference-frame.js";

const preset = JSON.parse(fs.readFileSync(new URL(
  "../src/hexatone/preset-tunings/marc-sabat-nyky-ensemble/sabat-the-tree-modulations.json",
  import.meta.url,
), "utf8"));
const degrees = ["1/1", ...preset.scale.slice(0, -1)];
for (const anchorDegree of [56, 23, 56]) {
  const frame = createReferenceFrame({ anchorLabel: "\uE261A", anchorRatio: degrees[anchorDegree] });
  const start = performance.now();
  const labels = spellScaleFromReferenceFrame(degrees, frame);
  console.log(JSON.stringify({
    anchorDegree,
    milliseconds: Math.round((performance.now() - start) * 100) / 100,
    supported: labels.filter((label) => label.supported).length,
  }));
}
