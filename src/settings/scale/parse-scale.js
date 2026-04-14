/*
  Parsing scale information encoded in the Scala .scl format.
  http://www.huygens-fokker.org/scala/scl_format.html

  This parser also allows encoding of key labels and key colors (hex format, i.e. #ffffff)
  Extended HEXATONE_* and ABLETON_* comment lines are read for full round-trip fidelity.
*/

export const parseScale = (scala) => {
  const out = {
    scale: [],
    colors: [],
    labels: [],
    errors: [],
  };
  var lines = scala.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let match;
    if (line.match(/^\s*$/)) {
      continue;
    } else if ((match = line.match(/^\s*!\s*HEXATONE_NOTE_NAMES\s+(.+)$/))) {
      out.hexatone_note_names = match[1].split(",").map((s) => s.trim());
    } else if ((match = line.match(/^\s*!\s*HEXATONE_NOTE_COLORS\s+(.+)$/))) {
      out.hexatone_note_colors = match[1].split(",").map((s) => s.trim());
    } else if ((match = line.match(/^\s*!\s*HEXATONE_REFERENCE_PITCH\s+(\d+)\s+([\d.]+)$/))) {
      out.hexatone_reference_degree = parseInt(match[1]);
      out.hexatone_fundamental = parseFloat(match[2]);
    } else if ((match = line.match(/^\s*!\s*HEXATONE_midiin_central_degree\s+(\d+)$/))) {
      out.hexatone_midiin_central_degree = parseInt(match[1]);
    } else if ((match = line.match(/^\s*!\s*ABLETON_REFERENCE_PITCH\s+(\d+)\s+([\d.]+)$/))) {
      out.ableton_reference_note = parseInt(match[1]);
      out.ableton_reference_freq = parseFloat(match[2]);
    } else if ((match = line.match(/^\s*!\s*ABLETON_ROOT_NOTE\s+(\d+)$/))) {
      out.ableton_root_note = parseInt(match[1]);
    } else if (line.match(/^\s*!/)) {
      if (!out.filename) {
        const fname = line.split("!", 2)[1].trim();
        if (fname) out.filename = fname;
      }
      continue;
    } else if (!out.description) {
      out.description = line.trim();
    } else if (!out.equivSteps && line.match(/^\s*[0-9]+\s*$/)) {
      out.equivSteps = parseInt(line.trim());
    } else if (
      (match = line.match(/^\s*(-?[0-9]+\.[0-9]*|[0-9]+\/[0-9]*|[0-9]+\\[0-9]*|[0-9]+)\s*$/))
    ) {
      out.scale.push(match[1]);
      out.labels.push(null);
      out.colors.push(null);
    } else if (
      (match = line.match(
        /^\s*(-?[0-9]+\.[0-9]*|[0-9]+\/[0-9]*|[0-9]+\\[0-9]*|[0-9]+)\s+(#[a-fA-F0-9]{6})$/,
      ))
    ) {
      out.scale.push(match[1]);
      out.labels.push(null);
      out.colors.push(match[2].toLowerCase());
    } else if (
      (match = line.match(
        /^\s*(-?[0-9]+\.[0-9]*|[0-9]+\/[0-9]*|[0-9]+\\[0-9]*|[0-9]+)\s+(.*)\s+(#[a-fA-F0-9]{6})$/,
      ))
    ) {
      out.scale.push(match[1]);
      out.labels.push(match[2].trim());
      out.colors.push(match[3].toLowerCase());
    } else if (
      (match = line.match(
        /^\s*(-?[0-9]+\.[0-9]*|[0-9]+\/[0-9]*|[0-9]+\\[0-9]*|[0-9]+\\[0-9]*|[0-9]+)\s+(.*)\s*$/,
      ))
    ) {
      out.scale.push(match[1]);
      out.labels.push(match[2].trim());
      out.colors.push(null);
    } else {
      out.errors.push({ line: i, value: line, error: "Unexpected token." });
    }
  }
  if (out.equivSteps !== out.scale.length) {
    out.errors.push({
      line: lines.length,
      error: `${out.equivSteps} pitches specified, but ${out.scale.length} provided`,
    });
  }
  return out;
};

// Convert a scale degree string to cents.
// Handles: ratio (3/2), decimal cents (701.955), EDO step (7\12), plain integer (3 → 3/1).
export const scalaToCents = (line) => {
  if (typeof line === "number") {
    return line > 0 ? (1200 * Math.log(line)) / Math.log(2) : 0;
  }
  if (line.match(/\//)) {
    const nd = line.split("/");
    return (1200 * Math.log(parseInt(nd[0]) / parseInt(nd[1]))) / Math.log(2);
  } else if (line.match(/\./)) {
    return parseFloat(line);
  } else if (line.match(/\\/)) {
    const edo = line.split("\\");
    return (parseFloat(edo[0]) * 1200) / parseFloat(edo[1]);
  } else {
    return (1200 * Math.log(parseInt(line))) / Math.log(2);
  }
};

/**
 * Parse and validate a Scala-style interval string.
 *
 * @param {string} str   Raw user input (ratio, cents, EDO step, plain integer).
 * @param {'degree'|'interval'} context
 *   'degree'   — 0¢ is valid (unison in a scale).
 *   'interval' — 0¢ is invalid (meaningless bend / equave range).
 * @returns {{ cents: number|null, valid: boolean, error: string|null }}
 */
export function parseScalaInterval(str, context = "degree") {
  if (typeof str !== "string" || str.trim() === "") {
    return { cents: null, valid: false, error: "empty" };
  }
  let cents;
  try {
    cents = scalaToCents(str);
  } catch {
    return { cents: null, valid: false, error: "parse error" };
  }
  if (!isFinite(cents) || isNaN(cents)) {
    return { cents: null, valid: false, error: "invalid" };
  }
  if (cents < 0) {
    return { cents, valid: false, error: "negative" };
  }
  if (cents === 0 && context === "interval") {
    return { cents: 0, valid: true, error: null };
  }
  return { cents, valid: true, error: null };
}

// Normalise a scale degree to either ratio or cents string.
// EDO steps (n\m) and plain integers are converted to cents.
// Ratios and cents strings are returned unchanged.
export const normaliseDegree = (line) => {
  if (!line) return "0.";
  if (line.match(/\//)) return line; // ratio — keep as-is
  if (line.match(/\./)) return line; // cents — keep as-is
  if (line.match(/\\/)) {
    // EDO step — convert to cents
    const cents = scalaToCents(line);
    return cents.toFixed(6);
  }
  // plain integer — treat as ratio n/1
  return `${parseInt(line)}/1`;
};

// Convert scale data from string to label
export const scalaToLabels = (line) => {
  if (line.match(/\//)) {
    if (line.length > 7) {
      const nd = line.split("/");
      const cents = (1200 * Math.log(parseInt(nd[0]) / parseInt(nd[1]))) / Math.log(2);
      return " " + Math.round(cents).toString() + ".";
    } else {
      return line;
    }
  } else if (line.match(/\\/)) {
    const edo = line.split("\\");
    const cents = (parseFloat(edo[0]) * 1200) / parseFloat(edo[1]);
    return " " + Math.round(cents).toString() + ".";
  } else if (line.match(/\./)) {
    const cents = parseFloat(line);
    return " " + Math.round(cents).toString() + ".";
  } else {
    return line + "/1";
  }
};

// Convert parsed scale data to labels
export const parsedScaleToLabels = (scale) => {
  return scale.map((i) => scalaToLabels(i));
};

// ─── Serialisers ──────────────────────────────────────────────────────────────

// Build a plain standard Scala file string from current settings.
// EDO steps are converted to cents; integers become ratios.
// No extended metadata — maximum compatibility.
export const settingsToPlainScala = (settings) => {
  const name = settings.name || "custom";
  const description = settings.description || name;
  // settings.scale has degree 0 (0.0) prepended and equivInterval appended by normalize();
  // preset_values.js stores the raw scala array without degree 0.
  // We work from settings.scale_import parse if available, else reconstruct.
  const rawScale = getRawScale(settings);
  const lines = [
    `! ${name}.scl`,
    `!`,
    description,
    rawScale.length.toString(),
    `!`,
    ...rawScale.map((d) => ` ${normaliseDegree(d)}`),
  ];
  return lines.join("\n") + "\n";
};

// Build an Ableton .ascl file string.
export const settingsToAbletonScala = (settings) => {
  const name = settings.name || "custom";
  const description = settings.description || name;
  const rawScale = getRawScale(settings);
  const refNote = (settings.midiin_central_degree || 60) + (settings.reference_degree || 0);
  const rootNote = (settings.midiin_central_degree || 60) % 12;
  const lines = [
    `! ${name}.ascl`,
    `!`,
    `! ABLETON_REFERENCE_PITCH ${refNote} ${settings.fundamental || 440}`,
    `! ABLETON_ROOT_NOTE ${rootNote}`,
    `!`,
    description,
    rawScale.length.toString(),
    `!`,
    ...rawScale.map((d) => ` ${normaliseDegree(d)}`),
  ];
  return lines.join("\n") + "\n";
};

// Build an Ableton/Hexatone .ascl file string with full round-trip metadata.
export const settingsToHexatonScala = (settings) => {
  const name = settings.name || "custom";
  const description = settings.description || name;
  const rawScale = getRawScale(settings);
  const refNote = (settings.midiin_central_degree || 60) + (settings.reference_degree || 0);
  const rootNote = (settings.midiin_central_degree || 60) % 12;
  const noteNames = (settings.note_names || []).join(", ");
  const noteColors = (settings.note_colors || []).join(", ");
  const lines = [
    `! ${name}.ascl`,
    `!`,
    `! ABLETON_REFERENCE_PITCH ${refNote} ${settings.fundamental || 440}`,
    `! ABLETON_ROOT_NOTE ${rootNote}`,
    `!`,
    `! HEXATONE_REFERENCE_PITCH ${settings.reference_degree || 0} ${settings.fundamental || 440}`,
    `! HEXATONE_midiin_central_degree ${settings.midiin_central_degree || 60}`,
    noteNames ? `! HEXATONE_NOTE_NAMES ${noteNames}` : null,
    noteColors ? `! HEXATONE_NOTE_COLORS ${noteColors}` : null,
    `!`,
    description,
    rawScale.length.toString(),
    `!`,
    ...rawScale.map((d) => ` ${normaliseDegree(d)}`),
  ].filter((l) => l !== null);
  return lines.join("\n") + "\n";
};

// Build a .kbm keyboard mapping file string from current settings.
export const settingsToKbm = (settings) => {
  const equivSteps = settings.equivSteps || 12;
  const midiin_central_degree = settings.midiin_central_degree || 60;
  const reference_degree = settings.reference_degree || 0;
  const refNote = midiin_central_degree + reference_degree;
  const fundamental = settings.fundamental || 440;
  const mapping = [...Array(equivSteps).keys()].map((i) => i.toString());
  const lines = [
    `! Keyboard mapping file`,
    `! Map size:`,
    equivSteps.toString(),
    `! First MIDI note:`,
    `0`,
    `! Last MIDI note:`,
    `127`,
    `! Middle note (MIDI note number for degree 0):`,
    midiin_central_degree.toString(),
    `! Reference note (MIDI note for reference frequency):`,
    refNote.toString(),
    `! Reference frequency (Hz):`,
    fundamental.toString(),
    `! Scale degree for reference note:`,
    `0`,
    `! Pitch mapping (scale degree per MIDI note):`,
    ...mapping,
  ];
  return lines.join("\n") + "\n";
};

// ─── Internal helper ──────────────────────────────────────────────────────────

// Extract the raw scale array (without degree 0, with equivInterval at end)
// as stored in preset_values.js / settings.scale before normalize() processes it.
// settings.scale after normalize() has 0 prepended and equivInterval popped off.
// We detect which form we have by checking if settings.scale[0] === 0.
const getRawScale = (settings) => {
  if (!settings.scale || !settings.scale.length) return [];
  const s = settings.scale;
  // After normalize(), scale[0] is 0 (the implicit fundamental) and equivInterval
  // has been popped. We need to reconstruct: drop the first element and append equivInterval.
  if ((parseFloat(s[0]) === 0 || s[0] === "0" || s[0] === 0) && settings.equivInterval) {
    return [...s.slice(1), settings.equivInterval.toFixed(6)];
  }
  // Pre-normalize form — use as-is
  return s;
};

// Serialise current settings as a compact JSON object for user-preset export.
export const settingsToPresetJson = (settings) => {
  const PRESET_FIELDS = [
    "name",
    "description",
    "short_description",
    "scale",
    "equivSteps",
    "note_names",
    "note_colors",
    "key_labels",
    "spectrum_colors",
    "fundamental_color",
    "fundamental",
    "reference_degree",
    "rSteps",
    "drSteps",
    "hexSize",
    "rotation",
    "center_degree",
  ];

  const preset = {};
  for (const key of PRESET_FIELDS) {
    if (settings[key] !== undefined) preset[key] = settings[key];
  }

  // Pretty-print with 2-space indent, matching preset_values.js style
  return JSON.stringify(preset, null, 2);
};

// ─── Folder import helper ─────────────────────────────────────────────────────

// Parse a single file (by name and text content) into a preset object.
// Handles .json (Hexatone preset JSON), .ascl and .scl (Scala formats).
// Returns a preset object or null if the file could not be parsed.
export const fileToPreset = (filename, text) => {
  const ext = filename.split(".").pop().toLowerCase();

  if (ext === "json") {
    try {
      const preset = JSON.parse(text);
      // Must have at minimum a name and a scale
      if (!preset.name || !preset.scale) return null;
      return preset;
    } catch {
      return null;
    }
  }

  if (ext === "scl" || ext === "ascl") {
    const parsed = parseScale(text);
    if (!parsed.scale || !parsed.scale.length) return null;

    const name = parsed.filename || filename.replace(/\.(a?scl)$/i, "").replace(/_/g, " ");

    const note_names = parsed.hexatone_note_names || [];
    const note_colors = parsed.hexatone_note_colors || [];
    const hasMetadata = note_names.some((n) => n) || note_colors.some((c) => c);

    return {
      name,
      description: parsed.description || "",
      scale_import: text,
      scale: parsed.scale,
      equivSteps: parsed.equivSteps,
      note_names,
      note_colors,
      key_labels: hasMetadata ? "note_names" : "scala_names",
      spectrum_colors: !hasMetadata,
      fundamental_color: "#f2e3e3",
      fundamental: parsed.hexatone_fundamental || 440,
      reference_degree: parsed.hexatone_reference_degree || 0,
      midiin_central_degree: parsed.hexatone_midiin_central_degree || 60,
    };
  }

  return null;
};
