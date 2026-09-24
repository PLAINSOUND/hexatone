import { beforeEach, afterEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it("does not persist when disabled", async () => {
  const { recordReloadDiagnostic, RELOAD_DIAGNOSTICS_KEY } = await import("./reload-diagnostics.js");
  recordReloadDiagnostic("app-render");
  expect(sessionStorage.getItem(RELOAD_DIAGNOSTICS_KEY)).toBeNull();
});

it("bounds detail history and checkpoints without yielding to timers", async () => {
  localStorage.setItem("hexatone_debug_reload", "true");
  const { recordReloadDiagnostic, RELOAD_DIAGNOSTICS_KEY } = await import("./reload-diagnostics.js");
  for (let i = 0; i < 1000; i++) recordReloadDiagnostic("settings-update", { changedKeys: ["instrument"] });
  const saved = JSON.parse(sessionStorage.getItem(RELOAD_DIAGNOSTICS_KEY));
  expect(saved.counts["settings-update"]).toBe(1000);
  expect(saved.recent).toHaveLength(12);
});

it("preserves the preceding capture when the module restarts", async () => {
  localStorage.setItem("hexatone_debug_reload", "true");
  let module = await import("./reload-diagnostics.js");
  module.recordReloadDiagnostic("app-render");
  const first = sessionStorage.getItem(module.RELOAD_DIAGNOSTICS_KEY);
  vi.resetModules();
  module = await import("./reload-diagnostics.js");
  module.recordReloadDiagnostic("app-render");
  expect(sessionStorage.getItem(module.RELOAD_DIAGNOSTICS_PREVIOUS_KEY)).toBe(first);
});
