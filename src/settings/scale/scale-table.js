import { createRef } from "preact";
import { useState, useRef, useCallback, useEffect, useMemo } from "preact/hooks";
import PropTypes from "prop-types";
import { scalaToCents } from "./parse-scale";
import ScalaInput from "./scala-input.js";
import { CANONICAL_MONZO_BASIS, parseExactInterval } from "../../tuning/interval.js";
import { createScaleWorkspace, getWorkspaceSlot } from "../../tuning/workspace.js";
import {
  findRationalCandidates,
  harmonicRadiusFromMonzo,
  scoreRationalCandidate,
  scorePrimeConsistency,
  selectRationalisationContext,
} from "../../tuning/rationalise.js";

const PREVIEW_RATIO_TOLERANCE_CENTS = 0.05;
// All non-2 primes in the canonical basis — used to build the full prime grid.
const PRIME_BOUND_KEYS = CANONICAL_MONZO_BASIS.filter((p) => p !== 2);
// Split into two rows: common primes (3–19) and extended primes (23+).
const PRIME_BOUND_KEYS_LOW  = PRIME_BOUND_KEYS.filter((p) => p <= 19);
const PRIME_BOUND_KEYS_HIGH = PRIME_BOUND_KEYS.filter((p) => p > 19);
const DEFAULT_PRIME_BOUNDS = Object.fromEntries(PRIME_BOUND_KEYS.map((p) => {
  if (p === 3)  return [p, "8"];
  if (p === 5)  return [p, "3"];
  if (p === 7)  return [p, "2"];
  if (p === 11) return [p, "2"];
  if (p === 13) return [p, "2"];
  if (p === 17) return [p, "1"];
  if (p === 19) return [p, "1"];
  return [p, "0"];
}));

const DEFAULT_SEARCH_PREFS = {
  region: "symmetric",
  primeLimit: "19",
  oddLimit: "255",
  centsTolerance: "6",
  contextTolerance: "14",
  // primeBounds: overtonal maxima per prime (always used)
  primeBounds: { ...DEFAULT_PRIME_BOUNDS },
  // primeBoundsUt: undertonal maxima per prime (only used in "custom" region mode;
  // initialised equal to primeBounds so switching to custom starts symmetric)
  primeBoundsUt: { ...DEFAULT_PRIME_BOUNDS },
};

// Format the prime-limit of a candidate as an overtonal/undertonal pair.
// Overtonal limit = highest prime with a positive non-2 exponent, shown with ° suffix.
// Undertonal limit = highest prime with a negative non-2 exponent, shown with u prefix.
// Examples: 21/20 → "7°u5",  7/4 → "7°",  8/5 → "u5",  1/1 → "1"
// Fraction.toFraction() collapses "1/1" to "1". Always show the denominator.
function formatRatioText(ratioText) {
  if (ratioText === "1") return "1/1";
  return ratioText;
}

function formatPrimeLimits(monzo) {
  if (!Array.isArray(monzo)) return "?";
  let otLim = 1;
  let utLim = 1;
  for (let i = 1; i < monzo.length; i++) {
    const exp = monzo[i];
    if (exp > 0) otLim = CANONICAL_MONZO_BASIS[i];
    else if (exp < 0) utLim = CANONICAL_MONZO_BASIS[i];
  }
  if (utLim === 1) return `lim ${otLim}\u00B0`;
  if (otLim === 1) return `lim 1\u00B0u${utLim}`;
  return `lim ${otLim}\u00B0u${utLim}`;
}

function parseOptionalPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildPrimeBoundsFromPrefs(searchPrefs, primeLimit = null) {
  const bounds = {};
  const boundsUt = {};
  const effectivePrimeLimit = parseOptionalPositiveInt(primeLimit);
  for (const prime of CANONICAL_MONZO_BASIS) {
    if (prime === 2) continue;
    if (effectivePrimeLimit != null && prime > effectivePrimeLimit) break;
    const parsedOt = parseOptionalPositiveInt(searchPrefs?.primeBounds?.[prime]);
    const parsedUt = parseOptionalPositiveInt(searchPrefs?.primeBoundsUt?.[prime]);
    bounds[prime] = parsedOt ?? 1;
    boundsUt[prime] = parsedUt ?? 1;
  }
  const hasEntries = Object.keys(bounds).length > 0;
  return {
    primeBounds: hasEntries ? bounds : null,
    primeBoundsUt: hasEntries ? boundsUt : null,
  };
}

function getRowRuntime(workspace, degree, tunedCents = null, previewInterval = null) {
  const slot = getWorkspaceSlot(workspace, degree);
  const committedInterval = slot?.committedIdentity ?? null;
  const committedCents = slot?.cents ?? 0;
  return {
    slot,
    committedInterval,
    committedCents,
    previewInterval,
    effectiveCents: tunedCents ?? previewInterval?.cents ?? committedCents,
    ratioText: committedInterval?.ratio ? committedInterval.ratio.toFraction() : null,
    exact: !!committedInterval?.exact,
    harmonicRadius: slot?.analysis?.harmonicRadius ?? null,
  };
}

function buildFrequencyContext({ degree, workspace, settings, frequencyAtDegree }) {
  const maxDegree = workspace?.slots?.length ?? 0;
  const nearbyDegrees = [degree - 1, degree + 1].filter(
    (candidateDegree) => candidateDegree >= 0 && candidateDegree < maxDegree,
  );
  return {
    targetDegree: degree,
    targetHz: typeof frequencyAtDegree === "function" ? frequencyAtDegree(degree) : null,
    referenceHz: settings?.fundamental ?? null,
    nearbyHz: nearbyDegrees.map((candidateDegree) => ({
      degree: candidateDegree,
      hz: frequencyAtDegree(candidateDegree),
    })),
  };
}

