export const SETTINGS_IMPACT_FIELDS = {
  tuning: [
    "scale",
    "equivSteps",
    "reference_degree",
    "fundamental",
  ],
  layout: [
    "rSteps",
    "drSteps",
    "center_degree",
    "hexSize",
    "rotation",
  ],
  labels: [
    "note_names",
    "key_labels",
    "show_equaves",
    "heji_anchor_label",
    "heji_anchor_ratio",
    "heji_show_cents",
    "heji_tempered_only",
  ],
  colors: [
    "note_colors",
    "spectrum_colors",
    "fundamental_color",
  ],
  inputBinding: [
    "midiin_device",
    "midiin_channel",
    "midiin_steps_per_channel",
    "midiin_anchor_channel",
    "midiin_controller_override",
    "controller_anchor_note",
    "midiin_channel_legacy",
    "midi_passthrough",
    "midiin_central_degree",
    "axis49_center_note",
    "wheel_to_recent",
    "midiin_mapping_target",
    "midiin_mpe_input",
    "midiin_pitchbend_mode",
    "midiin_pressure_mode",
    "lumatone_center_channel",
    "lumatone_center_note",
  ],
  inputRuntime: [
    "midiin_device",
    "midiin_channel",
    "midiin_steps_per_channel",
    "midiin_anchor_channel",
    "midiin_central_degree",
    "midiin_channel_legacy",
    "midiin_controller_override",
    "midiin_mapping_target",
    "midiin_mpe_input",
    "midiin_pitchbend_mode",
    "midiin_pressure_mode",
    "midiin_modwheel_source",
    "midiin_modwheel_value",
    "midi_passthrough",
    "controller_anchor_note",
    "axis49_center_note",
    "wheel_to_recent",
    "lumatone_center_channel",
    "lumatone_center_note",
    "lumatone_led_sync",
    "exquis_led_sync",
    "linnstrument_led_sync",
  ],
  outputRuntime: [
    "instrument",
    "output_sample",
    "output_mts",
    "output_mpe",
    "output_mts_bulk",
    "output_osc",
    "midi_device",
    "midi_channel",
    "midi_mapping",
    "midi_velocity",
    "sysex_auto",
    "sysex_type",
    "device_id",
    "tuning_map_number",
    "mts_bulk_device",
    "mts_bulk_mode",
    "mts_bulk_channel",
    "mts_bulk_sysex_auto",
    "mts_bulk_device_id",
    "mts_bulk_tuning_map_number",
    "mts_bulk_tuning_map_name",
    "fluidsynth_device",
    "fluidsynth_channel",
    "mpe_device",
    "mpe_manager_ch",
    "mpe_lo_ch",
    "mpe_hi_ch",
    "mpe_pitchbend_range",
    "mpe_mode",
  ],
};

export const SETTINGS_IMPACT_GROUPS = {
  structural: [
    ...SETTINGS_IMPACT_FIELDS.tuning,
    ...SETTINGS_IMPACT_FIELDS.layout,
    ...SETTINGS_IMPACT_FIELDS.labels,
  ],
  keysReconstruction: [
    ...SETTINGS_IMPACT_FIELDS.tuning,
    ...SETTINGS_IMPACT_FIELDS.layout,
    ...SETTINGS_IMPACT_FIELDS.inputBinding,
  ],
  musicalSurfaceReset: [
    ...SETTINGS_IMPACT_FIELDS.tuning,
    ...SETTINGS_IMPACT_FIELDS.layout,
  ],
  colors: SETTINGS_IMPACT_FIELDS.colors,
  inputRuntime: SETTINGS_IMPACT_FIELDS.inputRuntime,
  outputRuntime: SETTINGS_IMPACT_FIELDS.outputRuntime,
};

export function settingsImpactSnapshot(settings, group, extra = {}) {
  const fields = SETTINGS_IMPACT_GROUPS[group] ?? SETTINGS_IMPACT_FIELDS[group];
  if (!fields) throw new Error(`Unknown settings impact group: ${group}`);
  const snapshot = {};
  for (const field of fields) snapshot[field] = settings?.[field];
  return { ...snapshot, ...extra };
}

export function settingsImpactKey(settings, group, extra = {}) {
  return JSON.stringify(settingsImpactSnapshot(settings, group, extra));
}
