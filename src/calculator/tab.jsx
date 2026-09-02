import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import PropTypes from "prop-types";
import FrequencyInput, {
  formatFrequencyHz,
} from "../settings/scale/scale-table/frequency-input.js";
import { buildAutoSelectInputProps } from "../ui/input-selection.js";
import {
  buildPrimeBoundsFromPrefs,
  DEFAULT_SEARCH_PREFS,
  PRIME_BOUND_KEYS,
  parseOptionalPositiveInt,
} from "../settings/scale/scale-table/search-prefs.js";
import HejiPalette from "./heji-palette.jsx";
import { loadCalculatorWorkspace, saveCalculatorWorkspace } from "./session-persistence.js";
import {
  calculatorIntervalFromPitchStructure,
  calculatorPalettePitchFromAnalysis,
  calculatePitchLookup,
  canonicalCalculatorAnchorLabelInput,
  combineCalculatorIntervals,
  deriveCalculatorSeed,
  frequencyFromCents,
  parseCalculatorInterval,
  relativeCalculatorInterval,
} from "./runtime.js";

function loadRationalisationPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem("hexatone_search_prefs") || "null");
    if (stored) {
      return {
        ...DEFAULT_SEARCH_PREFS,
        ...stored,
        primeBounds: { ...DEFAULT_SEARCH_PREFS.primeBounds, ...(stored.primeBounds ?? {}) },
        primeBoundsUt: { ...DEFAULT_SEARCH_PREFS.primeBoundsUt, ...(stored.primeBoundsUt ?? {}) },
      };
    }
  } catch {
    // A corrupt or unavailable local store falls back to Hexatone defaults.
  }
  return {
    ...DEFAULT_SEARCH_PREFS,
    primeBounds: { ...DEFAULT_SEARCH_PREFS.primeBounds },
    primeBoundsUt: { ...DEFAULT_SEARCH_PREFS.primeBoundsUt },
  };
}

function formatNumber(value, decimals) {
  if (!Number.isFinite(value)) return "—";
  const places = Math.max(0, Math.min(6, Number(decimals) || 0));
  const rounded = Number(value.toFixed(places));
  return rounded.toFixed(places);
}

