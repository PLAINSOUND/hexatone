import { describe, expect, it } from "vitest";
import {
  CALCULATOR_WORKSPACE_STORAGE_KEY,
  loadCalculatorWorkspace,
  saveCalculatorWorkspace,
} from "./session-persistence.js";

describe("Calculator session persistence", () => {
  it("keeps independent Calculator data for each tuning identity", () => {
    const storage = new Map();
    const session = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    };

    saveCalculatorWorkspace("blank", { queryInterval: "1/1" }, session);
    saveCalculatorWorkspace("restored-preset", { queryInterval: "5/4" }, session);

    expect(loadCalculatorWorkspace("blank", session)).toEqual({ queryInterval: "1/1" });
    expect(loadCalculatorWorkspace("restored-preset", session)).toEqual({
      queryInterval: "5/4",
    });
    expect(JSON.parse(storage.get(CALCULATOR_WORKSPACE_STORAGE_KEY)).version).toBe(1);
  });
});
