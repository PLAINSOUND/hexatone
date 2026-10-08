// Status and actions are separate for every startup/recovery state.
export default function AudioRecoveryAlert({ message, onActivate, onSave, onDismiss }) {
  return (
    <div className="audio-recovery-alert">
      <span role="status">{message}</span>{" "}
      <button type="button" onClick={onActivate}>Retry</button>{" "}
      <button type="button" onClick={onSave}>Report</button>{" "}
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