function formatSigned(value, decimals, { includeUnit = true } = {}) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(decimals));
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded).toFixed(decimals)}${includeUnit ? "¢" : ""}`;
}

function formatIntervalPair(ratioText, cents, decimals) {
  return `${ratioText ?? "—"} | ${formatNumber(cents, decimals)}`;
}

function midiNoteName(
  noteName,
  { includeNatural = false, includeOctave = true, useTraditionalAccidentals = false } = {},
) {
  const match = /^([A-G])([b#]?)(-?\d+)?$/.exec(String(noteName ?? ""));
  if (!match) return String(noteName ?? "");
  const [, letter, accidental, octave] = match;
  const symbols = useTraditionalAccidentals
    ? { flat: "*f", natural: "*n", sharp: "*s" }
    : { flat: "", natural: "", sharp: "" };
  const prefix =
    accidental === "b"
      ? symbols.flat
      : accidental === "#"
        ? symbols.sharp
        : includeNatural
          ? symbols.natural
          : "";
  return `${prefix}${letter}${includeOctave ? (octave ?? "") : ""}`;
}

function selectElementText(element) {
  const selection = globalThis.getSelection?.();
  if (!selection || !document.createRange) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectOutputText(event) {
  selectElementText(event.currentTarget);
}

function selectMidiOutputToken(event) {
  if (event.detail >= 3) {
    selectElementText(event.currentTarget.closest("output"));
    return;
  }
  const selection = globalThis.getSelection?.();
  if (event.detail === 1 && selection && !selection.isCollapsed) return;
  selectElementText(event.currentTarget);
}

const SelectableOutput = ({ ariaLabel, children }) => (
  <output
    class="calculator-output"
    aria-label={ariaLabel}
    tabIndex={0}
    onClick={selectOutputText}
    onFocus={selectOutputText}
  >
    {children}
  </output>
);

SelectableOutput.propTypes = {
  ariaLabel: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

const CommitTextInput = ({ ariaLabel, value, onCommit, inputMode = "text", className = "" }) => {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = onCommit(draft);
    setDraft(next ?? value);
  };
  return (
    <input
      type="text"
      inputMode={inputMode}
      class={`sidebar-input ${className}`.trim()}
      aria-label={ariaLabel}
      value={draft}
      {...buildAutoSelectInputProps()}
      onInput={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={commit}
    />
  );
};

CommitTextInput.propTypes = {
  ariaLabel: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  onCommit: PropTypes.func.isRequired,
  inputMode: PropTypes.string,
  className: PropTypes.string,
};

const CalculatorTab = ({
  settings,
  effectiveAnchorLabel,
  effectiveAnchorRatio,
  hidden = false,
  workspaceKey = "",
}) => {
  const seed = useMemo(
    () =>
      deriveCalculatorSeed(settings, {
        label: effectiveAnchorLabel,
        ratio: effectiveAnchorRatio,
      }),
    [effectiveAnchorLabel, effectiveAnchorRatio, settings],
  );
  const restoredWorkspace = useMemo(
    () => (workspaceKey ? loadCalculatorWorkspace(workspaceKey) : null),
    [workspaceKey],
  );
  const [showBlankDataHints, setShowBlankDataHints] = useState(
    restoredWorkspace?.showBlankDataHints ??
      (!Array.isArray(settings.scale) || settings.scale.length === 0),
  );
  const [referenceFrequency, setReferenceFrequency] = useState(
    restoredWorkspace?.referenceFrequency ?? seed.referenceFrequency,
  );
  const [referenceInterval, setReferenceInterval] = useState(
    restoredWorkspace?.referenceInterval ?? seed.referenceInterval,
  );
  const [anchorInterval, setAnchorInterval] = useState(
    restoredWorkspace?.anchorInterval ?? seed.anchorInterval,
  );
  const [anchorReferenceInterval, setAnchorReferenceInterval] = useState(
    restoredWorkspace?.anchorReferenceInterval ?? seed.anchorReferenceInterval,
  );
  const [anchorLabel, setAnchorLabel] = useState(
    restoredWorkspace?.anchorLabel ?? seed.anchorLabel,
  );
  const [offsetInterval, setOffsetInterval] = useState(restoredWorkspace?.offsetInterval ?? "1/1");
  const [queryInterval, setQueryInterval] = useState(
    restoredWorkspace?.queryInterval ?? seed.targetInterval,
  );
  const [spellingResultLabel, setSpellingResultLabel] = useState(
    restoredWorkspace?.spellingResultLabel ?? "",
  );
  const [decimalPlaces, setDecimalPlaces] = useState(
    restoredWorkspace?.decimalPlaces ?? seed.decimalPlaces,
  );
  const [querySource, setQuerySource] = useState(restoredWorkspace?.querySource ?? "ratio");
  const [searchPrefs, setSearchPrefs] = useState(
    restoredWorkspace?.searchPrefs ?? loadRationalisationPreferences,
  );
  const [rationalSort, setRationalSort] = useState(
    restoredWorkspace?.rationalSort ?? "harmonicRadius",
  );
  const [maxRationalResults, setMaxRationalResults] = useState(
    restoredWorkspace?.maxRationalResults ?? "16",
  );
  const [showRationalOptions, setShowRationalOptions] = useState(
    restoredWorkspace?.showRationalOptions ?? false,
  );
  const [normalizeResults, setNormalizeResults] = useState(
    restoredWorkspace?.normalizeResults ?? false,
  );
  const [includeTemperedAccidentalsInDeviation, setIncludeTemperedAccidentalsInDeviation] =
    useState(restoredWorkspace?.includeTemperedAccidentalsInDeviation ?? false);
  const [useTraditionalAccidentals, setUseTraditionalAccidentals] = useState(
    restoredWorkspace?.useTraditionalAccidentals ?? false,
  );
  const [paletteWorkspaceState, setPaletteWorkspaceState] = useState(
    restoredWorkspace?.palette ?? null,
  );

  useEffect(() => {
    if (!workspaceKey) return;
    saveCalculatorWorkspace(workspaceKey, {
      showBlankDataHints,
      referenceFrequency,
      referenceInterval,
      anchorInterval,
      anchorReferenceInterval,
      anchorLabel,
      offsetInterval,
      queryInterval,
      spellingResultLabel,
      decimalPlaces,
      querySource,
      searchPrefs,
      rationalSort,
      maxRationalResults,
      showRationalOptions,
      normalizeResults,
      includeTemperedAccidentalsInDeviation,
      useTraditionalAccidentals,
      palette: paletteWorkspaceState,
    });
  }, [
    anchorInterval,
    anchorLabel,
    anchorReferenceInterval,
    decimalPlaces,
    includeTemperedAccidentalsInDeviation,
    maxRationalResults,
    normalizeResults,
    offsetInterval,
    paletteWorkspaceState,
    queryInterval,
    querySource,
    rationalSort,
    referenceFrequency,
    referenceInterval,
    searchPrefs,
    showBlankDataHints,
    showRationalOptions,
    spellingResultLabel,
    useTraditionalAccidentals,
    workspaceKey,
  ]);

  const rationalSearch = useMemo(() => {
    const primeLimit = parseOptionalPositiveInt(searchPrefs.primeLimit);
    const bounds = buildPrimeBoundsFromPrefs(searchPrefs, primeLimit);
    return {
      primeLimit: primeLimit ?? 19,
      oddLimit: parseOptionalPositiveInt(searchPrefs.oddLimit),
      centsTolerance: Math.max(0.01, Number(searchPrefs.centsTolerance) || 6),
      region: searchPrefs.region,
      ...bounds,
      maxCandidates: Math.max(1, Math.min(64, Number(maxRationalResults) || 16)),
      sortBy: rationalSort,
    };
  }, [maxRationalResults, rationalSort, searchPrefs]);

  const targetFromAnchorInterval = useMemo(
    () => combineCalculatorIntervals(offsetInterval, queryInterval) ?? "",
    [offsetInterval, queryInterval],
  );
  const targetInterval = useMemo(
    () => combineCalculatorIntervals(anchorInterval, targetFromAnchorInterval) ?? "",
    [anchorInterval, targetFromAnchorInterval],
  );
  const analysis = useMemo(
    () =>
      calculatePitchLookup({
        referenceFrequency,
        referenceInterval,
        anchorInterval,
        anchorLabel,
        targetInterval,
        offsetFromAnchorInterval: offsetInterval,
        pitchFromOffsetInterval: queryInterval,
        preferredHejiLabel: querySource === "spelling" ? spellingResultLabel : "",
        rationalSearch,
        normalizeResults,
      }),
    [
      anchorInterval,
      anchorLabel,
      rationalSearch,
      referenceFrequency,
      referenceInterval,
      querySource,
      spellingResultLabel,
      targetInterval,
      normalizeResults,
      offsetInterval,
      queryInterval,
    ],
  );
  const synchronizedPalettePitch = useMemo(
    () =>
      querySource === "ratio" && analysis.valid
        ? calculatorPalettePitchFromAnalysis({
            hejiLabel: analysis.hejiLabel,
            centsFromAnchor: analysis.centsFromAnchor,
            anchorLabel,
          })
        : null,
    [analysis, anchorLabel, querySource],
  );

  const commitInterval = (value, setter, fallback) => {
    const parsed = parseCalculatorInterval(value);
    if (!parsed.valid) return fallback;
    setter(parsed.normalized);
    return parsed.normalized;
  };
  const updateAnchorPlacement = (nextAnchorInterval) => {
    setAnchorInterval(nextAnchorInterval);
  };
  const commitReferenceInterval = (value) => {
    const parsed = parseCalculatorInterval(value);
    if (!parsed.valid) return referenceInterval;
    const nextAnchorInterval = combineCalculatorIntervals(
      parsed.normalized,
      anchorReferenceInterval,
    );
    if (!nextAnchorInterval) return referenceInterval;
    setReferenceInterval(parsed.normalized);
    updateAnchorPlacement(nextAnchorInterval);
    return parsed.normalized;
  };
  const commitAnchorInterval = (value) => {
    const parsed = parseCalculatorInterval(value);
    if (!parsed.valid) return anchorInterval;
    const nextAnchorReferenceInterval = relativeCalculatorInterval(
      parsed.normalized,
      referenceInterval,
    );
    if (!nextAnchorReferenceInterval) return anchorInterval;
    setAnchorReferenceInterval(nextAnchorReferenceInterval);
    updateAnchorPlacement(parsed.normalized);
    return parsed.normalized;
  };
  const commitAnchorReferenceInterval = (value) => {
    const parsed = parseCalculatorInterval(value);
    if (!parsed.valid) return anchorReferenceInterval;
    const nextAnchorInterval = combineCalculatorIntervals(referenceInterval, parsed.normalized);
    if (!nextAnchorInterval) return anchorReferenceInterval;
    setAnchorReferenceInterval(parsed.normalized);
    updateAnchorPlacement(nextAnchorInterval);
    return parsed.normalized;
  };
  const commitSpelling = useCallback(
    ({ structure, deviationCents, octave }) => {
      const resolved = calculatorIntervalFromPitchStructure({
        structure,
        anchorLabel,
        anchorInterval,
        deviationCents,
        octave,
      });
      if (!resolved.valid) return;
      const relative = relativeCalculatorInterval(resolved.relativeInterval, offsetInterval);
      if (!relative) return;
      setSpellingResultLabel(resolved.hejiLabel || "");
      setQueryInterval(relative);
      setQuerySource("spelling");
    },
    [anchorInterval, anchorLabel, offsetInterval],
  );
  const updateSearchPreference = (key, value) => {
    setSearchPrefs((current) => ({ ...current, [key]: value }));
  };
  const updatePrimeBound = (prime, value, undertonal = false) => {
    setSearchPrefs((current) => {
      const key = undertonal ? "primeBoundsUt" : "primeBounds";
      const next = { ...current, [key]: { ...current[key], [prime]: value } };
      if (!undertonal && current.region === "symmetric") {
        next.primeBoundsUt = { ...current.primeBoundsUt, [prime]: value };
      }
      return next;
    });
  };
  return (
    <div
      hidden={hidden}
      class={`calculator-tab${showBlankDataHints ? " calculator-tab--blank-hints" : ""}`}
      onInputCapture={() => setShowBlankDataHints(false)}
      onChangeCapture={() => setShowBlankDataHints(false)}
      onClickCapture={(event) => {
        const button = event.target.closest?.("button");
        if (
          button?.closest(".calculator-palette") &&
          button.textContent.trim() !== "Copy" &&
          button.textContent.trim() !== "Copied"
        ) {
          setShowBlankDataHints(false);
        }
      }}
    >
      <fieldset>
        <legend>Reference</legend>
        <label>
          Reference Frequency (Hz)
          <FrequencyInput
            ariaLabel="Calculator reference frequency"
            value={referenceFrequency}
            onCommit={(value) => {
              setReferenceFrequency(value);
            }}
          />
        </label>
        <label>
          Reference Offset (Ratio/Cents from 1/1)
          <CommitTextInput
            key={`reference-interval-${referenceInterval}`}
            ariaLabel="Calculator reference ratio or cents"
            value={referenceInterval}
            onCommit={commitReferenceInterval}
          />
        </label>
        <label>
          Frequency of 1/1
          <FrequencyInput
            ariaLabel="Calculator frequency of 1/1"
            value={analysis.valid ? analysis.degree0Frequency : null}
            onCommit={(degree0Frequency) => {
              if (!analysis.valid || !Number.isFinite(degree0Frequency) || degree0Frequency <= 0)
                return;
              setReferenceFrequency(frequencyFromCents(degree0Frequency, analysis.referenceCents));
            }}
          />
        </label>
      </fieldset>

      <fieldset class="heji-anchor-fieldset">
        <legend>HEJI Spelling with 0¢ Deviation</legend>
        <label>
          Ratio/Cents from 1/1
          <CommitTextInput
            key={`anchor-interval-${anchorInterval}`}
            ariaLabel="Calculator HEJI anchor ratio or cents"
            value={anchorInterval}
            onCommit={commitAnchorInterval}
          />
        </label>
        <label>
          Ratio/Cents from Reference
          <CommitTextInput
            key={`anchor-reference-interval-${anchorReferenceInterval}`}
            ariaLabel="Calculator HEJI anchor ratio or cents from reference"
            value={anchorReferenceInterval}
            onCommit={commitAnchorReferenceInterval}
          />
        </label>
        <label>
          Notation (Spelling)
          <CommitTextInput
            key={`anchor-label-${anchorLabel}`}
            ariaLabel="Calculator HEJI anchor spelling"
            value={anchorLabel}
            onCommit={(value) => {
              const normalized = canonicalCalculatorAnchorLabelInput(value);
              if (!normalized) return anchorLabel;
              setAnchorLabel(normalized);
              return normalized;
            }}
          />
        </label>
        <label>
          Spelling Frequency
          <FrequencyInput
            ariaLabel="Calculator spelling frequency"
            value={analysis.valid ? analysis.anchorFrequency : null}
            onCommit={(nextAnchorFrequency) => {
              if (
                !analysis.valid ||
                !Number.isFinite(nextAnchorFrequency) ||
                nextAnchorFrequency <= 0
              )
                return;
              const nextReferenceFrequency = frequencyFromCents(
                nextAnchorFrequency,
                analysis.referenceCents - parseCalculatorInterval(anchorInterval).cents,
              );
              setReferenceFrequency(nextReferenceFrequency);
            }}
          />
        </label>
      </fieldset>

      <fieldset
        class={`calculator-palette-fieldset${querySource === "spelling" ? " calculator-input-source--active" : ""}`}
      >
        <legend>Palette Input</legend>
        <p class="calculator-field-hint">Spell a note using HEJI Notation</p>
        <HejiPalette
          anchorLabel={anchorLabel}
          anchorRatio={anchorInterval}
          initialSpelling={anchorLabel}
          initialDeviation=""
          initialDecimals={decimalPlaces}
          initialWorkspaceState={paletteWorkspaceState}
          synchronizedPitch={synchronizedPalettePitch}
          onDecimalsChange={setDecimalPlaces}
          onSpellingChange={commitSpelling}
          onWorkspaceStateChange={setPaletteWorkspaceState}
        />
      </fieldset>

      <fieldset class="calculator-lookup">
        <legend>Ratio/Cents Input</legend>
        <p class="calculator-field-hint">Choose an offset and a pitch as ratio or cents</p>
        <label>
          Offset (from HEJI Notation Anchor)
          <CommitTextInput
            key={`offset-${offsetInterval}`}
            ariaLabel="Calculator lookup offset ratio or cents"
            value={offsetInterval}
            onCommit={(value) => {
              const parsed = parseCalculatorInterval(value);
              if (!parsed.valid) return offsetInterval;
              setOffsetInterval(parsed.normalized);
              setQuerySource("ratio");
              return parsed.normalized;
            }}
          />
        </label>
        <label>
          Pitch (from Offset)
          <CommitTextInput
            key={`query-${queryInterval}`}
            ariaLabel="Calculator lookup ratio or cents"
            value={queryInterval}
            onCommit={(value) => {
              const committed = commitInterval(value, setQueryInterval, queryInterval);
              if (committed !== queryInterval || parseCalculatorInterval(value).valid) {
                setQuerySource("ratio");
              }
              return committed;
            }}
          />
        </label>
        {!analysis.valid ? <p class="settings-form__warning-copy">{analysis.error}</p> : null}
      </fieldset>

      <fieldset class="calculator-rationalisation">
        <legend>
          <b>Rationalisation Search</b>
          <button
            type="button"
            class="section-collapse-toggle"
            aria-expanded={showRationalOptions}
            aria-controls="calculator-rationalisation-options"
            aria-label={`${showRationalOptions ? "Hide" : "Show"} Rationalisation Search options`}
            title={`${showRationalOptions ? "Toggle to hide" : "Toggle to show"} Rationalisation Search options`}
            onClick={() => setShowRationalOptions((current) => !current)}
          >
            <span
              class={`disclosure-toggle-glyph disclosure-toggle-glyph--${
                showRationalOptions ? "expanded" : "collapsed"
              }`}
              aria-hidden="true"
            />
          </button>
        </legend>
        <label>
          Sort By
          <select
            class="sidebar-input"
            aria-label="Calculator rationalisation sort"
            value={rationalSort}
            onChange={(event) => setRationalSort(event.target.value)}
          >
            <option value="score">Search ranking</option>
            <option value="deviation">Cents deviation</option>
            <option value="harmonicRadius">Harmonic radius from 1/1</option>
            <option value="oddRadius">Odd radius from 1/1</option>
            <option value="prime">Prime limit</option>
            <option value="odd">Odd limit</option>
          </select>
        </label>
        {showRationalOptions ? (
          <div id="calculator-rationalisation-options" class="calculator-rationalisation__options">
            <div class="scale-search-prefs__row">
              <label class="scale-search-prefs__field">
                Region
                <select
                  aria-label="Calculator rationalisation region"
                  value={searchPrefs.region}
                  onChange={(event) => updateSearchPreference("region", event.target.value)}
                >
                  <option value="symmetric">Symmetric</option>
                  <option value="overtonal">Overtonal</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label class="scale-search-prefs__field">
                Search (¢)
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Calculator rationalisation cents tolerance"
                  value={searchPrefs.centsTolerance}
                  onInput={(event) => updateSearchPreference("centsTolerance", event.target.value)}
                />
              </label>
              <label class="scale-search-prefs__field">
                Prime Limit
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Calculator rationalisation prime limit"
                  value={searchPrefs.primeLimit}
                  onInput={(event) => updateSearchPreference("primeLimit", event.target.value)}
                />
              </label>
              <label class="scale-search-prefs__field">
                Odd Limit
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Calculator rationalisation odd limit"
                  value={searchPrefs.oddLimit}
                  onInput={(event) => updateSearchPreference("oddLimit", event.target.value)}
                />
              </label>
              <label class="scale-search-prefs__field">
                Results
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Calculator rationalisation result count"
                  value={maxRationalResults}
                  onInput={(event) => setMaxRationalResults(event.target.value)}
                />
              </label>
            </div>
            <div
              class={`scale-search-prefs__grid${
                searchPrefs.region === "custom" ? " scale-search-prefs__grid--custom" : ""
              }`}
              aria-label="Calculator prime step bounds"
            >
              {PRIME_BOUND_KEYS.map((prime) => {
                const activeLimit = parseOptionalPositiveInt(searchPrefs.primeLimit);
                const inactive = activeLimit != null && prime > activeLimit;
                return (
                  <div
                    key={prime}
                    class={`scale-search-prefs__prime${
                      inactive ? " scale-search-prefs__prime--inactive" : ""
                    }`}
                  >
                    <span class="scale-search-prefs__prime-label">{prime}</span>
                    {searchPrefs.region === "custom" ? (
                      <div class="scale-search-prefs__prime-pair">
                        <span class="scale-search-prefs__prime-badge scale-search-prefs__prime-badge--ut">
                          u
                        </span>
                        <input
                          type="text"
                          class="scale-search-prefs__prime-input"
                          aria-label={`Calculator rationalisation prime ${prime} undertonal steps`}
                          inputMode="numeric"
                          disabled={inactive}
                          value={searchPrefs.primeBoundsUt[prime] ?? "0"}
                          onInput={(event) => updatePrimeBound(prime, event.target.value, true)}
                        />
                        <input
                          type="text"
                          class="scale-search-prefs__prime-input"
                          aria-label={`Calculator rationalisation prime ${prime} overtonal steps`}
                          inputMode="numeric"
                          disabled={inactive}
                          value={searchPrefs.primeBounds[prime] ?? "0"}
                          onInput={(event) => updatePrimeBound(prime, event.target.value)}
                        />
                        <span class="scale-search-prefs__prime-badge scale-search-prefs__prime-badge--ot">
                          °
                        </span>
                      </div>
                    ) : (
                      <input
                        type="text"
                        aria-label={`Calculator rationalisation prime ${prime} overtonal steps`}
                        inputMode="numeric"
                        disabled={inactive}
                        value={searchPrefs.primeBounds[prime] ?? "0"}
                        onInput={(event) => updatePrimeBound(prime, event.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </fieldset>

      <fieldset class="calculator-results">
        <legend>Calculated Data</legend>
        <label class="settings-form__checkbox-row calculator-results__normalize">
          <input
            type="checkbox"
            aria-label="Calculator normalise results"
            checked={normalizeResults}
            onChange={(event) => setNormalizeResults(event.target.checked)}
          />
          Normalise into one octave above the HEJI Anchor
        </label>
        <label>
          Spelling
          <SelectableOutput ariaLabel="Calculator spelling output">
            {analysis.hejiLabel || "—"}
          </SelectableOutput>
        </label>
        <label>
          Ratio | Cents from Offset
          <SelectableOutput ariaLabel="Calculator interval from offset">
            {analysis.valid
              ? formatIntervalPair(
                  analysis.ratioFromOffsetText,
                  analysis.centsFromOffset,
                  decimalPlaces,
                )
              : "—"}
          </SelectableOutput>
        </label>
        <label>
          Ratio | Cents from HEJI Anchor
          <SelectableOutput ariaLabel="Calculator interval from HEJI anchor">
            {analysis.valid
              ? formatIntervalPair(
                  analysis.ratioFromAnchorText,
                  analysis.displayedCentsFromAnchor,
                  decimalPlaces,
                )
              : "—"}
          </SelectableOutput>
        </label>
        <label>
          Ratio | Cents from Reference
          <SelectableOutput ariaLabel="Calculator interval from reference">
            {analysis.valid
              ? formatIntervalPair(
                  analysis.ratioFromReferenceText,
                  analysis.centsFromReference,
                  decimalPlaces,
                )
              : "—"}
          </SelectableOutput>
        </label>
        <label>
          Ratio | Cents from 1/1
          <SelectableOutput ariaLabel="Calculator interval from 1/1">
            {analysis.valid
              ? formatIntervalPair(analysis.ratioText, analysis.centsFromDegree0, decimalPlaces)
              : "—"}
          </SelectableOutput>
        </label>
        <label>
          Frequency (Hz)
          <SelectableOutput ariaLabel="Calculator frequency output">
            {analysis.valid ? formatFrequencyHz(analysis.frequencyHz) : "—"}
          </SelectableOutput>
        </label>
        <label>
          Nearest MIDI Note
          <output
            class="calculator-output calculator-output--tokens"
            aria-label="Calculator nearest MIDI note"
            tabIndex={0}
          >
            {analysis.midi ? (
              <>
                {analysis.midi.noteNames.map((noteName, index) => (
                  <span key={noteName}>
                    {index > 0 ? <span aria-hidden="true"> | </span> : null}
                    <span
                      class="calculator-output__token calculator-output--midi"
                      onClick={selectMidiOutputToken}
                    >
                      {midiNoteName(noteName, { useTraditionalAccidentals })}
                    </span>
                  </span>
                ))}
                <span aria-hidden="true"> | </span>
                <span class="calculator-output__token" onClick={selectMidiOutputToken}>
                  {analysis.midi.midiNote}
                </span>
              </>
            ) : (
              "—"
            )}
          </output>
        </label>
        <label>
          Deviation (±50)
          <output
            class={`calculator-output${
              includeTemperedAccidentalsInDeviation
                ? " calculator-output--tokens calculator-output--midi"
                : ""
            }`}
            aria-label="Calculator MIDI deviation"
            tabIndex={0}
            onClick={(event) => {
              if (event.target === event.currentTarget) selectOutputText(event);
            }}
          >
            {analysis.notationMeter
              ? includeTemperedAccidentalsInDeviation
                ? analysis.notationMeter.noteNames.map((noteName, index) => {
                    const deviation = formatSigned(
                      analysis.notationMeter.deviationCents,
                      decimalPlaces,
                      { includeUnit: false },
                    );
                    return (
                      <span key={noteName}>
                        {index > 0 ? <span aria-hidden="true"> | </span> : null}
                        <span class="calculator-output__token" onClick={selectMidiOutputToken}>
                          {midiNoteName(noteName, {
                            includeNatural: true,
                            includeOctave: false,
                            useTraditionalAccidentals,
                          })}
                          {deviation}
                        </span>
                      </span>
                    );
                  })
                : formatSigned(analysis.notationMeter.deviationCents, decimalPlaces, {
                    includeUnit: false,
                  })
              : "—"}
          </output>
        </label>
        <label class="settings-form__checkbox-row calculator-results__midi-accidentals">
          <input
            type="checkbox"
            aria-label="Calculator include tempered accidentals in deviation"
            checked={includeTemperedAccidentalsInDeviation}
            onChange={(event) => setIncludeTemperedAccidentalsInDeviation(event.target.checked)}
          />
          Include tempered accidentals in Deviation
        </label>
        <label class="settings-form__checkbox-row calculator-results__midi-accidentals">
          <input
            type="checkbox"
            aria-label="Calculator use traditional accidentals"
            checked={useTraditionalAccidentals}
            onChange={(event) => setUseTraditionalAccidentals(event.target.checked)}
          />
          Use traditional accidentals
        </label>
      </fieldset>

      <fieldset class="calculator-rational-candidates">
        <legend>Nearby Rational Pitches</legend>
        <div class="calculator-candidate-list" aria-label="Calculator nearby rational values">
          {analysis.nearbyRatios?.length ? (
            analysis.nearbyRatios.map((candidate) => (
              <button
                key={candidate.ratioText}
                type="button"
                class="rationalise-candidate calculator-rational-candidate"
                onClick={() => {
                  setQueryInterval(candidate.ratioText);
                  setQuerySource("ratio");
                  setShowBlankDataHints(false);
                }}
              >
                <span class="rationalise-candidate__row1">
                  <span class="rationalise-candidate__ratio">{candidate.ratioText}</span>
                  <span class="rationalise-candidate__meta">
                    {formatSigned(candidate.deviationCents, decimalPlaces)}
                  </span>
                </span>
                <span class="rationalise-candidate__row2">
                  <span class="rationalise-candidate__meta">{candidate.primeLimit}-limit</span>
                  <span class="rationalise-candidate__meta">
                    {rationalSort === "oddRadius" ? "or" : "hr"}{" "}
                    {formatNumber(
                      rationalSort === "oddRadius" ? candidate.oddRadius : candidate.harmonicRadius,
                      2,
                    )}
                  </span>
                  <span class="rationalise-candidate__meta">odd {candidate.oddLimit}</span>
                </span>
              </button>
            ))
          ) : (
            <p class="calculator-field-hint">No rational values within the current search.</p>
          )}
        </div>
      </fieldset>
    </div>
  );
};

CalculatorTab.propTypes = {
  settings: PropTypes.object.isRequired,
  effectiveAnchorLabel: PropTypes.string,
  effectiveAnchorRatio: PropTypes.string,
  hidden: PropTypes.bool,
  workspaceKey: PropTypes.string,
};

export default CalculatorTab;
