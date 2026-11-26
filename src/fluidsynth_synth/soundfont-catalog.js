export const HOSTED_SOUNDFONTS = Object.freeze([
  "PlainsoundOrgan.sf2",
  "PlainsoundOrganGedackt.sf2",
  "PlainsoundOrganSpielFl.sf2",
  "PlainsoundOrganPrincipal.sf2",
  "PlainsoundHarpsichord.sf2",
  "PlainsoundHarpsichordLute.sf2",
  "PlainsoundSrutibox.sf2",
]);

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
