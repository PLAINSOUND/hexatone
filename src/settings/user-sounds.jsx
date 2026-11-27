import { useEffect, useRef, useState } from "preact/hooks";
import { BUILTIN_USER_SOUNDS, captureUserSound, loadUserSounds, parseUserSounds, saveUserSounds } from "../persistence/user-sounds.js";
import { orderPresetsByName } from "../persistence/preset-name-order.js";
import { exportFilename } from "../persistence/export-filename.js";
import { peekFluidSynthEngine, subscribeFluidSynthEngine } from "../fluidsynth_synth/index.js";

function soundState(sound) {
  const { fallback: _fallback, ...soundfont } = sound.soundfont;
  return JSON.stringify({ ...sound, soundfont });
}

export default function UserSounds({ settings, onApply }) {
  const [sounds, setSounds] = useState(loadUserSounds);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [, setEngineRevision] = useState(0);
  useEffect(() => subscribeFluidSynthEngine(() => setEngineRevision(value => value + 1)), []);
  const fileInput = useRef(null);
  const attempt = action => {
    try { action(); setError(""); } catch (error) { setError(error.message); }
  };
  const capture = () => captureUserSound(name, settings, { engine: peekFluidSynthEngine(), description });
  const selectedSound = selected.startsWith("builtin:") ? BUILTIN_USER_SOUNDS[Number(selected.slice(8))]
    : sounds.find(sound => `user:${sound.name}` === selected);
  let dirty = false;
  if (selectedSound && name.trim()) {
    const current = capture();
    const engine = peekFluidSynthEngine();
    // Disabled FluidSynth keeps its previous bank warm. That bank is not part
    // of the recalled sound until the output is enabled again.
    if (!current.settings.output_fluidsynth) {
      current.soundfont.name = selectedSound.soundfont.name;
      current.soundfont.preset = selectedSound.soundfont.preset;
    } else if (!engine?.soundfontSource && !engine?.pendingSoundfont) {
      current.soundfont.name = selectedSound.soundfont.name;
      current.soundfont.preset = settings.fluidsynth_preset ?? selectedSound.soundfont.preset;
    }
    const fallback = selectedSound.soundfont.fallback;
    if (fallback?.name === current.soundfont.name && fallback.preset === current.soundfont.preset) {
      current.soundfont.name = selectedSound.soundfont.name;
      current.soundfont.preset = selectedSound.soundfont.preset;
    }
    dirty = soundState(current) !== soundState(selectedSound);
  } else if (selectedSound) dirty = true;
  const recall = value => attempt(() => {
    const record = value.startsWith("builtin:") ? BUILTIN_USER_SOUNDS[Number(value.slice(8))]
      : sounds.find(sound => `user:${sound.name}` === value);
    if (!record) return;
    onApply(record); setSelected(value); setName(record.name); setDescription(record.description);
  });
  const save = copy => attempt(() => {
    if (!copy && selected.startsWith("builtin:")) return;
    let record = capture();
    if (copy) {
      const base = record.name;
      let suffix = 2;
      while (sounds.some(sound => sound.name === record.name)) record = { ...record, name: `${base} ${suffix++}` };
    }
    const original = copy ? null : sounds.find(sound => `user:${sound.name}` === selected);
    if (!copy && sounds.some(sound => sound !== original && sound.name === record.name)) {
      throw new Error("A sound with this name already exists. Choose another name or use Save as copy.");
    }
    const next = original
      ? sounds.map(sound => sound === original ? record : sound)
      : [...sounds, record];
    setSounds(saveUserSounds(next)); setSelected(`user:${record.name}`); setName(record.name);
  });
  return <><fieldset>
    <legend><b>User Sounds</b></legend>
    <input ref={fileInput} type="file" accept=".json" multiple class="settings-form__hidden-file-input"
      onChange={async event => {
        const input = event.currentTarget;
        try {
          const imported = (await Promise.all([...input.files].map(async file => parseUserSounds(await file.text())))).flat();
          let next = loadUserSounds();
          for (const record of imported) {
            const base = record.name;
            let name = base, suffix = 2;
            while (next.some(sound => sound.name === name)) name = `${base} ${suffix++}`;
            next = [...next, { ...record, name }];
          }
          setSounds(saveUserSounds(next)); setError("");
        } catch (error) { setError(error.message); }
        input.value = "";
      }} />
    <div class="preset-actions preset-actions--library preset-actions--library-import">
      <button type="button" class="preset-action-btn" onClick={() => fileInput.current.click()}>Open File(s)...</button>
    </div>
    <label class="preset-selector-row">
      <select aria-label="User sounds" value={selected} onChange={event => recall(event.currentTarget.value)}>
        <option value="">Choose a sound:</option>
        {BUILTIN_USER_SOUNDS.map((sound, index) => <option key={`builtin:${index}`} value={`builtin:${index}`}>{sound.name}{dirty && selected === `builtin:${index}` ? " *" : ""}</option>)}
        <option disabled>──────────</option>
        {orderPresetsByName(sounds).map(sound => <option key={sound.name} value={`user:${sound.name}`}>{sound.name}{dirty && selected === `user:${sound.name}` ? " *" : ""}</option>)}
      </select>
      <button type="button" class="preset-refresh-btn" disabled={!selected}
        aria-label="Reload selected sound" title="Reload selected sound" onClick={() => recall(selected)}>
        <span class="preset-refresh-glyph" aria-hidden="true">⟳</span>
      </button>
      {sounds.some(sound => `user:${sound.name}` === selected) && <button type="button" class="delete-btn preset-utility-btn" onClick={() => attempt(() => {
        setSounds(saveUserSounds(sounds.filter(sound => `user:${sound.name}` !== selected)));
        setSelected(""); setName(""); setDescription("");
      })}>Delete</button>}
    </label>
    <div class="settings-form__action-row settings-form__action-row--top">
      <span class="settings-form__action-group settings-form__action-group--wrap">
        <button type="button" class="preset-action-btn" disabled={!name.trim() || selected.startsWith("builtin:")} onClick={() => save(false)}>Save</button>
        <button type="button" class="preset-action-btn" disabled={!name.trim()} onClick={() => save(true)}>Save as copy</button>
      </span>
      <button type="button" class="preset-utility-btn settings-form__utility-btn--export" disabled={!name.trim()}
        onClick={() => attempt(() => {
          const record = capture();
          const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url;
          link.download = `${exportFilename(record.name, "sound")}.json`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        })}>Export .json</button>
    </div>
    <p class="setting-help">Saves all four built-in sounds. SoundFont files are kept separately.</p>
    {error && <p class="preset-error" role="alert">{error}</p>}
  </fieldset>
  <fieldset>
    <legend><b>Name and Description</b></legend>
    <label><input type="text" aria-label="Sound name" placeholder="User Sound"
      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={name}
      onInput={event => setName(event.currentTarget.value)} />{dirty && <span aria-label="Unsaved sound changes" title="Unsaved sound changes"> *</span>}</label>
    <label><textarea aria-label="Sound description" autoComplete="off" autoCorrect="off"
      autoCapitalize="off" spellCheck={false} value={description}
      onInput={event => setDescription(event.currentTarget.value)} /></label>
  </fieldset></>;
}
