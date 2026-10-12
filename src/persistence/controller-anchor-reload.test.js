import { afterEach, expect, it } from "vitest";
import { rememberControllerAnchorForReload } from "./controller-anchor-reload.js";
import { mergeRestoredPresetIntoSettings } from "../hooks/use-presets.js";
import { applyControllerPresetAnchor } from "../controllers/preset-anchors.js";

const key = "hexatone_restored_preset_payload";
afterEach(() => { sessionStorage.removeItem(key); localStorage.removeItem("hexatone_restore_io_on_reload"); });

it("keeps a learned Exquis anchor through preset restoration on reload", () => {
  localStorage.setItem("hexatone_restore_io_on_reload", "true");
  const original = { name: "Test", scale: ["2/1"], exquis_anchor_note: 30 };
  sessionStorage.setItem(key, JSON.stringify({ source: "builtin", name: "Test", preset: original }));
  rememberControllerAnchorForReload("exquis", 17, 3);
  const payload = JSON.parse(sessionStorage.getItem(key));
  const restored = mergeRestoredPresetIntoSettings({ midiin_controller_override: "exquis", midiin_anchor_note: 17 }, payload.preset);
  expect(restored.midiin_anchor_note).toBe(17);
  expect(restored.exquis_anchor_note).toBe(17);
  expect(applyControllerPresetAnchor(restored, "exquis").midiin_anchor_note).toBe(17);
  expect(original.exquis_anchor_note).toBe(30);
  expect(payload.source).toBe("builtin");
});

it("does not rewrite the reload anchor when Restore I/O is disabled", () => {
  localStorage.setItem("hexatone_restore_io_on_reload", "false");
  sessionStorage.setItem(key, JSON.stringify({ preset: { exquis_anchor_note: 30 } }));
  rememberControllerAnchorForReload("exquis", 17);
  expect(JSON.parse(sessionStorage.getItem(key)).preset.exquis_anchor_note).toBe(30);
});
