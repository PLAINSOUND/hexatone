/**
 * src/settings/normalize-settings.js
 *
 * Converts persisted/UI settings into the coherent live settings object used by
 * the runtime layers.
 *
 * This is the bridge between raw preset/query/storage values and the app's
 * runtime model. It parses scale text, derives spelling and colour state,
 * constructs workspace-dependent tuning data, and fills structural defaults so
 * keyboard, synth, and sequencer code can assume a consistent settings shape.
 */

import { normaliseHejiAnchorRatio, scalaToLabels } from "./scale/parse-scale.js";
import keyCodeToCoords from "../keyboard/keycodes";
import { hex2rgb, rgb2hsv, HSVtoRGB2, rgbToHex } from "../keyboard/color_utils.js";
import { buildHejiNotationFrame, resolveEffectiveHejiAnchor } from "../notation/heji-frame.js";
import { buildPitchFrame } from "../notation/pitch-frame.js";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "../tuning/workspace.js";
export { deriveHejiAnchor, deriveHejiAnchorFromNoteNames } from "../notation/heji-normalization.js";
import { deriveAutoNoteColors } from "./scale/auto-colors.js";
import { deriveKeyColorFlags } from "./scale/key-colors-mode.js";

const AUTO_COLOR_CACHE_LIMIT = 8;
const autoColorNormalizationCache = new Map();

function buildAutoColorCacheKey(settings) {
  return JSON.stringify({
    scale: settings.scale ?? [],
    note_names: settings.note_names ?? [],
    note_colors: settings.note_colors ?? [],
    key_labels: settings.key_labels ?? "",
    reference_degree: settings.reference_degree ?? 0,
    fundamental: settings.fundamental ?? 0,
    name: settings.name ?? "",
    short_description: settings.short_description ?? "",
    heji_anchor_ratio: settings.heji_anchor_ratio ?? "",
    heji_anchor_label: settings.heji_anchor_label ?? "",
    heji_tempered_only: settings.heji_tempered_only === true,
    heji_show_cents: settings.heji_show_cents !== false,
    heji_names: settings.heji_names ?? [],
    heji_names_table: settings.heji_names_table ?? [],
    prime_family_colors: settings.prime_family_colors ?? [],
    key_colors_mode: settings.key_colors_mode ?? "",
    auto_colors: settings.auto_colors === true,
    spectrum_colors: settings.spectrum_colors === true,
    fundamental_color: settings.fundamental_color ?? "",
    equivSteps: settings.equivSteps ?? 0,
  });
}

function getCachedAutoNormalizedColors(settings, compute) {
  const cacheKey = buildAutoColorCacheKey(settings);
  const cached = autoColorNormalizationCache.get(cacheKey);
  if (cached) return cached;
  const result = compute();
  autoColorNormalizationCache.set(cacheKey, result);
  if (autoColorNormalizationCache.size > AUTO_COLOR_CACHE_LIMIT) {
    const oldestKey = autoColorNormalizationCache.keys().next().value;
    autoColorNormalizationCache.delete(oldestKey);
  }
  return result;
}

