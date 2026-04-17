import PropTypes from "prop-types";

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
              placeholder="e.g. 3/2 or 702.0"
              value={props.settings.heji_anchor_ratio || ""}
              onInput={(e) => props.onChange("heji_anchor_ratio", e.target.value)}
            />
          </label>
          <label>
            Notation
            <input
              type="text"
              class="sidebar-input"
              placeholder={`e.g. \uE261A`}
              value={props.settings.heji_anchor_label || ""}
              onInput={(e) => props.onChange("heji_anchor_label", e.target.value)}
            />
          </label>
          <button
            type="button"
            class="sidebar-input"
            style={{ marginTop: "0.5em", textAlign: "center", fontSize: "0.92em"}}
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
  settings: PropTypes.shape({
    key_labels: PropTypes.string,
    heji_anchor_ratio: PropTypes.string,
    heji_anchor_label: PropTypes.string,
  }),
};

export default KeyLabels;
