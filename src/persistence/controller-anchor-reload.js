import { buildControllerPresetAnchorUpdate } from "../controllers/preset-anchors.js";

// Anchor edits belong to the active session, not the original library preset.
// Keep its reload snapshot current so preset restoration cannot undo Learn.
export function rememberControllerAnchorForReload(controllerId, note, channel) {
  try {
    if (localStorage.getItem("hexatone_restore_io_on_reload") === "false") return;
    const key = "hexatone_restored_preset_payload";
    const payload = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!payload?.preset) return;
    const update = buildControllerPresetAnchorUpdate(controllerId, note, channel);
    if (!Object.keys(update).length) return;
    payload.preset = { ...payload.preset, ...update };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch { /* Restricted or malformed storage must not interrupt MIDI Learn. */ }
}
