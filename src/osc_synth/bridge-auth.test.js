import { afterEach, expect, it } from "vitest";
import { bridgeProtocols, getBridgeToken, setBridgeToken, subscribeBridgeToken } from "./bridge-auth.js";
afterEach(() => sessionStorage.clear());
it("keeps pairing tokens session-only and out of URLs/settings", () => {
  const url = "ws://localhost:8089";
  const token = "a".repeat(64);
  setBridgeToken(url, token);
  expect(getBridgeToken("ws://127.0.0.1:8089")).toBe(token);
  expect(bridgeProtocols(url)).toEqual(["hexatone-osc", `hexatone-token.${token}`]);
  expect(localStorage.getItem("osc_bridge_token")).toBeNull();
  expect(() => setBridgeToken(url, "invalid")).toThrow("pairing token");
  expect(() => setBridgeToken(url + "?token=secret", token)).toThrow("without credentials");
  setBridgeToken(url, "");
  expect(bridgeProtocols(url)).toEqual(["hexatone-osc"]);
});
it("notifies only the matching bridge and removes listeners on shutdown", () => {
  const seen = [];
  const unsubscribe = subscribeBridgeToken("ws://localhost:8089", () => seen.push(true));
  setBridgeToken("ws://127.0.0.1:8090", "a".repeat(64));
  expect(seen).toEqual([]);
  setBridgeToken("ws://127.0.0.1:8089", "a".repeat(64));
  expect(seen).toEqual([true]);
  unsubscribe();
  setBridgeToken("ws://127.0.0.1:8089", "b".repeat(64));
  expect(seen).toEqual([true]);
});
