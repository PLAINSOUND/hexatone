// KeyLabels renders the label/spelling controls for the current scale.
// It coordinates HEJI anchor data, label modes, and notation structure editing
// without owning the underlying tuning workspace or keyboard runtime.

import { useEffect, useMemo, useState } from "preact/hooks";
import PropTypes from "prop-types";
import { normaliseHejiAnchorRatio, scalaToCents } from "./parse-scale.js";
import { canonicalHejiAnchorLabelInput } from "../../notation/heji-normalization.js";
import { BASE_BY_ID, BASE_SYMBOLS, HEJI_FAMILIES } from "../../notation/heji.js";
import {
  clearPitchStructure,
  createPitchStructure,
  parseHejiToStructure,
  pitchStructureToBaseId,
  pitchStructureToHeji,
  withPitchStructureAccidentalCount,
  withPitchStructureAccidentalDelta,
  withPitchStructureFlag,
  withPitchStructureLetter,
  withPitchStructurePrimeDelta,
  withPitchStructureSyntonicDelta,
} from "../../notation/pitch-structure.js";
import { buildPitchFrame, resolveStructurePitch } from "../../notation/pitch-frame.js";
import { createScaleWorkspace } from "../../tuning/workspace.js";
import { formatEditableFrequencyHz, formatFrequencyHz } from "./scale-table/frequency-input.js";

const HEJI_PALETTE_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const HEJI_BASE_SYMBOLS_BY_ID = Object.fromEntries(BASE_SYMBOLS.map((symbol) => [symbol.id, symbol]));
function makeBaseId(chromatic, syntonic) {
  return `${chromatic}:${syntonic}`;
}

const HEJI_3_LIMIT_GLYPHS = {
  flat: HEJI_BASE_SYMBOLS_BY_ID[makeBaseId("flat", 0)]?.glyph ?? "b",
  natural: HEJI_BASE_SYMBOLS_BY_ID[makeBaseId("natural", 0)]?.glyph ?? "n",
  sharp: HEJI_BASE_SYMBOLS_BY_ID[makeBaseId("sharp", 0)]?.glyph ?? "#",
};

const TEMPERED_12EDO_GLYPHS = {
  flat: "",
  natural: "",
  sharp: "",
};

const LETTER_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHROMATIC_TO_SEMITONE_DELTA = { doubleflat: -2, flat: -1, natural: 0, sharp: 1, doublesharp: 2 };

function chromaticSemitone(letter, chromatic) {
  const base = LETTER_TO_SEMITONE[letter?.toUpperCase?.()] ?? 9;
  const delta = CHROMATIC_TO_SEMITONE_DELTA[chromatic] ?? 0;
  return ((base + delta) % 12 + 12) % 12;
}

function samePitchStructure(a, b) {
  if (!a || !b) return false;
  if (a.letter !== b.letter) return false;
  if ((a.accidentalCount ?? 0) !== (b.accidentalCount ?? 0)) return false;
  if ((a.syntonic ?? 0) !== (b.syntonic ?? 0)) return false;
  if ((a.useTemperedAccidentals ?? false) !== (b.useTemperedAccidentals ?? false)) return false;
  const keys = new Set([
    ...Object.keys(a.primeExponents ?? {}),
    ...Object.keys(b.primeExponents ?? {}),
  ]);
  return [...keys].every((key) => (a.primeExponents?.[key] ?? 0) === (b.primeExponents?.[key] ?? 0));
}

function derivePaletteAutoDeviationCents(structure, anchorLabel, anchorRatio) {
  if (!structure?.letter || !anchorLabel) return null;

  const anchorStructure = parseHejiToStructure(anchorLabel);
  if (!anchorStructure?.letter) return null;

  const pitchFrame = buildPitchFrame({
    heji_anchor_label: anchorLabel,
    heji_anchor_ratio: anchorRatio || "1/1",
    reference_degree: 0,
    fundamental: 440,
  }, null);
  const resolved = resolveStructurePitch(pitchFrame, structure);
  const centsFromAnchor = resolved?.notationRelativeInterval?.cents;
  if (!Number.isFinite(centsFromAnchor)) return null;

  const targetChromatic = BASE_BY_ID[pitchStructureToBaseId(structure)]?.chromatic ?? "natural";
  const anchorChromatic = BASE_BY_ID[pitchStructureToBaseId(anchorStructure)]?.chromatic ?? "natural";
  const pc = ((centsFromAnchor % 1200) + 1200) % 1200;
  const expected =
    ((chromaticSemitone(structure.letter, targetChromatic) - chromaticSemitone(anchorStructure.letter, anchorChromatic)) * 100 % 1200 + 1200) % 1200;
  const raw = pc - expected;
  return ((raw + 600) % 1200 + 1200) % 1200 - 600;
}

