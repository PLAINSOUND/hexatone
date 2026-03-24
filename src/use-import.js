import { useState } from "preact/hooks";
import {
  parseScale,
  parsedScaleToLabels,
} from "./settings/scale/parse-scale.js";

/**
 * Manages scale-file import state and logic.
 *
 * `importCount` is incremented on every import (and also when equivSteps /
 * scale_divide change in onChange) so the Scale UI knows to re-render even
 * when the settings object reference doesn't change.
 *
 * @param {object}   settings     - Current app settings
 * @param {function} setSettings  - Settings updater from useQuery
 * @param {object}   options
 * @param {function} options.onReady           - Called to mark the app as ready
 *                                               (needed for the fresh-load edge case)
 * @param {function} options.onUserInteraction - Called to mark the first user gesture
 *
 * @returns {{ onImport, importCount, bumpImportCount }}
 */
const useImport = (settings, setSettings, { onReady, onUserInteraction }) => {
  const [importCount, setImportCount] = useState(0);

  // Increment importCount from outside the hook (e.g. onChange equivSteps / scale_divide).
  const bumpImportCount = () => setImportCount((c) => c + 1);

  const onImport = () => {
    setImportCount((c) => c + 1);
    // On fresh load, scale exists but scale_import may not — ensure the app
    // is marked ready so the keyboard renders with the loaded scale.
    if (!settings.scale_import && settings.scale) {
      onReady();
      onUserInteraction();
    }
    setSettings((s) => {
      if (!s.scale_import) return s;

      const parsed = parseScale(s.scale_import);
      const { filename, description, equivSteps, scale, labels, colors } = parsed;
      const scala_names = parsedScaleToLabels(scale);

      const hasNames =
        parsed.hexatone_note_names &&
        parsed.hexatone_note_names.some((n) => n);
      const hasColors =
        parsed.hexatone_note_colors &&
        parsed.hexatone_note_colors.some((c) => c);
      const hasMetadata = hasNames || hasColors;

      let note_names, note_colors;

      if (hasNames) {
        note_names = parsed.hexatone_note_names;
      } else if (labels.some((l) => l)) {
        const f_name = labels.pop();
        labels.unshift(f_name === "null" || !f_name ? "" : f_name);
        note_names = labels;
      } else {
        note_names = [];
      }

      if (hasColors) {
        note_colors = parsed.hexatone_note_colors;
      } else if (colors.some((c) => c)) {
        const f_color = colors.pop();
        colors.unshift(f_color === "null" || !f_color ? "#ffffff" : f_color);
        note_colors = colors;
      } else {
        note_colors = [];
      }

      const fundamental = parsed.hexatone_fundamental || s.fundamental;
      const reference_degree =
        parsed.hexatone_reference_degree !== undefined
          ? parsed.hexatone_reference_degree
          : s.reference_degree;
      const midiin_central_degree =
        parsed.hexatone_midiin_central_degree || s.midiin_central_degree;

      return {
        ...s,
        name: filename || s.name,
        description: description || s.description,
        equivSteps,
        scale,
        scala_names,
        note_names,
        note_colors,
        fundamental,
        reference_degree,
        midiin_central_degree,
        key_labels: hasMetadata ? "note_names" : "scala_names",
        spectrum_colors: hasMetadata ? false : true,
        fundamental_color: hasMetadata ? s.fundamental_color : "#f2e3e3",
      };
    });
  };

  return { onImport, importCount, bumpImportCount };
};

export default useImport;
