import { createRef } from "preact";
import { useEffect, useRef } from "preact/hooks";
import PropTypes from "prop-types";
import { deriveSpectrumNoteColors, normalizeColors } from "../../normalize-settings.js";
import { deriveAutoNoteColors, normaliseColorForCompare } from "./auto-colors.js";
import ColorCell from "./scale-table/color-cell.js";
import {
  DEFAULT_PRIME_FAMILY_COLORS,
  normalizePrimeFamilyColors,
  PRIME_COLOR_ORDER,
} from "./monzo-color.js";

const PRIME_FAMILY_PALETTE_STORAGE_KEY = "hexatone_prime_family_palette";

export const colorProp = function (props, propName, componentName) {
  const value = props[propName];
  if (value !== undefined && !/#[a-zA-Z0-9]{6}/.test(props[propName])) {
    return new Error(
      "Invalid hex color for prop `" +
      propName +
      "` supplied to" +
      " `" +
      componentName +
      "`. Validation failed.",
    );
  }
};

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

const Colors = (props) => {
  const rawSettings = props.rawSettings ?? props.settings;
  const pickerRef = createRef();
  const textRef = createRef();
  const swatchRef = createRef();
  const pendingPrimePreviewRef = useRef(null);
  const primePreviewFrameRef = useRef(0);
  const autoActive = props.settings.auto_colors === true;
  const primeFamilyColors = normalizePrimeFamilyColors(props.settings.prime_family_colors);
  const derivedAutoColors = deriveAutoNoteColors(props.settings);

  const safe = normaliseHex(props.settings.fundamental_color || "#f2e3e3") || "#f2e3e3";

  const handleSwatchClick = () => {
    if (autoActive) return;
    if (pickerRef.current) pickerRef.current.click();
  };

  const lastFire = useRef(0);

  const handlePickerInput = (e) => {
    const hex = e.target.value;
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
    const now = Date.now();
    if (now - lastFire.current >= 60) {
      lastFire.current = now;
      props.onChange("fundamental_color", hex);
    }
  };

  const handlePickerChange = (e) => {
    const hex = e.target.value;
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
    lastFire.current = 0;
    props.onChange("fundamental_color", hex);
  };

  const handleTextInput = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
      if (pickerRef.current) pickerRef.current.value = hex;
    }
  };

  const handleTextBlur = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      props.onChange("fundamental_color", hex);
    } else {
      e.target.value = safe;
      if (swatchRef.current) swatchRef.current.style.backgroundColor = safe;
      if (pickerRef.current) pickerRef.current.value = safe;
    }
  };

  const handleLoadSpectrumColors = () => {
    const colors = deriveSpectrumNoteColors(props.settings, safe.replace(/^#/, ""));
    props.onChange(
      "note_colors",
      colors.map((color) => `#${color}`),
    );
  };

  const handlePrimeFamilyColorChange = (index) => (e) => {
    const next = [...primeFamilyColors];
    next[index] = e.target.value;
    props.onChange("prime_family_colors", next);
  };

  const previewPrimeFamilyColors = (nextPrimeFamilyColors) => {
    if (!autoActive || !props.keysRef?.current?.updateColors) return;
    const normalized = normalizeColors({
      ...rawSettings,
      ...props.settings,
      prime_family_colors: nextPrimeFamilyColors,
    });
    props.keysRef.current.updateColors({
      note_colors: normalized.note_colors,
      spectrum_colors: normalized.spectrum_colors,
      fundamental_color: normalized.fundamental_color,
    });
  };

  useEffect(() => () => {
    if (primePreviewFrameRef.current) {
      cancelAnimationFrame(primePreviewFrameRef.current);
      primePreviewFrameRef.current = 0;
    }
  }, []);

  const handlePrimeFamilyPreview = (index) => (hex) => {
    const next = [...primeFamilyColors];
    next[index] = hex;
    pendingPrimePreviewRef.current = next;
    if (primePreviewFrameRef.current) return;
    primePreviewFrameRef.current = requestAnimationFrame(() => {
      primePreviewFrameRef.current = 0;
      if (pendingPrimePreviewRef.current) {
        previewPrimeFamilyColors(pendingPrimePreviewRef.current);
        pendingPrimePreviewRef.current = null;
      }
    });
  };

  const handleSavePrimePalette = () => {
    localStorage.setItem(PRIME_FAMILY_PALETTE_STORAGE_KEY, JSON.stringify(primeFamilyColors));
  };

  const handleLoadPrimePalette = () => {
    try {
      const raw = localStorage.getItem(PRIME_FAMILY_PALETTE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      props.onChange("prime_family_colors", normalizePrimeFamilyColors(parsed));
    } catch {
      // ignore malformed saved palette
    }
  };

  const handleResetPrimePalette = () => {
    props.onChange("prime_family_colors", PRIME_COLOR_ORDER.map((prime) => DEFAULT_PRIME_FAMILY_COLORS[prime]));
  };

  const handleCommitAutoColors = () => {
    if (props.onAtomicChange) {
      props.onAtomicChange({
        note_colors: derivedAutoColors,
        auto_colors: false,
      });
      return;
    }
    props.onChange("note_colors", derivedAutoColors);
    props.onChange("auto_colors", false);
  };

  const hasSavedPrimePalette = !!localStorage.getItem(PRIME_FAMILY_PALETTE_STORAGE_KEY);
  const hasCommitableAutoColors = derivedAutoColors.length > 0
    && derivedAutoColors.some((color, index) =>
      normaliseColorForCompare(color) !== normaliseColorForCompare(rawSettings.note_colors?.[index]));

  return (
    <div class="scale-colors-group">
      <div class="auto-colors-toggle-row">
        <span class="auto-colors-toggle-row__label">Use Auto Colours</span>
        <span class="auto-colors-toggle-row__controls">
          <button
            type="button"
            class="preset-action-btn"
            disabled={!hasCommitableAutoColors}
            onClick={handleCommitAutoColors}
          >
            Commit Auto Colours
          </button>
          <label class="auto-colors-toggle-row__checkbox">
            <input
              aria-label="Use Auto Colours"
              name="auto_colors"
              type="checkbox"
              checked={props.settings.auto_colors === true}
              onChange={(e) => props.onChange(e.target.name, e.target.checked)}
            />
          </label>
        </span>
      </div>
      <fieldset class="auto-prime-colors-fieldset">
        <legend>Auto Colour Palette</legend>
        <div class="auto-prime-colors-grid">
          {PRIME_COLOR_ORDER.map((prime, index) => (
            <label class="auto-prime-colors-grid__item" key={`prime-family-color-${prime}`}>
              <span class="auto-prime-colors-grid__label">{prime === 1 ? "1/1" : `${prime}°`}</span>
              <ColorCell
                name={`prime-family-colour-${prime}`}
                value={primeFamilyColors[index]}
                disabled={false}
                onChange={handlePrimeFamilyColorChange(index)}
                suggestedColor={null}
                onPreviewColor={handlePrimeFamilyPreview(index)}
              />
            </label>
          ))}
        </div>
        <div class="auto-prime-colors-actions">
          <span class="auto-prime-colors-actions__group">
            <button type="button" class="preset-action-btn" onClick={handleSavePrimePalette}>
              Save User Palette
            </button>
            <button
              type="button"
              class="preset-action-btn"
              disabled={!hasSavedPrimePalette}
              onClick={handleLoadPrimePalette}
            >
              Load User Palette
            </button>
          </span>
          <button type="button" class="preset-action-btn" onClick={handleResetPrimePalette}>
            Reset Defaults
          </button>
        </div>
      </fieldset>
      <label>
        Use Spectrum Colors
        <input
          name="spectrum_colors"
          type="checkbox"
          checked={props.settings.spectrum_colors}
          disabled={autoActive}
          onChange={(e) => props.onChange(e.target.name, e.target.checked)}
        />
      </label>

      {props.settings.spectrum_colors && (
        <fieldset
          class="spectrum-colors-fieldset"
          disabled={autoActive}
          style={{
            opacity: autoActive ? 0.5 : 1,
          }}
        >
          <label>
            Choose Central Hue
            <div class="color-cell color-cell--label-rhs">
              <span class="color-swatch-hitbox">
                <span
                  ref={swatchRef}
                  class="color-swatch"
                  style={{ backgroundColor: safe }}
                  onClick={handleSwatchClick}
                  title="Click to open colour picker"
                  role="button"
                  aria-label="open colour picker for central hue"
                />
                <input
                  ref={pickerRef}
                  type="color"
                  class="color-picker-hidden"
                  value={safe}
                  disabled={autoActive}
                  onInput={handlePickerInput}
                  onChange={handlePickerChange}
                  tabIndex={-1}
                />
              </span>
              <input
                ref={textRef}
                type="text"
                class="color-input"
                defaultValue={safe}
                key={safe}
                disabled={autoActive}
                maxLength={7}
                placeholder="#rrggbb"
                onInput={handleTextInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                }}
                onBlur={handleTextBlur}
                aria-label="hex colour for central hue"
              />
            </div>
          </label>
          <label>
            Table Colors
            <span class="sidebar-input" style={{ textAlign: "right" }}>
              <button
                type="button"
                class="preset-action-btn"
                aria-label="Load Spectrum Colors"
                disabled={autoActive}
                onClick={handleLoadSpectrumColors}
              >
                Load Spectrum Colors to Scale Table
              </button>
            </span>
          </label>
        </fieldset>
      )}

    </div>
  );
};

Colors.propTypes = {
  onChange: PropTypes.func.isRequired,
  onAtomicChange: PropTypes.func,
  rawSettings: PropTypes.shape({
    note_colors: PropTypes.arrayOf(PropTypes.string),
  }),
  settings: PropTypes.shape({
    spectrum_colors: PropTypes.bool,
    auto_colors: PropTypes.bool,
    fundamental_color: colorProp,
    prime_family_colors: PropTypes.arrayOf(PropTypes.string),
    note_colors: PropTypes.arrayOf(PropTypes.string),
    equivSteps: PropTypes.number,
    scale: PropTypes.array,
  }),
};

export default Colors;
