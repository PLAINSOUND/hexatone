import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SOUND_RESTORE_KEY } from "../persistence/io-reload-policy.js";

let storage;
async function loadStorage() {
  vi.resetModules();
  storage = await import("./soundfont-storage.js");
}

beforeEach(async () => {
  localStorage.clear();
  await loadStorage();
});
afterEach(() => vi.unstubAllGlobals());

function mockDatabase() {
  const banks = new Map();
  const close = vi.fn();
  vi.stubGlobal("indexedDB", {
    open() {
      const open = {};
      queueMicrotask(() => {
        open.result = {
          close,
          transaction() {
            const transaction = {};
            const result = (value) => {
              const request = { result: value };
              queueMicrotask(() => transaction.oncomplete());
              return request;
            };
            transaction.objectStore = () => ({
              put: (bank, key) => { banks.set(key, bank); return result(key); },
              getAllKeys: () => result([...banks.keys()]),
              get: (key) => result(banks.get(key)),
              delete: (key) => { banks.delete(key); return result(undefined); },
              openCursor: () => {
                const request = {};
                const entries = banks.entries();
                const next = () => queueMicrotask(() => {
                  const entry = entries.next();
                  if (entry.done) {
                    request.result = null;
                    request.onsuccess();
                    transaction.oncomplete();
                    return;
                  }
                  const [key, value] = entry.value;
                  request.result = { value, delete: () => banks.delete(key), continue: next };
                  request.onsuccess();
                });
                next();
                return request;
              },
            });
            return transaction;
          },
        };
        open.onsuccess();
      });
      return open;
    },
  });
  return { banks, close };
}

it("discovers a legacy local bank and deduplicates its hosted key", async () => {
  const { banks } = mockDatabase();
  const name = "PlainsoundHarpsichordLute.sf2";
  const hosted = "https://soundfonts.plainsound.org/" + name;
  banks.set("local:" + name, { name });
  banks.set(hosted, { name });
  expect(await storage.workingSoundfontKeys()).toEqual([hosted]);
});

it("keeps browser copies across reloads with Restore enabled", async () => {
  const { banks, close } = mockDatabase();
  const source = { name: "organ.sf2", url: "https://example.com/organ.sf2" };
  localStorage.setItem(SOUND_RESTORE_KEY, "false");
  await storage.storeSoundfontCopy(source, new Uint8Array([1, 2, 3]));
  localStorage.setItem(SOUND_RESTORE_KEY, "true");

  await loadStorage();
  await storage.initializeSoundfontStorage();
  const bank = await storage.readOfflineSoundfont(source.url);
  expect(bank.name).toBe(source.name);
  expect(bank.blob).toBeInstanceOf(Blob);
  expect(bank.blob.size).toBe(3);
  expect(banks.size).toBe(1);
  expect(close).toHaveBeenCalled();
});

it("discards previous browser copies on startup with Restore disabled", async () => {
  const { banks } = mockDatabase();
  const previous = { name: "organ.sf2" };
  const legacyKey = "local:PlainsoundOrgan.sf2";
  banks.set(legacyKey, { name: "PlainsoundOrgan.sf2", blob: new Blob(["legacy"]) });
  await storage.storeSoundfontCopy(previous, new Uint8Array([1]));
  localStorage.setItem(SOUND_RESTORE_KEY, "false");
  expect((await storage.readWorkingSoundfont("local:organ.sf2")).blob.size).toBe(1);

  await loadStorage();
  const initialization = storage.initializeSoundfontStorage();
  const writing = storage.storeSoundfontCopy({ name: "lute.sf2" }, new Uint8Array([2, 3]));
  await Promise.all([initialization, writing]);
  expect(await storage.readOfflineSoundfont("local:organ.sf2")).toBeUndefined();
  expect(await storage.readWorkingSoundfont("local:organ.sf2")).toBeUndefined();
  expect(await storage.readWorkingSoundfont(legacyKey)).toBeUndefined();
  expect((await storage.readWorkingSoundfont("local:lute.sf2")).blob.size).toBe(2);
  expect([...banks.keys()]).toEqual(["local:lute.sf2"]);
});

