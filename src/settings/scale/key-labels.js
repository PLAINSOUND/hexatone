import PropTypes from "prop-types";

// ASCII → HEJI Unicode glyph replacements.
// Notation input accepts: bare letter (A-G = natural), then optional accidentals
// written as ASCII shorthand which auto-expands to HEJI SMuFL glyphs.
//
// HEJI chromatic accidentals (SMuFL):
//   n  → U+E261  (♮ natural sign, but used as HEJI natural prefix — Plainsound Sans renders it correctly)
//   b  → U+E260  (flat)
//   #  → U+E262  (sharp)
//   bb → U+E264  (double-flat)
//   ## → U+E263  (double-sharp)
//
// Syntonic comma accidentals:
//   +  → U+E282  (syntonic comma up, 1 arrow)
//   -  → U+E280  (syntonic comma down, 1 arrow)
//
// Parsing approach: scan left-to-right, replace ASCII sequences with glyphs,
// leave anything else (already-Unicode glyphs) untouched.
const ASCII_HEJI_REPLACEMENTS = [
  // Two-char sequences first (must precede single-char to avoid partial match)
  ["##", "\uE263"], // double-sharp
  ["bb", "\uE264"], // double-flat
  // Single-char accidentals
  ["n", "\uE261"],  // natural
  ["b", "\uE260"],  // flat
  ["#", "\uE262"],  // sharp
];

// Expand ASCII shorthand in a notation string to Unicode HEJI glyphs.
// Bare letter A-G at start is kept as-is (no prefix needed).
const expandHejiNotation = (raw) => {
  // Work through the string character by character, replacing ASCII sequences.
  // We only touch ASCII characters; anything >= U+0100 is left alone.
  let result = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    // If already a non-ASCII character, pass through unchanged.
    if (ch.charCodeAt(0) > 127) {
      result += ch;
      i++;
      continue;
    }
    // Try two-char replacements first.
    let matched = false;
    if (i + 1 < raw.length) {
      const two = raw.slice(i, i + 2);
      const rep2 = ASCII_HEJI_REPLACEMENTS.find(([k]) => k.length === 2 && k === two);
      if (rep2) {
        result += rep2[1];
        i += 2;
        matched = true;
      }
    }
    if (!matched) {
      // Try single-char replacements.
      const rep1 = ASCII_HEJI_REPLACEMENTS.find(([k]) => k.length === 1 && k === ch);
      if (rep1) {
        result += rep1[1];
      } else {
        result += ch;
      }
      i++;
    }
  }
  return result;
};

// choose options for the displayed text on the keys
const KeyLabels = (props) => {
  const isHeji = props.settings.key_labels === "heji";

  const copyHejiToNoteNames = () => {
    if (!props.heji_names?.length) return;
    props.onAtomicChange({
      note_names: [...props.heji_names],
      key_labels: "note_names",
    });
  };

  return (
    <>
      <label>
        Key Labels
        <select
          name="key_labels"
          class="sidebar-input"
          value={props.settings.key_labels}
          onChange={(e) => props.onChange(e.target.name, e.target.value)}
        >
          <option value="no_labels">Blank Keys</option>
          <option value="enumerate">Scale Degrees</option>
          <option value="scala_names">Ratios/Cents</option>
          <option value="cents">Cents from Reference Degree</option>
          <option value="note_names">Note Names</option>
          <option value="heji">HEJI (auto-generated)</option>
        </select>
      </label>
      {isHeji && (
        // The two fields below together define the rational offset for the entire
        // HEJI spelling.  They name a single reference pitch — the one whose
        // deviation reads 0¢ on a tuning meter — by its ratio from degree 0 (1/1)
        // and its HEJI pitch-class spelling.  This pitch need not be a scale degree.
        // Default: ratio "1/1" labelled "nA" — A natural is the just root.
        <fieldset class="heji-anchor-fieldset">
          <legend>HEJI Spelling with 0¢ Deviation</legend>
          <label>
            Ratio/Cents from scale degree 0 (1/1)
            <input
              type="text"
              class="sidebar-input"
              placeholder={props.heji_anchor_ratio_eff || "e.g. 1/1  |  0.0¢  |  0\\12"}
              value={props.settings.heji_anchor_ratio || ""}
              onInput={(e) => props.onChange("heji_anchor_ratio", e.target.value)}
            />
          </label>
          <label>
            Notation (Spelling)
            <input
              type="text"
              class="sidebar-input"
              placeholder={props.heji_anchor_label_eff || `\uE261A`}
              value={props.settings.heji_anchor_label || ""}
              onInput={(e) => {
                const expanded = expandHejiNotation(e.target.value);
                // If expansion changed the value, update the DOM input to show glyphs
                if (expanded !== e.target.value) {
                  const pos = e.target.selectionStart + (expanded.length - e.target.value.length);
                  e.target.value = expanded;
                  e.target.setSelectionRange(pos, pos);
                }
                props.onChange("heji_anchor_label", expanded);
              }}
            />
          </label>
          <label style={{ justifyContent: "flex-start", gap: "0.5em", marginTop: "0.5em" }}>
            <input
              type="checkbox"
              checked={props.settings.heji_show_cents !== false}
              onChange={(e) => props.onChange("heji_show_cents", e.target.checked)}
            />
            Always Include Cents on Keys
          </label>
          <button
            type="button"
            style={{ marginTop: "0.5em", fontSize: "1em", padding: "0.25em 0.6em", background: "#f4efef", border: "1px solid #c8b8b8", color: "#330000", borderRadius: "4px", whiteSpace: "nowrap" }}
            disabled={!props.heji_names?.length}
            onClick={copyHejiToNoteNames}
          >
            Copy HEJI to Note Names
          </button>
        </fieldset>
      )}
    </>
  );
};

KeyLabels.propTypes = {
  onChange: PropTypes.func.isRequired,
  onAtomicChange: PropTypes.func.isRequired,
  heji_names: PropTypes.arrayOf(PropTypes.string),
  heji_anchor_label_eff: PropTypes.string,
  heji_anchor_ratio_eff: PropTypes.string,
  settings: PropTypes.shape({
    key_labels: PropTypes.string,
    heji_anchor_ratio: PropTypes.string,
    heji_anchor_label: PropTypes.string,
    heji_show_cents: PropTypes.bool,
  }),
};

export default KeyLabels;
