import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferSequenceHejiName, resolveSequenceHejiName } from "../src/sequencer/pitch-frame.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const presetDirectory = path.join(root, "src/sequencer/preset-sequences/marc-sabat");
const migrations = [
  {
    file: "FALL.json",
    frame: {
      id: "frame-1",
      referenceLabel: "A4",
      referenceFrequency: 441,
      referenceInterval: "27/16",
      hejiAnchorLabel: "*nE",
      hejiAnchorInterval: "81/64",
    },
  },
  {
    file: "Flight.json",
    frame: {
      id: "frame-1",
      referenceLabel: "A4",
      referenceFrequency: 440,
      referenceInterval: "27/16",
      hejiAnchorLabel: "*nE",
      hejiAnchorInterval: "81/64",
    },
  },
  {
    file: "Seeds-of-Skies-Alibis.json",
    frame: {
      id: "frame-1",
      referenceLabel: "A4",
      referenceFrequency: 440,
      referenceInterval: "27/1",
      hejiAnchorLabel: "*nA",
      hejiAnchorInterval: "27/1",
    },
  },
];

for (const { file, frame } of migrations) {
  const filename = path.join(presetDirectory, file);
  const sequence = JSON.parse(fs.readFileSync(filename, "utf8"));
  let maximumErrorCents = 0;
  for (const snapshot of sequence.snapshots ?? []) {
    snapshot.pitchFrameId = frame.id;
    for (const note of snapshot.notes ?? []) {
      const hejiName = inferSequenceHejiName(note, frame);
      if (!hejiName) throw new Error(`${file}: cannot infer octave for ${note.displayLabel}`);
      const resolved = resolveSequenceHejiName(hejiName, frame);
      const errorCents = Math.abs(Number(note.midicents) - resolved.midicents) * 100;
      maximumErrorCents = Math.max(maximumErrorCents, errorCents);
      if (errorCents > 0.001) {
        throw new Error(`${file}: ${hejiName} differs by ${errorCents} cents`);
      }
      note.hejiName = hejiName;
    }
  }
  sequence.version = 5;
  sequence.pitchFrames = [frame];
  let serialized = JSON.stringify(sequence, null, 2);
  if (file === "Seeds-of-Skies-Alibis.json") {
    serialized = serialized.replace(
      /\[\n\s+(-?\d+(?:\.\d+)?(?:,\n\s+-?\d+(?:\.\d+)?)*)\n\s+\]/g,
      (match) => `[${match.match(/-?\d+(?:\.\d+)?/g).join(", ")}]`,
    );
  }
  fs.writeFileSync(filename, `${serialized}\n`);
  console.log(`${file}: migrated; maximum pitch error ${maximumErrorCents.toFixed(9)} cents`);
}
