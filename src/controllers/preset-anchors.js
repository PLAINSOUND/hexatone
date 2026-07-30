import { getControllerById } from "./registry.js";

/**
 * Controller anchors that belong to a tuning preset rather than to the
 * controller preference store. Keep the JSON field names here so exporting,
 * preset loading, manual edits, and MIDI learn all use the same mapping.
 */
export const CONTROLLER_PRESET_ANCHOR_CONFIGS = [
  {
    controllerId: "lumatone",
    noteKey: "lumatone_anchor_note",
    channelKey: "lumatone_anchor_channel",
  },
  {
    controllerId: "exquis",
    noteKey: "exquis_anchor_note",
  },
  {
    controllerId: "linnstrument",
    noteKey: "linnstrument_anchor_note",
    channelKey: "linnstrument_anchor_channel",
  },
  {
    controllerId: "hakenaudio",
    noteKey: "haken_anchor_note",
  },
];

export const CONTROLLER_PRESET_ANCHOR_FIELDS = CONTROLLER_PRESET_ANCHOR_CONFIGS.flatMap(
  ({ noteKey, channelKey }) => [noteKey, ...(channelKey ? [channelKey] : [])],
);

export function getControllerPresetAnchorConfig(controllerId) {
  return CONTROLLER_PRESET_ANCHOR_CONFIGS.find((config) => config.controllerId === controllerId);
}

export function buildControllerPresetAnchorUpdate(controllerId, note, channel) {
  const config = getControllerPresetAnchorConfig(controllerId);
  if (!config) return {};

  return {
    ...(Number.isFinite(note) ? { [config.noteKey]: note } : {}),
    ...(config.channelKey && Number.isFinite(channel) ? { [config.channelKey]: channel } : {}),
  };
}

export function hasControllerPresetAnchor(settings = {}, controllerId) {
  if (settings.midi_passthrough === true) return false;
  const config = getControllerPresetAnchorConfig(controllerId);
  if (!config) return false;
  return (
    Number.isFinite(settings[config.noteKey]) ||
    (config.channelKey && Number.isFinite(settings[config.channelKey]))
  );
}

export function applyControllerPresetAnchor(settings = {}, controllerId, update = {}) {
  if (!hasControllerPresetAnchor(settings, controllerId)) return update;
  const config = getControllerPresetAnchorConfig(controllerId);
  return {
    ...update,
    ...(Number.isFinite(settings[config.noteKey])
      ? { midiin_anchor_note: settings[config.noteKey] }
      : {}),
    ...(config.channelKey && Number.isFinite(settings[config.channelKey])
      ? { midiin_anchor_channel: settings[config.channelKey] }
      : {}),
  };
}

export function deriveControllerPresetAnchorFields(settings = {}) {
  if (settings.midi_passthrough === true) return {};

  const fields = {};
  for (const config of CONTROLLER_PRESET_ANCHOR_CONFIGS) {
    if (Number.isFinite(settings[config.noteKey])) {
      fields[config.noteKey] = settings[config.noteKey];
    }
    if (config.channelKey && Number.isFinite(settings[config.channelKey])) {
      fields[config.channelKey] = settings[config.channelKey];
    }
  }

  const activeConfig = getControllerPresetAnchorConfig(settings.midiin_controller_override);
  if (!activeConfig) return fields;

  const controller = getControllerById(activeConfig.controllerId);
  const note = settings.midiin_anchor_note;
  const channel = settings.midiin_anchor_channel;
  const hasExplicitNote = Number.isFinite(settings[activeConfig.noteKey]);
  const hasExplicitChannel =
    activeConfig.channelKey && Number.isFinite(settings[activeConfig.channelKey]);

  if (Number.isFinite(note) && (hasExplicitNote || note !== controller?.anchorDefault)) {
    fields[activeConfig.noteKey] = note;
  }
  if (
    activeConfig.channelKey &&
    Number.isFinite(channel) &&
    (hasExplicitChannel || channel !== controller?.anchorChannelDefault)
  ) {
    fields[activeConfig.channelKey] = channel;
  }

  return fields;
}
