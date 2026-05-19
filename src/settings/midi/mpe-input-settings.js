import PropTypes from "prop-types";

// This module owns the compact MPE input zone controls used by MIDI Input for
// unknown controllers and controller-specific MPE-capable paths. It only
// renders/settings manager channel, member channel bounds, and input-side MPE
// pitch bend range; callers provide the allowed channel set and persistence
// behavior.
const MpeInputSettings = ({
  settings,
  memberChannels,
  defaultLo,
  defaultHi,
  onChange,
}) => {
  const hakenContinuumActive = settings.midiin_controller_override === "hakenaudio";
  const visibleBendRange = settings.midiin_scale_bend_range ?? (hakenContinuumActive ? 96 : 48);

  return (
  <>
    <label title="MPE zone manager channel. Default is channel 1.">
      Manager Channel
      <select
        class="sidebar-input"
        value={settings.midiin_mpe_manager_ch || settings.mpe_manager_ch || "1"}
        onChange={(e) => {
          onChange("midiin_mpe_manager_ch", e.target.value);
          sessionStorage.setItem("midiin_mpe_manager_ch", e.target.value);
        }}
      >
        <option value="1">Channel 1</option>
        <option value="16">Channel 16</option>
      </select>
    </label>

    <label title="Lowest member channel accepted from this controller's MPE zone.">
      Lowest Member Channel
      <select
        class="sidebar-input"
        value={settings.midiin_mpe_lo_ch ?? defaultLo}
        onChange={(e) => {
          const nextLo = parseInt(e.target.value, 10);
          const nextHi = Math.max(settings.midiin_mpe_hi_ch ?? defaultHi, nextLo);
          onChange("midiin_mpe_lo_ch", nextLo);
          sessionStorage.setItem("midiin_mpe_lo_ch", String(nextLo));
          if (nextHi !== (settings.midiin_mpe_hi_ch ?? defaultHi)) {
            onChange("midiin_mpe_hi_ch", nextHi);
            sessionStorage.setItem("midiin_mpe_hi_ch", String(nextHi));
          }
        }}
      >
        {memberChannels.map((ch) => (
          <option
            key={ch}
            value={ch}
            disabled={ch > (settings.midiin_mpe_hi_ch ?? defaultHi)}
          >
            {ch}
          </option>
        ))}
      </select>
    </label>

    <label title="Highest member channel accepted from this controller's MPE zone.">
      Highest Member Channel
      <select
        class="sidebar-input"
        value={settings.midiin_mpe_hi_ch ?? defaultHi}
        onChange={(e) => {
          const nextHi = parseInt(e.target.value, 10);
          const nextLo = Math.min(settings.midiin_mpe_lo_ch ?? defaultLo, nextHi);
          onChange("midiin_mpe_hi_ch", nextHi);
          sessionStorage.setItem("midiin_mpe_hi_ch", String(nextHi));
          if (nextLo !== (settings.midiin_mpe_lo_ch ?? defaultLo)) {
            onChange("midiin_mpe_lo_ch", nextLo);
            sessionStorage.setItem("midiin_mpe_lo_ch", String(nextLo));
          }
        }}
      >
        {memberChannels.map((ch) => (
          <option
            key={ch}
            value={ch}
            disabled={ch < (settings.midiin_mpe_lo_ch ?? defaultLo)}
          >
            {ch}
          </option>
        ))}
      </select>
    </label>

    <label title="Incoming MPE pitch bend range in semitones. Default 48 for generic controllers and 96 for Haken Continuum.">
      MPE Pitch Bend Range
      <input
        type="text"
        inputMode="numeric"
        class="sidebar-input"
        style={{ width: "3.5em" }}
        key={visibleBendRange}
        defaultValue={visibleBendRange}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
        onBlur={(e) => {
          const parsed = parseInt(e.target.value, 10);
          if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 96) {
            onChange("midiin_scale_bend_range", parsed);
            sessionStorage.setItem("midiin_scale_bend_range", String(parsed));
          } else {
            e.target.value = String(visibleBendRange);
          }
        }}
      />
    </label>
  </>
  );
};

MpeInputSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  memberChannels: PropTypes.arrayOf(PropTypes.number).isRequired,
  defaultLo: PropTypes.number.isRequired,
  defaultHi: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default MpeInputSettings;