function getRationalisationRequest({
  degree,
  tunedCents,
  workspace,
  settings,
  frequencyAtDegree,
  searchPrefs,
}) {
  const primeLimit =
    parseOptionalPositiveInt(searchPrefs?.primeLimit) ?? settings?.rationalise_prime_limit ?? 19;
  const { primeBounds, primeBoundsUt } = buildPrimeBoundsFromPrefs(searchPrefs, primeLimit);
  return {
    targetDegree: degree,
    workspace,
    primeLimit,
    primeBounds: primeBounds ?? settings?.rationalise_prime_bounds ?? null,
    primeBoundsUt: primeBoundsUt ?? null,
    oddLimit: parseOptionalPositiveInt(searchPrefs?.oddLimit) ?? settings?.rationalise_odd_limit ?? 255,
    centsTolerance:
      parseOptionalPositiveInt(searchPrefs?.centsTolerance) ?? settings?.rationalise_tolerance ?? 6,
    contextTolerance:
      parseOptionalPositiveInt(searchPrefs?.contextTolerance) ?? 14,
    maxCandidates: 8,
    region: searchPrefs?.region ?? "symmetric",
    frequencyContext: buildFrequencyContext({
      degree,
      workspace,
      settings,
      frequencyAtDegree,
    }),
    targetCents: tunedCents,
  };
}

function mergeUniqueCandidates(candidateSets, maxCandidates = 8) {
  const merged = [];
  const seen = new Set();
  for (const candidateSet of candidateSets) {
    for (const candidate of candidateSet) {
      if (seen.has(candidate.ratioText)) continue;
      seen.add(candidate.ratioText);
      merged.push(candidate);
    }
  }
  // Sort by aggregateScore ascending (lower cost = better).
  // aggregateScore incorporates radius, deviation, contextual consonance,
  // best context match, and overtonal branch extent — so this is the
  // definitive ranking for display order.
  merged.sort((a, b) => a.aggregateScore - b.aggregateScore);
  return merged.slice(0, maxCandidates);
}

function buildCommittedRatioCandidate(slot, baseRequest) {
  const committed = slot?.committedIdentity;
  if (!committed?.ratio || !Array.isArray(committed?.monzo) || committed?.cents == null) return null;
  const context =
    baseRequest.workspace && baseRequest.targetDegree != null
      ? selectRationalisationContext(baseRequest.workspace, baseRequest.targetDegree, baseRequest)
      : { committedSlots: [] };
  return scoreRationalCandidate(
    {
      ratio: committed.ratio,
      ratioText: committed.ratio.toFraction(),
      monzo: [...committed.monzo],
      cents: committed.cents,
      deviation: baseRequest.targetCents - committed.cents,
      primeLimit: committed.primeLimit ?? null,
      oddLimit: committed.ratio ? Math.max(committed.ratio.n, committed.ratio.d) : null,
      harmonicRadius:
        slot?.analysis?.harmonicRadius ?? harmonicRadiusFromMonzo(committed.monzo),
      region: baseRequest.region ?? "symmetric",
      contextualConsonance: 0,
      contextualBestMatch: 0,
      contextualBestRatio: null,
      branchExtent: 0,
      primeConsistency: 0,
      aggregateScore: 0,
    },
    context,
    baseRequest,
  );
}

function getHumanTestableRationalCandidates(baseRequest) {
  const maxCandidates = baseRequest.maxCandidates ?? 8;
  const committedCandidate = buildCommittedRatioCandidate(
    getWorkspaceSlot(baseRequest.workspace, baseRequest.targetDegree),
    baseRequest,
  );
  // The tolerance is fixed at the user's setting — we never widen it in the
  // ladder. The ladder is only used to broaden prime coverage when primeBounds
  // is not set (legacy path); with primeBounds the search is already fully
  // specified and a single pass suffices.
  const tol = baseRequest.centsTolerance ?? 6;
  const searchLadder = baseRequest.primeBounds
    ? [{ centsTolerance: tol }]
    : [
        { centsTolerance: tol, primeLimit: baseRequest.primeLimit ?? 19 },
        { centsTolerance: tol, primeLimit: Math.max(baseRequest.primeLimit ?? 19, 23) },
        { centsTolerance: tol, primeLimit: Math.max(baseRequest.primeLimit ?? 19, 29) },
        { centsTolerance: tol, primeLimit: Math.max(baseRequest.primeLimit ?? 19, 37) },
      ];

  const candidateSets = [];
  if (committedCandidate) {
    committedCandidate.isCommitted = true;
    candidateSets.push([committedCandidate]);
  }
  for (const searchStep of searchLadder) {
    candidateSets.push(
      findRationalCandidates(baseRequest.targetCents, {
        ...baseRequest,
        ...searchStep,
        maxCandidates,
      }),
    );
    const merged = mergeUniqueCandidates(candidateSets, maxCandidates);
    if (merged.length >= 6) return merged;
  }
  return mergeUniqueCandidates(candidateSets, maxCandidates);
}

