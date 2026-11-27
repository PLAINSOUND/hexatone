import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Blob } from "node:buffer";
const storage = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./soundfont-storage.js", () => ({ readWorkingSoundfont: storage.read }));
import { createSoundfontSource } from "./soundfont-source.js";

const url = "https://soundfonts.plainsound.org/PlainsoundOrgan.sf2";
const make = (options) => createSoundfontSource({ name: "PlainsoundOrgan.sf2", url, ...options });
beforeEach(() => {
  storage.read.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it.each([true, false])(
  "reuses a stored bank without changing its offline preference (%s)",
  async (offline) => {
    const bank = { offline, blob: new Blob([new Uint8Array([1, 2, 3])]) };
    storage.read.mockResolvedValue(bank);
    const source = make();
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(source.cachedBankKey).toBe(url);
    expect(source.offline).toBe(offline);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("uses the bank already checked by recall instead of reading storage again", async () => {
  const source = make({ cachedBank: { blob: new Blob(["bank"]) } });
  await source.arrayBuffer();
  expect(storage.read).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("never falls back to a download during automatic recall", async () => {
  storage.read.mockResolvedValue(null);
  await expect(make().arrayBuffer()).rejects.toThrow("No stored copy");
  storage.read.mockRejectedValue(new Error("Storage denied"));
  await expect(make().arrayBuffer()).rejects.toThrow("Stored copy unavailable");
  expect(fetch).not.toHaveBeenCalled();
});

it("downloads only when explicitly allowed and reports streamed progress", async () => {
  storage.read.mockResolvedValue(null);
  fetch.mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "3" } }),
  );
  const onPhase = vi.fn(),
    progress = vi.fn();
  const source = make({ allowDownload: true, onPhase });
  expect(new Uint8Array(await source.arrayBuffer(progress))).toEqual(new Uint8Array([1, 2, 3]));
  expect(onPhase).toHaveBeenCalledWith("Downloading");
  expect(progress).toHaveBeenLastCalledWith({ loaded: 3, total: 3 });
  expect(source.cachedBankKey).toBeNull();
});

it("does not download if canceled while checking the cache", async () => {
  let finish;
  storage.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = make({ allowDownload: true, signal: controller.signal }).arrayBuffer();
  controller.abort();
  finish(null);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects incomplete downloads and releases their stream reader", async () => {
  storage.read.mockResolvedValue(null);
  const response = new Response(new Uint8Array([1, 2]), { headers: { "content-length": "3" } });
  fetch.mockResolvedValue(response);
  await expect(make({ allowDownload: true }).arrayBuffer()).rejects.toThrow(
    "download was incomplete",
  );
  expect(response.body.locked).toBe(false);
});
