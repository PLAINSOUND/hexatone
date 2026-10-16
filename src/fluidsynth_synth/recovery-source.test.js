import { describe, expect, it, vi } from "vitest";
import { readRecoverySoundfont } from "./recovery-source.js";
import { readWorkingSoundfont } from "./soundfont-storage.js";

vi.mock("./soundfont-storage.js", () => ({
  readWorkingSoundfont: vi.fn(),
  soundfontStorageKey: source => source.url || `local:${source.name}`,
}));

describe("SoundFont recovery source", () => {
  it("reopens the stored copy without touching a stale file handle", async () => {
    const bytes = new ArrayBuffer(4);
    readWorkingSoundfont.mockResolvedValue({ blob: { arrayBuffer: async () => bytes } });
    const source = { name: "organ.sf2", arrayBuffer: vi.fn(() => { throw new Error("NotFoundError"); }) };
    expect(await readRecoverySoundfont(source)).toBe(bytes);
    expect(source.arrayBuffer).not.toHaveBeenCalled();
  });
  it("falls back to the original source when storage is unavailable", async () => {
    readWorkingSoundfont.mockRejectedValue(new Error("Unavailable"));
    const bytes = new ArrayBuffer(4);
    expect(await readRecoverySoundfont({ name: "organ.sf2", arrayBuffer: async () => bytes })).toBe(bytes);
  });
  it("explains when the user must reload an unreadable file", async () => {
    readWorkingSoundfont.mockResolvedValue(undefined);
    await expect(readRecoverySoundfont({ name: "organ.sf2", arrayBuffer: async () => {
      throw new Error("The object can not be found here.");
    } })).rejects.toThrow("Reload the SoundFont file");
  });
});
