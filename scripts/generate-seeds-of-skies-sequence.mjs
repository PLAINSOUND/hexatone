import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import { monzoToHeji } from "../src/notation/heji.js";
import { parseExactInterval } from "../src/tuning/interval.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "Synths/SuperCollider-OSC/SeedsOfSkiesPrologue&PartOneEnd.scd");
const outputPath = resolve(
  root,
  "src/sequencer/preset-sequences/marc-sabat/Seeds-of-Skies-Alibis.json",
);

const source = await readFile(sourcePath, "utf8");
const scoreSource = source.match(/~score\s*=\s*~f\s*\*\s*\[([\s\S]*?)\n\];/)?.[1];
if (!scoreSource) throw new Error(`Could not find ~score in ${sourcePath}`);

const anchorMonzo = parseExactInterval("27/1").monzo;
const baseMidi = 69 - 12 * Math.log2(27);
const subtractMonzos = (left, right) => left.map((value, index) => value - (right[index] ?? 0));
const ratioValue = (text) => {
  const [numerator, denominator = "1"] = text.split("/").map(Number);
  return numerator / denominator;
};

let section = "Prologue";
const score = [];
for (const sourceLine of scoreSource.split("\n")) {
  if (sourceLine.includes("Libero")) section = "Libero";
  if (sourceLine.includes("Postlude")) section = "Postlude (Falling orb)";
  const chordText = sourceLine.match(/^\s*\[([^\]]*)\]/)?.[1];
  if (chordText == null) continue;
  const ratios = chordText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  score.push({ section, ratios });
}

const snapshots = score.map(({ section: snapshotSection, ratios }, snapshotIndex) => {
  const soundingRatios = ratios.filter((ratio) => ratio !== "0");
  const notes = soundingRatios.map((ratioText, noteIndex) => {
    const parsed = parseExactInterval(ratioText);
    if (!parsed.exact || !parsed.ratio || !parsed.monzo) {
      throw new Error(`Unsupported ratio ${ratioText} in snapshot ${snapshotIndex + 1}`);
    }
    const absoluteMonzo = subtractMonzos(parsed.monzo, anchorMonzo);
    const spelling = monzoToHeji(absoluteMonzo, { octaveMin: 0, octaveMax: 8 });
    if (!spelling.supported) {
      throw new Error(`No HEJI spelling for ${ratioText} in snapshot ${snapshotIndex + 1}`);
    }
    const midicents = baseMidi + 12 * Math.log2(ratioValue(ratioText));
    return {
      id: `seeds:${snapshotIndex + 1}:${noteIndex + 1}`,
      instanceKey: `seeds:${snapshotIndex + 1}:${noteIndex + 1}`,
      midicents,
      attackVelocity: 72,
      releaseVelocity: 64,
      velocity: 72,
      pressure: 0,
      timbre: 64,
      displayLabel: spelling.label.glyphs.replace(/[0-9]/g, ""),
      ratioText: parsed.ratio.toFraction().includes("/")
        ? parsed.ratio.toFraction()
        : `${parsed.ratio.toFraction()}/1`,
      monzo: parsed.monzo,
      sequenceSlot: noteIndex,
      start: noteIndex / (2 * soundingRatios.length),
      end: 1,
      rationalContext: {
        version: 1,
        anchorLabel: "A4",
        anchorRatioText: "27/1",
        anchorOctave: 4,
        globalOffsetMonzo: anchorMonzo,
        midiCentsOffset: baseMidi * 100,
      },
    };
  });
  const chordDescription = soundingRatios.length ? soundingRatios.join(" : ") : "Rest";
  return {
    id: snapshotIndex + 1,
    length: 1,
    description: `${snapshotSection} — ${chordDescription}`,
    descriptionManual: true,
    notes,
    manualTrigger: {
      articulation: "arpeggiate",
      styleId: "positional",
      styleParameters: null,
    },
  };
});

for (let snapshotIndex = 0; snapshotIndex < snapshots.length - 1; snapshotIndex += 1) {
  const snapshot = snapshots[snapshotIndex];
  const nextSnapshot = snapshots[snapshotIndex + 1];
  snapshot.notes = snapshot.notes.map((note) => {
    const replacement =
      nextSnapshot.notes.find((candidate) => candidate.ratioText === note.ratioText) ??
      nextSnapshot.notes.find((candidate) => candidate.sequenceSlot === note.sequenceSlot) ??
      null;
    return {
      ...note,
      end: replacement ? 1 + replacement.start : 1,
    };
  });
}

const sequence = {
  type: "hexatone-sequence",
  version: 4,
  name: "Seeds of Skies, Alibis",
  description:
    "The Prologue, Libero, and Falling Orb chord sequence from Seeds of Skies, expressed as exact ratios above 440/27 Hz. Manual triggering uses randomized positional arpeggiation and sustains each snapshot until the next one.",
  snapshotLabelMode: "labels",
  legatoMode: "per-note",
  autoCreateBars: false,
  manualArpeggiation: {
    mode: "all",
    styleId: "positional",
    initialSpreadMs: 1350,
    spreadVariation: 0.3,
    timingVariation: 0.5,
    decayMode: "timed",
    decayMs: 6000,
    decayVariation: 0.3,
    styleParameters: {},
  },
  transport: { unit: "sequence", anchorSeconds: 0 },
  tempi: [],
  snapshots,
  bars: [],
  repeats: [],
};

await writeFile(
  outputPath,
  await format(JSON.stringify(sequence), { parser: "json", printWidth: 100, tabWidth: 2 }),
);
console.log(`Wrote ${snapshots.length} snapshots to ${outputPath}`);
