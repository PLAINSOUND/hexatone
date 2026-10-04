/** FluidSynth browser backend controls: local SoundFont, enumerated preset and level. */

import { useEffect, useRef, useState } from "preact/hooks";
import PropTypes from "prop-types";
import CustomRangeSlider from "./shared/range-slider.jsx";
import {
  loadFluidSynthSoundFont,
  peekFluidSynthEngine,
  subscribeFluidSynthEngine,
} from "../fluidsynth_synth/index.js";

const VOLUME_KEY = "fluidsynth_internal_volume";
const LAST_BANK_KEY = "fluidsynth_last_hosted_soundfont";
const HOSTED_SOUNDFONTS = [
  "PlainsoundOrgan.sf2",
  "PlainsoundOrganGedackt.sf2",
  "PlainsoundOrganSpielFl.sf2",
  "PlainsoundOrganPrincipal.sf2",
  "PlainsoundHarpsichord.sf2",
  "PlainsoundHarpsichordLute.sf2",
  "PlainsoundSrutibox.sf2",
];
const readVolume = () => {
  const stored = localStorage.getItem(VOLUME_KEY);
  const value = stored == null ? 100 : Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(127, value)) : 100;
};

async function readResponseWithProgress(response, onProgress) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.arrayBuffer();

  const contentLength = Number(response.headers.get("content-length"));
  const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
  const target = total ? new Uint8Array(total) : null;
  const chunks = target ? null : [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (target) target.set(value, loaded);
    else chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total });
  }

  if (target) {
    if (loaded !== target.byteLength) {
      throw new Error(
        `SoundFont download was incomplete (${loaded} of ${target.byteLength} bytes)`,
      );
    }
    return target.buffer;
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

const FluidSynthSettings = ({ settings, onChange }) => {
  const [presets, setPresets] = useState(() => peekFluidSynthEngine()?.presets ?? []);
  const [soundfontName, setSoundfontName] = useState("");
  const [hostedSoundfont, setHostedSoundfont] = useState(() => {
    const sourceName = peekFluidSynthEngine()?.soundfontSource?.name;
    const remembered = localStorage.getItem(LAST_BANK_KEY);
    return HOSTED_SOUNDFONTS.includes(sourceName) ? sourceName
      : HOSTED_SOUNDFONTS.includes(remembered) ? remembered : "";
  });
  const [volume, setVolume] = useState(readVolume);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(null);
  const localFileInputRef = useRef(null);
  const downloadControllerRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const activeEngine = peekFluidSynthEngine();
  useEffect(() => {
    const syncEngineState = (nextEngine = peekFluidSynthEngine()) => {
      setPresets(nextEngine?.presets ?? []);
      if (nextEngine?.soundfontSource?.name) {
        setSoundfontName(nextEngine.soundfontSource.name);
        setHostedSoundfont(
          HOSTED_SOUNDFONTS.includes(nextEngine.soundfontSource.name)
            ? nextEngine.soundfontSource.name
            : "",
        );
      } else if (nextEngine?.soundfontId == null) {
        setSoundfontName("");
      }
    };
    syncEngineState();
    return subscribeFluidSynthEngine(syncEngineState);
  }, []);
  const loaded = activeEngine?.soundfontId != null && presets.length > 0;
  const selectedPreset = settings.fluidsynth_preset || "0:0";

  const changeVolume = (nextValue) => {
    const next = Math.max(0, Math.min(127, Math.round(Number(nextValue) || 0)));
    setVolume(next);
    localStorage.setItem(VOLUME_KEY, String(next));
    sessionStorage.setItem(VOLUME_KEY, String(next));
    peekFluidSynthEngine()?.setVolume(next);
  };

  const loadSoundFont = async (source, signal) => {
    if (!source) return;
    const generation = ++loadGenerationRef.current;
    const current = () => generation === loadGenerationRef.current;
    setBusy(true);
    setStatus(`${loaded ? "Replacing" : "Loading"} ${source.name}…`);
    setLoadingProgress({
      name: source.name,
      url: source.url ?? "",
      percent: 0,
      phase: "Downloading",
    });
    try {
      const result = await loadFluidSynthSoundFont(source, {
        signal,
        onDownloadProgress: ({ loaded: bytesLoaded, total }) => {
          if (!current()) return;
          setLoadingProgress((current) => ({
            ...current,
            percent: total ? Math.min(100, Math.floor((bytesLoaded / total) * 100)) : null,
          }));
        },
        onDownloadComplete: () => {
          if (current()) setLoadingProgress((progress) => ({ ...progress, percent: 100, phase: "Installing" }));
        },
      });
      if (!current()) return;
      const nextPresets = result.presets || [];
      setPresets(nextPresets);
      setSoundfontName(source.name);
      if (source.url && HOSTED_SOUNDFONTS.includes(source.name)) {
        localStorage.setItem(LAST_BANK_KEY, source.name);
      }
      if (nextPresets.length) {
        const first = nextPresets[0];
        const value = `${first.bank}:${first.program}`;
        onChange("fluidsynth_preset", value);
        onChange(
          "fluidsynth_runtime_revision",
          (Number(settings.fluidsynth_runtime_revision) || 0) + 1,
        );
        setStatus("");
      }
      peekFluidSynthEngine()?.setVolume(volume);
    } catch (error) {
      if (!current() || error.name === "AbortError") return;
      setStatus(`SoundFont load failed: ${error.message}`);
      setPresets([]);
      setSoundfontName("");
      onChange("output_fluidsynth", false);
      onChange(
        "fluidsynth_runtime_revision",
        (Number(settings.fluidsynth_runtime_revision) || 0) + 1,
      );
    } finally {
      if (current()) {
        setBusy(false);
        setLoadingProgress(null);
        downloadControllerRef.current = null;
      }
    }
  };

  const loadLocalSoundFont = (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    void loadSoundFont(file).finally(() => {
      input.value = "";
    });
  };

  const loadHostedSoundFont = async () => {
    if (!hostedSoundfont) return;
    const name = hostedSoundfont;
    const url = new URL(encodeURIComponent(name), "https://soundfonts.plainsound.org/").href;
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    void loadSoundFont({
      name,
      url,
      async arrayBuffer(onProgress) {
        // The soundfonts subdomain's document root already maps to the
        // webspace /soundfonts directory, so the URL path starts at /.
        const response = await fetch(url, { mode: "cors", signal: controller.signal });
        if (!response.ok) throw new Error(`SoundFont download failed (${response.status})`);
        return readResponseWithProgress(response, onProgress);
      },
    }, controller.signal);
  };

  const selectPreset = (event) => {
    const [bank, program] = event.currentTarget.value.split(":").map(Number);
    const preset = presets.find((item) => item.bank === bank && item.program === program);
    if (!preset) return;
    peekFluidSynthEngine()?.selectPreset(preset);
    onChange("fluidsynth_preset", event.currentTarget.value);
  };

  return (
    <fieldset>
      <legend>
        <b>Built-in SoundFont Player</b>
      </legend>

      <label>
        Use FluidSynth Sounds
        <input
          type="checkbox"
          aria-label="Use FluidSynth output"
          checked={!!settings.output_fluidsynth}
          onChange={(event) => onChange("output_fluidsynth", event.currentTarget.checked)}
        />
      </label>

      <p class="settings-form__intro-copy">
        <em>
          Hexatone SoundFont banks are fetched from soundfonts.plainsound.org. Alternately, choose a
          local file in .sf2 or .sf3 format. The built-in WebAssembly player supports independent per-note tuning and expression.</em>
      </p>

      <label>
        Hexatone SoundFonts
        <select
          class="sidebar-input"
          aria-label="Hexatone FluidSynth SoundFont"
          value={hostedSoundfont}
          disabled={busy}
          style={!loaded && hostedSoundfont ? { color: "var(--muted-text, #888)" } : undefined}
          onChange={(event) => setHostedSoundfont(event.currentTarget.value)}
        >
          <option value="">Choose an instrument</option>
          {HOSTED_SOUNDFONTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div class="fluidsynth-settings__load-row">
        {soundfontName ? (
          <span class="settings-form__helper-text fluidsynth-settings__loaded-name">
            Loaded: {soundfontName}
          </span>
        ) : null}
        <div class="preset-actions preset-actions--end fluidsynth-settings__load-actions">
          <button
            type="button"
            class="preset-action-btn"
            disabled={busy || !hostedSoundfont}
            onClick={loadHostedSoundFont}
          >
            {busy ? "Loading…" : "Load Hexatone SoundFont"}
          </button>
          <button
            type="button"
            class="preset-action-btn"
            disabled={busy && loadingProgress?.phase !== "Downloading"}
            onClick={() => {
              if (downloadControllerRef.current && loadingProgress?.phase === "Downloading") {
                ++loadGenerationRef.current;
                downloadControllerRef.current.abort();
                downloadControllerRef.current = null;
                setBusy(false);
                setLoadingProgress(null);
                setStatus("Download cancelled.");
              }
              localFileInputRef.current.disabled = false;
              localFileInputRef.current?.click();
            }}
          >
            Choose Local File
          </button>
          <input
            ref={localFileInputRef}
            type="file"
            accept=".sf2,.sf3,audio/x-soundfont,audio/sf2"
            aria-label="FluidSynth SoundFont"
            class="settings-form__hidden-file-input"
            disabled={busy}
            onChange={loadLocalSoundFont}
          />
        </div>
      </div>

      {settings.output_fluidsynth && (
        <>
          <label>
            Preset
            <select
              class="sidebar-input"
              aria-label="FluidSynth preset"
              value={selectedPreset}
              disabled={!loaded}
              onChange={selectPreset}
            >
              {!presets.length ? <option value="0:0">Load a SoundFont first</option> : null}
              {presets.map((preset) => (
                <option
                  key={`${preset.bank}:${preset.program}`}
                  value={`${preset.bank}:${preset.program}`}
                >
                  {preset.name} (bank {preset.bank}, program {preset.program})
                </option>
              ))}
            </select>
          </label>
          <label>
            Volume
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="FluidSynth volume"
                min={0}
                max={127}
                step={1}
                value={volume}
                disabled={!loaded}
                onInputValue={changeVolume}
                onCommitValue={changeVolume}
              />
              <span class="settings-form__range-value">{volume}</span>
            </span>
          </label>
        </>
      )}
      
      {busy && loadingProgress ? (
        <div
          class="settings-form__helper-text fluidsynth-settings__download-status"
          role="status"
          aria-live="polite"
        >
          <p>
            {loadingProgress.phase} {loadingProgress.name}
            {loadingProgress.url ? (
              <>
                {" — "}
                <a href={loadingProgress.url} target="_blank" rel="noreferrer">
                  {loadingProgress.url}
                </a>
              </>
            ) : null}
          </p>
          {loadingProgress.percent == null ? (
            <p>Download progress unavailable</p>
          ) : (
            <p>
              <progress
                aria-label={`Loading ${loadingProgress.name}`}
                max="100"
                value={loadingProgress.percent}
              />{" "}
              {loadingProgress.percent}%
            </p>
          )}
        </div>
      ) : status ? (
        <p class="settings-form__helper-text" role="status">
          {status}
        </p>
      ) : null}
    </fieldset>
  );
};

FluidSynthSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default FluidSynthSettings;
