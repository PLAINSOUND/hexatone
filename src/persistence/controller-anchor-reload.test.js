import { afterEach, expect, it } from "vitest";
import { rememberControllerAnchorForReload } from "./controller-anchor-reload.js";
import { mergeRestoredPresetIntoSettings } from "../hooks/use-presets.js";
import { applyControllerPresetAnchor } from "../controllers/preset-anchors.js";
import { settingsToTuningRecord, serializeTuningRecord } from "../hexatone/tuning-record.js";
import { settingsToPresetJson } from "../settings/scale/parse-scale.js";
import { saveUserTunings, loadUserTunings } from "../hexatone/user-tunings.js";
import { loadAnchorSettingsUpdate } from "../input/controller-anchor.js";
import { getControllerById } from "../controllers/registry.js";

const key = "hexatone_restored_preset_payload";
it.each([
  ["exquis", 17, 1],
  ["lumatone", 41, 2],
])("round-trips explicit %s anchors through library and JSON over stale I/O", (id, note, channel) => {
  const settings = { name: "Anchor round trip", scale: ["2/1"],
    midi_passthrough: false, midiin_controller_override: "auto",
    midiin_anchor_note: note, midiin_anchor_channel: channel,
    [`${id}_anchor_note`]: note, [`${id}_anchor_channel`]: channel };
  const before = loadUserTunings();
  try {
    saveUserTunings([settingsToTuningRecord(settings)]);
    const library = loadUserTunings()[0];
    for (const preset of [library, JSON.parse(serializeTuningRecord(library)),
      JSON.parse(settingsToPresetJson(settings))]) {
      expect(preset[`${id}_anchor_note`]).toBe(note);
      expect(preset[`${id}_anchor_channel`]).toBe(id === "exquis" ? undefined : channel);
      const stale = { ...settings, midiin_controller_override: id,
        midiin_anchor_note: 60, midiin_anchor_channel: 9 };
      const restored = mergeRestoredPresetIntoSettings(stale, preset);
      expect(restored.midiin_anchor_note).toBe(note);
      expect(restored.midiin_anchor_channel).toBe(id === "exquis" ? 9 : channel);
      expect(loadAnchorSettingsUpdate(getControllerById(id), restored))
        .toMatchObject({ midiin_anchor_note: note, midiin_anchor_channel: channel });
    }
  } finally { saveUserTunings(before); }
});
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
