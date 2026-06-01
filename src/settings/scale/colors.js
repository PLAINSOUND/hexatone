import { createRef } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import PropTypes from "prop-types";
import { deriveSpectrumNoteColors, normalizeColors } from "../../normalize-settings.js";
import { deriveAutoNoteColors, normaliseColorForCompare } from "./auto-colors.js";
import ColorCell from "./scale-table/color-cell.js";
import {
  DEFAULT_PRIME_FAMILY_COLORS,
  normalizePrimeFamilyColors,
  PRIME_COLOR_ORDER,
} from "./monzo-color.js";

const PRIME_FAMILY_PALETTES_STORAGE_KEY = "hexatone_prime_family_palettes";

export const colorProp = function (props, propName, componentName) {
  const value = props[propName];
  if (value !== undefined && !/^#?[a-zA-Z0-9]{6}$/.test(props[propName])) {
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

const getColorMode = (settings) => {
  if (settings?.auto_colors) return "auto";
  if (settings?.spectrum_colors) return "spectrum";
  return "manual";
};

const loadPrimeFamilyPalettes = () => {
  try {
    const raw = localStorage.getItem(PRIME_FAMILY_PALETTES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.name === "string")
      .map((entry) => ({
        name: entry.name,
        colors: normalizePrimeFamilyColors(entry.colors ?? entry.prime_family_colors),
      }));
  } catch {
    return [];
  }
};

const savePrimeFamilyPalettes = (palettes) => {
  localStorage.setItem(PRIME_FAMILY_PALETTES_STORAGE_KEY, JSON.stringify(palettes));
};

const defaultPrimePalette = () =>
  PRIME_COLOR_ORDER.map((prime) => DEFAULT_PRIME_FAMILY_COLORS[prime]);

const safePaletteName = (name) => (name || "palette").replace(/[^a-zA-Z0-9_\-]/g, "_");

const downloadPaletteFile = (palette) => {
  const blob = new Blob([JSON.stringify(palette, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safePaletteName(palette.name)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const Colors = (props) => {
  const rawSettings = props.rawSettings ?? props.settings;
  const pickerRef = createRef();
  const textRef = createRef();
  const swatchRef = createRef();
  const pendingPrimePreviewRef = useRef(null);
  const primePreviewFrameRef = useRef(0);
  const primePreviewGenerationRef = useRef(0);
  const paletteFileInputRef = createRef();
  const colorMode = getColorMode(rawSettings);
  const autoActive = colorMode === "auto";
  const autoActiveRef = useRef(autoActive);
  const spectrumActive = colorMode === "spectrum";
  const primeFamilyColors = normalizePrimeFamilyColors(rawSettings.prime_family_colors);
  const derivedAutoColors = deriveAutoNoteColors(rawSettings);
  const [savedPrimePalettes, setSavedPrimePalettes] = useState(loadPrimeFamilyPalettes);
  const [selectedPrimePalette, setSelectedPrimePalette] = useState("default");

  const safe = normaliseHex(rawSettings.fundamental_color || "#ffdbe8") || "#ffdbe8";
  const selectedPaletteEntry = useMemo(
    () => savedPrimePalettes.find((palette) => palette.name === selectedPrimePalette) ?? null,
    [savedPrimePalettes, selectedPrimePalette],
  );

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

  const handleCommitSpectrumColors = () => {
    const colors = deriveSpectrumNoteColors(rawSettings, safe.replace(/^#/, ""));
    const committedColors = colors.map((color) => `#${color}`);
    if (props.onAtomicChange) {
      props.onAtomicChange({
        note_colors: committedColors,
        spectrum_colors: false,
      });
      return;
    }
    props.onChange("note_colors", committedColors);
    props.onChange("spectrum_colors", false);
  };

  const setColorMode = (nextMode) => {
    const updates = {
      auto_colors: nextMode === "auto",
      spectrum_colors: nextMode === "spectrum",
    };
    if (nextMode === "spectrum" && !rawSettings.auto_colors) {
      props.onChange("spectrum_colors", true);
      return;
    }
    if (nextMode === "auto" && !rawSettings.spectrum_colors) {
      props.onChange("auto_colors", true);
      return;
    }
    if (nextMode === "manual" && rawSettings.spectrum_colors && !rawSettings.auto_colors) {
      props.onChange("spectrum_colors", false);
      return;
    }
    if (nextMode === "manual" && rawSettings.auto_colors && !rawSettings.spectrum_colors) {
      props.onChange("auto_colors", false);
      return;
    }
    if (props.onAtomicChange) {
      props.onAtomicChange(updates);
      return;
    }
    props.onChange("auto_colors", updates.auto_colors);
    props.onChange("spectrum_colors", updates.spectrum_colors);
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

  useEffect(() => {
    autoActiveRef.current = autoActive;
  }, [autoActive]);

  const cancelPrimePreview = () => {
    if (primePreviewFrameRef.current) {
      cancelAnimationFrame(primePreviewFrameRef.current);
      primePreviewFrameRef.current = 0;
    }
    pendingPrimePreviewRef.current = null;
    primePreviewGenerationRef.current += 1;
  };

  useEffect(() => {
    if (!autoActive) cancelPrimePreview();
  }, [autoActive]);

  const handlePrimeFamilyPreview = (index) => (hex) => {
    const next = [...primeFamilyColors];
    next[index] = hex;
    pendingPrimePreviewRef.current = next;
    if (primePreviewFrameRef.current) return;
    const generation = primePreviewGenerationRef.current;
    primePreviewFrameRef.current = requestAnimationFrame(() => {
      primePreviewFrameRef.current = 0;
      if (
        pendingPrimePreviewRef.current &&
        autoActiveRef.current &&
        generation === primePreviewGenerationRef.current
      ) {
        previewPrimeFamilyColors(pendingPrimePreviewRef.current);
        pendingPrimePreviewRef.current = null;
      }
    });
  };

  const handleColorModeChange = (e) => {
    const nextMode = e.target.value;
    if (nextMode !== "auto") cancelPrimePreview();
    setColorMode(nextMode);
  };

  const handleSavePrimePalette = () => {
    const existingName = selectedPaletteEntry?.name ?? "";
    const nextName = window.prompt("Save JI colour palette as:", existingName || "My Palette");
    if (!nextName) return;
    const trimmedName = nextName.trim();
    if (!trimmedName) return;
    const nextEntry = { name: trimmedName, colors: normalizePrimeFamilyColors(primeFamilyColors) };
    const nextPalettes = savedPrimePalettes.some((palette) => palette.name === trimmedName)
      ? savedPrimePalettes.map((palette) => (palette.name === trimmedName ? nextEntry : palette))
      : [...savedPrimePalettes, nextEntry];
    savePrimeFamilyPalettes(nextPalettes);
    setSavedPrimePalettes(nextPalettes);
    setSelectedPrimePalette(trimmedName);
  };

  const handleSelectPrimePalette = (e) => {
    const nextName = e.target.value;
    setSelectedPrimePalette(nextName);
    if (nextName === "default") {
      props.onChange("prime_family_colors", defaultPrimePalette());
      return;
    }
    const nextPalette = savedPrimePalettes.find((palette) => palette.name === nextName);
    if (nextPalette) {
      props.onChange("prime_family_colors", nextPalette.colors);
    }
  };

  const handleOpenPrimePaletteFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const name = typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim()
        : file.name.replace(/\.json$/i, "");
      const colors = normalizePrimeFamilyColors(parsed.colors ?? parsed.prime_family_colors);
      const nextEntry = { name, colors };
      const nextPalettes = savedPrimePalettes.some((palette) => palette.name === name)
        ? savedPrimePalettes.map((palette) => (palette.name === name ? nextEntry : palette))
        : [...savedPrimePalettes, nextEntry];
      savePrimeFamilyPalettes(nextPalettes);
      setSavedPrimePalettes(nextPalettes);
      setSelectedPrimePalette(name);
      props.onChange("prime_family_colors", colors);
    } catch {
      // ignore malformed palette files
    } finally {
      e.target.value = "";
    }
  };

  const handleWritePrimePaletteFile = () => {
    const name = selectedPaletteEntry?.name || "JI-colour-palette";
    downloadPaletteFile({
      name,
      prime_family_colors: normalizePrimeFamilyColors(primeFamilyColors),
    });
  };

  const handleDeletePrimePalette = () => {
    if (!selectedPaletteEntry) return;
    const nextPalettes = savedPrimePalettes.filter((palette) => palette.name !== selectedPaletteEntry.name);
    savePrimeFamilyPalettes(nextPalettes);
    setSavedPrimePalettes(nextPalettes);
    setSelectedPrimePalette("default");
  };

  const handleRevertPrimePalette = () => {
    if (!selectedPaletteEntry) return;
    props.onChange("prime_family_colors", selectedPaletteEntry.colors);
  };

  const handleClearAllPrimePalettes = () => {
    savePrimeFamilyPalettes([]);
    setSavedPrimePalettes([]);
    setSelectedPrimePalette("default");
  };

  const handleResetPrimePalette = () => {
    props.onChange("prime_family_colors", defaultPrimePalette());
    setSelectedPrimePalette("default");
  };

  const handleCommitAutoColors = () => {
    if (props.onAtomicChange) {
      props.onAtomicChange({
        note_colors: derivedAutoColors,
        auto_colors: false,
        spectrum_colors: false,
      });
      return;
    }
    props.onChange("note_colors", derivedAutoColors);
    props.onChange("auto_colors", false);
    props.onChange("spectrum_colors", false);
  };

  const hasCommitableAutoColors = derivedAutoColors.length > 0
    && derivedAutoColors.some((color, index) =>
      normaliseColorForCompare(color) !== normaliseColorForCompare(rawSettings.note_colors?.[index]));

  return (
    <div class="scale-colors-group">
      <label>
        Key Colours
        <select
          class="sidebar-input"
          aria-label="Key Colours"
          value={colorMode}
          onChange={handleColorModeChange}
        >
          <option value="manual">Manual</option>
          <option value="auto">Auto</option>
          <option value="spectrum">Spectrum</option>
        </select>
      </label>

      {autoActive && (
          <fieldset class="auto-prime-colors-fieldset">
            <legend>47-limit JI Colour Palette</legend>
            <div class="scale-colors-fieldset-actions">
              <button
                type="button"
                class="preset-action-btn"
                onClick={handleResetPrimePalette}
              >
                Default Colours
              </button>
              <button
                type="button"
                class="preset-action-btn"
                disabled={!hasCommitableAutoColors}
                onClick={handleCommitAutoColors}
              >
                Commit Auto Colours
              </button>
            </div>
            <div class="auto-prime-colors-grid">
              {PRIME_COLOR_ORDER.map((prime, index) => (
                <label class="auto-prime-colors-grid__item" key={`prime-family-color-${prime}`}>
                  <span class="auto-prime-colors-grid__label">{prime === 1 ? "1°" : `${prime}°`}</span>
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
              <div class="auto-prime-colors-palette-layout">
                <div class="auto-prime-colors-palette-row">
                  <div class="preset-selector-row auto-prime-colors-palette-selector">
                    <select
                      aria-label="JI Colour Palette"
                      value={selectedPrimePalette}
                      onChange={handleSelectPrimePalette}
                    >
                      <option value="default">Default</option>
                      {savedPrimePalettes.map((palette) => (
                        <option key={palette.name} value={palette.name}>
                          {palette.name}
                        </option>
                      ))}
                    </select>
                    {selectedPaletteEntry && (
                      <button
                        type="button"
                        class="preset-refresh-btn"
                        aria-label="Reload saved palette"
                        title="Reload saved palette"
                        onClick={handleRevertPrimePalette}
                      >
                        <span class="preset-refresh-glyph">⟳</span>
                      </button>
                    )}
                  </div>
                  <span class="auto-prime-colors-actions__group">
                    <button type="button" class="preset-action-btn" onClick={handleSavePrimePalette}>
                      Save
                    </button>
                    <button type="button" class="preset-action-btn" onClick={() => paletteFileInputRef.current?.click()}>
                      Open
                    </button>
                    <button type="button" class="preset-action-btn" onClick={handleWritePrimePaletteFile}>
                      Write
                    </button>
                  </span>
                </div>
                {selectedPaletteEntry && (
                  <span class="auto-prime-colors-actions__side">
                    <button
                      type="button"
                      class="delete-btn preset-utility-btn"
                      onClick={handleDeletePrimePalette}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      class="delete-btn preset-utility-btn"
                      onClick={handleClearAllPrimePalettes}
                    >
                      Clear All
                    </button>
                  </span>
                )}
                <input
                  ref={paletteFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={handleOpenPrimePaletteFile}
                />
              </div>
            </div>
          </fieldset>
      )}

      {spectrumActive && (
        <fieldset class="spectrum-colors-fieldset">
          <legend>Spectrum Colours</legend>
          <div class="scale-colors-fieldset-actions">
            <button
              type="button"
              class="preset-action-btn"
              aria-label="Commit Spectrum Colours"
              onClick={handleCommitSpectrumColors}
            >
              Commit Spectrum Colours
            </button>
          </div>
          <label>
            Central Hue
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
