export const HOSTED_SOUNDFONTS = Object.freeze([
  "PlainsoundOrgan.sf2",
  "PlainsoundOrganGedackt.sf2",
  "PlainsoundOrganSpielFl.sf2",
  "PlainsoundOrganPrincipal.sf2",
  "PlainsoundHarpsichord.sf2",
  "PlainsoundHarpsichordLute.sf2",
  "PlainsoundSrutibox.sf2",
]);

const SLIM_SOUNDFONTS = new Set([
  "PlainsoundOrganGedackt.sf2", "PlainsoundOrganSpielFl.sf2",
  "PlainsoundOrganPrincipal.sf2", "PlainsoundHarpsichordLute.sf2",
]);
export const isSlimSoundfont = name => SLIM_SOUNDFONTS.has(name);

export const hostedSoundfontUrl = name => new URL(encodeURIComponent(name), "https://soundfonts.plainsound.org/").href;

// A matching local file is the user's copy of this menu bank. Arbitrary names
// and other URLs retain their own identities; browsing the menu is not a link.
export function canonicalSoundfontKey(key) {
  if (!key?.startsWith("local:")) return key;
  const name = key.slice(6);
  return HOSTED_SOUNDFONTS.includes(name) ? hostedSoundfontUrl(name) : key;
}

// Older pages kept local and hosted copies/preset choices under separate keys.
export function legacyLocalSoundfontKey(key) {
  const name = HOSTED_SOUNDFONTS.find(name => hostedSoundfontUrl(name) === key);
  return name ? `local:${name}` : undefined;
}


export const LAST_SOUNDFONT_KEY = "fluidsynth_last_soundfont_source";

export function readRememberedSoundfont(storage = localStorage) {
  try {
    const source = JSON.parse(storage.getItem(LAST_SOUNDFONT_KEY) || "null");
    if (typeof source?.name === "string" && source.name) return source;
    const name = storage.getItem(LAST_BANK_KEY);
    return name ? { name, url: hostedSoundfontUrl(name) } : null;
  } catch { return null; }
}

export const LAST_BANK_KEY = "fluidsynth_last_hosted_soundfont";
export const BANK_PRESETS_KEY = "fluidsynth_bank_presets";

export function rememberBankPreset(key, value) {
  try {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(BANK_PRESETS_KEY) || "{}"); } catch { saved = {}; }
    localStorage.setItem(BANK_PRESETS_KEY, JSON.stringify({ ...saved, [key]: value }));
  } catch { /* Storage restrictions must not interrupt playback. */ }
}
