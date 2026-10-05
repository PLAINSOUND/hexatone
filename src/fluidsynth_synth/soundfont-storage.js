/** Disk-backed copies, with one best-effort memory copy if browser storage fails. */
const DATABASE = "hexatone-soundfonts";
const STORE = "banks";
// A fresh page gets a fresh session: temporary banks are not an offline library.
const sessionId = crypto.randomUUID();
let cleanupStarted = false;
let memoryBank;

async function access(mode, operation) {
  if (!globalThis.indexedDB) throw new Error("Offline storage is unavailable in this browser.");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline storage is blocked by another tab."));
  });
  try {
    if (!cleanupStarted) {
      cleanupStarted = true;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        const request = transaction.objectStore(STORE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          // Crashed/closed sessions cannot reliably clean up during unload.
          // Reclaim abandoned temporary copies on a later visit, after 24 hours.
          if (cursor.value.offline === false && cursor.value.sessionId !== sessionId &&
            cursor.value.savedAt < Date.now() - 24 * 60 * 60 * 1000) cursor.delete();
          cursor.continue();
        };
        transaction.oncomplete = resolve;
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    }
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Offline storage operation aborted."));
    });
  } finally { db.close(); }
}

export const soundfontStorageKey = (source) => source.url || `local:${source.name}`;
export async function readOfflineSoundfont(key) {
  const bank = await access("readonly", (store) => store.get(key));
  return bank?.offline === false ? undefined : bank;
}
export async function readWorkingSoundfont(key) {
  let bank;
  try { bank = await access("readonly", (store) => store.get(key)); }
  catch (error) {
    if (memoryBank?.key === key) return memoryBank.bank;
    throw error;
  }
  if (!bank && memoryBank?.key === key) return memoryBank.bank;
  return bank && (bank.offline !== false || bank.sessionId === sessionId) ? bank : undefined;
}
export async function removeOfflineSoundfont(key) {
  const bank = await readWorkingSoundfont(key);
  if (bank) await access("readwrite", (store) => store.put({ ...bank,
    offline: false, sessionId, savedAt: Date.now() }, key));
}
export async function storeOfflineSoundfont(source, bytes) {
  const bank = { name: source.name, url: source.url || "", blob: new Blob([bytes]),
    offline: true, sessionId, savedAt: Date.now() };
  const key = soundfontStorageKey(source);
  try {
    await access("readwrite", (store) => store.put(bank, key));
    memoryBank = undefined;
  } catch (error) {
    // Blob construction above is the best-effort allocation; browsers expose no
    // reliable available-memory probe. Keep only the most recent failed copy.
    memoryBank = { key, bank: { ...bank, offline: false } };
    throw error;
  }
}

export async function keepWorkingSoundfont(source) {
  const key = soundfontStorageKey(source);
  const bank = await readWorkingSoundfont(key);
  if (!bank) throw new Error("The temporary copy is no longer available. Load the SoundFont again.");
  await access("readwrite", (store) => store.put({ ...bank, offline: true, savedAt: Date.now() }, key));
  if (memoryBank?.key === key) memoryBank = undefined;
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