function formatPaletteAutoDeviation(value, decimals = 0) {
  if (!Number.isFinite(value)) return "";
  const places = Math.max(0, Math.min(6, Number(decimals) || 0));
  const rounded = Number(value.toFixed(places));
  const prefix = rounded < 0 ? "−" : "+";
  const magnitude = Math.abs(rounded).toFixed(places);
  return `${prefix}${magnitude}`;
}

function normalizeEditableDeviationInput(nextValue, currentValue = "") {
  const source = String(nextValue ?? "").replace(/\s+/g, "");
  if (!source) return "";
  const rest = source.replace(/^[+\u2212-]+/, "");
  if (!rest) {
    if (source.startsWith("−") || source.startsWith("-")) return "−";
    if (source.startsWith("+")) return "+";
    return String(currentValue ?? "").startsWith("−") ? "−" : "+";
  }
  if (source.startsWith("−") || source.startsWith("-")) return `−${rest}`;
  if (source.startsWith("+")) return `+${rest}`;
  return String(currentValue ?? "").startsWith("−") ? `−${rest}` : `+${rest}`;
}

function formatDerivedFrequency(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(1);
}

function normalizeAnchorFrequencyInput(raw) {
  const next = String(raw ?? "").trim();
  if (!next) return "";
  const parsed = Number.parseFloat(next);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed.toFixed(6).replace(/\.?0+$/, "");
}

function normalizeAnchorLabelInput(raw) {
  const source = String(raw ?? "").trim();
  if (!source) return null;
  const withoutCents = source.replace(/[+\-\u2212]\d+(?:\.\d+)?\s*$/u, "");
  return canonicalHejiAnchorLabelInput(withoutCents.trim());
}

function convertPaletteStructureToTempered(structure, accidentalCount) {
  return createPitchStructure({
    ...structure,
    accidentalCount,
    syntonic: 0,
    primeExponents: {},
    useTemperedAccidentals: true,
  });
}

function convertPaletteStructureToJiBase(structure) {
  return createPitchStructure({
    ...structure,
    syntonic: 0,
    primeExponents: {},
    useTemperedAccidentals: false,
  });
}

function convertTemperedAccidentalToJi(structure, accidentalCount) {
  return withPitchStructureAccidentalCount(convertPaletteStructureToJiBase(structure), accidentalCount);
}

function parsePaletteStructureSetting(value) {
  try {
    return createPitchStructure(JSON.parse(value || "{}"));
  } catch {
    return createPitchStructure();
  }
}

