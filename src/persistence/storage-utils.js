/**
 * persistence/storage-utils.js
 *
 * Safe helpers for reading typed values from sessionStorage and localStorage.
 *
 * The core problem these solve: parseInt("0") returns 0, which is falsy, so
 * the common pattern `parseInt(storage.getItem(key)) || default` incorrectly
 * replaces a stored 0 with the default. All helpers here use an explicit
 * !== null check before parsing.
 *
 * Usage:
 *   import { sessionInt, sessionBool, sessionString, localInt } from './storage-utils.js';
 *   const channel = sessionInt('midi_channel', 0);
 *   const enabled = sessionBool('output_mts', false);
 */

// ── sessionStorage helpers ────────────────────────────────────────────────────

/**
 * Read an integer from sessionStorage.
 * Returns `fallback` if the key is absent (null), not if the value is falsy.
 */
export function sessionInt(key, fallback) {
  const raw = sessionStorage.getItem(key);
  return raw !== null ? parseInt(raw) : fallback;
}

/**
 * Read a float from sessionStorage.
 * Returns `fallback` if the key is absent.
 */
export function sessionFloat(key, fallback) {
  const raw = sessionStorage.getItem(key);
  return raw !== null ? parseFloat(raw) : fallback;
}

/**
 * Read a boolean from sessionStorage.
 * Returns `fallback` if the key is absent.
 * A stored value of "true" returns true; anything else returns false.
 */
export function sessionBool(key, fallback) {
  const raw = sessionStorage.getItem(key);
  return raw !== null ? raw === "true" : fallback;
}

/**
 * Read a string from sessionStorage.
 * Returns `fallback` if the key is absent (null).
 * A stored empty string "" is returned as-is, not replaced by fallback.
 */
export function sessionString(key, fallback) {
  const raw = sessionStorage.getItem(key);
  return raw !== null ? raw : fallback;
}

// ── localStorage helpers ──────────────────────────────────────────────────────

/**
 * Read an integer from localStorage.
 * Returns `fallback` if the key is absent.
 */
export function localInt(key, fallback) {
  const raw = localStorage.getItem(key);
  return raw !== null ? parseInt(raw) : fallback;
}

/**
 * Read a float from localStorage.
 * Returns `fallback` if the key is absent.
 */
export function localFloat(key, fallback) {
  const raw = localStorage.getItem(key);
  return raw !== null ? parseFloat(raw) : fallback;
}

/**
 * Read a boolean from localStorage.
 * Returns `fallback` if the key is absent.
 */
export function localBool(key, fallback) {
  const raw = localStorage.getItem(key);
  return raw !== null ? raw === "true" : fallback;
}

/**
 * Read a string from localStorage.
 * Returns `fallback` if the key is absent.
 */
export function localString(key, fallback) {
  const raw = localStorage.getItem(key);
  return raw !== null ? raw : fallback;
}
