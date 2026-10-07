/** FluidSynth browser backend controls: local SoundFont, enumerated preset and level. */

import { useEffect, useRef, useState } from "preact/hooks";
import PropTypes from "prop-types";
import CustomRangeSlider from "./shared/range-slider.jsx";
import { soundfontStorageKey, readOfflineSoundfont, readWorkingSoundfont, keepWorkingSoundfont, storeOfflineSoundfont,
  removeOfflineSoundfont, saveSoundfontFile } from "../fluidsynth_synth/soundfont-storage.js";
import {
  loadFluidSynthSoundFont,
  peekFluidSynthEngine,
  subscribeFluidSynthEngine,
} from "../fluidsynth_synth/index.js";

const VOLUME_KEY = "fluidsynth_internal_volume";
const LAST_BANK_KEY = "fluidsynth_last_hosted_soundfont";
const PRESET_KEY = "fluidsynth_bank_presets";
const hostedUrl = (name) => new URL(encodeURIComponent(name), "https://soundfonts.plainsound.org/").href;
const readSavedPreset = (key) => {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}")[key]; }
  catch { return undefined; }
};
const rememberPreset = (key, value) => {
  try {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch { saved = {}; }
    localStorage.setItem(PRESET_KEY, JSON.stringify({ ...saved, [key]: value }));
  } catch { /* Browser storage restrictions must not interrupt playback. */ }
};
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
  const [offlineKey, setOfflineKey] = useState(null);
  const [menuOfflineKey, setMenuOfflineKey] = useState(null);
  const [checkedMenuKey, setCheckedMenuKey] = useState(null);
  const [presetValue, setPresetValue] = useState(settings.fluidsynth_preset || "0:0");
  const [storageStatus, setStorageStatus] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const [restoringOffline, setRestoringOffline] = useState(false);
  const localFileInputRef = useRef(null);
  const downloadControllerRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const activeEngine = peekFluidSynthEngine();
  const source = activeEngine?.soundfontSource;
  const loadedMenuMatches = !hostedSoundfont || source?.name === hostedSoundfont;
  const menuKey = hostedSoundfont ? hostedUrl(hostedSoundfont) : null;
  useEffect(() => {
    let current = true;
    setMenuOfflineKey(null);
    if (menuKey) readOfflineSoundfont(menuKey).then((bank) => {
      if (current && bank) setMenuOfflineKey(menuKey);
    }).catch(() => {}).finally(() => {
      if (current) setCheckedMenuKey(menuKey);
    });
    return () => { current = false; };
  }, [menuKey]);
  useEffect(() => {
    let current = true;
    setOfflineKey(null);
    if (source) {
      const key = soundfontStorageKey(source);
      readOfflineSoundfont(key).then((bank) => {
        if (current && bank) setOfflineKey(key);
      }).catch(() => {});
    }
    return () => { current = false; };
  }, [source]);
  useEffect(() => {
    const syncEngineState = (nextEngine = peekFluidSynthEngine()) => {
      setPresets(nextEngine?.presets ?? []);
      if (nextEngine?.selectedPreset) {
        setPresetValue(`${nextEngine.selectedPreset.bank}:${nextEngine.selectedPreset.program}`);
      }
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
  const presetControlsReady = loaded && loadedMenuMatches && !busy;
  const selectedPreset = presetControlsReady ? presetValue : "";
  const quietOfflineLoad = busy && loadingProgress?.quiet;
  const storageActionsReady = loaded && !!source && loadedMenuMatches;
  // Compare keys during render so even the first frame after selection retains
  // the row, before the asynchronous cache-check effect starts.
  const offlineRowPending = !storageActionsReady && !!menuKey && checkedMenuKey !== menuKey;
  const showOfflineNotice = storageActionsReady
    ? !!offlineKey : !!menuKey && menuOfflineKey === menuKey;
  const showOfflineRow = storageActionsReady || ((!busy || quietOfflineLoad) && (showOfflineNotice || offlineRowPending));
  const canCancelDownload = busy && loadingProgress?.phase === "Downloading" &&
    !!downloadControllerRef.current;
  const cancelDownload = () => {
    if (!downloadControllerRef.current || loadingProgress?.phase !== "Downloading") return;
    ++loadGenerationRef.current;
    downloadControllerRef.current.abort();
    downloadControllerRef.current = null;
    setBusy(false);
    setLoadingProgress(null);
    setStatus("Download cancelled.");
  };

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
    const preferredPreset = readSavedPreset(soundfontStorageKey(source)) ??
      (source.name === localStorage.getItem(LAST_BANK_KEY) ? settings.fluidsynth_preset : undefined);
    setBusy(true);
    setStatus(source.url ? "" : `${loaded ? "Replacing" : "Loading"} ${source.name}…`);
    setStorageStatus("");
    setLoadingProgress({
      name: source.name,
      url: source.url ?? "",
      percent: 0,
      phase: source.url ? "Checking stored copy" : "Reading local file",
      quiet: !!source.url,
    });
    try {
      const result = await loadFluidSynthSoundFont(source, {
        signal,
        preferredPreset,
        onDownloadProgress: ({ loaded: bytesLoaded, total }) => {
          if (!current()) return;
          setLoadingProgress((current) => ({
            ...current,
            percent: total ? Math.min(100, Math.floor((bytesLoaded / total) * 100)) : null,
          }));
        },
        onDownloadComplete: () => {
          if (current()) setLoadingProgress((progress) => ({ ...progress, percent: 100, phase: "Loading instrument" }));
        },
        onBytesReady: async (bankSource, bytes) => {
          try {
            await storeOfflineSoundfont(bankSource, bytes);
            if (current()) {
              setOfflineKey(soundfontStorageKey(bankSource));
              if (bankSource.url) setMenuOfflineKey(bankSource.url);
              setStorageStatus("");
            }
            // Persistence is best effort; denial must never interrupt playback.
            void navigator.storage?.persist?.().catch(() => {});
          } catch (error) {
            if (current()) setStorageStatus(`Loaded, but couldn’t save an offline copy: ${error.message}`);
          }
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
        const key = soundfontStorageKey(source);
        const chosen = nextPresets.find((preset) => `${preset.bank}:${preset.program}` === preferredPreset) ?? nextPresets[0];
        peekFluidSynthEngine()?.selectPreset?.(chosen);
        const value = `${chosen.bank}:${chosen.program}`;
        setPresetValue(value);
        rememberPreset(key, value);
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
      const previousEngine = peekFluidSynthEngine();
      if (previousEngine?.soundfontId != null) {
        setPresets(previousEngine.presets || []);
        setSoundfontName(previousEngine.soundfontSource?.name || "");
        return; // A failed download has not replaced the playing instrument.
      }
      setPresets([]);
      setSoundfontName("");
      // Keep the controls and failure message visible so the user can retry.
      // A failed instrument load must not change their output preference.
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
    // iOS may classify SoundFonts as generic documents and disable them when
    // an accept filter is present. Validate here, not in the native picker.
    if (!/\.(sf2|sf3)$/i.test(file.name)) {
      setStatus("Choose a SoundFont file in .sf2 or .sf3 format.");
      input.value = "";
      return;
    }
    void loadSoundFont(file).finally(() => {
      input.value = "";
    });
  };

  const loadHostedSoundFont = async () => {
    if (!hostedSoundfont) return;
    const name = hostedSoundfont;
    const url = hostedUrl(name);
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    void loadSoundFont({
      name,
      url,
      async arrayBuffer(onProgress) {
        const updatePhase = (phase) => {
          if (downloadControllerRef.current === controller) setLoadingProgress((progress) => ({ ...progress, phase, quiet: phase !== "Downloading" }));
        };
        controller.signal.throwIfAborted();
        try {
          const cached = await readWorkingSoundfont(url);
          controller.signal.throwIfAborted();
          if (cached) {
            updatePhase("Loading offline copy");
            onProgress?.({ loaded: cached.blob.size, total: cached.blob.size });
            return cached.blob.arrayBuffer();
          }
        } catch (error) {
          if (error.name === "AbortError") throw error;
          if (downloadControllerRef.current === controller) {
            setStorageStatus("Couldn’t read the stored copy. Downloading instead…");
          }
        }
        updatePhase("Downloading");
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
    setPresetValue(event.currentTarget.value);
    if (source) rememberPreset(soundfontStorageKey(source), event.currentTarget.value);
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

      {settings.output_fluidsynth && (
        <>
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
          style={(!loaded || !loadedMenuMatches) && hostedSoundfont ? { color: "var(--muted-text, #888)" } : undefined}
          onChange={(event) => {
            setHostedSoundfont(event.currentTarget.value);
            setStatus("");
            setStorageStatus("");
          }}
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
            disabled={!canCancelDownload && (busy || !hostedSoundfont)}
            onClick={canCancelDownload ? cancelDownload : loadHostedSoundFont}
          >
            {canCancelDownload ? "Cancel Download" : busy && !quietOfflineLoad ? "Loading…" : "Load Hexatone SoundFont"}
          </button>
          <button
            type="button"
            class="preset-action-btn"
            disabled={busy && loadingProgress?.phase !== "Downloading"}
            onClick={() => {
              cancelDownload();
              localFileInputRef.current.disabled = false;
              localFileInputRef.current?.click();
            }}
          >
            Choose Local File
          </button>
          <input
            ref={localFileInputRef}
            type="file"
            aria-label="FluidSynth SoundFont"
            class="settings-form__hidden-file-input"
            disabled={busy}
            onChange={loadLocalSoundFont}
          />
        </div>
      </div>

          <label>
            Preset
            <select
              class="sidebar-input"
              aria-label="FluidSynth preset"
              value={selectedPreset}
              disabled={!presetControlsReady}
              onChange={selectPreset}
            >
              {!presetControlsReady ? <option value="">{busy && !quietOfflineLoad ? "Loading instrument…" : "Load the selected SoundFont first"}</option> : null}
              {(presetControlsReady ? presets : []).map((preset) => (
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

      {showOfflineRow ? (
        <div class={`fluidsynth-settings__load-row${offlineRowPending ? " fluidsynth-settings__offline-row--pending" : ""}`} aria-hidden={offlineRowPending ? "true" : undefined}>
          {showOfflineNotice || offlineRowPending ? (
            <span class="settings-form__helper-text fluidsynth-settings__loaded-name" title="Stored in this browser. Clearing site data or ending a private session may remove it.">
              {showOfflineNotice ? "Available offline in this browser." : "\u00a0"}
            </span>
          ) : null}
          <div class={`preset-actions preset-actions--end fluidsynth-settings__load-actions fluidsynth-settings__offline-actions${storageActionsReady ? "" : " fluidsynth-settings__offline-actions--hidden"}`} aria-hidden={!storageActionsReady ? "true" : undefined}>
            <button type="button" class="preset-action-btn" disabled={!storageActionsReady || busy || storageBusy}
              onClick={async () => {
                setStorageBusy(true);
                try {
                  const bank = await readWorkingSoundfont(soundfontStorageKey(source)).catch(() => null);
                  if (!bank && !(source instanceof Blob)) throw new Error("The temporary copy is unavailable. Load the SoundFont again.");
                  const blob = bank?.blob ?? source;
                  saveSoundfontFile(source.name, blob);
                } catch (error) { setStorageStatus(`File save failed: ${error.message}`); }
                finally { setStorageBusy(false); }
              }}>Save SoundFont File…</button>
            {showOfflineNotice || offlineRowPending ? (
              <button type="button" class="preset-action-btn" disabled={!storageActionsReady || busy || storageBusy}
                onClick={async () => {
                  setStorageBusy(true);
                  try {
                    await removeOfflineSoundfont(offlineKey);
                    setOfflineKey(null);
                    if (source.url === menuKey) setMenuOfflineKey(null);
                    setStorageStatus("");
                  } catch (error) { setStorageStatus(`Could not remove offline copy: ${error.message}`); }
                  finally { setStorageBusy(false); }
                }}>Remove Offline Copy</button>
            ) : (
              <button type="button" class="preset-action-btn" disabled={!storageActionsReady || busy || storageBusy}
                onClick={async () => {
                  setStorageBusy(true);
                  setRestoringOffline(true);
                  try {
                    if (source instanceof Blob) await storeOfflineSoundfont(source, await source.arrayBuffer());
                    else await keepWorkingSoundfont(source);
                    setOfflineKey(soundfontStorageKey(source));
                    if (source.url === menuKey) setMenuOfflineKey(menuKey);
                    setStorageStatus("");
                    void navigator.storage?.persist?.().catch(() => {});
                  } catch (error) { setStorageStatus(`Offline copy not saved: ${error.message}`); }
                  finally { setStorageBusy(false); setRestoringOffline(false); }
                }}>{restoringOffline ? "Saving offline…" : "Keep for Offline Use"}</button>
            )}
          </div>
        </div>
      ) : null}
      {storageStatus ? <p class="settings-form__helper-text" role="status">{storageStatus}</p> : null}
      {busy && loadingProgress && !quietOfflineLoad ? (
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
          {loadingProgress.phase !== "Downloading" ? null : loadingProgress.percent == null ? (
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
      ) : status && !quietOfflineLoad ? (
        <p class="settings-form__helper-text" role="status">
          {status}
        </p>
      ) : null}
        </>
      )}
    </fieldset>
  );
};

FluidSynthSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default FluidSynthSettings;