// choose options for the displayed text on the keys
const KeyLabels = (props) => {
  const hejiDisabled = props.heji_supported === false;
  const selectedKeyLabel = props.settings.key_labels === "equaves" ? "no_labels" : props.settings.key_labels;
  const showEquaves = props.settings.show_equaves || props.settings.key_labels === "equaves";
  const [showPalette, setShowPaletteState] = useState(
    () => props.settings.heji_palette_visible === true,
  );
  const [paletteStructure, setPaletteStructureState] = useState(
    () => parsePaletteStructureSetting(props.settings.heji_palette_structure),
  );
  const [paletteDeviation, setPaletteDeviationState] = useState(
    () => String(props.settings.heji_palette_deviation ?? ""),
  );
  const [paletteDeviationDecimals, setPaletteDeviationDecimalsState] = useState(
    () => Math.max(0, Math.min(6, Number(props.settings.heji_palette_decimals) || 0)),
  );
  const setShowPalette = (value) => {
    const next = value === true;
    setShowPaletteState(next);
    props.onChange("heji_palette_visible", next);
  };
  const setPaletteStructure = (update) => {
    const next = typeof update === "function" ? update(paletteStructure) : update;
    const normalized = createPitchStructure(next);
    setPaletteStructureState(normalized);
    props.onChange("heji_palette_structure", JSON.stringify(normalized));
  };
  const setPaletteDeviation = (update) => {
    const next = typeof update === "function" ? update(paletteDeviation) : update;
    const normalized = String(next ?? "");
    setPaletteDeviationState(normalized);
    props.onChange("heji_palette_deviation", normalized);
  };
  const setPaletteDeviationDecimals = (value) => {
    const next = Math.max(0, Math.min(6, Number(value) || 0));
    setPaletteDeviationDecimalsState(next);
    props.onChange("heji_palette_decimals", next);
  };
  const [copied, setCopied] = useState(false);
  const [anchorRatioDraft, setAnchorRatioDraft] = useState(() => props.settings.heji_anchor_ratio || "");
  const [anchorLabelDraft, setAnchorLabelDraft] = useState(() => props.settings.heji_anchor_label || "");
  const [anchorFrequencyDraft, setAnchorFrequencyDraft] = useState("");
  const [editingAnchorFrequency, setEditingAnchorFrequency] = useState(false);
  const effectiveAnchorLabel = props.settings.heji_anchor_label || props.heji_anchor_label_eff || "A";
  const effectiveAnchorRatio = props.settings.heji_anchor_ratio || props.heji_anchor_ratio_eff || "1/1";
  useEffect(() => {
    setShowPaletteState(props.settings.heji_palette_visible === true);
  }, [props.settings.heji_palette_visible]);
  useEffect(() => {
    setPaletteStructureState(parsePaletteStructureSetting(props.settings.heji_palette_structure));
  }, [props.settings.heji_palette_structure]);
  useEffect(() => {
    setPaletteDeviationState(String(props.settings.heji_palette_deviation ?? ""));
  }, [props.settings.heji_palette_deviation]);
  useEffect(() => {
    setPaletteDeviationDecimalsState(
      Math.max(0, Math.min(6, Number(props.settings.heji_palette_decimals) || 0)),
    );
  }, [props.settings.heji_palette_decimals]);
  useEffect(() => {
    setAnchorRatioDraft(props.settings.heji_anchor_ratio || "");
  }, [props.settings.heji_anchor_ratio]);
  useEffect(() => {
    setAnchorLabelDraft(props.settings.heji_anchor_label || "");
  }, [props.settings.heji_anchor_label]);
  const effectivePitchFrame = useMemo(() => {
    if (props.settings.pitch_frame) return props.settings.pitch_frame;
    if (!Array.isArray(props.settings.scale)) return null;
    try {
      const settingsForFrame = {
        scale: props.settings.scale,
        reference_degree: props.settings.reference_degree ?? 0,
        fundamental: props.settings.fundamental ?? 440,
        heji_anchor_label: effectiveAnchorLabel,
        heji_anchor_ratio: effectiveAnchorRatio,
      };
      return buildPitchFrame(settingsForFrame, createScaleWorkspace(settingsForFrame));
    } catch {
      return null;
    }
  }, [
    props.settings.pitch_frame,
    props.settings.scale,
    props.settings.reference_degree,
    props.settings.fundamental,
    effectiveAnchorLabel,
    effectiveAnchorRatio,
  ]);
  const effectiveAnchorFrequencyValue = useMemo(() => {
    const pitchFrame = effectivePitchFrame;
    const referenceFrequency = Number(props.settings.fundamental);
    const referenceOffsetCents = Number(pitchFrame?.notationZeroToReferenceInterval?.cents);
    if (!Number.isFinite(referenceFrequency)) return null;
    if (!Number.isFinite(referenceOffsetCents)) {
      const normalizedAnchorRatio = normaliseHejiAnchorRatio(effectiveAnchorRatio) || "1/1";
      const anchorCents = scalaToCents(normalizedAnchorRatio);
      const referenceDegree = props.settings.reference_degree ?? 0;
      const referenceDegreeText =
        referenceDegree === 0
          ? "1/1"
          : String(props.settings.scale?.[referenceDegree - 1] ?? "");
      const referenceDegreeCents = scalaToCents(referenceDegreeText);
      if (Number.isFinite(anchorCents) && Number.isFinite(referenceDegreeCents)) {
        return referenceFrequency / Math.pow(2, (referenceDegreeCents - anchorCents) / 1200);
      }
      const anchorStructure = parseHejiToStructure(effectiveAnchorLabel);
      const referenceStructure = parseHejiToStructure(props.settings.note_names?.[referenceDegree] ?? "");
      if (samePitchStructure(anchorStructure, referenceStructure)) {
        return referenceFrequency;
      }
      if ((props.settings.reference_degree ?? 0) === 0 && normalizedAnchorRatio === "1/1") {
        return referenceFrequency;
      }
      return null;
    }
    return referenceFrequency / Math.pow(2, referenceOffsetCents / 1200);
  }, [
    effectivePitchFrame,
    effectiveAnchorLabel,
    props.settings.fundamental,
    props.settings.note_names,
    props.settings.reference_degree,
    props.settings.scale,
    effectiveAnchorRatio,
  ]);
  const effectiveAnchorFrequency = useMemo(
    () => formatDerivedFrequency(effectiveAnchorFrequencyValue),
    [effectiveAnchorFrequencyValue],
  );
  const explicitAnchorFrequencyValue = useMemo(() => {
    const parsed = Number.parseFloat(props.settings.heji_anchor_frequency || "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [props.settings.heji_anchor_frequency]);
  const derivedAnchorFrequencyValue = useMemo(() => {
    return Number.isFinite(effectiveAnchorFrequencyValue) && effectiveAnchorFrequencyValue > 0
      ? effectiveAnchorFrequencyValue
      : null;
  }, [effectiveAnchorFrequencyValue]);
  const visibleAnchorFrequencyValue = explicitAnchorFrequencyValue ?? derivedAnchorFrequencyValue;
  const displayedAnchorFrequency = useMemo(
    () => formatFrequencyHz(visibleAnchorFrequencyValue),
    [visibleAnchorFrequencyValue],
  );
  const editableAnchorFrequency = useMemo(
    () => formatEditableFrequencyHz(visibleAnchorFrequencyValue),
    [visibleAnchorFrequencyValue],
  );
  useEffect(() => {
    if (!editingAnchorFrequency) setAnchorFrequencyDraft(displayedAnchorFrequency);
  }, [displayedAnchorFrequency, editingAnchorFrequency]);
  const paletteText = useMemo(() => pitchStructureToHeji(paletteStructure), [paletteStructure]);
  const paletteAutoDeviationCents = useMemo(() => {
    if (paletteStructure.useTemperedAccidentals) return null;
    return derivePaletteAutoDeviationCents(paletteStructure, effectiveAnchorLabel, effectiveAnchorRatio);
  }, [effectiveAnchorLabel, effectiveAnchorRatio, paletteStructure]);
  const paletteDeviationDisplay = useMemo(() => {
    if (paletteStructure.useTemperedAccidentals) return paletteDeviation;
    return formatPaletteAutoDeviation(paletteAutoDeviationCents, paletteDeviationDecimals);
  }, [paletteAutoDeviationCents, paletteDeviation, paletteDeviationDecimals, paletteStructure.useTemperedAccidentals]);
  const combinedPaletteText = `${paletteText}${paletteDeviationDisplay}`.trim();

  const copyHejiToNoteNames = () => {
    if (!props.heji_names?.length) return;
    props.onAtomicChange({
      note_names: [...props.heji_names],
      key_labels: "note_names",
    });
  };

  const handleCopyPalette = async () => {
    if (!combinedPaletteText) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(combinedPaletteText);
        setCopied(true);
        return;
      }
      const helper = document.createElement("textarea");
      helper.value = combinedPaletteText;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      helper.style.pointerEvents = "none";
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      const copiedOk = document.execCommand?.("copy");
      document.body.removeChild(helper);
      setCopied(!!copiedOk);
    } catch {
      setCopied(false);
    }
  };

  const setDeviationSign = (sign) => {
    setPaletteDeviation((current) => {
      const rest = String(current ?? "").replace(/^[+\u2212-]+/, "");
      return `${sign}${rest}`;
    });
    setCopied(false);
  };

  const commitPaletteAutoDeviationToEditable = () => {
    if (!Number.isFinite(paletteAutoDeviationCents)) return;
    setPaletteDeviation(formatPaletteAutoDeviation(paletteAutoDeviationCents, paletteDeviationDecimals));
  };

  return (
    <>
      <label>
        Key Labels
        <select
          name="key_labels"
          class="sidebar-input"
          value={selectedKeyLabel}
          onChange={(e) => props.onChange(e.target.name, e.target.value)}
        >
          <option value="no_labels">Blank Keys</option>
          <option value="enumerate">Scale Degrees</option>
          <option value="scala_names">Scale Data</option>
          <option value="cents">Octave-Reduced Scale Cents</option>
          <option value="note_names">Name</option>
          <option value="heji">HEJI</option>
        </select>
      </label>
      <label>
        Show Equave Numbers
        <input
          type="checkbox"
          checked={showEquaves}
          onChange={(e) => props.onChange("show_equaves", e.target.checked)}
        />
      </label>
      {
        // The two fields below together define the rational offset for the entire
        // HEJI spelling.  They name a single reference pitch — the one whose
        // deviation reads 0¢ on a tuning meter — by its ratio from degree 0 (1/1)
        // and its HEJI pitch-class spelling.  This pitch need not be a scale degree.
        // Default: ratio "1/1" labelled "nA" — A natural is the just root.
        <fieldset class="heji-anchor-fieldset">
          <legend>HEJI Spelling with 0¢ Deviation</legend>
          {hejiDisabled && (
            <p class="settings-form__warning-copy">
              {props.heji_warning || "Non-octave equave cannot generate consistent note names."}
            </p>
          )}
          {props.settings.key_labels === "heji" && (
            <div class="heji-anchor-fieldset-actions">
              <button
                type="button"
                class="preset-action-btn"
                disabled={hejiDisabled || !props.heji_names?.length}
                onClick={copyHejiToNoteNames}
              >
                Copy HEJI to Note Names
              </button>
            </div>
          )}
          <label>
            Ratio/Cents from 1/1 (scale degree 0)
            <input
              type="text"
              class="sidebar-input"
              placeholder={props.heji_anchor_ratio_eff || "e.g. 1/1  |  0.0¢  |  0\\12"}
              value={anchorRatioDraft}
              disabled={hejiDisabled}
              onInput={(e) => setAnchorRatioDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
              }}
              onBlur={(e) => {
                const normalized = normaliseHejiAnchorRatio(e.target.value);
                if (normalized) {
                  setAnchorRatioDraft(normalized);
                  const stableSpellingFrequency = Number.parseFloat(
                    props.settings.heji_anchor_frequency || effectiveAnchorFrequency,
                  );
                  const preserveDerivedAnchor =
                    !String(props.settings.heji_anchor_ratio || "").trim()
                    && !String(props.settings.heji_anchor_label || "").trim()
                    && effectiveAnchorLabel;
                  let nextFundamental = null;
                  if (Array.isArray(props.settings.scale) && Number.isFinite(stableSpellingFrequency) && stableSpellingFrequency > 0) {
                    try {
                      const nextPitchFrame = buildPitchFrame({
                        scale: props.settings.scale,
                        reference_degree: props.settings.reference_degree ?? 0,
                        fundamental: props.settings.fundamental ?? 440,
                        heji_anchor_label: preserveDerivedAnchor ? effectiveAnchorLabel : (props.settings.heji_anchor_label || effectiveAnchorLabel),
                        heji_anchor_ratio: normalized,
                      }, createScaleWorkspace({
                        scale: props.settings.scale,
                        reference_degree: props.settings.reference_degree ?? 0,
                        fundamental: props.settings.fundamental ?? 440,
                        heji_anchor_label: preserveDerivedAnchor ? effectiveAnchorLabel : (props.settings.heji_anchor_label || effectiveAnchorLabel),
                        heji_anchor_ratio: normalized,
                      }));
                      const referenceOffsetCents = Number(nextPitchFrame?.notationZeroToReferenceInterval?.cents);
                      if (Number.isFinite(referenceOffsetCents)) {
                        nextFundamental = stableSpellingFrequency * Math.pow(2, referenceOffsetCents / 1200);
                      }
                    } catch {
                      nextFundamental = null;
                    }
                  }
                  if (Number.isFinite(nextFundamental) && nextFundamental > 0 && props.onAtomicChange) {
                    props.onAtomicChange({
                      ...(preserveDerivedAnchor ? { heji_anchor_label: effectiveAnchorLabel } : {}),
                      heji_anchor_ratio: normalized,
                      fundamental: nextFundamental,
                    });
                    return;
                  }
                  props.onChange("heji_anchor_ratio", normalized);
                  return;
                }
                const fallback = props.settings.heji_anchor_ratio || "";
                setAnchorRatioDraft(fallback);
              }}
            />
          </label>
          <label>
            Notation (Spelling)
            <input
              type="text"
              class="sidebar-input"
              placeholder={props.heji_anchor_label_eff || `\uE261A`}
              value={anchorLabelDraft}
              disabled={hejiDisabled}
              onInput={(e) => setAnchorLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
              }}
              onBlur={(e) => {
                const normalized = normalizeAnchorLabelInput(e.target.value);
                if (normalized) {
                  setAnchorLabelDraft(normalized);
                  props.onChange("heji_anchor_label", normalized);
                  return;
                }
                setAnchorLabelDraft(props.settings.heji_anchor_label || "");
              }}
            />
          </label>
          <label>
            Spelling Frequency
            <span class="heji-anchor-frequency-right">
              <input
                type="text"
                class={`sidebar-input frequency-input${!props.settings.heji_anchor_frequency ? " frequency-input--derived" : ""}`}
                inputMode="decimal"
                value={anchorFrequencyDraft}
                disabled={hejiDisabled}
                onFocus={(e) => {
                  if (hejiDisabled) return;
                  setEditingAnchorFrequency(true);
                  setAnchorFrequencyDraft(editableAnchorFrequency);
                  e.currentTarget.select?.();
                }}
                onInput={(e) => setAnchorFrequencyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                }}
                onBlur={(e) => {
                  setEditingAnchorFrequency(false);
                  const raw = String(e.target.value ?? "").trim();
                  if (!raw) {
                    props.onChange("heji_anchor_frequency", "");
                    setAnchorFrequencyDraft(displayedAnchorFrequency);
                    return;
                  }
                  const normalized = normalizeAnchorFrequencyInput(e.target.value);
                  if (normalized === null) {
                    setAnchorFrequencyDraft(displayedAnchorFrequency);
                    return;
                  }
                  const normalizedValue = Number.parseFloat(normalized);
                  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
                    setAnchorFrequencyDraft(displayedAnchorFrequency);
                    return;
                  }
                  const referenceOffsetCents = Number(effectivePitchFrame?.notationZeroToReferenceInterval?.cents);
                  if (!Number.isFinite(referenceOffsetCents)) {
                    setAnchorFrequencyDraft(displayedAnchorFrequency);
                    return;
                  }
                  const nextFundamental = normalizedValue * Math.pow(2, referenceOffsetCents / 1200);
                  if (!Number.isFinite(nextFundamental) || nextFundamental <= 0) {
                    setAnchorFrequencyDraft(displayedAnchorFrequency);
                    return;
                  }
                  const currentFundamental = Number(props.settings.fundamental);
                  const sameExplicitText =
                    props.settings.heji_anchor_frequency
                    && Number.isFinite(explicitAnchorFrequencyValue)
                    && Math.abs(normalizedValue - explicitAnchorFrequencyValue) < 0.0000005;
                  const sameDerivedText =
                    !props.settings.heji_anchor_frequency
                    && Number.isFinite(derivedAnchorFrequencyValue)
                    && Math.abs(normalizedValue - derivedAnchorFrequencyValue) < 0.0000005;
                  const sameFundamental =
                    Number.isFinite(currentFundamental)
                    && Math.abs(nextFundamental - currentFundamental) < 0.0000005;
                  if (sameExplicitText && sameFundamental) {
                    setAnchorFrequencyDraft(displayedAnchorFrequency);
                    return;
                  }
                  if (sameDerivedText && sameFundamental) {
                    setAnchorFrequencyDraft(displayedAnchorFrequency);
                    return;
                  }
                  const preserveDerivedAnchor =
                    !String(props.settings.heji_anchor_ratio || "").trim()
                    && !String(props.settings.heji_anchor_label || "").trim()
                    && effectiveAnchorLabel
                    && effectiveAnchorRatio;
                  if (props.onAtomicChange) {
                    props.onAtomicChange({
                      ...(preserveDerivedAnchor
                        ? {
                            heji_anchor_label: effectiveAnchorLabel,
                            heji_anchor_ratio: effectiveAnchorRatio,
                          }
                        : {}),
                      heji_anchor_frequency: normalized,
                      fundamental: nextFundamental,
                    });
                  } else {
                    if (preserveDerivedAnchor) {
                      props.onChange("heji_anchor_label", effectiveAnchorLabel);
                      props.onChange("heji_anchor_ratio", effectiveAnchorRatio);
                    }
                    props.onChange("heji_anchor_frequency", normalized);
                    props.onChange("fundamental", nextFundamental);
                  }
                }}
              />
            </span>
          </label>
          <label class="heji-anchor-fieldset__toggle-row">
            <input
              type="checkbox"
              checked={props.settings.heji_tempered_only === true}
              disabled={hejiDisabled}
              onChange={(e) => props.onChange("heji_tempered_only", e.target.checked)}
            />
            Tempered Accidentals Only
          </label>
          <label class="heji-anchor-fieldset__toggle-row">
            <input
              type="checkbox"
              checked={props.settings.heji_show_cents !== false}
              disabled={hejiDisabled}
              onChange={(e) => props.onChange("heji_show_cents", e.target.checked)}
            />
            Always Include Cents on Keys
          </label>
          <label class="heji-anchor-fieldset__toggle-row">
            <input
              type="checkbox"
              checked={showPalette}
              onChange={(e) => setShowPalette(e.target.checked)}
            />
            Palette
          </label>
          {showPalette && (
            <div class="heji-palette-builder">
              <label class="heji-palette-builder__toggle-row">
                <input
                  type="checkbox"
                  checked={paletteStructure.useDoubles}
                  onChange={(e) => {
                    setPaletteStructure((current) => withPitchStructureFlag(current, "useDoubles", e.target.checked));
                    setCopied(false);
                  }}
                />
                Double Flat/Sharp
              </label>
              <label class="heji-palette-builder__toggle-row">
                <input
                  type="checkbox"
                  checked={paletteStructure.useDoubleSeptimals}
                  onChange={(e) => {
                    setPaletteStructure((current) => withPitchStructureFlag(current, "useDoubleSeptimals", e.target.checked));
                    setCopied(false);
                  }}
                />
                Double Septimals
              </label>
              <label class="heji-palette-builder__toggle-row">
                <input
                  type="checkbox"
                  checked={paletteStructure.cautionaryNatural}
                  onChange={(e) => {
                    setPaletteStructure((current) => withPitchStructureFlag(current, "cautionaryNatural", e.target.checked));
                    setCopied(false);
                  }}
                />
                Cautionary Natural
              </label>
              <label class="heji-palette-builder__select-row">
                Decimal Places
                <select
                  class="sidebar-input heji-palette-builder__decimals-select"
                  aria-label="HEJI palette cents decimal places"
                  value={String(paletteDeviationDecimals)}
                  onChange={(e) => setPaletteDeviationDecimals(Number.parseInt(e.target.value, 10) || 0)}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                    <option key={value} value={String(value)}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <div class="heji-palette-builder__output-row">
                <span>Output</span>
                <div class="heji-palette-builder__output-actions">
                  <button
                    type="button"
                    class="preset-action-btn"
                    disabled={!combinedPaletteText}
                    onClick={handleCopyPalette}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    class="preset-action-btn"
                    disabled={!combinedPaletteText}
                    onClick={() => {
                      setPaletteStructure(clearPitchStructure());
                      setPaletteDeviation("");
                      setCopied(false);
                    }}
                  >
                    Clear
                  </button>
                </div>

                <input
                  type="text"
                  class="sidebar-input heji-palette-builder__output"
                  value={paletteText}
                  readOnly
                  aria-label="HEJI palette output"
                />
                <input
                  type="text"
                  class="sidebar-input heji-palette-builder__deviation"
                  value={paletteDeviationDisplay}
                  placeholder="+0"
                  aria-label="HEJI palette cents deviation"
                  readOnly={!paletteStructure.useTemperedAccidentals}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onInput={(e) => {
                    if (!paletteStructure.useTemperedAccidentals) return;
                    setPaletteDeviation(normalizeEditableDeviationInput(e.target.value, paletteDeviation));
                    setCopied(false);
                  }}
                  onBlur={(e) => {
                    if (!paletteStructure.useTemperedAccidentals) return;
                    setPaletteDeviation(normalizeEditableDeviationInput(e.target.value, paletteDeviation));
                    setCopied(false);
                  }}
                />
              </div>

              <div class="heji-palette-builder__group-row heji-palette-builder__group-row--note">
                <div class="heji-palette-builder__group-label">Note</div>
                <div class="heji-palette-builder__symbols" role="group" aria-label="HEJI letters">
                  {HEJI_PALETTE_LETTERS.map((letter) => (
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) => withPitchStructureLetter(current, letter));
                        setCopied(false);
                      }}
                    >
                      {letter}
                    </button>
                  ))}
                </div>
              </div>
              <div class="heji-palette-builder__group-row heji-palette-builder__group-row--chunks">
                <span class="heji-palette-builder__group-chunk" key="12edo">
                  <div class="heji-palette-builder__group-label">12edo</div>
                  <div class="heji-palette-builder__symbols" role="group" aria-label="12edo accidentals">
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        commitPaletteAutoDeviationToEditable();
                        setPaletteStructure((current) => convertPaletteStructureToTempered(current, -1));
                        setCopied(false);
                      }}
                    >
                      {TEMPERED_12EDO_GLYPHS.flat}
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        commitPaletteAutoDeviationToEditable();
                        setPaletteStructure((current) => convertPaletteStructureToTempered(current, 0));
                        setCopied(false);
                      }}
                    >
                      {TEMPERED_12EDO_GLYPHS.natural}
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        commitPaletteAutoDeviationToEditable();
                        setPaletteStructure((current) => convertPaletteStructureToTempered(current, 1));
                        setCopied(false);
                      }}
                    >
                      {TEMPERED_12EDO_GLYPHS.sharp}
                    </button>
                  </div>
                </span>
                <span class="heji-palette-builder__group-chunk heji-palette-builder__group-chunk--after-symbols">
                  <div class="heji-palette-builder__group-label">cents</div>
                  <div class="heji-palette-builder__symbols" role="group" aria-label="cents sign">
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => setDeviationSign("+")}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => setDeviationSign("−")}
                    >
                      −
                    </button>
                  </div>
                </span>
              </div>
              <div class="heji-palette-builder__group-row heji-palette-builder__group-row--chunks">
                <span class="heji-palette-builder__group-chunk" key="3lim">
                  <div class="heji-palette-builder__group-label">3-Lim</div>
                  <div class="heji-palette-builder__symbols" role="group" aria-label="3-Limit">
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) =>
                          current.useTemperedAccidentals
                            ? convertTemperedAccidentalToJi(current, -1)
                            : withPitchStructureAccidentalDelta(current, -1));
                        setPaletteDeviation("");
                        setCopied(false);
                      }}
                    >
                      {HEJI_3_LIMIT_GLYPHS.flat}
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) =>
                          current.useTemperedAccidentals
                            ? convertTemperedAccidentalToJi(current, 0)
                            : withPitchStructureAccidentalCount(current, 0));
                        setPaletteDeviation("");
                        setCopied(false);
                      }}
                    >
                      {HEJI_3_LIMIT_GLYPHS.natural}
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) =>
                          current.useTemperedAccidentals
                            ? convertTemperedAccidentalToJi(current, 1)
                            : withPitchStructureAccidentalDelta(current, 1));
                        setPaletteDeviation("");
                        setCopied(false);
                      }}
                    >
                      {HEJI_3_LIMIT_GLYPHS.sharp}
                    </button>
                  </div>
                </span>
                <span class="heji-palette-builder__group-chunk" key="5lim">
                  <div class="heji-palette-builder__group-label">5-Lim</div>
                  <div class="heji-palette-builder__symbols" role="group" aria-label="5-Limit">
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) =>
                          withPitchStructureSyntonicDelta(
                            current.useTemperedAccidentals ? convertPaletteStructureToJiBase(current) : current,
                            -1,
                          ));
                        setPaletteDeviation("");
                        setCopied(false);
                      }}
                    >
                      down
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) =>
                          withPitchStructureSyntonicDelta(
                            current.useTemperedAccidentals ? convertPaletteStructureToJiBase(current) : current,
                            1,
                          ));
                        setPaletteDeviation("");
                        setCopied(false);
                      }}
                    >
                      up
                    </button>
                  </div>
                </span>
              </div>
              <div class="heji-palette-builder__prime-grid">
                {HEJI_FAMILIES.map((family) => (
                  <span class="heji-palette-builder__group-chunk" key={family.prime}>
                    <div class="heji-palette-builder__group-label">{`${family.prime}-Lim`}</div>
                    <div class="heji-palette-builder__symbols" role="group" aria-label={`${family.prime}-Limit`}>
                      <span class="heji-palette-builder__pair">
                        <button
                          type="button"
                          class="preset-action-btn heji-palette-builder__symbol-btn"
                          title={`${family.prime}-limit lower`}
                          onClick={() => {
                            setPaletteStructure((current) =>
                              withPitchStructurePrimeDelta(
                                current.useTemperedAccidentals ? convertPaletteStructureToJiBase(current) : current,
                                family.prime,
                                -1,
                              ));
                            setPaletteDeviation("");
                            setCopied(false);
                          }}
                        >
                          {family.lower.glyph}
                        </button>
                        <button
                          type="button"
                          class="preset-action-btn heji-palette-builder__symbol-btn"
                          title={`${family.prime}-limit upper`}
                          onClick={() => {
                            setPaletteStructure((current) =>
                              withPitchStructurePrimeDelta(
                                current.useTemperedAccidentals ? convertPaletteStructureToJiBase(current) : current,
                                family.prime,
                                1,
                              ));
                            setPaletteDeviation("");
                            setCopied(false);
                          }}
                        >
                          {family.upper.glyph}
                        </button>
                      </span>
                    </div>
                  </span>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      }
    </>
  );
};

KeyLabels.propTypes = {
  onChange: PropTypes.func.isRequired,
  onAtomicChange: PropTypes.func.isRequired,
  heji_names: PropTypes.arrayOf(PropTypes.string),
  heji_anchor_label_eff: PropTypes.string,
  heji_anchor_ratio_eff: PropTypes.string,
  heji_supported: PropTypes.bool,
  heji_warning: PropTypes.string,
  settings: PropTypes.shape({
    key_labels: PropTypes.string,
    show_equaves: PropTypes.bool,
    heji_anchor_ratio: PropTypes.string,
    heji_anchor_label: PropTypes.string,
    heji_anchor_frequency: PropTypes.string,
    heji_tempered_only: PropTypes.bool,
    heji_show_cents: PropTypes.bool,
    heji_palette_visible: PropTypes.bool,
    heji_palette_structure: PropTypes.string,
    heji_palette_deviation: PropTypes.string,
    heji_palette_decimals: PropTypes.number,
    pitch_frame: PropTypes.object,
    fundamental: PropTypes.number,
  }),
};

export default KeyLabels;
