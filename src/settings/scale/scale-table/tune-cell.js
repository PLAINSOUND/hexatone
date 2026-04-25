import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import { parseExactInterval } from "../../../tuning/interval.js";
import {
  getRationalisationRequest,
  getHumanTestableRationalCandidates,
  getSaveString,
  formatRatioText,
  formatPrimeLimits,
} from "./rationalise.js";
import { parseOptionalPositiveInt } from "./search-prefs.js";

/**
 * TuneCell — drag-to-tune control for a single scale degree.
 * Drag left/right to retune; A/B compare; save or revert.
 *
 * When retuning the reference_degree, behavior depends on retuning_mode:
 * - 'recalculate_reference' (default): Keep current sound, recalculate Reference Frequency
 * - 'transpose_scale': Transpose entire scale, preserve Reference Frequency
 *
 * retuning_mode is intentionally internal for now. There is currently no
 * user-facing toggle in the UI, so Hexatone always runs with the default
 * 'recalculate_reference' behavior. Keep the alternate path in place and
 * documented here in case a dedicated UX control is added later.
 */
export function getEffectivePreviewCents(tunedCents, comparing, originalCents) {
  if (tunedCents === null) return null;
  return comparing ? originalCents : tunedCents;
}

const TuneCell = ({
  scaleStr,
  degree,
  committedInterval,
  committedCents,
  workspace,
  settings,
  frequencyAtDegree,
  searchPrefs,
  keysRef,
  onChange,
  onDegree0Save,
  reference_degree,
  fundamental,
  onFundamentalChange,
  retuning_mode,
  onPreviewChange,
  resetVersion,
}) => {
  const originalCents = useRef(committedCents);
  const [tunedCents, setTunedCents] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [previewInterval, setPreviewInterval] = useState(null);
  const [rationaliseCandidates, setRationaliseCandidates] = useState(null);
  const dragStart = useRef(null);
  const tuneCellRef = useRef(null);
  // Capture the Keys instance when drag starts — keysRef.current may change
  // during reconciliation, so we need the specific instance we set drag on
  const dragKeysInstance = useRef(null);
  // Keep the latest onPreviewChange in a ref so effects don't re-fire when
  // the parent re-renders and creates a new function reference.
  const onPreviewChangeRef = useRef(onPreviewChange);
  useEffect(() => {
    onPreviewChangeRef.current = onPreviewChange;
  }, [onPreviewChange]);
  // Keep originalCents in sync when scale string changes from outside
  useEffect(() => {
    if (tunedCents === null) {
      originalCents.current = committedCents;
      setPreviewInterval(null);
      setRationaliseCandidates(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tunedCents guards drag-active state; intentionally not a dep
  }, [scaleStr, committedCents]);

  // When a direct text edit commits a new scale value, discard any in-flight
  // drag state so the TuneCell resets to the newly committed pitch.
  useEffect(() => {
    if (resetVersion === undefined || resetVersion === 0) return;
    originalCents.current = committedCents;
    setTunedCents(null);
    setComparing(false);
    setPreviewInterval(null);
    setRationaliseCandidates(null);
  }, [resetVersion, committedCents]);

  useEffect(() => {
    if (!rationaliseCandidates) return;
    const dismiss = (event) => {
      if (tuneCellRef.current?.contains(event.target)) return;
      setRationaliseCandidates(null);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [rationaliseCandidates]);

  // Broadcast live preview cents + comparing state to the parent frequency column.
  // Only re-runs when these values change, not when the callback identity changes.
  useEffect(() => {
    if (!onPreviewChangeRef.current) return;
    const effectivePreviewCents = getEffectivePreviewCents(
      tunedCents,
      comparing,
      originalCents.current,
    );
    onPreviewChangeRef.current(degree, effectivePreviewCents, comparing);
  }, [degree, tunedCents, comparing]);

  useEffect(() => {
    return () => {
      if (onPreviewChangeRef.current) onPreviewChangeRef.current(degree, null);
    };
  }, [degree]);

  // Clean up drag state and any in-flight glide on unmount.
  useEffect(() => {
    return () => {
      // Use the captured instance from when drag started, not keysRef.current
      // which may now point to a new Keys instance after reconstruction
      if (dragKeysInstance.current && dragKeysInstance.current.setTuneDragging) {
        dragKeysInstance.current.setTuneDragging(false);
      }
    };
  }, []);

  const currentCents = tunedCents !== null ? tunedCents : originalCents.current;
  const isDirty = tunedCents !== null && Math.abs(tunedCents - originalCents.current) > 0.001;
  const isReferenceDegree = degree === reference_degree;

  const pushToKeys = useCallback(
    (cents) => {
      if (!keysRef || !keysRef.current) return;
      if (degree === 0) {
        // Only retune degree-0 notes; all other notes stay at their pitch.
        // cents is the absolute offset from 0 (the drag value from originalCents=0).
        if (keysRef.current.previewDegree0) keysRef.current.previewDegree0(cents);
      } else if (keysRef.current.updateScaleDegree) {
        keysRef.current.updateScaleDegree(degree, cents);
      }
    },
    [keysRef, degree],
  );

  const glideTo = useCallback(
    (targetCents) => {
      pushToKeys(targetCents);
    },
    [pushToKeys],
  );

  const openRationaliseCandidates = useCallback(
    (targetCents) => {
      // TuneCell owns transient preview state only. Candidate search reads the
      // committed workspace plus this row's current cents target; committing the
      // chosen ratio still happens through the normal scale update path.
      const request = getRationalisationRequest({
        degree,
        tunedCents: targetCents,
        workspace,
        settings,
        frequencyAtDegree,
        searchPrefs,
      });
      const candidates = getHumanTestableRationalCandidates(request);
      setRationaliseCandidates(candidates.length ? candidates : null);
    },
    [degree, workspace, settings, frequencyAtDegree, searchPrefs],
  );

  const onPointerDown = useCallback(
    (e) => {
      // Set flag BEFORE setPointerCapture — capture triggers a spurious Escape keyup
      // which would drop sustain; the flag guards against that in keys.js.
      // Also capture the Keys instance for cleanup in case we're unmounted mid-drag.
      if (keysRef && keysRef.current && keysRef.current.setTuneDragging) {
        keysRef.current.setTuneDragging(true);
        dragKeysInstance.current = keysRef.current;
      }
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragStart.current = { lastX: e.clientX, accCents: currentCents };
      openRationaliseCandidates(currentCents);
    },
    [currentCents, keysRef, openRationaliseCandidates],
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.lastX;
      if (dx === 0) return;
      // Velocity-sensitive: slow drags (|dx| small) → fine; fast drags → coarser.
      // sensitivity = base * speed^1.5 — superlinear so fast moves cover more ground
      const speed = Math.abs(dx);
      const sensitivity = 0.05 * Math.pow(speed, 1.125); // ~0.05¢ at 1px/event, ~1¢ at 7px/event
      const newCents = dragStart.current.accCents + Math.sign(dx) * sensitivity;
      dragStart.current.lastX = e.clientX;
      dragStart.current.accCents = newCents;
      setTunedCents(newCents);
      // Free dragging invalidates any previously snapped exact candidate.
      setPreviewInterval(null);
      setRationaliseCandidates(null);
      // Use glideTo so fast swipes interpolate smoothly rather than jumping.
      // While comparing, the original pitch is playing — don't update the preview.
      if (!comparing) glideTo(newCents);
    },
    [comparing, glideTo],
  );

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    if (keysRef && keysRef.current && keysRef.current.setTuneDragging) {
      keysRef.current.setTuneDragging(false);
      // If Escape is still physically held, re-engage sustain now drag is done
      if (keysRef.current.state && keysRef.current.state.escHeld) {
        keysRef.current.sustainOn();
      }
    }
  }, [keysRef]);

  const onCompare = useCallback(() => {
    const next = !comparing;
    setComparing(next);
    glideTo(next ? originalCents.current : tunedCents);
  }, [comparing, tunedCents, glideTo]);

  const onSave = useCallback(() => {
    const saveVal = tunedCents !== null ? tunedCents : originalCents.current;
    // getSaveString guards the exact-ratio path: only a still-valid snapped
    // preview writes ratio text, otherwise the current cents value is saved.
    const saveStr = getSaveString({
      committedInterval,
      previewInterval,
      tunedCents,
      committedCents,
    });

    if (degree === 0) {
      // Degree 0 retuning: shift all other scale degrees by -delta so that
      // all notes except degree 0 remain at the same absolute pitch.
      // onDegree0Save receives the delta in cents.
      if (onDegree0Save) onDegree0Save(saveVal); // saveVal === delta (originalCents is 0)
    } else if (isReferenceDegree && retuning_mode !== "transpose_scale") {
      const delta = tunedCents - originalCents.current;
      const newFundamental = fundamental * Math.pow(2, delta / 1200.0);
      if (onFundamentalChange) {
        onFundamentalChange(newFundamental, saveStr);
      } else {
        onChange(saveStr);
      }
    } else {
      onChange(saveStr);
    }

    // For degree 0 the scale value is always 0 after save — the delta was
    // baked into the other scale degrees / fundamental on save, so the next
    // drag must start from 0, not from saveVal.
    originalCents.current = degree === 0 ? 0 : saveVal;
    setTunedCents(null);
    setComparing(false);
    setPreviewInterval(null);
    setRationaliseCandidates(null);
    // Restore live preview to 0 so held degree-0 notes return to base pitch
    if (degree === 0) pushToKeys(0);
  }, [
    tunedCents,
    degree,
    isReferenceDegree,
    retuning_mode,
    fundamental,
    onFundamentalChange,
    onDegree0Save,
    onChange,
    pushToKeys,
    committedInterval,
    previewInterval,
    committedCents,
  ]);

  const onRevert = useCallback(() => {
    setTunedCents(null);
    setComparing(false);
    setPreviewInterval(null);
    setRationaliseCandidates(null);
    glideTo(originalCents.current);
  }, [glideTo]);

  const delta = isDirty ? tunedCents - originalCents.current : 0;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}c` : `${delta.toFixed(1)}c`;

  return (
    <div class="tune-cell" ref={tuneCellRef}>
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
        <button type="button" class="tune-btn tune-btn--save" onClick={onSave} title="Save tuning">
          ✓
        </button>
      )}
      {isDirty && (
        <button
          type="button"
          class="tune-btn tune-btn--revert"
          onClick={onRevert}
          title="Revert to original"
        >
          ✕
        </button>
      )}
      {isDirty && (
        <button
          type="button"
          class={`tune-btn tune-btn--rationalise${rationaliseCandidates ? " tune-btn--active" : ""}`}
          onClick={() => {
            if (rationaliseCandidates) {
              setRationaliseCandidates(null);
              return;
            }
            const request = getRationalisationRequest({
              degree,
              tunedCents,
              workspace,
              settings,
              frequencyAtDegree,
              searchPrefs,
            });
            const candidates = getHumanTestableRationalCandidates(request);
            setRationaliseCandidates(candidates.length ? candidates : null);
          }}
          title="Find rational candidates"
          aria-label={`find rational candidates for degree ${degree}`}
        >
          ≈
        </button>
      )}
      <span
        class="tune-handle"
        title="Drag left/right to tune — slow for fine, fast for coarse"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ paddingBottom: "6px" }}
      >
        ⟺
      </span>
      {rationaliseCandidates && (
        <div class="rationalise-dropdown">
          {rationaliseCandidates.map((candidate) => {
            const tol = parseOptionalPositiveInt(searchPrefs?.centsTolerance) ?? 6;
            const pl = parseOptionalPositiveInt(searchPrefs?.primeLimit) ?? 19;
            const region = searchPrefs?.region ?? "symmetric";
            const outsideTolerance = Math.abs(candidate.deviation) > tol;
            const outsidePrimeLimit = candidate.primeLimit != null && candidate.primeLimit > pl;
            // For overtonal region: any negative non-2 exponent in the monzo means the
            // ratio has an undertonal component (e.g. 21/20 = [−2, −1, 1, 1] — has −1 for 5).
            // For undertonal region: any positive non-2 exponent is out of bounds.
            const outsideRegion = Array.isArray(candidate.monzo) && (
              region === "overtonal"
                ? candidate.monzo.slice(1).some((e) => e < 0)
                : region === "undertonal"
                  ? candidate.monzo.slice(1).some((e) => e > 0)
                  : false
            );
            const isOutOfBounds = outsideTolerance || outsidePrimeLimit || outsideRegion;
            const isCommitted = !!candidate.isCommitted;
            return (
              <button
                key={candidate.ratioText}
                type="button"
                class={[
                  "rationalise-candidate",
                  isCommitted ? "rationalise-candidate--committed" : "",
                  isOutOfBounds ? "rationalise-candidate--out-of-bounds" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  const parsed = parseExactInterval(candidate.ratioText);
                  setTunedCents(candidate.cents);
                  setPreviewInterval(parsed);
                  setRationaliseCandidates(null);
                  dragStart.current = null;
                  glideTo(candidate.cents);
                }}
                aria-label={`rational candidate ${candidate.ratioText}`}
              >
                <div class="rationalise-candidate__row1">
                  <span class="rationalise-candidate__ratio">{formatRatioText(candidate.ratioText)}</span>
                  <span class="rationalise-candidate__meta">{candidate.deviation >= 0 ? "+" : ""}{candidate.deviation.toFixed(2)}c</span>
                  <span class="rationalise-candidate__meta">{formatPrimeLimits(candidate.monzo)}</span>
                  <span class="rationalise-candidate__meta">hr {candidate.harmonicRadius.toFixed(2)}</span>
                  <span class="rationalise-candidate__meta rationalise-candidate__score">s {(candidate.globalScore ?? 0).toFixed(2)}</span>
                </div>
                <div class="rationalise-candidate__row2">
                  <span class="rationalise-candidate__meta">s_ctx {(candidate.contextualConsonance ?? 0).toFixed(2)}</span>
                  {candidate.contextualBestRatio && (
                    <span class="rationalise-candidate__meta">
                      s_tune {candidate.contextualBestRatio}
                    </span>
                  )}
                  <span class="rationalise-candidate__meta">s_oton {(candidate.branchExtent ?? 0).toFixed(2)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TuneCell;
