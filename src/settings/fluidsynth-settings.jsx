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
  stopFluidSynthEngine,
} from "../fluidsynth_synth/index.js";

import { HOSTED_SOUNDFONTS, hostedSoundfontUrl as hostedUrl, legacyLocalSoundfontKey } from "../fluidsynth_synth/soundfont-catalog.js";
import { REVERB_KEY, readFluidSynthReverb } from "../fluidsynth_synth/reverb.js";
import { SMOOTHING_KEY, normalizeFluidSynthSmoothing, readFluidSynthSmoothing } from "../fluidsynth_synth/smoothing.js";

const VOLUME_KEY = "fluidsynth_internal_volume";
const LAST_BANK_KEY = "fluidsynth_last_hosted_soundfont";
const PRESET_KEY = "fluidsynth_bank_presets";

const readSavedPreset = (key) => {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESET_KEY) || "{}");
    return saved[key] ?? saved[legacyLocalSoundfontKey(key)];
  }
  catch { return undefined; }
};
const rememberPreset = (key, value) => {
  try {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch { saved = {}; }
    localStorage.setItem(PRESET_KEY, JSON.stringify({ ...saved, [key]: value }));
  } catch { /* Browser storage restrictions must not interrupt playback. */ }
};
const pendingBankNotice = name => `${name} is ready for the next note. The old sound will fade out over 40 ms before loading.`;
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

