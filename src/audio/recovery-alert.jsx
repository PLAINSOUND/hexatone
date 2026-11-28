// Status and actions are separate for every startup/recovery state.
export default function AudioRecoveryAlert({ message, onActivate, onReleaseSustain, onSave, onDismiss }) {
  return (
    <div className="audio-recovery-alert">
      <span role="status">{message}</span>{" "}
      {onReleaseSustain && <button type="button" onClick={onReleaseSustain}>Release Sustain</button>}{" "}
      {onActivate && <button type="button" onClick={onActivate}>Retry</button>}{" "}
      {onSave && <button type="button" onClick={onSave}>Report</button>}{" "}
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
