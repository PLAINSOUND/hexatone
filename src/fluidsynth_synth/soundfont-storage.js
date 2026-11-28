/** Disk-backed copies, with one best-effort memory copy if browser storage fails. */
import { canonicalSoundfontKey, legacyLocalSoundfontKey } from "./soundfont-catalog.js";
import { restoreSoundOnReload } from "../persistence/io-reload-policy.js";

const DATABASE = "hexatone-soundfonts";
const STORE = "banks";
// A fresh page gets a fresh session: temporary banks are not an offline library.
const sessionId = crypto.randomUUID();
let cleanupPromise;
let discardPreviousCopies = false;
let memoryBank;
const pendingChanges = new Map();

async function changeCopy(key, operation) {
  const previous = pendingChanges.get(key);
  const next = previous ? previous.catch(() => {}).then(operation) : operation();
  pendingChanges.set(key, next);
  try { return await next; }
  finally {
    if (pendingChanges.get(key) === next) pendingChanges.delete(key);
    soundfontCopiesChanged.dispatchEvent(new Event("change"));
  }
}
export const soundfontCopiesChanged = new EventTarget();

async function withDatabase(operation) {
  if (!globalThis.indexedDB) throw new Error("Offline storage is unavailable in this browser.");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline storage is blocked by another tab."));
  });
  try { return await operation(db); }
  finally { db.close(); }
}

function cleanUpCopies(db) {
  cleanupPromise ??= new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const request = transaction.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const bank = cursor.value;
      // Old versions allowed individually removing an offline copy. Keep those
      // temporary records out of future sessions until this cleanup removes them.
      if (bank.sessionId !== sessionId && (discardPreviousCopies || bank.offline === false)) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  }).catch(error => {
    cleanupPromise = null;
    throw error;
  });
  return cleanupPromise;
}

export function initializeSoundfontStorage() {
  if (restoreSoundOnReload()) return Promise.resolve();
  discardPreviousCopies = true;
  return withDatabase(cleanUpCopies);
}

function access(mode, operation) {
  return withDatabase(async db => {
    await cleanUpCopies(db);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Offline storage operation aborted."));
    });
  });
}

export const soundfontStorageKey = (source) => canonicalSoundfontKey(source.url || `local:${source.name}`);
// Enumerate keys only. Reading all bank records would materialize large Blobs on phones.
export async function workingSoundfontKeys() {
  let keys = [];
  try { keys = await access("readonly", store => store.getAllKeys()); }
  catch { /* Storage can be disabled; the session fallback still works. */ }
  if (memoryBank) keys.push(memoryBank.key);
  return [...new Set(keys.map(canonicalSoundfontKey))];
}
async function readBank(key) {
  key = canonicalSoundfontKey(key);
  const bank = await access("readonly", (store) => store.get(key));
  // An explicit temporary/removed record must take precedence over an old copy.
  if (bank) return bank;
  const legacyKey = legacyLocalSoundfontKey(key);
  return legacyKey ? access("readonly", (store) => store.get(legacyKey)) : undefined;
}
async function writeBank(key, bank) {
  key = canonicalSoundfontKey(key);
  await access("readwrite", store => {
    const request = store.put(bank, key);
    const legacyKey = legacyLocalSoundfontKey(key);
    if (legacyKey) store.delete(legacyKey);
    return request;
  });
}
export async function readOfflineSoundfont(key) {
  const bank = await readBank(key);
  return bank?.offline === false ? undefined : bank;
}
export async function readWorkingSoundfont(key) {
  key = canonicalSoundfontKey(key);
  await pendingChanges.get(key)?.catch(() => {});
  let bank;
  try { bank = await readBank(key); }
  catch (error) {
    if (memoryBank?.key === key) return memoryBank.bank;
    throw error;
  }
  if (!bank && memoryBank?.key === key) return memoryBank.bank;
  return bank && (bank.offline !== false || bank.sessionId === sessionId) ? bank : undefined;
}
export async function storeSoundfontCopy(source, bytes) {
  const bank = { name: source.name, url: source.url || "", blob: new Blob([bytes]),
    offline: true, sessionId };
  const key = soundfontStorageKey(source);
  return changeCopy(key, async () => {
    try {
      await writeBank(key, bank);
      memoryBank = undefined;
    } catch (error) {
      memoryBank = { key, bank: { ...bank, offline: false } };
      throw error;
    }
  });
}

export function removeSoundfontCopy(key) {
  return changeCopy(key, async () => {
    try {
      await access("readwrite", store => {
        const legacyKey = legacyLocalSoundfontKey(key);
        if (legacyKey) store.delete(legacyKey);
        return store.delete(key);
      });
    }
    catch (error) {
      if (memoryBank?.key !== key) throw error;
    }
    if (memoryBank?.key === key) memoryBank = undefined;
  });
}

export function saveSoundfontFile(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
