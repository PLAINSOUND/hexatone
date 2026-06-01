import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("withMidiJitterInput", () => {
  const originalStorage = globalThis.localStorage;

  beforeEach(() => {
    const store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key) => store.get(key) ?? null),
      setItem: vi.fn((key, value) => {
        store.set(key, String(value));
      }),
      removeItem: vi.fn((key) => {
        store.delete(key);
      }),
    });
    localStorage.setItem("hexatone_debug", "midijitter");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalStorage) vi.stubGlobal("localStorage", originalStorage);
  });

  it("keeps the input context alive until async work settles", async () => {
    const { withMidiJitterInput, traceMidiOutput } = await import("./midi-jitter.js");

    await withMidiJitterInput(
      "noteOnIn",
      { channel: 1, note: 60, value: 100 },
      async () => {
        await Promise.resolve();
        traceMidiOutput("noteOnOut", { family: "sample", channel: 1, note: 60 });
      },
    );

    const logs = console.log.mock.calls.map((call) => call[0]);
    expect(logs.some((line) => line.includes("[midijitter:out]") && line.includes("sourceSeq=1"))).toBe(true);
  });
});
