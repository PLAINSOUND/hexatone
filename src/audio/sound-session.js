import { DSF_DEFAULTS, dsfControlsFromSettings } from "../dsf_synth/controls.js";
import { isMixerParameter, mixerValue, readMixerValue } from "./sound-mixer.js";
import { countAudioTestEvent } from "./runtime-diagnostics.js";

// Live controls are independent of the sidebar and the persisted settings.
// Keep committed previews until App acknowledges them on its next render.
export function createSoundSession(getBindings, { settleMs = 200 } = {}) {
  const changes = new EventTarget();
  let pending = {};
  let committed = {};
  let timer;
  let dsfSettings;
  let dsfControls;
  const mixer = new Map();
  const readMixer = key => {
    if (!mixer.has(key)) mixer.set(key, readMixerValue(key, getBindings().settings));
    return mixer.get(key);
  };

  const workingSettings = base =>
    Object.keys(committed).length || Object.keys(pending).length
      ? { ...base, ...committed, ...pending }
      : base;

  const flush = () => {
    clearTimeout(timer);
    const updates = pending;
    pending = {};
    if (!Object.keys(updates).length) return;
    for (const [key, value] of Object.entries(updates)) {
      if (!isMixerParameter(key)) committed[key] = value;
    }
    getBindings().commit(updates);
    countAudioTestEvent("soundSettingsCommits");
  };

  return {
    changes,
    readMixer,
    mixerValues: () => Object.fromEntries(mixer),
    settings: workingSettings,
    acknowledge(settings) {
      for (const key of Object.keys(committed)) {
        if (settings[key] === committed[key]) delete committed[key];
      }
    },
    setParameter(key, value) {
      const brightness = key === "osc_brightness";
      const mix = isMixerParameter(key);
      if (!mix && !brightness && (!key.startsWith("dsf_") || !Object.hasOwn(DSF_DEFAULTS, key.slice(4)))) {
        throw new Error(`Unknown sound parameter: ${key}`);
      }
      const bindings = getBindings();
      if (mix) {
        const next = mixerValue(key, value);
        if (readMixer(key) === next) return;
        mixer.set(key, next);
        pending[key] = next;
        bindings.applyMixer?.(key, next);
        countAudioTestEvent("mixerControlEdits");
      } else if (brightness) {
        const base = workingSettings(bindings.settings);
        const next = Math.max(0, Math.min(1, Number(value) || 0));
        if (bindings.oscBrightness?.value !== next) bindings.applyBrightness?.(next);
        if ((base[key] ?? 0.2) === next) return;
        pending[key] = next;
        countAudioTestEvent("oscBrightnessEdits");
      } else {
        const base = workingSettings(bindings.settings);
        if (dsfSettings !== bindings.settings || !dsfControls) {
          dsfSettings = bindings.settings;
          dsfControls = dsfControlsFromSettings(base);
        }
        const controls = dsfControlsFromSettings({ ...base, [key]: value });
        const next = controls[key.slice(4)];
        if (dsfControls[key.slice(4)] === next) return;
        dsfControls = controls;
        pending[key] = next;
        bindings.applyDsf?.(controls);
        countAudioTestEvent("dsfControlEdits");
      }
      changes.dispatchEvent(new CustomEvent("change", { detail: key }));
      clearTimeout(timer);
      timer = setTimeout(flush, settleMs);
    },
    flush,
    discardEdits() {
      clearTimeout(timer);
      pending = {};
      committed = {};
      mixer.clear();
      dsfControls = undefined;
    },
  };
}
