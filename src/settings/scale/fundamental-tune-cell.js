import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import PropTypes from "prop-types";

/**
 * Inline drag-to-tune handle for the Reference Frequency.
 * Drag shifts all sounding notes by the delta in cents.
 * On save: newFundamental = fundamental * 2^(delta/1200). Scale unchanged.
 */
const FundamentalTuneCell = ({ fundamental, keysRef, onChange }) => {
  const [deltaCents, setDeltaCents] = useState(null); // null = no drag in progress
  const [comparing, setComparing] = useState(false);
  const dragStart = useRef(null);
  const dragKeysInstance = useRef(null);

  useEffect(
    () => () => {
      if (dragKeysInstance.current?.setTuneDragging)
        dragKeysInstance.current.setTuneDragging(false);
    },
    [],
  );

  const isDirty = deltaCents !== null && Math.abs(deltaCents) > 0.001;
  const delta = isDirty ? deltaCents : 0;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}¢` : `${delta.toFixed(1)}¢`;

  const onCompare = useCallback(() => {
    const next = !comparing;
    setComparing(next);
    if (keysRef?.current?.previewFundamental)
      keysRef.current.previewFundamental(next ? 0 : deltaCents);
  }, [comparing, deltaCents, keysRef]);

  const onPointerDown = useCallback(
    (e) => {
      if (keysRef?.current?.setTuneDragging) {
        keysRef.current.setTuneDragging(true);
        dragKeysInstance.current = keysRef.current;
      }
      // Snapshot base pitch of all sounding notes before drag begins
      if (keysRef?.current?.snapshotForFundamentalPreview)
        keysRef.current.snapshotForFundamentalPreview();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragStart.current = { lastX: e.clientX, acc: 0 };
    },
    [keysRef],
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.lastX;
      if (dx === 0) return;
      const speed = Math.abs(dx);
      const sensitivity = 0.05 * Math.pow(speed, 1.5);
      const newDelta = dragStart.current.acc + Math.sign(dx) * sensitivity;
      dragStart.current.lastX = e.clientX;
      dragStart.current.acc = newDelta;
      setDeltaCents(newDelta);
      if (keysRef?.current?.previewFundamental) keysRef.current.previewFundamental(newDelta);
    },
    [keysRef],
  );

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    if (dragKeysInstance.current?.setTuneDragging) {
      dragKeysInstance.current.setTuneDragging(false);
      if (dragKeysInstance.current.state?.escHeld) dragKeysInstance.current.sustainOn();
    }
  }, []);

  const onSave = useCallback(() => {
    const newFundamental = fundamental * Math.pow(2, deltaCents / 1200);
    onChange("fundamental", newFundamental);
    // Restore notes to their scale-derived pitch — Keys rebuild will use new fundamental.
    // clearSnapshot=true ends the drag session; updateFundamental in keys.js also clears it.
    if (keysRef?.current?.previewFundamental) keysRef.current.previewFundamental(0, true);
    setDeltaCents(null);
    setComparing(false);
  }, [deltaCents, fundamental, onChange, keysRef]);

  const onRevert = useCallback(() => {
    // clearSnapshot=true ends the drag session so the snapshot is not reused.
    if (keysRef?.current?.previewFundamental) keysRef.current.previewFundamental(0, true);
    setDeltaCents(null);
    setComparing(false);
  }, [keysRef]);

  return (
    <div class="tune-cell--inline">
      {isDirty && (
        <span class={`tune-delta${comparing ? " tune-comparing" : ""}`}>
          {comparing ? "orig" : deltaStr}
        </span>
      )}
      {isDirty && (
        <button
          type="button"
          class={`tune-btn${comparing ? " tune-btn--active" : ""}`}
          onClick={onCompare}
          title="A/B compare with original"
        >
          <span class="tune-btn-compare" style={{ display: "block", marginTop: "-4px" }}>
            ↺
          </span>
        </button>
      )}
      {isDirty && (
        <button
          type="button"
          class="tune-btn tune-btn--save"
          onClick={onSave}
          title="Save new Reference Frequency"
        >
          ✓
        </button>
      )}
      {isDirty && (
        <button type="button" class="tune-btn tune-btn--revert" onClick={onRevert} title="Revert">
          ✕
        </button>
      )}
      <span
        class="tune-handle"
        title="Drag to adjust Reference Frequency — slow for fine, fast for coarse"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ paddingBottom: "6px" }}
      >
        ⟺
      </span>
    </div>
  );
};

FundamentalTuneCell.propTypes = {
  fundamental: PropTypes.number.isRequired,
  keysRef: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default FundamentalTuneCell;
