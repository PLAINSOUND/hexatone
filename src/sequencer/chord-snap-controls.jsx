import { clampChordDrift } from "./chord-snap.js";

// Shared controls: palette and Sequencer must edit the same App-owned values.
export default function ChordSnapControls({ enabled, drift, onEnabledChange, onDriftChange, palette = false }) {
  const rowClass = palette ? "snapshot-palette-snap-toggle" : "sequencer-option-row sequencer-option-row--mobile-inline";
  return <div className="chord-snap-controls" onPointerDown={event => event.stopPropagation()}>
    <label className={rowClass}>
      <span>Chord-aware Snap (prototype)</span>
      <input type="checkbox" aria-label={palette ? "Palette chord-aware Snap" : "Chord-aware Snap"}
        checked={enabled} onChange={event => onEnabledChange?.(event.currentTarget.checked)} />
    </label>
    {enabled && <label className={rowClass}
      title="Allow a shared chord shift around nearest-note Snap; 0 keeps ordinary Snap">
      <span>Chord Drift: {drift} cents</span>
      <input type="range" min="0" max="50" step="1" value={drift}
        aria-label={palette ? "Palette Chord Drift" : "Chord Drift"}
        onInput={event => onDriftChange?.(clampChordDrift(event.currentTarget.value))} />
    </label>}
  </div>;
}