function getSaveString({ committedInterval, previewInterval, tunedCents, committedCents }) {
  if (previewInterval && tunedCents !== null) {
    const previewCents = previewInterval?.cents ?? null;
    if (previewCents !== null && Math.abs(previewCents - tunedCents) <= PREVIEW_RATIO_TOLERANCE_CENTS) {
      if (previewInterval?.ratio) return previewInterval.ratio.toFraction();
    }
  }
  const saveVal = tunedCents !== null ? tunedCents : committedCents;
  if (saveVal === committedCents && committedInterval?.ratio) {
    return committedInterval.ratio.toFraction();
  }
  return saveVal.toFixed(6);
}

// Normalise a hex string to the form #rrggbb.
// Accepts:  #rgb  #rrggbb  rgb  rrggbb
// Returns the normalised string, or null if invalid.
const normaliseHex = (raw) => {
  if (!raw) return null;
  const s = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return `#${s}`;
  }
  return null;
};

// A colour cell: a clickable swatch that opens a colour picker,
// alongside a hex text input that accepts typed or pasted values.
const ColorCell = ({ name, value, disabled, onChange }) => {
  const safe = normaliseHex(value || "#ffffff") || "#ffffff";
  const pickerRef = createRef();
  const textRef = createRef();
  const swatchRef = createRef();
  const lastFire = useRef(0);
  const lastEventTime = useRef(0);

  // Clicking the swatch triggers the hidden color picker
  const handleSwatchClick = () => {
    if (!disabled && pickerRef.current) {
      pickerRef.current.click();
    }
  };

  // onInput: velocity-adaptive throttling
  // Fast movement → fewer updates (coarser, ~100ms gap)
  // Slow movement → more updates (finer, ~16ms gap = 60fps)
  const handlePickerInput = (e) => {
    const hex = e.target.value;
    const now = Date.now();

    // Always update local UI immediately (no perceived lag)
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;

    // Measure event frequency as proxy for drag speed
    const timeSinceLastEvent = now - lastEventTime.current;
    lastEventTime.current = now;

    // Adaptive throttle: fast drag (small gap) → longer throttle
    // 0ms gap (very fast) → 100ms throttle
    // 80ms+ gap (slow) → 16ms throttle (60fps)
    const speedFactor = Math.max(0, Math.min(1, (80 - timeSinceLastEvent) / 80));
    const throttle = 16 + speedFactor * 84; // 16-100ms range

    if (now - lastFire.current >= throttle) {
      lastFire.current = now;
      onChange({ target: { name, value: hex } });
    }
  };

  // onChange: always fires on picker close to commit the final value
  const handlePickerChange = (e) => {
    const hex = e.target.value;
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
    lastFire.current = 0; // reset throttle so final value always commits
    onChange({ target: { name, value: hex } });
  };

  // Text input — update swatch live while typing
  const handleTextInput = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
      if (pickerRef.current) pickerRef.current.value = hex;
    }
  };

  // Text input blur — validate and commit, or revert
  const handleTextBlur = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      onChange({ target: { name, value: hex } });
    } else {
      e.target.value = safe;
      if (swatchRef.current) swatchRef.current.style.backgroundColor = safe;
      if (pickerRef.current) pickerRef.current.value = safe;
    }
  };

  return (
    <div class="color-cell">
      {/* Visible swatch — clicking opens the hidden picker */}
      <span
        ref={swatchRef}
        class={`color-swatch${disabled ? " color-swatch--disabled" : ""}`}
        style={{ backgroundColor: safe }}
        onClick={handleSwatchClick}
        title={disabled ? undefined : "Click to open colour picker"}
        role={disabled ? undefined : "button"}
        aria-label={disabled ? undefined : `open colour picker for ${name}`}
      />

      {/* Hidden native color picker — provides the HSL picker UI */}
      <input
        ref={pickerRef}
        type="color"
        class="color-picker-hidden"
        value={safe}
        disabled={disabled}
        onInput={handlePickerInput}
        onChange={handlePickerChange}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Editable hex text input */}
      <input
        ref={textRef}
        type="text"
        class="color-input"
        name={name}
        defaultValue={safe}
        key={safe}
        disabled={disabled}
        maxLength={7}
        placeholder="#rrggbb"
        onInput={handleTextInput}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
        onBlur={handleTextBlur}
        aria-label={`hex colour for ${name}`}
      />
    </div>
  );
};

const formatFrequencyHz = (value) => {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(1);
};

const FrequencyInput = ({
  ariaLabel,
  value,
  onCommit,
  disabled = false,
  deviationCents = null,
  comparing = false,
}) => {
  const display = formatFrequencyHz(value);
  const isDirty = deviationCents !== null && Math.abs(deviationCents) > 0.001;
  // Match the tune-delta / tune-comparing colour scheme
  const color = isDirty ? (comparing ? "#660000" : "#990000") : undefined;
  const fontStyle = comparing ? "italic" : undefined;
  return (
    <input
      id="centered"
      type="text"
      inputMode="decimal"
      disabled={disabled}
      class="frequency-input"
      key={display}
      defaultValue={display}
      aria-label={ariaLabel}
      style={color ? { color, WebkitTextFillColor: color, fontStyle } : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
      }}
      onBlur={(e) => {
        const next = parseFloat(e.target.value);
        if (!Number.isFinite(next) || next <= 0 || disabled) {
          e.target.value = display;
          return;
        }
        onCommit(next);
      }}
    />
  );
};

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
    if (onPreviewChangeRef.current) onPreviewChangeRef.current(degree, tunedCents, comparing);
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

