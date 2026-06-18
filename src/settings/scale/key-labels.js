import { useMemo, useState } from "preact/hooks";
import PropTypes from "prop-types";
import { normaliseHejiAnchorRatio } from "./parse-scale.js";
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
  withPitchStructureTemperedAccidentalCount,
} from "../../notation/pitch-structure.js";
import { buildPitchFrame, resolveStructurePitch } from "../../notation/pitch-frame.js";

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

function derivePaletteAutoDeviation(structure, anchorLabel, anchorRatio) {
  if (!structure?.letter || !anchorLabel) return "";

  const anchorStructure = parseHejiToStructure(anchorLabel);
  if (!anchorStructure?.letter) return "";

  const pitchFrame = buildPitchFrame({
    heji_anchor_label: anchorLabel,
    heji_anchor_ratio: anchorRatio || "1/1",
    reference_degree: 0,
    fundamental: 440,
  }, null);
  const resolved = resolveStructurePitch(pitchFrame, structure);
  const centsFromAnchor = resolved?.notationRelativeInterval?.cents;
  if (!Number.isFinite(centsFromAnchor)) return "";

  const targetChromatic = BASE_BY_ID[pitchStructureToBaseId(structure)]?.chromatic ?? "natural";
  const anchorChromatic = BASE_BY_ID[pitchStructureToBaseId(anchorStructure)]?.chromatic ?? "natural";
  const pc = ((centsFromAnchor % 1200) + 1200) % 1200;
  const expected =
    ((chromaticSemitone(structure.letter, targetChromatic) - chromaticSemitone(anchorStructure.letter, anchorChromatic)) * 100 % 1200 + 1200) % 1200;
  const raw = Math.round(pc - expected);
  const deviation = ((raw + 600) % 1200 + 1200) % 1200 - 600;
  if (deviation === 0) return "+0";
  return deviation > 0 ? `+${deviation}` : `−${Math.abs(deviation)}`;
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

// choose options for the displayed text on the keys
const KeyLabels = (props) => {
  const hejiDisabled = props.heji_supported === false;
  const selectedKeyLabel = props.settings.key_labels === "equaves" ? "no_labels" : props.settings.key_labels;
  const showEquaves = props.settings.show_equaves || props.settings.key_labels === "equaves";
  const [showPalette, setShowPalette] = useState(false);
  const [paletteStructure, setPaletteStructure] = useState(() => createPitchStructure());
  const [paletteDeviation, setPaletteDeviation] = useState("");
  const [copied, setCopied] = useState(false);
  const effectiveAnchorLabel = props.settings.heji_anchor_label || props.heji_anchor_label_eff || "A";
  const effectiveAnchorRatio = props.settings.heji_anchor_ratio || props.heji_anchor_ratio_eff || "1/1";
  const paletteText = useMemo(() => pitchStructureToHeji(paletteStructure), [paletteStructure]);
  const paletteDeviationDisplay = useMemo(() => {
    if (paletteStructure.useTemperedAccidentals) return paletteDeviation;
    return derivePaletteAutoDeviation(paletteStructure, effectiveAnchorLabel, effectiveAnchorRatio);
  }, [effectiveAnchorLabel, effectiveAnchorRatio, paletteDeviation, paletteStructure]);
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
      }
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
          <option value="cents">Scale Cents</option>
          <option value="note_names">Name</option>
          <option value="heji">HEJI (auto-generated)</option>
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
            <p style={{ color: "#8b3a2e", margin: "0 0 0.75em 0", fontStyle: "italic" }}>
              {props.heji_warning || "Non-octave equave cannot generate consistent note names."}
            </p>
          )}
          <div class="heji-anchor-fieldset-actions">
            <button
              type="button"
              class="preset-action-btn"

              disabled={hejiDisabled || !props.heji_names?.length}
              onClick={copyHejiToNoteNames}
            >
              Copy HEJI to Note Names
            </button></div>
          <label>
            Ratio/Cents from 1/1 (scale degree 0)
            <input
              type="text"
              class="sidebar-input"
              placeholder={props.heji_anchor_ratio_eff || "e.g. 1/1  |  0.0¢  |  0\\12"}
              value={props.settings.heji_anchor_ratio || ""}
              disabled={hejiDisabled}
              onInput={(e) => props.onChange("heji_anchor_ratio", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
              }}
              onBlur={(e) => {
                const normalized = normaliseHejiAnchorRatio(e.target.value);
                if (normalized) props.onChange("heji_anchor_ratio", normalized);
              }}
            />
          </label>
          <label>
            Notation (Spelling)
            <input
              type="text"
              class="sidebar-input"
              placeholder={props.heji_anchor_label_eff || `\uE261A`}
              value={props.settings.heji_anchor_label || ""}
              disabled={hejiDisabled}
              onInput={(e) => props.onChange("heji_anchor_label", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
              }}
              onBlur={(e) => {
                const normalized = canonicalHejiAnchorLabelInput(e.target.value);
                if (normalized) props.onChange("heji_anchor_label", normalized);
              }}
            />
          </label>
          <label style={{ justifyContent: "flex-start", gap: "0.5em", marginTop: "0.5em" }}>
            <input
              type="checkbox"
              checked={props.settings.heji_tempered_only === true}
              disabled={hejiDisabled}
              onChange={(e) => props.onChange("heji_tempered_only", e.target.checked)}
            />
            Tempered Accidentals Only
          </label>
          <label style={{ justifyContent: "flex-start", gap: "0.5em", marginTop: "0.5em" }}>
            <input
              type="checkbox"
              checked={props.settings.heji_show_cents !== false}
              disabled={hejiDisabled}
              onChange={(e) => props.onChange("heji_show_cents", e.target.checked)}
            />
            Always Include Cents on Keys
          </label>
          <label style={{ justifyContent: "flex-start", gap: "0.5em", marginTop: "0.5em" }}>
            <input
              type="checkbox"
              checked={showPalette}
              disabled={hejiDisabled}
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
              <label class="heji-palette-builder__output-row">
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
              </label>

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
                        setPaletteStructure((current) => withPitchStructureTemperedAccidentalCount(current, -1));
                        setCopied(false);
                      }}
                    >
                      {TEMPERED_12EDO_GLYPHS.flat}
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) => withPitchStructureTemperedAccidentalCount(current, 0));
                        setCopied(false);
                      }}
                    >
                      {TEMPERED_12EDO_GLYPHS.natural}
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) => withPitchStructureTemperedAccidentalCount(current, 1));
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
                        setPaletteStructure((current) => withPitchStructureAccidentalDelta(current, -1));
                        setCopied(false);
                      }}
                    >
                      {HEJI_3_LIMIT_GLYPHS.flat}
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) => withPitchStructureAccidentalCount(current, 0));
                        setCopied(false);
                      }}
                    >
                      {HEJI_3_LIMIT_GLYPHS.natural}
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) => withPitchStructureAccidentalDelta(current, 1));
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
                        setPaletteStructure((current) => withPitchStructureSyntonicDelta(current, -1));
                        setCopied(false);
                      }}
                    >
                      down
                    </button>
                    <button
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      onClick={() => {
                        setPaletteStructure((current) => withPitchStructureSyntonicDelta(current, 1));
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
                            setPaletteStructure((current) => withPitchStructurePrimeDelta(current, family.prime, -1));
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
                            setPaletteStructure((current) => withPitchStructurePrimeDelta(current, family.prime, 1));
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
    heji_tempered_only: PropTypes.bool,
    heji_show_cents: PropTypes.bool,
  }),
};

export default KeyLabels;
