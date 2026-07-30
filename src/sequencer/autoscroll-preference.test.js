import { describe, expect, it, vi } from "vitest";
import {
  AUTO_SCROLL_STORAGE_KEY,
  loadSequencerAutoScrollPreference,
  saveSequencerAutoScrollPreference,
} from "./autoscroll-preference.js";

describe("sequencer autoscroll preference", () => {
  it("defaults to enabled and restores either persisted value", () => {
    expect(loadSequencerAutoScrollPreference({ getItem: () => null })).toBe(true);
    expect(loadSequencerAutoScrollPreference({ getItem: () => "true" })).toBe(true);
    expect(loadSequencerAutoScrollPreference({ getItem: () => "false" })).toBe(false);
  });

  it("persists without throwing when storage is unavailable", () => {
    const setItem = vi.fn();
    saveSequencerAutoScrollPreference(false, { setItem });
    expect(setItem).toHaveBeenCalledWith(AUTO_SCROLL_STORAGE_KEY, "false");

    expect(() =>
      saveSequencerAutoScrollPreference(true, {
        setItem() {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