// sidebar display of the scala file, degrees, note names, colors in an html table format
const ScaleTable = (props) => {
  const { scale, equiv_interval } = useMemo(() => {
    const s = [...(props.settings.scale || [])];
    const eq = s.length ? s.pop() : "2/1";
    s.unshift("0.");
    return { scale: s, equiv_interval: eq };
  }, [props.settings.scale]);
  const workspace = useMemo(
    () => createScaleWorkspace(props.settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- props.settings is a new object on every render; listing the specific keys that affect workspace output avoids unnecessary recomputation
    [props.settings.scale, props.settings.reference_degree, props.settings.fundamental],
  );

  const degrees = [...Array(scale.length).keys()];
  const note_names = props.settings.note_names || [];

  let colors;
  if (props.settings.spectrum_colors) {
    colors = Array(scale.length).fill(props.settings.fundamental_color);
  } else {
    colors = props.settings.note_colors || [];
  }

  const rows = scale.map((x, i) => [x, degrees[i], note_names[i] || "", colors[i] || "#ffffff"]);
  const referenceDegree = props.settings.reference_degree || 0;

  const scaleChangeAt = (i, str) => {
    const next = [...(props.settings.scale || [])];
    next[i] = str;
    props.onChange("scale", next);
  };
  // Called only on blur-commit (not on every keystroke) so TuneCell can reset.
  // degree index here is the TuneCell degree (i+1 for scale rows, scale.length for equave).
  const scaleCommitAt = (i, str, tuneCellDegree) => {
    scaleChangeAt(i, str);
    bumpResetVersion(tuneCellDegree);
  };

  const colorChange = (e) => {
    const next = [...(props.settings.note_colors || [])];
    next[parseInt(e.target.name.replace(/color/, ""))] = e.target.value;
    props.onChange("note_colors", next);
  };

  const nameChange = (e) => {
    const next = [...(props.settings.note_names || [])];
    next[parseInt(e.target.name.replace(/name/, ""))] = e.target.value;
    props.onChange("note_names", next);
  };

  const editable_colors = props.settings.spectrum_colors;
  const [showSearchPrefs, setShowSearchPrefs] = useState(false);
  const [searchPrefs, setSearchPrefs] = useState(DEFAULT_SEARCH_PREFS);
  const [rationalisingScale, setRationalisingScale] = useState(false);
  // previewState: per-degree { cents, comparing } set by TuneCell during drag
  const [previewState, setPreviewState] = useState({});
  // resetVersion: per-degree counter, bumped when a direct text edit commits a new
  // scale value so TuneCell can discard its in-flight drag state.
  const [resetVersion, setResetVersion] = useState({});
  const bumpResetVersion = useCallback((degreeIndex) => {
    setResetVersion((prev) => ({ ...prev, [degreeIndex]: (prev[degreeIndex] ?? 0) + 1 }));
  }, []);

  const effectiveCentsAtDegree = useCallback((degreeIndex) => {
    const state = previewState[degreeIndex];
    if (state && state.cents !== null) return state.cents;
    return scalaToCents(String(scale[degreeIndex] ?? equiv_interval));
  }, [previewState, scale, equiv_interval]);
  const referenceCents = effectiveCentsAtDegree(referenceDegree);
  const frequencyAtDegree = useCallback((degreeIndex) => {
    const cents = effectiveCentsAtDegree(degreeIndex);
    return props.settings.fundamental * Math.pow(2, (cents - referenceCents) / 1200.0);
  }, [effectiveCentsAtDegree, props.settings.fundamental, referenceCents]);

  // Auto-rationalise every non-root, non-equave degree using a two-pass approach:
  //
  // Pass 1 — independent: gather top-N candidates for every degree with no
  //   cross-degree consistency influence. The naive best (index 0) is collected
  //   to form the reference set for pass 2.
  //
  // Pass 2 — cross-consistent: for each degree, rescore its candidate list
  //   using scorePrimeConsistency against the full set of pass-1 winners
  //   (excluding that degree's own entry). The candidate with the best combined
  //   aggregate + consistency bonus wins.
  //
  // This avoids the ordering bias of the old incremental approach, where early
  // degrees had no cross-degree signal and later degrees were locked into
  // whatever earlier degrees happened to pick.
  const rationaliseScale = useCallback(() => {
    const currentScale = [...(props.settings.scale || [])];
    const equaveIdx = currentScale.length - 1; // last entry is the equave — never touched

    // Pre-compute scaleCents once — the pitch set is static across all degrees.
    const byDegree = workspace?.lookup?.byDegree;
    const scaleCents = byDegree
      ? Array.from(byDegree.values()).filter((s) => s?.cents != null).map((s) => s.cents)
      : null;

    // Seed reference monzos from whatever is already hand-committed in the
    // workspace — these are stable anchors regardless of what this run picks.
    const preCommittedMonzos = [];
    if (byDegree) {
      for (const slot of byDegree.values()) {
        if (Array.isArray(slot?.committedIdentity?.monzo)) {
          preCommittedMonzos.push(slot.committedIdentity.monzo);
        }
      }
    }

    // ── Pass 1: independent candidate search for every degree ──────────────
    // No cross-degree consistency scoring — each degree is evaluated on its
    // own merits. We keep the full candidate list per degree for pass 2.
    const perDegree = currentScale.map((str, i) => {
      if (i === equaveIdx) return null;
      const tuneCellDegree = i + 1;
      const tunedCents = scalaToCents(String(str));
      const request = getRationalisationRequest({
        degree: tuneCellDegree,
        tunedCents,
        workspace,
        settings: props.settings,
        frequencyAtDegree,
        searchPrefs,
      });
      request._scaleCents = scaleCents;
      request._committedMonzos = []; // no cross-degree signal in pass 1
      const candidates = getHumanTestableRationalCandidates(request);
      return { str, candidates };
    });

    // Collect the naive-best monzo from each degree to form the pass-2 reference.
    const pass1Monzos = perDegree.map((entry) => {
      if (!entry) return null;
      const best = entry.candidates[0];
      return Array.isArray(best?.monzo) ? best.monzo : null;
    });

    // ── Pass 2: cross-consistent re-ranking ────────────────────────────────
    // Each degree is rescored using the full pass-1 winner set (minus itself)
    // as the committed-monzo reference. scorePrimeConsistency produces a graded
    // bonus [0,2] that is added to aggregateScore to break ties in favour of
    // harmonically adjacent choices.
    const CONSISTENCY_BONUS_WEIGHT = 0.8; // matches weightConsistency in rationalise.js
    let changed = false;
    const newScale = currentScale.map((str, i) => {
      if (i === equaveIdx) return str;
      const entry = perDegree[i];
      if (!entry || !entry.candidates.length) return str;

      // Reference = pre-committed anchors + pass-1 winners from all OTHER degrees.
      const refMonzos = [
        ...preCommittedMonzos,
        ...pass1Monzos.filter((m, j) => j !== i && m != null),
      ];

      // Re-rank by (aggregateScore - consistency_bonus) — lower aggregateScore
      // is better, so a positive consistency bonus lowers the effective cost.
      const ranked = entry.candidates
        .filter((c) => c.ratioText)
        .map((c) => {
          const consistency = scorePrimeConsistency(c, refMonzos);
          const effectiveCost = c.aggregateScore - CONSISTENCY_BONUS_WEIGHT * consistency;
          return { c, effectiveCost };
        })
        .sort((a, b) => a.effectiveCost - b.effectiveCost);

      if (!ranked.length) return str;
      const best = ranked[0].c;
      if (best.ratioText === str) return str;
      changed = true;
      return best.ratioText;
    });

    if (changed) {
      props.onChange("scale", newScale);
      // Bump all reset versions so every TuneCell discards in-flight drag state.
      setResetVersion((prev) => {
        const next = { ...prev };
        for (let i = 1; i <= newScale.length; i++) {
          next[i] = (prev[i] ?? 0) + 1;
        }
        return next;
      });
    }
    setRationalisingScale(false);
  }, [props, workspace, frequencyAtDegree, searchPrefs]);

  const centsFromFrequency = (frequency) =>
    referenceCents + 1200 * Math.log2(frequency / props.settings.fundamental);
  // deviationCentsAtDegree: cents delta from committed value (for frequency colour)
  const deviationCentsAtDegree = (degreeIndex) => {
    const state = previewState[degreeIndex];
    if (!state || state.cents === null) return null;
    const committed = scalaToCents(String(scale[degreeIndex] ?? equiv_interval));
    return state.cents - committed;
  };
  const isComparingAtDegree = (degreeIndex) => !!previewState[degreeIndex]?.comparing;
  const updatePreviewCents = useCallback((degreeIndex, cents, comparing = false) => {
    setPreviewState((prev) => {
      const cur = prev[degreeIndex];
      if (cur && cur.cents === cents && cur.comparing === comparing) return prev;
      if (cents === null) {
        if (!cur || cur.cents === null) return prev;
        return { ...prev, [degreeIndex]: { cents: null, comparing: false } };
      }
      return { ...prev, [degreeIndex]: { cents, comparing } };
    });
  }, []);
  const commitFrequencyAtDegree = (degreeIndex, frequency) => {
    const targetCents = centsFromFrequency(frequency);

    if (degreeIndex === 0) {
      const delta = targetCents;
      const oldScale = [...(props.settings.scale || [])];
      const newScale = oldScale.map((str, idx) => {
        if (idx === oldScale.length - 1) return str;
        const cents = scalaToCents(String(str));
        return (cents - delta).toFixed(6);
      });
      if (referenceDegree === 0) {
        props.onAtomicChange({
          scale: newScale,
          fundamental: props.settings.fundamental * Math.pow(2, delta / 1200.0),
        });
      } else {
        props.onChange("scale", newScale);
      }
      return;
    }

    if (degreeIndex === referenceDegree && props.settings.retuning_mode !== "transpose_scale") {
      props.onChange("fundamental", frequency);
      return;
    }

    if (degreeIndex === scale.length) {
      scaleChangeAt(scale.length - 1, targetCents.toFixed(6));
      return;
    }

    scaleChangeAt(degreeIndex - 1, targetCents.toFixed(6));
  };

  return (
    <div class="scale-table-workspace">
      <div class="scale-table-toolbar">
        {!showSearchPrefs && (
          <button
            type="button"
            class="scale-table-toolbar__toggle"
            onClick={() => setShowSearchPrefs(true)}
            aria-expanded={false}
            aria-controls="scale-search-prefs"
          >
            Rationalisation Search Preferences
          </button>
        )}
        <button
          type="button"
          class="scale-table-toolbar__rationalise"
          onClick={() => {
            setRationalisingScale(true);
            // Defer to next tick so the button can show a loading state before
            // the synchronous search blocks the main thread.
            setTimeout(rationaliseScale, 0);
          }}
          disabled={rationalisingScale}
          title="Find best rational candidate for every scale degree and commit all at once"
        >
          {rationalisingScale ? "Rationalising…" : "Rationalise Scale"}
        </button>
      </div>
      {showSearchPrefs && (
        <fieldset id="scale-search-prefs" class="settings-panel scale-search-prefs">
          <legend>Rationalisation Search</legend>
          <button
            type="button"
            title="Close"
            class="settings-panel__close"
            onClick={() => setShowSearchPrefs(false)}
          >
            ✕
          </button>
          <div class="scale-search-prefs__row">
            <label class="scale-search-prefs__field">
              Region
              <select
                value={searchPrefs.region}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearchPrefs((prev) => {
                    if (next === "overtonal") {
                      // Zero out all undertonal bounds
                      const utZero = Object.fromEntries(
                        Object.keys(prev.primeBoundsUt).map((k) => [k, "0"])
                      );
                      return { ...prev, region: next, primeBoundsUt: utZero };
                    }
                    if (next === "symmetric") {
                      // Mirror overtonal bounds into undertonal
                      return { ...prev, region: next, primeBoundsUt: { ...prev.primeBounds } };
                    }
                    // custom: keep existing values as-is
                    return { ...prev, region: next };
                  });
                }}
                aria-label="rationalisation region"
              >
                <option value="symmetric">Symmetric</option>
                <option value="overtonal">Overtonal</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label class="scale-search-prefs__field">
              Search tol. (¢)
              <input
                type="text"
                inputMode="numeric"
                value={searchPrefs.centsTolerance}
                onInput={(e) =>
                  setSearchPrefs((prev) => ({
                    ...prev,
                    centsTolerance: e.target.value,
                  }))
                }
                aria-label="rationalisation cents tolerance"
              />
            </label>
            <label class="scale-search-prefs__field">
              Context tol. (¢)
              <input
                type="text"
                inputMode="numeric"
                value={searchPrefs.contextTolerance}
                onInput={(e) =>
                  setSearchPrefs((prev) => ({
                    ...prev,
                    contextTolerance: e.target.value,
                  }))
                }
                aria-label="rationalisation context consonance tolerance"
              />
            </label>
            <label class="scale-search-prefs__field">
              Prime limit
              <input
                type="text"
                inputMode="numeric"
                value={searchPrefs.primeLimit}
                onInput={(e) => {
                  const raw = e.target.value;
                  const newLimit = parseOptionalPositiveInt(raw);
                  setSearchPrefs((prev) => {
                    const next = { ...prev, primeLimit: raw };
                    if (newLimit == null) return next;
                    // Sync primeBounds and primeBoundsUt with the new limit:
                    // — primes above the limit → "0"
                    // — primes newly within the limit that were "0" → default from DEFAULT_PRIME_BOUNDS
                    const prevLimit = parseOptionalPositiveInt(prev.primeLimit);
                    const ot = { ...prev.primeBounds };
                    const ut = { ...prev.primeBoundsUt };
                    for (const prime of PRIME_BOUND_KEYS) {
                      const wasActive = prevLimit == null || prime <= prevLimit;
                      const nowActive = prime <= newLimit;
                      if (!nowActive && wasActive) {
                        // Newly excluded: zero out
                        ot[prime] = "0";
                        ut[prime] = "0";
                      } else if (nowActive && !wasActive) {
                        // Newly included: restore default if currently "0"
                        const def = DEFAULT_PRIME_BOUNDS[prime] ?? "1";
                        if (!ot[prime] || ot[prime] === "0") ot[prime] = def;
                        if (!ut[prime] || ut[prime] === "0") ut[prime] = def;
                      }
                    }
                    next.primeBounds = ot;
                    next.primeBoundsUt = ut;
                    return next;
                  });
                }}
                aria-label="rationalisation prime limit"
              />
            </label>
            <label class="scale-search-prefs__field">
              Odd limit
              <input
                type="text"
                inputMode="numeric"
                value={searchPrefs.oddLimit}
                onInput={(e) =>
                  setSearchPrefs((prev) => ({
                    ...prev,
                    oddLimit: e.target.value,
                  }))
                }
                aria-label="rationalisation odd limit"
              />
            </label>
          </div>
          {/* Rows 2–3: per-prime step bounds split into 3–19 and 23+ */}
          {[PRIME_BOUND_KEYS_LOW, PRIME_BOUND_KEYS_HIGH].map((primeRow, rowIdx) => {
            const isCustom = searchPrefs.region === "custom";
            return (
              <div
                key={rowIdx}
                class={`scale-search-prefs__grid${isCustom ? " scale-search-prefs__grid--custom" : ""}`}
                aria-label={rowIdx === 0 ? "prime step bounds 3–19" : "prime step bounds 23+"}
              >
                {primeRow.map((prime) => {
                  const limit = parseOptionalPositiveInt(searchPrefs.primeLimit);
                  const aboveLimit = limit != null && prime > limit;
                  return (
                    <div
                      key={prime}
                      class={`scale-search-prefs__prime${aboveLimit ? " scale-search-prefs__prime--inactive" : ""}`}
                    >
                      <span class="scale-search-prefs__prime-label">{prime}</span>
                      {isCustom ? (
                        <div class="scale-search-prefs__prime-pair">
                          <span class="scale-search-prefs__prime-badge scale-search-prefs__prime-badge--ut">u</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={aboveLimit ? "0" : (searchPrefs.primeBoundsUt[prime] ?? "1")}
                            disabled={aboveLimit}
                            onInput={(e) =>
                              setSearchPrefs((prev) => ({
                                ...prev,
                                primeBoundsUt: { ...prev.primeBoundsUt, [prime]: e.target.value },
                              }))
                            }
                            aria-label={`prime ${prime} undertonal steps`}
                            class="scale-search-prefs__prime-input"
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            value={aboveLimit ? "0" : (searchPrefs.primeBounds[prime] ?? "1")}
                            disabled={aboveLimit}
                            onInput={(e) =>
                              setSearchPrefs((prev) => ({
                                ...prev,
                                primeBounds: { ...prev.primeBounds, [prime]: e.target.value },
                              }))
                            }
                            aria-label={`prime ${prime} overtonal steps`}
                            class="scale-search-prefs__prime-input"
                          />
                          <span class="scale-search-prefs__prime-badge scale-search-prefs__prime-badge--ot">°</span>
                        </div>
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={aboveLimit ? "0" : (searchPrefs.primeBounds[prime] ?? "1")}
                          disabled={aboveLimit}
                          onInput={(e) => {
                            const val = e.target.value;
                            setSearchPrefs((prev) => {
                              const next = {
                                ...prev,
                                primeBounds: { ...prev.primeBounds, [prime]: val },
                              };
                              // In symmetric mode keep undertonal mirrored
                              if (prev.region === "symmetric") {
                                next.primeBoundsUt = { ...prev.primeBoundsUt, [prime]: val };
                              }
                              return next;
                            });
                          }}
                          aria-label={`rationalisation prime ${prime} steps`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          
        </fieldset>
      )}
      <table>
        <thead>
          <tr>
            <th class="wide scale-data-col" id="leftaligned">
              Degree&nbsp;:&nbsp;Ratio&nbsp;|&nbsp;Cents&nbsp;|&nbsp;EDO
            </th>
            <th class="scale-frequency-col">Frequency&nbsp;&nbsp;</th>
            <th class="scale-name-col">Name</th>
            <th class="scale-color-col">Colour&nbsp;&nbsp;&nbsp;</th>
          </tr>
        </thead>
        <tbody>
        <tr
          key={`0-${props.importCount}`}
          class={
            [
              props.settings.reference_degree === 0 ? "reference-degree-row" : "",
              props.settings.center_degree === 0 ? "center-degree-row" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <td class="scale-data-col">
            <div class="scale-degree-cell">
              <span class="degree-gutter" aria-label="scale degree gutter 0">
                {degrees[0]}
              </span>
              <div class="freq-cell">
                <input
                  type="text"
                  disabled
                  value="1/1  |  0.0  |  0\n"
                  aria-label="pitch value root"
                />
                <TuneCell
                  key={`tune0-${props.importCount}`}
                  scaleStr="0.0"
                  degree={0}
                  committedInterval={getRowRuntime(workspace, 0).committedInterval}
                  committedCents={getRowRuntime(workspace, 0).committedCents}
                  workspace={workspace}
                  settings={props.settings}
                  frequencyAtDegree={frequencyAtDegree}
                  searchPrefs={searchPrefs}
                  keysRef={props.keysRef}
                  reference_degree={props.settings.reference_degree}
                  fundamental={props.settings.fundamental}
                  retuning_mode={props.settings.retuning_mode}
                  onPreviewChange={updatePreviewCents}
                  onDegree0Save={(delta) => {
                    // delta: cents degree 0 moved up.
                    // The equave is never touched — it is a period ratio, not a pitch.
                    const oldScale = [...(props.settings.scale || [])];
                    // Subtract delta from every degree except the equave so all
                    // other notes stay at the same absolute Hz.
                    const newScale = oldScale.map((str, idx) => {
                      if (idx === oldScale.length - 1) return str; // equave unchanged
                      const cents = scalaToCents(String(str));
                      return (cents - delta).toFixed(6);
                    });
                    const ref = props.settings.reference_degree;
                    if (ref === 0) {
                      // Degree 0 is the reference: fundamental shifts up by delta.
                      // Scale degrees (excl. equave) shift down by delta to keep
                      // all other notes at the same Hz.
                      const newFundamental =
                        props.settings.fundamental * Math.pow(2, delta / 1200.0);
                      props.onAtomicChange({ scale: newScale, fundamental: newFundamental });
                    } else {
                      // Another degree is the reference: fundamental stays.
                      // Subtracting delta from all non-equave scale degrees keeps
                      // every other note at the same Hz and shifts degree 0 up.
                      props.onChange("scale", newScale);
                    }
                  }}
                />
              </div>
            </div>
          </td>
          <td class="scale-frequency-col">
            <FrequencyInput
              ariaLabel="pitch frequency 0"
              value={frequencyAtDegree(0)}
              onCommit={(frequency) => commitFrequencyAtDegree(0, frequency)}
              deviationCents={deviationCentsAtDegree(0)}
              comparing={isComparingAtDegree(0)}
            />
          </td>
          <td class="scale-name-col">
            <input
              id="centered"
              type="text"
              name="name0"
              value={note_names[0] || ""}
              onChange={nameChange}
              aria-label="pitch name 0"
            />
          </td>
          <td class="scale-color-col">
            <ColorCell
              name="color0"
              value={colors[0] || "#ffffff"}
              disabled={editable_colors}
              onChange={colorChange}
            />
          </td>
        </tr>
        {rows.slice(1).map(([freq, degree, name, color], i) => (
          <tr
            key={`${i + 1}-${props.importCount}`}
            class={
              [
                props.settings.reference_degree === i + 1 ? "reference-degree-row" : "",
                props.settings.center_degree === i + 1 ? "center-degree-row" : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          >
            <td class="scale-data-col">
              <div class="scale-degree-cell">
                <span class="degree-gutter" aria-label={`scale degree gutter ${i + 1}`}>
                  {degree}
                </span>
                <div class="freq-cell">
                  <ScalaInput
                    context="degree"
                    name={`scale${i}`}
                    value={freq}
                    onAnyChange={(str) => scaleChangeAt(i, str)}
                    onChange={(str) => scaleCommitAt(i, str, i + 1)}
                    showCents={!String(freq).includes(".")}
                    aria-label={`pitch value ${i}`}
                  />
                  <TuneCell
                    key={`tune${i + 1}-${props.importCount}`}
                    scaleStr={(props.settings.scale || [])[i] || String(freq)}
                    degree={i + 1}
                    committedInterval={getRowRuntime(workspace, i + 1).committedInterval}
                    committedCents={getRowRuntime(workspace, i + 1).committedCents}
                    workspace={workspace}
                    settings={props.settings}
                    frequencyAtDegree={frequencyAtDegree}
                    searchPrefs={searchPrefs}
                    keysRef={props.keysRef}
                    reference_degree={props.settings.reference_degree}
                    fundamental={props.settings.fundamental}
                    retuning_mode={props.settings.retuning_mode}
                    onPreviewChange={updatePreviewCents}
                    resetVersion={resetVersion[i + 1] ?? 0}
                    onChange={(newStr) => {
                      const next = [...(props.settings.scale || [])];
                      next[i] = newStr;
                      props.onChange("scale", next);
                    }}
                    onFundamentalChange={(newFreq, newStr) => {
                      if (newStr !== undefined) {
                        const next = [...(props.settings.scale || [])];
                        next[i] = newStr;
                        props.onAtomicChange({ fundamental: newFreq, scale: next });
                      } else {
                        props.onChange("fundamental", newFreq);
                      }
                    }}
                  />
                </div>
              </div>
            </td>
            <td class="scale-frequency-col">
              <FrequencyInput
                ariaLabel={`pitch frequency ${i + 1}`}
                value={frequencyAtDegree(i + 1)}
                onCommit={(frequency) => commitFrequencyAtDegree(i + 1, frequency)}
                deviationCents={deviationCentsAtDegree(i + 1)}
                comparing={isComparingAtDegree(i + 1)}
              />
            </td>
            <td class="scale-name-col">
              <input
                id="centered"
                type="text"
                name={`name${i + 1}`}
                value={name}
                onChange={nameChange}
                aria-label={`pitch name ${i + 1}`}
              />
            </td>
            <td class="scale-color-col">
              <ColorCell
                name={`color${i + 1}`}
                value={color}
                disabled={editable_colors}
                onChange={colorChange}
              />
            </td>
          </tr>
        ))}
        <tr
          key={`equiv-${props.importCount}`}
          class={
            props.settings.reference_degree === scale.length ? "reference-degree-row" : undefined
          }
        >
          <td class="scale-data-col">
            <div class="scale-degree-cell">
              <span class="degree-gutter" aria-label="scale degree gutter equave">
                {scale.length}
              </span>
              <div class="freq-cell">
                <ScalaInput
                  context="interval"
                  name={`scale${scale.length - 1}`}
                  value={equiv_interval}
                  onAnyChange={(str) => scaleChangeAt(scale.length - 1, str)}
                  onChange={(str) => scaleCommitAt(scale.length - 1, str, scale.length)}
                  showCents={!String(equiv_interval).includes(".")}
                  aria-label={`pitch ${scale.length - 1}`}
                />
                <div class="tune-cell-spacer" aria-hidden="true" />
              </div>
            </div>
          </td>
          <td class="scale-frequency-col">
            <FrequencyInput
              ariaLabel="equave frequency"
              value={frequencyAtDegree(scale.length)}
              onCommit={(frequency) => commitFrequencyAtDegree(scale.length, frequency)}
              deviationCents={deviationCentsAtDegree(scale.length)}
              comparing={isComparingAtDegree(scale.length)}
            />
          </td>
          <td class="scale-name-col">
            <input
              id="centered"
              type="text"
              disabled
              class="equiv-cell"
              value={note_names[0] || ""}
              aria-label="pitch name equave"
            />
          </td>
          <td class="scale-color-col">
            <span
              style={{
                fontWeight: "bold",
                display: "block",
                textAlign: "center",
                marginTop: "0.25em",
              }}
            >
              Equave
            </span>
          </td>
        </tr>
        </tbody>
      </table>
    </div>
  );
};

ScaleTable.propTypes = {
  keysRef: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  onAtomicChange: PropTypes.func,
  importCount: PropTypes.number,
  settings: PropTypes.shape({
    scale: PropTypes.arrayOf(PropTypes.string),
    key_labels: PropTypes.string,
    spectrum_colors: PropTypes.bool,
    fundamental_color: PropTypes.string,
    note_colors: PropTypes.arrayOf(PropTypes.string),
    note_names: PropTypes.arrayOf(PropTypes.string),
    reference_degree: PropTypes.number,
    center_degree: PropTypes.number,
    fundamental: PropTypes.number,
    retuning_mode: PropTypes.string,
  }),
};

export default ScaleTable;