export function deriveSpectrumNoteColors(settings, fundamentalColor) {
  const count = settings.equivSteps || settings.scale?.length || 0;
  if (!count) return [];

  let fcolor = hex2rgb(`#${fundamentalColor || "ffdbe8"}`);
  fcolor = rgb2hsv(fcolor[0], fcolor[1], fcolor[2]);
  const baseHue = fcolor.h / 360;
  const sat = fcolor.s / 100;
  const val = fcolor.v / 100;

  return Array.from({ length: count }, (_, index) => {
    const hue = (baseHue + index / count) % 1;
    const rgb = HSVtoRGB2(hue, sat, val);
    return rgbToHex(rgb.red, rgb.green, rgb.blue).replace(/^#/, "");
  });
}

function deriveFallbackKeyColorMode(settings, requestedMode) {
  const explicitlyRequestedManual = Object.prototype.hasOwnProperty.call(settings ?? {}, "key_colors_mode")
    && settings?.key_colors_mode === "manual";
  if (requestedMode !== "manual" || !explicitlyRequestedManual) return requestedMode;
  const storedNoteColors = Array.isArray(settings?.note_colors) ? settings.note_colors : [];
  if (storedNoteColors.length > 0) return requestedMode;

  const count = settings?.equivSteps || settings?.scale?.length || 0;
  if (count > 0) return "spectrum";

  const autoCandidate = getCachedAutoNormalizedColors(settings, () => deriveAutoNoteColors(settings, {
    heji_names: settings.heji_names,
    heji_names_table: settings.heji_names_table,
    hejiFrame: settings.heji_frame,
  }));
  if (Array.isArray(autoCandidate) && autoCandidate.length > 0) return "auto";
  return requestedMode;
}

// Color fields only — changes here should NOT reconstruct the hex grid.
export const normalizeColors = (settings) => {
  const fundamental_color = (settings.fundamental_color || "").replace(/#/, "");
  const requestedFlags = deriveKeyColorFlags(settings);
  const key_colors_mode = deriveFallbackKeyColorMode(settings, requestedFlags.key_colors_mode);
  const colorFlags = deriveKeyColorFlags({
    ...settings,
    key_colors_mode,
  });
  const sourceNoteColors = colorFlags.auto_colors
    ? getCachedAutoNormalizedColors(settings, () => deriveAutoNoteColors(settings, {
      heji_names: settings.heji_names,
      heji_names_table: settings.heji_names_table,
      hejiFrame: settings.heji_frame,
    }))
    : (colorFlags.spectrum_colors
      ? deriveSpectrumNoteColors(settings, fundamental_color)
      : (settings.note_colors || []));
  const note_colors = sourceNoteColors.map((c) => (c ? c.replace(/#/, "") : "ffffff"));

  return {
    fundamental_color,
    note_colors: note_colors.length > 0 ? note_colors : [],
    ...colorFlags,
  };
};

// Everything except colors — changes here rebuild the Keys instance.
export const normalizeStructural = (settings, options = {}) => {
  const rotation = (settings.rotation * Math.PI) / 180.0; // converts degrees to radians
  const result = {
    ...settings,
    keyCodeToCoords,
    rotation,
    // Provide empty array defaults for label arrays that could be undefined.
    // This prevents crashes when accessing note_names[i] or scala_names[i].
    // When the array is empty, the hex just shows no label.
    note_names: settings.note_names || [],
    scala_names: [], // Will be populated below if scale exists
  };
  const legacyEquavesMode = settings.key_labels === "equaves";
  result["equaves"] = !!settings.show_equaves || legacyEquavesMode;

  // Set label flags based on key_labels selection.
  // These flags (degree, note, scala, cents, heji, equaves, no_labels) are checked in keys.js
  // to decide what text to draw on each hex.
  if (settings.key_labels === "enumerate") {
    result["degree"] = true;
  } else if (settings.key_labels === "note_names") {
    result["note"] = true;
  } else if (settings.key_labels === "scala_names") {
    result["scala"] = true;
  } else if (settings.key_labels === "cents") {
    result["cents"] = true;
  } else if (settings.key_labels === "heji") {
    result["heji"] = true;
  } else if (settings.key_labels === "no_labels" || legacyEquavesMode) {
    result["no_labels"] = true;
  } else {
    // Handle undefined or unknown values:
    // Default to no_labels (blank keys) which requires no data.
    result["no_labels"] = true;
  }

  // Build scala_names and normalized scale array from the scale setting.
  // This is required for key_labels === 'scala_names' and for cents calculations.
  if (settings.scale) {
    const scaleAsStrings = settings.scale.map((i) => String(i));
    const workspace = options.workspace ?? createScaleWorkspace(settings);
    const workspaceRuntime =
      options.tuningRuntime ??
      normalizeWorkspaceForKeys(workspace);
    const scala_names = scaleAsStrings.map((i) => scalaToLabels(i));
    scala_names.pop();
    scala_names.unshift("1/1");
    result["scala_names"] = scala_names;
    result["scale"] = workspaceRuntime.scale;
    result["equivInterval"] = workspaceRuntime.equivInterval;
    result["equivSteps"] = workspaceRuntime.equivSteps;
    const hejiSupported = Math.abs(workspaceRuntime.equivInterval % 1200 ?? 0) < 0.001;
    result["heji_supported"] = hejiSupported;
    result["pitch_frame"] = null;

    // Build HEJI frame and names from the persistent spelling anchor.
    //
    // The reference frame is defined by two user-supplied values:
    //   heji_anchor_ratio — the ratio from scale degree 0 (1/1) of the pitch
    //     whose tuning-meter deviation is 0¢.  This is a free-form Scala
    //     interval string; it does not need to coincide with any scale degree.
    //     Default "1/1" = root is the 0¢ reference.
    //   heji_anchor_label — the HEJI pitch-class spelling for that pitch
    //     (e.g. "nA" for A natural).
    //
    // Every scale degree's cents-from-anchor is computed as:
    //   scaleCents[degree] − scalaToCents(heji_anchor_ratio)
    //
    // Degree 0 is always 1/1 (the root); the scale entries are degrees 1..n-1
    // (the equave has already been popped off `scale` above).  We reconstruct the
    // full degree list as ratioText strings from the original scaleAsStrings:
    //   degree 0  → "1/1"
    //   degrees 1..n-1 → scaleAsStrings[0..n-2]  (equave was last, now popped)
    const degreeTexts = ["1/1", ...scaleAsStrings.slice(0, -1)];
    try {
      const effectiveHejiAnchor = resolveEffectiveHejiAnchor({
        referenceDegree: settings.reference_degree,
        noteNames: settings.note_names,
        degreeTexts,
        fundamental: settings.fundamental,
        scaleCents: workspaceRuntime.scale,
        explicitAnchorLabel: settings.heji_anchor_label || "",
        explicitAnchorRatio: normaliseHejiAnchorRatio(settings.heji_anchor_ratio || ""),
      });
      const pitchFrame = buildPitchFrame({
        ...settings,
        heji_anchor_label: effectiveHejiAnchor.anchorLabel,
        heji_anchor_ratio: effectiveHejiAnchor.anchorRatioText,
      }, workspace);
      result["heji_anchor_label_effective"] = effectiveHejiAnchor.anchorLabel;
      result["heji_anchor_ratio_effective"] = effectiveHejiAnchor.anchorRatioText;
      result["pitch_frame"] = pitchFrame;
      result["heji_tempered_only_effective"] =
        settings.heji_tempered_only === true || effectiveHejiAnchor.inferredTemperedOnly === true;

      if (!hejiSupported) {
        result["heji_names"] = [];
        result["heji_names_keys"] = [];
        result["heji_frame"] = null;
        result["heji_warning"] = "Non-octave equave cannot generate consistent note names.";
        return result;
      }

      const hejiFrame = buildHejiNotationFrame({
        referenceDegree: settings.reference_degree,
        noteNames: settings.note_names,
        degreeTexts,
        fundamental: settings.fundamental,
        scaleCents: workspaceRuntime.scale,
        explicitAnchorLabel: effectiveHejiAnchor.anchorLabel,
        explicitAnchorRatio: effectiveHejiAnchor.anchorRatioText,
        temperedOnly:
          settings.heji_tempered_only === true || effectiveHejiAnchor.inferredTemperedOnly === true,
        showCents: settings.heji_show_cents !== false,
        pitchFrame,
      });
      result["heji_anchor_label_effective"] = hejiFrame.anchorLabel;
      result["heji_anchor_ratio_effective"] = hejiFrame.anchorRatioText;
      result["heji_names"] = hejiFrame.hejiNames;
      result["heji_names_keys"] = hejiFrame.hejiNamesKeys;
      result["heji_frame"] = hejiFrame;
    } catch {
      result["heji_anchor_label_effective"] = "";
      result["heji_anchor_ratio_effective"] = "";
      result["heji_names"] = [];
      result["heji_names_keys"] = [];
      result["heji_frame"] = null;
      result["pitch_frame"] = null;
      result["heji_tempered_only_effective"] = settings.heji_tempered_only === true;
    }
  }
  return result;
};
