/** Contract tests for identical comparison controls and isolated voice cleanup. */
import { describe, it, expect, vi } from "vitest";
import { COMPARISON_GROUP, comparisonControls, createComparisonVoice, nativeComparisonMessage } from "./supersonic-comparison.js";

describe("SuperSonic comparison", () => {
  it("bounds controls without quantising frequency", () => {
    const pairs = comparisonControls({ frequency: 441.12345, level: 9, mod: -1 });
    expect(pairs[pairs.indexOf("freq") + 1]).toBe(441.12345);
    expect(pairs[pairs.indexOf("vol") + 1]).toBe(0.3);
    expect(pairs[pairs.indexOf("mod") + 1]).toBe(1);
  });
  it("releases before replacement and panics only its own group", () => {
    const send = vi.fn(); let id = 100;
    const voice = createComparisonVoice(send, () => id++);
    voice.attack("string", {});
    voice.attack("formant", {});
    expect(send.mock.calls[1]).toEqual(["/n_set", 100, "gate", 0]);
    voice.ended(100); voice.update({});
    expect(send.mock.calls.at(-1)[1]).toBe(101);
    voice.ended(101); send.mockClear(); voice.update({});
    expect(send).not.toHaveBeenCalled();
    voice.panic();
    expect(send).toHaveBeenCalledWith("/g_freeAll", COMPARISON_GROUP);
  });
  it("preserves OSC integer IDs and floating point controls for the bridge", () => {
    const result = nativeComparisonMessage(57110, "/s_new", ["hexlab_string", 123, 0, COMPARISON_GROUP, "freq", 441]);
    expect(result.args.map(arg => arg.type)).toEqual(["s", "i", "i", "i", "s", "f"]);
  });
});
