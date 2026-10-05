import { afterEach, expect, it, vi } from "vitest";
import { readOfflineSoundfont, storeOfflineSoundfont, removeOfflineSoundfont,
  readWorkingSoundfont, keepWorkingSoundfont, soundfontStorageKey } from "./soundfont-storage.js";

afterEach(() => vi.unstubAllGlobals());

it("stores a disk-backed Blob, retrieves it, and removes just the selected bank", async () => {
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
              get: (key) => result(banks.get(key)),
              delete: (key) => { banks.delete(key); return result(undefined); },
              openCursor: () => {
                const request = {};
                queueMicrotask(() => {
                  request.result = null;
                  request.onsuccess();
                  transaction.oncomplete();
                });
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
  const source = { name: "organ.sf2", url: "https://example.com/organ.sf2" };
  const bytes = new Uint8Array([1, 2, 3]);
  await storeOfflineSoundfont(source, bytes);
  const bank = await readOfflineSoundfont(soundfontStorageKey(source));
  expect(bank.name).toBe(source.name);
  expect(bank.blob).toBeInstanceOf(Blob);
  expect(bank.blob.size).toBe(3);
  await removeOfflineSoundfont(source.url);
  expect(await readOfflineSoundfont(source.url)).toBeUndefined();
  const temporary = await readWorkingSoundfont(source.url);
  expect(temporary.blob).toBe(bank.blob);
  expect(temporary.offline).toBe(false);
  banks.set(source.url, { ...temporary, sessionId: "another-page-session" });
  expect(await readWorkingSoundfont(source.url)).toBeUndefined();
  expect(await readOfflineSoundfont(source.url)).toBeUndefined();
  banks.set(source.url, temporary);
  await keepWorkingSoundfont(source);
  expect((await readOfflineSoundfont(source.url)).offline).toBe(true);
  expect(close).toHaveBeenCalled();
});

it("reports unavailable storage instead of claiming the bank is saved", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await expect(storeOfflineSoundfont({ name: "organ.sf2" }, new Uint8Array([1])))
    .rejects.toThrow("Offline storage is unavailable");
  const bank = await readWorkingSoundfont("local:organ.sf2");
  expect(bank.blob.size).toBe(1);
  expect(bank.offline).toBe(false);
  await expect(keepWorkingSoundfont({ name: "organ.sf2" }))
    .rejects.toThrow("Offline storage is unavailable");
  await expect(readOfflineSoundfont("local:organ.sf2"))
    .rejects.toThrow("Offline storage is unavailable");
  await expect(storeOfflineSoundfont({ name: "replacement.sf2" }, new Uint8Array([2, 3])))
    .rejects.toThrow("Offline storage is unavailable");
  expect((await readWorkingSoundfont("local:replacement.sf2")).blob.size).toBe(2);
  await expect(readWorkingSoundfont("local:organ.sf2"))
    .rejects.toThrow("Offline storage is unavailable");
});
