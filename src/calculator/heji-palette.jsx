import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import PropTypes from "prop-types";
import { BASE_BY_ID, BASE_SYMBOLS, HEJI_FAMILIES } from "../notation/heji.js";
import {
  createPitchStructure,
  parseHejiToStructure,
  pitchStructureToBaseId,
  pitchStructureToHeji,
  temperedPitchStructureFallback,
  withPitchStructureAccidentalCount,
  withPitchStructureAccidentalDelta,
  withPitchStructureFlag,
  withPitchStructureLetter,
  withPitchStructurePrimeDelta,
  withPitchStructureSyntonicDelta,
} from "../notation/pitch-structure.js";
import { buildPitchFrame, resolveStructurePitch } from "../notation/pitch-frame.js";
import {
  calculatorIntervalFromPitchStructure,
  DEFAULT_CALCULATOR_OCTAVE,
} from "./runtime.js";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const BASE_BY_SYMBOL_ID = Object.fromEntries(BASE_SYMBOLS.map((symbol) => [symbol.id, symbol]));
const baseId = (chromatic, syntonic) => `${chromatic}:${syntonic}`;
const THREE_LIMIT = {
  flat: BASE_BY_SYMBOL_ID[baseId("flat", 0)]?.glyph ?? "b",
  natural: BASE_BY_SYMBOL_ID[baseId("natural", 0)]?.glyph ?? "n",
  sharp: BASE_BY_SYMBOL_ID[baseId("sharp", 0)]?.glyph ?? "#",
};
const TEMPERED = { flat: "", natural: "", sharp: "" };
const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHROMATIC_SEMITONES = { doubleflat: -2, flat: -1, natural: 0, sharp: 1, doublesharp: 2 };

function parseStructure(value, fallbackSpelling) {
  try {
    if (value) return createPitchStructure(JSON.parse(value));
  } catch {
    // Fall through to the supplied anchor spelling.
  }
  const parsed = parseHejiToStructure(fallbackSpelling);
  return createPitchStructure({
    ...(parsed ?? {}),
    useDoubles: true,
    useDoubleSeptimals: true,
  });
}

function semitone(letter, chromatic) {
  return (
    ((((LETTER_SEMITONES[letter] ?? 9) + (CHROMATIC_SEMITONES[chromatic] ?? 0)) % 12) + 12) % 12
  );
}

function deriveDeviation(structure, anchorLabel, anchorRatio) {
  if (!structure?.letter) return null;
  const anchor = parseHejiToStructure(anchorLabel);
  if (!anchor?.letter) return null;
  try {
    const frame = buildPitchFrame(
      {
        heji_anchor_label: anchorLabel,
        heji_anchor_ratio: anchorRatio,
        reference_degree: 0,
        fundamental: 440,
      },
      null,
    );
    const cents = resolveStructurePitch(frame, structure)?.notationRelativeInterval?.cents;
    if (!Number.isFinite(cents)) return null;
    const targetChromatic = BASE_BY_ID[pitchStructureToBaseId(structure)]?.chromatic ?? "natural";
    const anchorChromatic = BASE_BY_ID[pitchStructureToBaseId(anchor)]?.chromatic ?? "natural";
    const expected =
      ((((semitone(structure.letter, targetChromatic) - semitone(anchor.letter, anchorChromatic)) *
        100) %
        1200) +
        1200) %
      1200;
    const pitchClass = ((cents % 1200) + 1200) % 1200;
    return ((((pitchClass - expected + 600) % 1200) + 1200) % 1200) - 600;
  } catch {
    return null;
  }
}

