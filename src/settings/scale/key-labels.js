import PropTypes from "prop-types";
import { normaliseHejiAnchorRatio } from "./parse-scale.js";
import { canonicalHejiAnchorLabelInput } from "../../notation/heji-normalization.js";

// choose options for the displayed text on the keys
const KeyLabels = (props) => {
  const isHeji = props.settings.key_labels === "heji";
  const hejiDisabled = isHeji && props.heji_supported === false;
  const selectedKeyLabel = props.settings.key_labels === "equaves" ? "no_labels" : props.settings.key_labels;
  const showEquaves = props.settings.show_equaves || props.settings.key_labels === "equaves";

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
          value={selectedKeyLabel}
          onChange={(e) => props.onChange(e.target.name, e.target.value)}
        >
          <option value="no_labels">Blank Keys</option>
          <option value="enumerate">Scale Degrees</option>
          <option value="scala_names">Scale Data</option>
          <option value="cents">Scale Cents</option>
          <option value="note_names">Name</option>
          <option value="heji">HEJI (auto-generated)</option>
        </select>
      </label>
      <label>
        Show Equave Numbers
        <input
          type="checkbox"
          checked={showEquaves}
          onChange={(e) => props.onChange("show_equaves", e.target.checked)}
        />
      </label>
      {isHeji && (
        // The two fields below together define the rational offset for the entire
        // HEJI spelling.  They name a single reference pitch — the one whose
        // deviation reads 0¢ on a tuning meter — by its ratio from degree 0 (1/1)
        // and its HEJI pitch-class spelling.  This pitch need not be a scale degree.
        // Default: ratio "1/1" labelled "nA" — A natural is the just root.
        <fieldset class="heji-anchor-fieldset">
          <legend>HEJI Spelling with 0¢ Deviation</legend>
          {hejiDisabled && (
            <p style={{ color: "#8b3a2e", margin: "0 0 0.75em 0", fontStyle: "italic" }}>
              {props.heji_warning || "Non-octave equave cannot generate consistent note names."}
            </p>
          )}
          <label>
            Ratio/Cents from 1/1 (scale degree 0)
            <input
              type="text"
              class="sidebar-input"
              placeholder={props.heji_anchor_ratio_eff || "e.g. 1/1  |  0.0¢  |  0\\12"}
              value={props.settings.heji_anchor_ratio || ""}
              disabled={hejiDisabled}
              onInput={(e) => props.onChange("heji_anchor_ratio", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
              }}
              onBlur={(e) => {
                const normalized = normaliseHejiAnchorRatio(e.target.value);
                if (normalized) props.onChange("heji_anchor_ratio", normalized);
              }}
            />
          </label>
          <label>
            Notation (Spelling)
            <input
              type="text"
              class="sidebar-input"
              placeholder={props.heji_anchor_label_eff || `\uE261A`}
              value={props.settings.heji_anchor_label || ""}
              disabled={hejiDisabled}
              onInput={(e) => props.onChange("heji_anchor_label", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
              }}
              onBlur={(e) => {
                const normalized = canonicalHejiAnchorLabelInput(e.target.value);
                if (normalized) props.onChange("heji_anchor_label", normalized);
              }}
            />
          </label>
          <label style={{ justifyContent: "flex-start", gap: "0.5em", marginTop: "0.5em" }}>
            <input
              type="checkbox"
              checked={props.settings.heji_tempered_only === true}
              disabled={hejiDisabled}
              onChange={(e) => props.onChange("heji_tempered_only", e.target.checked)}
            />
            Tempered Accidentals Only
          </label>
          <label style={{ justifyContent: "flex-start", gap: "0.5em", marginTop: "0.5em" }}>
            <input
              type="checkbox"
              checked={props.settings.heji_show_cents !== false}
              disabled={hejiDisabled}
              onChange={(e) => props.onChange("heji_show_cents", e.target.checked)}
            />
            Always Include Cents on Keys
          </label>
          <button
            type="button"
            class="preset-action-btn"
            style={{ marginTop: "0.5em", whiteSpace: "nowrap" }}
            disabled={hejiDisabled || !props.heji_names?.length}
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
  heji_supported: PropTypes.bool,
  heji_warning: PropTypes.string,
  settings: PropTypes.shape({
    key_labels: PropTypes.string,
    show_equaves: PropTypes.bool,
    heji_anchor_ratio: PropTypes.string,
    heji_anchor_label: PropTypes.string,
    heji_tempered_only: PropTypes.bool,
    heji_show_cents: PropTypes.bool,
  }),
};

export default KeyLabels;
