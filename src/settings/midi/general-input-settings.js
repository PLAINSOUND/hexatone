import PropTypes from "prop-types";

// This module owns the always-visible, controller-agnostic top section of the
// MIDI Input settings panel: selected input port, mapping target, controller
// geometry override, and auto-detect status. It does not render controller-
// specific controls or scale-mode behavior beyond the input-mode selector.
const GeneralInputSettings = ({
  hasBasicMidi,
  midi,
  settings,
  controllerOverrideId,
  autoDetectStatus,
  detectedController,
  controllerInfo,
  manualControllerOptions,
  linnstrumentUserFirmwareEligible,
  deactivateLinnstrumentUserFirmwareNow,
  resolveControllerSelection,
  isLinnstrumentUserFirmwareEligible,
  scaleMode,
  onChange,
}) => (
  <>
    <label>
      Input Port
      <select
        value={settings.midiin_device}
        name="midiin_device"
        class="sidebar-input"
        disabled={!hasBasicMidi}
        onChange={(e) => {
          if (linnstrumentUserFirmwareEligible && e.target.value !== settings.midiin_device) {
            deactivateLinnstrumentUserFirmwareNow();
          }
          onChange(e.target.name, e.target.value);
          sessionStorage.setItem(e.target.name, e.target.value);
        }}
      >
        <option value="OFF">OFF</option>
        {midi &&
          Array.from(midi.inputs.values()).map((m) => (
            <option value={m.id}>{m.name}</option>
          ))}
      </select>
    </label>

    <label>
      Controller Geometry
      <select
        class="sidebar-input"
        value={controllerOverrideId}
        onChange={(e) => {
          const nextCtrl = resolveControllerSelection(e.target.value, detectedController);
          const nextLinnstrumentUserFirmwareEligible = isLinnstrumentUserFirmwareEligible({
            controllerId: nextCtrl?.id ?? null,
            scaleMode,
            midiPassthrough: !!settings.midi_passthrough,
            midiinDevice: settings.midiin_device,
          });
          if (linnstrumentUserFirmwareEligible && !nextLinnstrumentUserFirmwareEligible) {
            deactivateLinnstrumentUserFirmwareNow();
          }
          onChange("midiin_controller_override", e.target.value);
          sessionStorage.setItem("midiin_controller_override", e.target.value);
        }}
      >
        <option value="auto">Auto Detect</option>
        {manualControllerOptions.map((option) => (
          <option value={option.id}>{option.label}</option>
        ))}
      </select>
    </label>

    {controllerInfo && (
      <label style={{ fontStyle: "italic", color: "#996666", marginBottom: "0.5em" }}>
        {controllerInfo.name}
        <span
          class="sidebar-input"
          style={{ textAlign: "right", fontSize: "0.85em", lineHeight: 1 }}
        >
          {controllerInfo.description}
        </span>
      </label>
    )}

    {autoDetectStatus && (
      <label title="Shows whether Hexatone recognised a dedicated controller geometry for the selected MIDI input.">
        Auto Detect
        <span class="sidebar-input" style={{ color: detectedController ? "#669966" : "#888", fontStyle: "italic" }}>
          {autoDetectStatus}
        </span>
      </label>
    )}

    <label>
      Input Mode
      <select
        class="sidebar-input"
        value={settings.midiin_mapping_target || "hex_layout"}
        onChange={(e) => {
          if (linnstrumentUserFirmwareEligible && e.target.value !== "hex_layout") {
            deactivateLinnstrumentUserFirmwareNow();
          }
          onChange("midiin_mapping_target", e.target.value);
          sessionStorage.setItem("midiin_mapping_target", e.target.value);
        }}
      >
        <option value="hex_layout">MIDI to Hex Layout</option>
        <option value="scale">MIDI to Nearest Scale Degree</option>
      </select>
    </label>
  </>
);

GeneralInputSettings.propTypes = {
  hasBasicMidi: PropTypes.bool.isRequired,
  midi: PropTypes.object,
  settings: PropTypes.object.isRequired,
  controllerOverrideId: PropTypes.string.isRequired,
  autoDetectStatus: PropTypes.string,
  detectedController: PropTypes.object,
  controllerInfo: PropTypes.shape({
    name: PropTypes.string,
    description: PropTypes.string,
  }),
  manualControllerOptions: PropTypes.array.isRequired,
  linnstrumentUserFirmwareEligible: PropTypes.bool.isRequired,
  deactivateLinnstrumentUserFirmwareNow: PropTypes.func.isRequired,
  resolveControllerSelection: PropTypes.func.isRequired,
  isLinnstrumentUserFirmwareEligible: PropTypes.func.isRequired,
  scaleMode: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default GeneralInputSettings;
