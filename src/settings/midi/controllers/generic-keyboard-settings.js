import PropTypes from "prop-types";

// This module owns the explicit Generic Keyboard controller-geometry section
// inside MIDI Input. It renders the generic controller description, the
// central anchor-note row, and the explanatory note that Generic Keyboard
// bypasses 2D controller geometry. It does not render generic unknown-
// controller fallback UI, MPE controls, or global pitch/channel settings.
const GenericKeyboardSettings = ({
  centerDegree,
  centralNote,
  centralDegreeSetting,
  anchorChannel = 1,
  midiLearnActive,
  showAnchorChannel = true,
  onChange,
}) => (
  <>
    <label class="center-degree-row center-degree-label">
      Anchor Key → Central Degree ({centerDegree})
      <span class="sidebar-input settings-form__inline-fields settings-form__inline-fields--anchor">
        <button
          type="button"
          class="preset-action-btn settings-form__inline-button--nowrap"
          onClick={() => onChange("midiLearnAnchor", !midiLearnActive)}
        >
          {midiLearnActive ? "● Listening…" : "Learn"}
        </button>
        {showAnchorChannel && (
          <input
            name="midiin_anchor_channel"
            type="text"
            inputMode="numeric"
            title="MIDI channel of anchor key (1-16)"
            class="settings-form__compact-input settings-form__compact-input--channel"
            key={`generic-anchor-channel-${anchorChannel}`}
            defaultValue={anchorChannel}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.target.blur();
            }}
            onBlur={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!Number.isNaN(val) && val >= 1 && val <= 16) {
                onChange("midiin_anchor_channel", val);
                sessionStorage.setItem("midiin_anchor_channel", String(val));
              } else {
                e.target.value = anchorChannel;
              }
            }}
          />
        )}
        <input
          name="midiin_anchor_note"
          type="text"
          inputMode="numeric"
          class="settings-form__compact-input settings-form__compact-input--grow"
          key={`generic-central-degree-${centralDegreeSetting}`}
          defaultValue={centralNote}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.target.blur();
          }}
          onBlur={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!Number.isNaN(val) && val >= 0 && val <= 127) {
              onChange("midiin_anchor_note", val);
              sessionStorage.setItem("midiin_anchor_note", val);
            } else {
              e.target.value = centralNote;
            }
          }}
        />
      </span>
    </label>

    <label>
      2D Geometry
      <span class="sidebar-input settings-form__helper-text settings-form__helper-text--muted">
        2D geometry is bypassed
      </span>
    </label>
  </>
);

GenericKeyboardSettings.propTypes = {
  centerDegree: PropTypes.number.isRequired,
  centralNote: PropTypes.number.isRequired,
  centralDegreeSetting: PropTypes.number,
  anchorChannel: PropTypes.number,
  midiLearnActive: PropTypes.bool.isRequired,
  showAnchorChannel: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

export default GenericKeyboardSettings;