function formatDeviation(value, decimals) {
  if (!Number.isFinite(value)) return "";
  const places = Math.max(0, Math.min(6, Number(decimals) || 0));
  const rounded = Number(value.toFixed(places));
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded).toFixed(places)}`;
}

function normalizeDeviation(value, current = "") {
  const source = String(value ?? "").replace(/\s+/g, "");
  if (!source) return "";
  const rest = source.replace(/^[+\u2212-]+/, "");
  if (rest && Number(rest) === 0) return `+${rest}`;
  const negative = source.startsWith("−") || source.startsWith("-");
  const positive = source.startsWith("+");
  const sign = negative ? "−" : positive ? "+" : String(current).startsWith("−") ? "−" : "+";
  return `${sign}${rest}`;
}

function applyDeviationSign(sign, value) {
  const unsigned = String(value ?? "").replace(/^[+\u2212-]+/, "");
  if (unsigned && Number(unsigned) === 0) return `+${unsigned}`;
  return `${sign}${unsigned}`;
}

function toTempered(structure, accidentalCount) {
  return createPitchStructure({
    ...structure,
    accidentalCount,
    syntonic: 0,
    primeExponents: {},
    useTemperedAccidentals: true,
  });
}

function toJiBase(structure) {
  return createPitchStructure({
    ...structure,
    syntonic: 0,
    primeExponents: {},
    useTemperedAccidentals: false,
  });
}

async function copyText(value) {
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const result = document.execCommand?.("copy") === true;
    document.body.removeChild(helper);
    return result;
  } catch {
    return false;
  }
}

const HejiPalette = ({
  anchorLabel,
  anchorRatio,
  initialStructure,
  initialSpelling,
  initialDeviation,
  initialDecimals,
  initialOctave = DEFAULT_CALCULATOR_OCTAVE,
  initialWorkspaceState,
  synchronizedPitch,
  onDecimalsChange,
  onSpellingChange,
  onWorkspaceStateChange,
}) => {
  const [structure, setStructure] = useState(() =>
    parseStructure(initialWorkspaceState?.structure ?? initialStructure, initialSpelling),
  );
  const [deviation, setDeviation] = useState(() =>
    String(initialWorkspaceState?.deviation ?? initialDeviation ?? ""),
  );
  const [decimals, setDecimals] = useState(() =>
    Math.max(0, Math.min(6, Number(initialWorkspaceState?.decimals ?? initialDecimals) || 0)),
  );
  const [octave, setOctave] = useState(() =>
    Math.trunc(Number(initialWorkspaceState?.octave ?? initialOctave ?? DEFAULT_CALCULATOR_OCTAVE)),
  );
  const [copied, setCopied] = useState(false);
  const pendingSynchronizedState = useRef(null);
  const spelling = useMemo(() => pitchStructureToHeji(structure), [structure]);
  const automaticDeviation = useMemo(
    () =>
      structure.useTemperedAccidentals
        ? null
        : deriveDeviation(structure, anchorLabel, anchorRatio),
    [anchorLabel, anchorRatio, structure],
  );
  const resolvedPalettePitch = useMemo(
    () =>
      structure.useTemperedAccidentals
        ? null
        : calculatorIntervalFromPitchStructure({
            structure,
            anchorLabel,
            anchorInterval: anchorRatio,
            octave,
          }),
    [anchorLabel, anchorRatio, octave, structure],
  );
  const overflowPitch =
    resolvedPalettePitch?.valid && resolvedPalettePitch.relativeExact === false
      ? temperedPitchStructureFallback(
          structure,
          parseHejiToStructure(anchorLabel),
          Number(resolvedPalettePitch.relativeInterval),
          { octave, decimals },
        )
      : null;
  const shownDeviation = structure.useTemperedAccidentals
    ? deviation
    : formatDeviation(automaticDeviation, decimals);
  const displayedSpelling = spelling;
  const displayedDeviation = overflowPitch?.deviationText || shownDeviation;
  const output = `${displayedSpelling}${displayedDeviation}`.trim();
  useEffect(() => {
    if (!synchronizedPitch?.spelling) return;
    const nextStructure = parseStructure("", synchronizedPitch.spelling);
    const nextDeviation = String(synchronizedPitch.deviation ?? "");
    const nextOctave = Math.trunc(Number(synchronizedPitch.octave ?? DEFAULT_CALCULATOR_OCTAVE));
    pendingSynchronizedState.current = JSON.stringify({
      spelling: pitchStructureToHeji(nextStructure),
      deviation: nextDeviation,
      octave: nextOctave,
    });
    setStructure(nextStructure);
    setDeviation(nextDeviation);
    setOctave(nextOctave);
    setCopied(false);
  }, [synchronizedPitch]);
  useEffect(() => {
    if (!structure.letter) return;
    if (pendingSynchronizedState.current) {
      const currentState = JSON.stringify({ spelling, deviation, octave });
      if (currentState === pendingSynchronizedState.current) {
        pendingSynchronizedState.current = null;
      }
      return;
    }
    const numericDeviation = Number(
      String(shownDeviation || "0")
        .replace("−", "-")
        .replace("+", ""),
    );
    onSpellingChange?.({
      spelling,
      structure,
      deviationCents: Number.isFinite(numericDeviation) ? numericDeviation : 0,
      octave,
    });
  }, [deviation, octave, onSpellingChange, shownDeviation, spelling, structure]);
  useEffect(() => {
    onWorkspaceStateChange?.({
      structure: JSON.stringify(structure),
      deviation,
      decimals,
      octave,
    });
  }, [decimals, deviation, octave, onWorkspaceStateChange, structure]);

  const update = (transform, { clearDeviation = false } = {}) => {
    setStructure((current) => createPitchStructure(transform(current)));
    if (clearDeviation) setDeviation("");
    setCopied(false);
  };
  const resetToAnchor = () => {
    const anchorStructure = parseStructure("", anchorLabel);
    setStructure((current) =>
      createPitchStructure({
        ...anchorStructure,
        useDoubles: current.useDoubles,
        useDoubleSeptimals: current.useDoubleSeptimals,
        cautionaryNatural: current.cautionaryNatural,
      }),
    );
    setDeviation("");
    setOctave(DEFAULT_CALCULATOR_OCTAVE);
    setCopied(false);
  };
  return (
    <div class="heji-palette-builder calculator-palette">
      <label class="heji-palette-builder__toggle-row">
        <input
          type="checkbox"
          aria-label="Calculator Double Flat/Sharp"
          checked={structure.useDoubles}
          onChange={(event) =>
            update((current) => withPitchStructureFlag(current, "useDoubles", event.target.checked))
          }
        />
        Double Flat/Sharp
      </label>
      <label class="heji-palette-builder__toggle-row">
        <input
          type="checkbox"
          aria-label="Calculator Double Septimals"
          checked={structure.useDoubleSeptimals}
          onChange={(event) =>
            update((current) =>
              withPitchStructureFlag(current, "useDoubleSeptimals", event.target.checked),
            )
          }
        />
        Double Septimals
      </label>
      <label class="heji-palette-builder__toggle-row">
        <input
          type="checkbox"
          aria-label="Calculator Cautionary Natural"
          checked={structure.cautionaryNatural}
          onChange={(event) =>
            update((current) =>
              withPitchStructureFlag(current, "cautionaryNatural", event.target.checked),
            )
          }
        />
        Cautionary Natural
      </label>
      <label class="heji-palette-builder__select-row">
        Decimal Places
        <select
          class="sidebar-input heji-palette-builder__decimals-select"
          aria-label="Calculator decimal places"
          value={String(decimals)}
          onChange={(event) => {
            const next = Math.max(0, Math.min(6, Number(event.target.value) || 0));
            setDecimals(next);
            onDecimalsChange?.(next);
          }}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((value) => (
            <option key={value} value={String(value)}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <div class="heji-palette-builder__output-row">
        <div class="heji-palette-builder__output-controls">
          <span>Output</span>
          <div class="heji-palette-builder__output-actions">
            <button
              type="button"
              class="preset-action-btn"
              disabled={!output}
              onClick={async () => setCopied(await copyText(output))}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              class="preset-action-btn"
              disabled={!output}
              onClick={resetToAnchor}
            >
              Clear
            </button>
          </div>
        </div>
        <div class="heji-palette-builder__output-fields">
          <input
            type="text"
            class="sidebar-input heji-palette-builder__output"
            value={displayedSpelling}
            readOnly
            aria-label="Calculator palette output"
          />
          <input
            type="text"
            class="sidebar-input heji-palette-builder__deviation"
            value={displayedDeviation}
            placeholder="+0"
            readOnly={!structure.useTemperedAccidentals}
            aria-label="Calculator palette cents deviation"
            onInput={(event) => {
              if (structure.useTemperedAccidentals) {
                const normalized = normalizeDeviation(event.currentTarget.value, deviation);
                event.currentTarget.value = normalized;
                setDeviation(normalized);
              }
            }}
          />
        </div>
      </div>

      <div class="heji-palette-builder__pitch-grid">
        <div class="heji-palette-builder__group-row heji-palette-builder__group-row--note">
          <div class="heji-palette-builder__group-label">Note</div>
          <div
            class="heji-palette-builder__symbols"
            role="group"
            aria-label="Calculator HEJI letters"
          >
            {LETTERS.map((letter) => (
              <button
                key={letter}
                type="button"
                class="preset-action-btn heji-palette-builder__symbol-btn"
                onClick={() => update((current) => withPitchStructureLetter(current, letter))}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
        <div class="heji-palette-builder__group-row heji-palette-builder__group-row--octave">
          <div class="heji-palette-builder__group-label">Octave</div>
          <div
            class="heji-palette-builder__symbols"
            role="group"
            aria-label="Calculator palette octave"
          >
            <button
              type="button"
              class="preset-action-btn heji-palette-builder__symbol-btn"
              aria-label="Lower calculator palette octave"
              onClick={() => setOctave((current) => current - 1)}
            >
              −
            </button>
            <output
              class="heji-palette-builder__octave-value"
              aria-label="Calculator palette octave value"
            >
              {octave}
            </output>
            <button
              type="button"
              class="preset-action-btn heji-palette-builder__symbol-btn"
              aria-label="Raise calculator palette octave"
              onClick={() => setOctave((current) => current + 1)}
            >
              +
            </button>
          </div>
        </div>

        <div class="heji-palette-builder__group-row heji-palette-builder__group-row--chunks">
          <span class="heji-palette-builder__group-chunk">
            <div class="heji-palette-builder__group-label">12edo</div>
            <div
              class="heji-palette-builder__symbols"
              role="group"
              aria-label="Calculator 12edo accidentals"
            >
              {[
                ["flat", -1],
                ["natural", 0],
                ["sharp", 1],
              ].map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  class="preset-action-btn heji-palette-builder__symbol-btn"
                  onClick={() => {
                    setDeviation("+0");
                    update((current) => toTempered(current, count));
                  }}
                >
                  {TEMPERED[name]}
                </button>
              ))}
            </div>
          </span>
          <span class="heji-palette-builder__group-chunk heji-palette-builder__group-chunk--after-symbols">
            <div class="heji-palette-builder__group-label">cents</div>
            <div
              class="heji-palette-builder__symbols"
              role="group"
              aria-label="Calculator cents sign"
            >
              {["+", "−"].map((sign) => (
                <button
                  key={sign}
                  type="button"
                  class="preset-action-btn heji-palette-builder__symbol-btn"
                  onClick={() => setDeviation(applyDeviationSign(sign, deviation))}
                >
                  {sign}
                </button>
              ))}
            </div>
          </span>
        </div>

        <div class="heji-palette-builder__group-row heji-palette-builder__group-row--chunks">
          <span class="heji-palette-builder__group-chunk">
            <div class="heji-palette-builder__group-label">3-Lim</div>
            <div class="heji-palette-builder__symbols" role="group" aria-label="Calculator 3-Limit">
              {[
                ["flat", -1],
                ["natural", 0],
                ["sharp", 1],
              ].map(([name, amount]) => (
                <button
                  key={name}
                  type="button"
                  class="preset-action-btn heji-palette-builder__symbol-btn"
                  onClick={() =>
                    update(
                      (current) => {
                        const ji = current.useTemperedAccidentals ? toJiBase(current) : current;
                        return name === "natural"
                          ? withPitchStructureAccidentalCount(ji, 0)
                          : withPitchStructureAccidentalDelta(ji, amount);
                      },
                      { clearDeviation: true },
                    )
                  }
                >
                  {THREE_LIMIT[name]}
                </button>
              ))}
            </div>
          </span>
          <span class="heji-palette-builder__group-chunk">
            <div class="heji-palette-builder__group-label">5-Lim</div>
            <div class="heji-palette-builder__symbols" role="group" aria-label="Calculator 5-Limit">
              {[
                ["down", -1],
                ["up", 1],
              ].map(([label, amount]) => (
                <button
                  key={label}
                  type="button"
                  class={`preset-action-btn heji-palette-builder__symbol-btn${
                    label === "down" ? " heji-palette-builder__symbol-btn--down" : ""
                  }`}
                  onClick={() =>
                    update(
                      (current) =>
                        withPitchStructureSyntonicDelta(
                          current.useTemperedAccidentals ? toJiBase(current) : current,
                          amount,
                        ),
                      { clearDeviation: true },
                    )
                  }
                >
                  <span class="heji-palette-builder__word-label">{label}</span>
                </button>
              ))}
            </div>
          </span>
        </div>

        <div class="heji-palette-builder__prime-grid">
          {HEJI_FAMILIES.map((family) => (
            <span class="heji-palette-builder__group-chunk" key={family.prime}>
              <div class="heji-palette-builder__group-label">{family.prime}-Lim</div>
              <div
                class="heji-palette-builder__symbols"
                role="group"
                aria-label={`Calculator ${family.prime}-Limit`}
              >
                <span class="heji-palette-builder__pair">
                  {[family.lower, family.upper].map((symbol) => (
                    <button
                      key={symbol.id}
                      type="button"
                      class="preset-action-btn heji-palette-builder__symbol-btn"
                      title={`${family.prime}-limit ${symbol.amount < 0 ? "lower" : "upper"}`}
                      onClick={() =>
                        update(
                          (current) =>
                            withPitchStructurePrimeDelta(
                              current.useTemperedAccidentals ? toJiBase(current) : current,
                              family.prime,
                              symbol.amount,
                            ),
                          { clearDeviation: true },
                        )
                      }
                    >
                      {symbol.glyph}
                    </button>
                  ))}
                </span>
              </div>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

HejiPalette.propTypes = {
  anchorLabel: PropTypes.string.isRequired,
  anchorRatio: PropTypes.string.isRequired,
  initialStructure: PropTypes.string,
  initialSpelling: PropTypes.string,
  initialDeviation: PropTypes.string,
  initialDecimals: PropTypes.number,
  initialOctave: PropTypes.number,
  initialWorkspaceState: PropTypes.object,
  synchronizedPitch: PropTypes.shape({
    spelling: PropTypes.string.isRequired,
    deviation: PropTypes.string,
    octave: PropTypes.number.isRequired,
  }),
  onDecimalsChange: PropTypes.func,
  onSpellingChange: PropTypes.func,
  onWorkspaceStateChange: PropTypes.func,
};

export default HejiPalette;
