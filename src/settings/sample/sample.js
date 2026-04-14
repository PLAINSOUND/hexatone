import { useState } from "preact/hooks";
import PropTypes from "prop-types";

const Sample = (props) => {
  const [muted, setMuted] = useState(() => localStorage.getItem("synth_muted") === "true");
  const [volume, setVolume] = useState(
    () => parseFloat(localStorage.getItem("synth_volume") ?? "1") || 1.0,
  );

  const handleVolume = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    localStorage.setItem("synth_volume", val);
    if (props.onVolumeChange) props.onVolumeChange(val, muted);
  };

  const handleMute = (e) => {
    const m = e.target.checked;
    setMuted(m);
    localStorage.setItem("synth_muted", m);
    if (props.onVolumeChange) props.onVolumeChange(volume, m);
  };

  return (
    <>
      <label>
        Sampled Instrument
        <Instruments
          value={props.settings.instrument}
          groups={props.instruments}
          onChange={props.onChange}
        />
      </label>
      <label>
        <span>Synth Volume</span>
        <span
          class="sidebar-input"
          style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}
        >
          <input
            type="range"
            name="synth_volume"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            style={{ width: "100%" }}
            onInput={handleVolume}
          />
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              minWidth: "2.5em",
              textAlign: "right",
              fontSize: "0.85em",
            }}
          >
            {Number.isInteger(volume) ? volume.toFixed(0) : volume.toFixed(2)}
          </span>
        </span>
      </label>
      {
        <label>
          Mute
          <input type="checkbox" name="synth_mute" checked={muted} onChange={handleMute} />
        </label>
      }
    </>
  );
};

Sample.propTypes = {
  onChange: PropTypes.func.isRequired,
  onVolumeChange: PropTypes.func,
  instruments: PropTypes.array,
  settings: PropTypes.shape({
    instrument: PropTypes.string,
  }),
};

const Instruments = (props) => (
  <select
    name="instrument"
    class="sidebar-input"
    value={props.value}
    onChange={(e) => {
      props.onChange(e.target.name, e.target.value);
      sessionStorage.setItem(e.target.name, e.target.value);
    }}
  >
    <option value="OFF">OFF (no sound)</option>
    {props.groups.map((group) => (
      <optgroup label={group.name}>
        {group.instruments.map((instrument) => (
          <option value={instrument.fileName}>{instrument.name}</option>
        ))}
      </optgroup>
    ))}
  </select>
);

Instruments.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  groups: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      instruments: PropTypes.arrayOf(
        PropTypes.shape({
          name: PropTypes.string.isRequired,
          fileName: PropTypes.string.isRequired,
        }),
      ),
    }),
  ),
};

export default Sample;