it("discards old temporary records even with Restore enabled", async () => {
  const { banks } = mockDatabase();
  banks.set("local:organ.sf2", { name: "organ.sf2", blob: new Blob(["bank"]), offline: false });
  await storage.initializeSoundfontStorage();
  expect(await storage.readWorkingSoundfont("local:organ.sf2")).toBeUndefined();
  expect(banks.size).toBe(0);
});

it("reports unavailable storage instead of claiming the bank is saved", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await expect(storage.storeSoundfontCopy({ name: "organ.sf2" }, new Uint8Array([1])))
    .rejects.toThrow("Offline storage is unavailable");
  const bank = await storage.readWorkingSoundfont("local:organ.sf2");
  expect(bank.blob.size).toBe(1);
  expect(bank.offline).toBe(false);
  await expect(storage.readOfflineSoundfont("local:organ.sf2"))
    .rejects.toThrow("Offline storage is unavailable");
  await expect(storage.storeSoundfontCopy({ name: "replacement.sf2" }, new Uint8Array([2, 3])))
    .rejects.toThrow("Offline storage is unavailable");
  expect((await storage.readWorkingSoundfont("local:replacement.sf2")).blob.size).toBe(2);
  await expect(storage.readWorkingSoundfont("local:organ.sf2"))
    .rejects.toThrow("Offline storage is unavailable");
});

it("shares a retained local Hexatone bank with its menu entry across page sessions", async () => {
  const { banks } = mockDatabase();
  const local = { name: "PlainsoundOrgan.sf2" };
  const hosted = { name: local.name, url: "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2" };
  expect(storage.soundfontStorageKey(local)).toBe(hosted.url);
  await storage.storeSoundfontCopy(local, new Uint8Array([1, 2, 3]));
  expect(banks.size).toBe(1);
  await loadStorage();
  await storage.initializeSoundfontStorage();
  expect((await storage.readOfflineSoundfont(hosted.url)).blob.size).toBe(3);
  expect((await storage.readWorkingSoundfont(hosted.url)).blob.size).toBe(3);
  await storage.storeSoundfontCopy(local, new Uint8Array([4, 5]));
  expect((await storage.readOfflineSoundfont(hosted.url)).blob.size).toBe(2);
  expect(banks.size).toBe(1);
});
it("reads a legacy local alias and replaces it with the canonical entry", async () => {
  const { banks } = mockDatabase();
  const name = "PlainsoundOrgan.sf2";
  const key = "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2";
  const legacy = "local:PlainsoundOrgan.sf2";
  banks.set(legacy, { name, url: "", blob: new Blob(["font"]), offline: true });
  expect((await storage.readOfflineSoundfont(key)).blob.size).toBe(4);
  await storage.storeSoundfontCopy({ name }, new Uint8Array([1, 2]));
  expect((await storage.readOfflineSoundfont(legacy)).blob.size).toBe(2);
  expect([...banks.keys()]).toEqual([key]);
});

it("keeps unrelated local names and third-party URLs separate", async () => {
  const { banks } = mockDatabase();
  const local = { name: "MyOrgan.sf2" };
  const remote = { name: "PlainsoundOrgan.sf2", url: "https://example.com/PlainsoundOrgan.sf2" };
  await storage.storeSoundfontCopy(local, new Uint8Array([1]));
  await storage.storeSoundfontCopy(remote, new Uint8Array([2, 3]));
  expect(storage.soundfontStorageKey(local)).toBe("local:MyOrgan.sf2");
  expect(storage.soundfontStorageKey(remote)).toBe(remote.url);
  expect(await storage.readOfflineSoundfont("https://soundfonts.plainsound.org/PlainsoundOrgan.sf2")).toBeUndefined();
  expect(banks.size).toBe(2);
});
