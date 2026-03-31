/**
 * input/controller-anchor.js
 *
 * Single source of truth for loading and saving per-controller anchor notes
 * and anchor channels from/to localStorage.
 *
 * Previously this logic was duplicated in:
 *   - use-settings-change.js  (on MIDI input device selection)
 *   - use-synth-wiring.js     (on MIDI-learn key press)
 *
 * Both call sites now delegate here so they cannot drift apart.
 *
 * Storage keys:
 *   `${controller.id}_anchor`         — physical MIDI note number (int)
 *   `${controller.id}_anchor_channel` — MIDI channel for channel-aware
 *                                       controllers such as Lumatone (int)
 *
 * These keys use localStorage (not sessionStorage) so that anchor preferences
 * survive browser restart and persist across device reconnects.
 */

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Load the saved anchor note for a controller from localStorage.
 * Falls back to `controller.anchorDefault` if no value has been saved.
 *
 * @param {object} controller  Registry entry (must have .id and .anchorDefault)
 * @returns {number}
 */
export function loadSavedAnchor(controller) {
  const raw = localStorage.getItem(`${controller.id}_anchor`);
  return raw !== null ? parseInt(raw) : controller.anchorDefault;
}

/**
 * Load the saved anchor channel for a channel-aware controller (e.g. Lumatone).
 * Returns null for controllers that have no `anchorChannelDefault`
 * (i.e. single-channel controllers where channel carries no layout meaning).
 * Falls back to `controller.anchorChannelDefault` if no value has been saved.
 *
 * @param {object} controller  Registry entry
 * @returns {number|null}
 */
export function loadSavedAnchorChannel(controller) {
  if (controller.anchorChannelDefault == null) return null;
  const raw = localStorage.getItem(`${controller.id}_anchor_channel`);
  return raw !== null ? parseInt(raw) : controller.anchorChannelDefault;
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Save an anchor note for a controller to localStorage.
 *
 * @param {object} controller  Registry entry
 * @param {number} note        Physical MIDI note number to save
 */
export function saveAnchor(controller, note) {
  localStorage.setItem(`${controller.id}_anchor`, String(note));
}

/**
 * Save an anchor channel for a channel-aware controller to localStorage.
 * No-op if the controller has no `anchorChannelDefault` (single-channel device).
 *
 * @param {object} controller  Registry entry
 * @param {number} channel     MIDI channel to save
 */
export function saveAnchorChannel(controller, channel) {
  if (controller.anchorChannelDefault == null) return;
  localStorage.setItem(`${controller.id}_anchor_channel`, String(channel));
}

// ── Combined helpers used by call sites ───────────────────────────────────────

/**
 * Given a controller, return the full anchor state to merge into settings:
 *   { midiin_central_degree, lumatone_center_channel?, midiin_mpe_input,
 *     midiin_mpe_lo_ch?, midiin_mpe_hi_ch? }
 *
 * Used by use-settings-change.js on device selection.
 * Automatically sets midiin_mpe_input based on whether the controller is MPE.
 * When the controller has a fixed `mpeVoiceChannels` range, also applies
 * those channel bounds to midiin_mpe_lo_ch / midiin_mpe_hi_ch (hides the
 * manual picker in the MPE Setup UI).
 *
 * @param {object} controller  Registry entry
 * @returns {{ midiin_central_degree: number, midiin_mpe_input: boolean,
 *             lumatone_center_channel?: number,
 *             midiin_mpe_lo_ch?: number, midiin_mpe_hi_ch?: number }}
 */
export function loadAnchorSettingsUpdate(controller) {
  const update = {
    midiin_central_degree: loadSavedAnchor(controller),
    midiin_mpe_input: !!controller.mpe,
  };
  const ch = loadSavedAnchorChannel(controller);
  if (ch !== null) update.lumatone_center_channel = ch;
  // Auto-apply fixed MPE voice channel range for controllers that define one.
  // When mpeVoiceChannels is non-null, the UI picker is hidden and these values
  // are set programmatically so the engine uses the correct range immediately.
  if (controller.mpeVoiceChannels) {
    update.midiin_mpe_lo_ch = controller.mpeVoiceChannels.lo;
    update.midiin_mpe_hi_ch = controller.mpeVoiceChannels.hi;
  }
  return update;
}

/**
 * Save all anchor state for a controller after a MIDI-learn event and return
 * the settings update to merge. Mirrors `loadAnchorSettingsUpdate` but writes
 * rather than reads.
 *
 * Used by use-synth-wiring.js in onAnchorLearn.
 *
 * @param {object} controller  Registry entry
 * @param {number} note        Learned anchor note
 * @param {number} channel     Learned anchor channel
 * @returns {{ midiin_central_degree: number, midiin_anchor_channel: number,
 *             lumatone_center_channel?: number, lumatone_center_note?: number }}
 */
export function saveAnchorFromLearn(controller, note, channel) {
  saveAnchor(controller, note);
  saveAnchorChannel(controller, channel);

  const update = {
    midiin_central_degree: note,
    midiin_anchor_channel: channel,
  };
  // For channel-aware controllers (e.g. Lumatone), also expose per-note block data.
  if (controller.anchorChannelDefault != null) {
    update.lumatone_center_channel = channel;
    update.lumatone_center_note    = note;  // note is 0–55 within the block
  }
  return update;
}
