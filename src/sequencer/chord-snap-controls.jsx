import { clampChordDrift, MAX_CHORD_DRIFT } from "./chord-snap.js";
import CustomRangeSlider from "../settings/shared/range-slider.jsx";

// Shared controls: palette and Sequencer must edit the same App-owned values.
export default function ChordSnapControls({ drift, onDriftChange, palette = false }) {
  const rowClass = palette ? "snapshot-palette-snap-toggle" : "sequencer-option-row sequencer-option-row--mobile-inline";
  return <div className="chord-snap-controls" onPointerDown={event => event.stopPropagation()}>
    <label className={rowClass}
      title="Allow a shared chord shift around nearest-note Snap; 0 keeps ordinary Snap">
      <span>Chord Drift</span>
      <span className="settings-form__range-row chord-snap-controls__fader">
        <CustomRangeSlider min={0} max={MAX_CHORD_DRIFT} step={1} value={drift}
          ariaLabel={palette ? "Palette Chord Drift" : "Chord Drift"}
          onInputValue={value => onDriftChange?.(clampChordDrift(value))} />
        <span className="settings-form__range-value settings-form__range-value--short">{drift}¢</span>
      </span>
    </label>
  </div>;
}