const FluidSynthSettings = ({ settings, onChange, soundRecall, onWorkingChange }) => {
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem("hexatone_fluidsynth_collapsed") !== "false");
  const [presets, setPresets] = useState(() => peekFluidSynthEngine()?.presets ?? []);
  const [soundfontName, setSoundfontName] = useState("");
  const [hostedSoundfont, setHostedSoundfont] = useState(() => {
    const sourceName = peekFluidSynthEngine()?.soundfontSource?.name;
    const remembered = localStorage.getItem(LAST_BANK_KEY);
    return HOSTED_SOUNDFONTS.includes(sourceName) ? sourceName
      : HOSTED_SOUNDFONTS.includes(remembered) ? remembered : "";
  });
  const [volume, setVolume] = useState(readVolume);
  const volumeRef = useRef(volume);
  const [reverb, setReverb] = useState(readFluidSynthReverb);
  const [smoothing, setSmoothing] = useState(readFluidSynthSmoothing);
  const smoothingRef = useRef(smoothing);
  const appliedRecallRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [status, setStatus] = useState(() => {
    const pending = peekFluidSynthEngine()?.pendingSoundfont;
    return pending ? pendingBankNotice(pending.source.name) : "";
  });
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
  const menuSelectionRef = useRef(0);
  const outputEnabledRef = useRef(!!settings.output_fluidsynth);
  outputEnabledRef.current = !!settings.output_fluidsynth;
  useEffect(() => () => { ++menuSelectionRef.current; }, []);
  const activeEngine = peekFluidSynthEngine();
  const source = activeEngine?.soundfontSource;
  const localSoundfontLoaded = activeEngine?.soundfontId != null && !!source && !source.url;
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
      if (!nextEngine?.pendingSoundfont && !nextEngine?.soundfontSwitchError) setStatus("");
      if (nextEngine?.selectedPreset) {
        setPresetValue(`${nextEngine.selectedPreset.bank}:${nextEngine.selectedPreset.program}`);
      }
      if (nextEngine?.soundfontSwitchError) setStatus(`SoundFont load failed: ${nextEngine.soundfontSwitchError}`);
      if (nextEngine?.soundfontSource?.name) {
        setSoundfontName(nextEngine.soundfontSource.name);
        setHostedSoundfont(
          HOSTED_SOUNDFONTS.includes(nextEngine.pendingSoundfont?.source.name ?? nextEngine.soundfontSource.name)
            ? (nextEngine.pendingSoundfont?.source.name ?? nextEngine.soundfontSource.name)
            : "",
        );
      } else if (nextEngine?.soundfontId == null) {
        setSoundfontName("");
      }
    };
    syncEngineState();
    return subscribeFluidSynthEngine(syncEngineState);
  // The warm output toggle does not reload the bank. Reopening its controls
  // must reflect the playing engine, not a previously browsed menu candidate.
  }, [settings.output_fluidsynth]);
  const loaded = activeEngine?.soundfontId != null && presets.length > 0;
  const presetControlsReady = loaded && loadedMenuMatches && !busy && !activeEngine?.pendingSoundfont;
  const selectedPreset = presetControlsReady ? presetValue : "";
  const quietOfflineLoad = busy && loadingProgress?.quiet;
  const storageActionsReady = loaded && !!source && loadedMenuMatches && !activeEngine?.pendingSoundfont;
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
    volumeRef.current = next;
    localStorage.setItem(VOLUME_KEY, String(next));
    sessionStorage.setItem(VOLUME_KEY, String(next));
    peekFluidSynthEngine()?.setVolume(next);
    onWorkingChange?.();
  };

  const changeReverb = (value) => {
    const next = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
    setReverb(next);
    try { localStorage.setItem(REVERB_KEY, String(next)); } catch { /* Private storage unavailable. */ }
    peekFluidSynthEngine()?.setReverb?.(next);
    onWorkingChange?.();
  };

  const changeSmoothing = (key, value, commit = false) => {
    const previous = smoothingRef.current;
    const next = normalizeFluidSynthSmoothing({ ...previous, [key]: value });
    // Keep disk-backed browser storage out of the pointer-move path.
    if (commit) {
      try { localStorage.setItem(SMOOTHING_KEY, JSON.stringify(next)); } catch { /* Private storage unavailable. */ }
    }
    if (previous.pressureMs === next.pressureMs && previous.expressionMs === next.expressionMs && previous.minimumMs === next.minimumMs) return;
    smoothingRef.current = next;
    setSmoothing(next);
    peekFluidSynthEngine()?.setSmoothing?.(next);
    onWorkingChange?.();
  };

  const loadSoundFont = async (source, signal, presetOverride, requestGeneration) => {
    if (!source) return;
    const generation = requestGeneration ?? ++loadGenerationRef.current;
    const current = () => generation === loadGenerationRef.current;
    const recalledPreset = appliedRecallRef.current === soundRecall ? undefined
      : soundRecall?.name === source.name ? soundRecall.preset
      : soundRecall?.fallback?.name === source.name ? soundRecall.fallback.preset : undefined;
    const preferredPreset = presetOverride ?? recalledPreset ?? readSavedPreset(soundfontStorageKey(source)) ??
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
            const key = soundfontStorageKey(bankSource);
            // A retained Blob already supplied these bytes; don't rewrite a
            // potentially large bank just to switch back to it.
            if (bankSource.storedOfflineKey !== key) await storeOfflineSoundfont(bankSource, bytes);
            if (current()) {
              setOfflineKey(soundfontStorageKey(bankSource));
              if (key === menuKey) setMenuOfflineKey(key);
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
      if (result.deferred) {
        setStatus(pendingBankNotice(source.name));
        return true;
      }
      const nextPresets = result.presets || [];
      setPresets(nextPresets);
      setSoundfontName(source.name);
      if (HOSTED_SOUNDFONTS.includes(source.name)) {
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
      peekFluidSynthEngine()?.setVolume?.(volumeRef.current);
      return true;
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

  const loadHostedSoundFont = (name = hostedSoundfont, { cachedBank, allowDownload = true } = {}) => {
    if (!name) return;
    const url = hostedUrl(name);
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    const bankSource = {
      name,
      url,
      async arrayBuffer(onProgress) {
        const updatePhase = (phase) => {
          if (downloadControllerRef.current === controller) setLoadingProgress((progress) => ({ ...progress, phase, quiet: phase !== "Downloading" }));
        };
        controller.signal.throwIfAborted();
        bankSource.storedOfflineKey = null;
        try {
          const cached = cachedBank ?? await readWorkingSoundfont(url);
          controller.signal.throwIfAborted();
          if (cached) {
            updatePhase("Loading offline copy");
            onProgress?.({ loaded: cached.blob.size, total: cached.blob.size });
            const bytes = await cached.blob.arrayBuffer();
            controller.signal.throwIfAborted();
            bankSource.storedOfflineKey = cached.offline === false ? null : url;
            return bytes;
          }
        } catch (error) {
          if (error.name === "AbortError") throw error;
          if (!allowDownload) throw new Error("Stored copy unavailable. Click Load to download, or choose a local file.", { cause: error });
          if (downloadControllerRef.current === controller) {
            setStorageStatus("Couldn’t read the stored copy. Downloading instead…");
          }
        }
        if (!allowDownload) throw new Error("No stored copy. Click Load to download, or choose a local file.");
        updatePhase("Downloading");
        // The soundfonts subdomain's document root already maps to the
        // webspace /soundfonts directory, so the URL path starts at /.
        const response = await fetch(url, { mode: "cors", signal: controller.signal });
        if (!response.ok) throw new Error(`SoundFont download failed (${response.status})`);
        return readResponseWithProgress(response, onProgress);
      },
    };
    void loadSoundFont(bankSource, controller.signal);
  };

  const loadRememberedSelection = async (name, selection, generation) => {
    const current = () => outputEnabledRef.current && menuSelectionRef.current === selection &&
      loadGenerationRef.current === generation;
    try {
      if (peekFluidSynthEngine()?.soundfontCache?.keys.includes(hostedUrl(name))) {
        if (current()) loadHostedSoundFont(name, { allowDownload: false });
        return;
      }
      const cachedBank = await readWorkingSoundfont(hostedUrl(name));
      if (!current()) return;
      if (cachedBank?.blob) loadHostedSoundFont(name, { cachedBank, allowDownload: false });
      else setStatus("Not stored in this browser. Click Load to download, or choose a local file.");
    } catch {
      if (current()) setStatus("Stored copy unavailable. Click Load to download, or choose a local file.");
    }
  };

  // Recall bank references through the existing cache/load path; never download implicitly.
  const recallLoaderRef = useRef(null);
  recallLoaderRef.current = loadSoundFont;
  const recallChangeRef = useRef(onChange);
  recallChangeRef.current = onChange;
  useEffect(() => {
    if (!soundRecall) return;
    setVolume(soundRecall.volume);
    volumeRef.current = soundRecall.volume;
    setReverb(soundRecall.reverb);
    setSmoothing(soundRecall.smoothing);
    smoothingRef.current = soundRecall.smoothing;
    setPresetValue(soundRecall.preset);
  }, [soundRecall]);
  useEffect(() => {
    if (!soundRecall || appliedRecallRef.current === soundRecall) return;
    if (!settings.output_fluidsynth || !soundRecall.name) return;
    let cancelled = false;
    const generation = ++loadGenerationRef.current;
    ++menuSelectionRef.current;
    downloadControllerRef.current?.abort();
    const current = () => !cancelled && loadGenerationRef.current === generation;
    const active = peekFluidSynthEngine();
    setHostedSoundfont(HOSTED_SOUNDFONTS.includes(soundRecall.name) ? soundRecall.name : "");
    const recallAvailable = async () => {
      for (const candidate of [soundRecall, soundRecall.fallback].filter(Boolean)) {
        const [bank, program] = candidate.preset.split(":").map(Number);
        if (active?.soundfontSource?.name === candidate.name && !active.pendingSoundfont) {
          active.selectPreset?.({ bank, program });
          setHostedSoundfont(HOSTED_SOUNDFONTS.includes(candidate.name) ? candidate.name : "");
          setPresetValue(candidate.preset);
          recallChangeRef.current("fluidsynth_preset", candidate.preset);
          appliedRecallRef.current = soundRecall;
          setStatus("");
          return;
        }
        const key = soundfontStorageKey({ name: candidate.name,
          ...(HOSTED_SOUNDFONTS.includes(candidate.name) ? { url: hostedUrl(candidate.name) } : {}) });
        const cached = await readWorkingSoundfont(key).catch(() => null);
        if (!current()) return;
        const resident = peekFluidSynthEngine()?.soundfontCache?.keys.includes(key);
        if (!cached?.blob && !resident) continue;
        setHostedSoundfont(HOSTED_SOUNDFONTS.includes(candidate.name) ? candidate.name : "");
        const applied = await recallLoaderRef.current({
          name: candidate.name, url: key, storedOfflineKey: key,
          arrayBuffer: () => {
            if (!cached?.blob) throw new Error("Stored copy unavailable. Choose the SoundFont locally.");
            return cached.blob.arrayBuffer();
          },
        }, undefined, candidate.preset, generation);
        if (current() && applied) appliedRecallRef.current = soundRecall;
        return;
      }
      setStatus(`Choose ${soundRecall.name} locally, or select it and click Load.`);
      appliedRecallRef.current = soundRecall;
    };
    void recallAvailable().catch(error => { if (current()) setStatus(`SoundFont recall failed: ${error.message}`); });
    return () => { cancelled = true; };
  }, [soundRecall, settings.output_fluidsynth]);

  const selectPreset = (event) => {
    const [bank, program] = event.currentTarget.value.split(":").map(Number);
    const preset = presets.find((item) => item.bank === bank && item.program === program);
    if (!preset) return;
    peekFluidSynthEngine()?.selectPreset(preset);
    setPresetValue(event.currentTarget.value);
    if (source) rememberPreset(soundfontStorageKey(source), event.currentTarget.value);
    onChange("fluidsynth_preset", event.currentTarget.value);
    onChange("fluidsynth_runtime_revision", (Number(settings.fluidsynth_runtime_revision) || 0) + 1);
  };

  return (
    <fieldset class="output-routing-fieldset">
      <legend>
        <b>Built-in SoundFont Player</b>
        <button type="button" class="section-collapse-toggle"
          aria-label={collapsed ? "Show SoundFont Player settings" : "Hide SoundFont Player settings"}
          aria-expanded={!collapsed}
          title={collapsed ? "Toggle to show SoundFont Player settings" : "Toggle to hide SoundFont Player settings"}
          onClick={() => {
            sessionStorage.setItem("hexatone_fluidsynth_collapsed", String(!collapsed));
            setCollapsed(!collapsed);
          }}>
          <span aria-hidden="true" class={`disclosure-toggle-glyph disclosure-toggle-glyph--${collapsed ? "collapsed" : "expanded"}`} />
        </button>
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
          local file in .sf2 or .sf3 format. The built-in WebAssembly player supports per-note tuning and expression. On iOS larger SoundFonts (i.e., PlainsoundOrgan and PlainsoundHarpsichord) may add some latency, the slimmer single register versions may offer better performance.</em>
      </p>

      <label>
        Hexatone SoundFonts
        <select
          class="sidebar-input"
          aria-label="Hexatone FluidSynth SoundFont"
          value={localSoundfontLoaded && !shuttingDown && !hostedSoundfont ? "local" : hostedSoundfont}
          disabled={busy}
          style={(!loaded || !loadedMenuMatches) && hostedSoundfont ? { color: "var(--muted-text, #888)" } : undefined}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "local") return;
            const selection = ++menuSelectionRef.current;
            const generation = ++loadGenerationRef.current;
            setHostedSoundfont(value);
            setStatus("");
            setStorageStatus("");
            if (!value) {
              setBusy(true);
              setShuttingDown(true);
              setStatus("Releasing FluidSynth sounds…");
              void stopFluidSynthEngine({ naturalRelease: true }).then(() => {
                setStatus("");
                onChange("fluidsynth_runtime_revision", (Number(settings.fluidsynth_runtime_revision) || 0) + 1);
              }).catch(error => setStatus(`FluidSynth release failed: ${error.message}`))
                .finally(() => { setBusy(false); setShuttingDown(false); });
            } else {
              const playing = peekFluidSynthEngine();
              if (playing?.soundfontId != null && !playing.pendingSoundfont && playing.soundfontSource &&
                  soundfontStorageKey(playing.soundfontSource) === hostedUrl(value)) return;
              void loadRememberedSelection(value, selection, generation);
            }
          }}
        >
          {localSoundfontLoaded ? <option value="local" disabled>Choose a hosted SoundFont…</option> : null}
          <option value="">OFF</option>
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
            disabled={!canCancelDownload && (busy || !hostedSoundfont || activeEngine?.pendingSoundfont?.cacheKey === menuKey)}
            onClick={canCancelDownload ? cancelDownload : () => loadHostedSoundFont()}
          >
            {canCancelDownload ? "Cancel Download" : "Load Hexatone SoundFont"}
          </button>
          <button
            type="button"
            class="preset-action-btn"
            disabled={busy && loadingProgress?.phase !== "Downloading"}
            onClick={() => {
              ++menuSelectionRef.current;
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
              {!presetControlsReady ? <option value="">{shuttingDown ? "Shutting down…" : busy && !quietOfflineLoad ? "Loading instrument…" : "Load the selected SoundFont first"}</option> : null}
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
                defaultValue={100}
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

          <label>
            Reverb
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider ariaLabel="FluidSynth reverb" min={0} max={127} step={1}
                defaultValue={20}
                value={reverb} disabled={!loaded}
                onInputValue={changeReverb} onCommitValue={changeReverb} />
              <span class="settings-form__range-value">{reverb}</span>
            </span>
          </label>

          {!collapsed && <>
          {[["pressureMs", "Pressure Smoothing (ms)"], ["expressionMs", "Expression Y Smoothing (ms)"]].map(([key, label]) => (
            <label key={key}>
              <span class={smoothing[key] === 0 ? "fluidsynth-settings__smoothing-off" : undefined}>{label}</span>
              <span class="sidebar-input settings-form__range-row">
                <CustomRangeSlider ariaLabel={label} min={0} max={500} step={1}
                  defaultValue={0} value={smoothing[key]} disabled={!loaded}
                  onInputValue={(value) => changeSmoothing(key, value)}
                  onCommitValue={(value) => changeSmoothing(key, value, true)} />
                <span class="settings-form__range-value">{smoothing[key] === 0 ? "off" : smoothing[key]}</span>
              </span>
            </label>
          ))}

          <label>
            <span class={smoothing.minimumMs === 0 ? "fluidsynth-settings__smoothing-off" : undefined}>Minimum Smoothing (ms)</span>
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider ariaLabel="Minimum Smoothing (ms)" min={0}
                max={Math.min(...[smoothing.pressureMs, smoothing.expressionMs].filter(ms => ms > 0), 500)}
                step={1} defaultValue={0} value={smoothing.minimumMs}
                disabled={!loaded || (!smoothing.pressureMs && !smoothing.expressionMs)}
                onInputValue={value => changeSmoothing("minimumMs", value)}
                onCommitValue={value => changeSmoothing("minimumMs", value, true)} />
              <span class="settings-form__range-value">{smoothing.minimumMs}</span>
            </span>
          </label>

          </>}

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
                    if (soundfontStorageKey(source) === menuKey) setMenuOfflineKey(null);
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
                    if (soundfontStorageKey(source) === menuKey) setMenuOfflineKey(menuKey);
                    setStorageStatus("");
                    void navigator.storage?.persist?.().catch(() => {});
                  } catch (error) { setStorageStatus(`Offline copy not saved: ${error.message}`); }
                  finally { setStorageBusy(false); setRestoringOffline(false); }
                }}>Keep for Offline Use</button>
            )}
          </div>
        </div>
      ) : null}
      {restoringOffline || storageStatus ? <p class="settings-form__helper-text" role="status">{restoringOffline ? "Saving offline…" : storageStatus}</p> : null}
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
  soundRecall: PropTypes.object,
  onWorkingChange: PropTypes.func,
};

export default FluidSynthSettings;
