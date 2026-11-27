import { createSampleBufferCache } from "./buffer-cache.js";

it("evicts the least recently used sample references and skips oversized entries", () => {
  const cache = createSampleBufferCache(8, buffer => buffer.byteLength);
  const sounding = new ArrayBuffer(4);
  cache.set("held instrument", sounding);
  cache.set("older instrument", new ArrayBuffer(4));
  expect(cache.get("held instrument")).toBe(sounding);
  cache.set("new instrument", new ArrayBuffer(4));
  expect(cache.get("older instrument")).toBeUndefined();

  cache.set("large instrument", new ArrayBuffer(9));
  expect(cache.get("large instrument")).toBeUndefined();
  expect(cache.diagnostics()).toEqual({ bytes: 8, budgetBytes: 8, instruments: 2 });
  cache.clear();
  expect(cache.diagnostics().bytes).toBe(0);
  expect(sounding.byteLength).toBe(4);
});
